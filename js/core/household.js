/**
 * Hushåll + Vänner (signed in, household tables mode). Holds the current
 * household, its members, my profile, invites, friends, the members' stars and
 * reviews, "who changed the status" and the "Senast i köket" feed, and wraps the
 * RPCs of supabase/migrations 0002 (see docs/household-friends-plan.md).
 *
 * Everything here is display data for the signed-in user; the shared journal data
 * itself lives in user-recipe-state.js / recipe-journal.js and is synced by
 * table-sync.js. A small cache in localStorage keeps names and avatars available
 * offline. Fires `householdchange` on window ({ detail: { what } }).
 */
const CACHE_KEY = 'yessy.household.v1';
export const MAX_MEMBERS = 8;
/** Where a #join/… or #friend/… link waits while the user signs in. */
export const PENDING_KEY = 'yessy.pendingInvite.v1';

let client = null;
let uid = null;

const st = {
  mode: 'local', // 'local' (signed out) | 'legacy' (old tables only) | 'tables'
  household: null, // { id, name, is_personal }
  members: [], // [{ user_id, role, joined_at, display_name, avatar_emoji }]
  profile: null, // my profile row
  invites: [], // active invites of my household
  friends: [], // [{ user_id, status, requested_by, display_name, avatar_emoji, share }]
  ratings: new Map(), // recipeId -> [{ user_id, rating, review, review_at }]
  statusMeta: new Map(), // recipeId -> { by, at }
  feed: [], // kitchen_feed rows
  feedMore: false,
  feedLoaded: false,
};

function fire(what) { window.dispatchEvent(new CustomEvent('householdchange', { detail: { what } })); }

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      uid, household: st.household, members: st.members, profile: st.profile, friends: st.friends,
    }));
  } catch { /* private mode */ }
}
function loadCache(forUid) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!c || c.uid !== forUid) return;
    st.household = c.household || null;
    st.members = Array.isArray(c.members) ? c.members : [];
    st.profile = c.profile || null;
    st.friends = Array.isArray(c.friends) ? c.friends : [];
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Wiring (sync.js)
// ---------------------------------------------------------------------------
export function attach(c, user) {
  const nextUid = user ? user.id : null;
  client = c;
  if (nextUid !== uid) {
    uid = nextUid;
    st.household = null; st.members = []; st.profile = null; st.invites = []; st.friends = [];
    st.ratings = new Map(); st.statusMeta = new Map(); st.feed = []; st.feedLoaded = false; st.feedMore = false;
    if (uid) loadCache(uid);
    st.mode = uid ? st.mode : 'local';
    fire('all');
  }
}
export function setMode(mode) { if (st.mode !== mode) { st.mode = mode; fire('mode'); } }

export const mode = () => st.mode;
export const isTables = () => st.mode === 'tables' && !!uid;
export const myId = () => uid;
export const household = () => st.household;
export const members = () => st.members.slice();
export const profile = () => st.profile;
export const invites = () => st.invites.slice();
export const friends = () => st.friends.slice();
/** True when someone else shares my household. */
export const isShared = () => isTables() && st.members.length > 1;
export const isOwner = () => !!st.members.find((m) => m.user_id === uid && m.role === 'owner');

function profileOf(id) {
  if (!id) return null;
  if (id === uid && st.profile) return st.profile;
  return st.members.find((m) => m.user_id === id) || st.friends.find((f) => f.user_id === id) || null;
}
/** Display name; 'du' for me (capitalised with { cap: true }). */
export function nameOf(id, { cap = false, me = true } = {}) {
  if (id && id === uid && me) return cap ? 'Du' : 'du';
  const p = profileOf(id);
  const n = p && p.display_name ? p.display_name : 'Någon';
  return n;
}
/** Short avatar: the emoji, or the first letter of the name, or '?'. */
export function avatarChar(id) {
  const p = profileOf(id);
  if (p && p.avatar_emoji) return p.avatar_emoji;
  const n = p && p.display_name ? p.display_name.trim() : '';
  return n ? n.charAt(0).toUpperCase() : '?';
}
/** Inline avatar chip (emoji or initial in a ring; always paired with a name/label in words). */
export function avatarHtml(id, cls = '') {
  const p = profileOf(id);
  const isEmoji = !!(p && p.avatar_emoji);
  const ch = avatarChar(id).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<span class="hh-av${isEmoji ? ' is-emoji' : ''}${cls ? ` ${cls}` : ''}" aria-hidden="true">${ch}</span>`;
}

// ---------------------------------------------------------------------------
// Data set by table-sync.js
// ---------------------------------------------------------------------------
export function setRatingRows(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (!r || !r.recipe_id) continue;
    if (r.rating == null && !(r.review && r.review.trim())) continue;
    if (!m.has(r.recipe_id)) m.set(r.recipe_id, []);
    m.get(r.recipe_id).push({ user_id: r.user_id, rating: r.rating, review: r.review || '', review_at: r.review_at, rating_at: r.rating_at });
  }
  st.ratings = m;
  fire('ratings');
}
export function setStatusMeta(rows) {
  const m = new Map();
  for (const r of rows || []) if (r && r.recipe_id && r.status_at && Date.parse(r.status_at) > 0) m.set(r.recipe_id, { by: r.updated_by, at: Date.parse(r.status_at) });
  st.statusMeta = m;
}
/** Replace one recipe's rows (after saving my review). */
export function patchRatings(recipeId, rows) {
  const list = (rows || []).filter((r) => r.rating != null || (r.review && r.review.trim()))
    .map((r) => ({ user_id: r.user_id, rating: r.rating, review: r.review || '', review_at: r.review_at, rating_at: r.rating_at }));
  if (list.length) st.ratings.set(recipeId, list); else st.ratings.delete(recipeId);
  fire('ratings');
}
/** Keep my own stars in the display rows in step with a local change. */
export function setMyRating(recipeId, rating) {
  if (!uid) return;
  const list = ratingsFor(recipeId);
  const mine = list.find((x) => x.user_id === uid);
  if (mine) mine.rating = rating; else if (rating) list.push({ user_id: uid, rating, review: '', review_at: null, rating_at: new Date().toISOString() });
  patchRatings(recipeId, list);
}
/** Everyone's stars/reviews for a recipe (me included). */
export const ratingsFor = (recipeId) => (st.ratings.get(recipeId) || []).slice();
/** Other members' stars/reviews for a recipe (only people still in the household). */
export function householdRatings(recipeId) {
  const ids = new Set(st.members.map((m) => m.user_id));
  return ratingsFor(recipeId).filter((r) => r.user_id !== uid && ids.has(r.user_id));
}
export function myReview(recipeId) {
  const r = ratingsFor(recipeId).find((x) => x.user_id === uid);
  return r ? r.review || '' : '';
}
export const statusMeta = (recipeId) => st.statusMeta.get(recipeId) || null;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

/** Household row, members + profiles, active invites and friends. */
export async function refresh(householdId) {
  if (!client || !uid) return;
  const [hh, mem, inv, fr] = await Promise.all([
    q(client.from('households').select('id,name,is_personal').eq('id', householdId)),
    q(client.from('household_members').select('user_id,role,joined_at').eq('household_id', householdId)),
    q(client.from('household_invites').select('code,expires_at,max_uses,uses,revoked,created_by').eq('household_id', householdId)),
    q(client.from('friendships').select('user_a,user_b,requested_by,status,created_at')),
  ]);
  const friendIds = (fr || []).map((f) => (f.user_a === uid ? f.user_b : f.user_a));
  const ids = [...new Set([uid, ...(mem || []).map((m) => m.user_id), ...friendIds])];
  const profs = await q(client.from('profiles').select('user_id,display_name,avatar_emoji,friend_code,share_with_friends').in('user_id', ids));
  const byId = new Map((profs || []).map((p) => [p.user_id, p]));
  st.household = (hh && hh[0]) || null;
  st.members = (mem || []).map((m) => ({ ...m, display_name: byId.get(m.user_id)?.display_name || '', avatar_emoji: byId.get(m.user_id)?.avatar_emoji || null }))
    .sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)));
  st.profile = byId.get(uid) || st.profile;
  const now = Date.now();
  st.invites = (inv || []).filter((i) => !i.revoked && Date.parse(i.expires_at) > now && i.uses < i.max_uses)
    .sort((a, b) => String(b.expires_at).localeCompare(String(a.expires_at)));
  st.friends = (fr || []).map((f) => {
    const other = f.user_a === uid ? f.user_b : f.user_a;
    const p = byId.get(other) || {};
    return { user_id: other, status: f.status, requested_by: f.requested_by, created_at: f.created_at, display_name: p.display_name || '', avatar_emoji: p.avatar_emoji || null, share: p.share_with_friends !== false };
  });
  saveCache();
  fire('household');
}

/** "Senast i köket": first page (or the next one with { more: true }). */
export async function loadFeed({ more = false, limit = 20 } = {}) {
  if (!client || !uid || !isTables()) return;
  const before = more && st.feed.length ? st.feed[st.feed.length - 1].logged_at : null;
  const rows = await q(client.rpc('kitchen_feed', { p_limit: limit, p_before: before }));
  st.feed = more ? [...st.feed, ...(rows || [])] : (rows || []);
  st.feedMore = (rows || []).length === limit;
  st.feedLoaded = true;
  fire('feed');
}
export const feed = () => st.feed.slice();
export const feedHasMore = () => st.feedMore;
export const feedLoaded = () => st.feedLoaded;

// ---------------------------------------------------------------------------
// Profile + household actions
// ---------------------------------------------------------------------------
export const MAX_NAME = 40;
export async function updateProfile(patch) {
  if (!client || !uid) throw new Error('not_signed_in');
  const row = { updated_at: new Date().toISOString() };
  if ('display_name' in patch) row.display_name = String(patch.display_name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if ('avatar_emoji' in patch) row.avatar_emoji = patch.avatar_emoji ? String(patch.avatar_emoji).slice(0, 8) : null;
  if ('share_with_friends' in patch) row.share_with_friends = !!patch.share_with_friends;
  await q(client.from('profiles').update(row).eq('user_id', uid));
  st.profile = { ...(st.profile || { user_id: uid }), ...row };
  st.members = st.members.map((m) => (m.user_id === uid ? { ...m, ...row } : m));
  saveCache();
  fire('profile');
}
export async function renameHousehold(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!n || !st.household) return;
  await q(client.from('households').update({ name: n }).eq('id', st.household.id));
  st.household = { ...st.household, name: n };
  saveCache();
  fire('household');
}
export async function createInvite() {
  const code = await q(client.rpc('create_household_invite', { p_max_uses: 5, p_days: 7 }));
  if (st.household) await refresh(st.household.id);
  return code;
}
export async function revokeInvite(code) {
  await q(client.from('household_invites').update({ revoked: true }).eq('code', code));
  st.invites = st.invites.filter((i) => i.code !== code);
  fire('household');
}
export async function previewInvite(code) {
  const rows = await q(client.rpc('preview_household_invite', { p_code: code }));
  return (rows && rows[0]) || null;
}
/** Join (the caller re-syncs afterwards, since the household id changes). */
export async function acceptInvite(code, merge) {
  return q(client.rpc('accept_household_invite', { p_code: code, p_merge: !!merge }));
}
export async function leave(copyMyLog) {
  return q(client.rpc('leave_household', { p_copy_my_log: !!copyMyLog }));
}
export async function removeMember(userId) {
  await q(client.rpc('remove_household_member', { p_user: userId }));
  if (st.household) await refresh(st.household.id);
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------
export async function requestFriend(code) {
  const res = await q(client.rpc('request_friend', { p_code: code }));
  if (st.household) await refresh(st.household.id);
  return res;
}
export async function respondFriend(otherId, accept) {
  const res = await q(client.rpc('respond_friend', { p_other: otherId, p_accept: !!accept }));
  if (st.household) await refresh(st.household.id);
  return res;
}
export async function removeFriend(otherId) {
  const a = uid < otherId ? uid : otherId;
  const b = uid < otherId ? otherId : uid;
  await q(client.from('friendships').delete().eq('user_a', a).eq('user_b', b));
  st.friends = st.friends.filter((f) => f.user_id !== otherId);
  saveCache();
  fire('household');
}

// ---------------------------------------------------------------------------
// Codes + links
// ---------------------------------------------------------------------------
/** 'k7qm-2xra ' -> 'K7QM2XRA' (same rule as the server's norm_code). */
export const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** 'K7QM2XRA' -> 'K7QM-2XRA' */
export const prettyCode = (c) => { const n = normCode(c); return n.length === 8 ? `${n.slice(0, 4)}-${n.slice(4)}` : n; };
export const appUrl = () => `${location.origin}${location.pathname}`;
export const joinLink = (code) => `${appUrl()}#join/${normCode(code)}`;
export const friendLink = (code) => `${appUrl()}#friend/${normCode(code)}`;

/** Remember a #join/#friend code across the sign-in round trip. */
export function setPending(kind, code) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ kind, code: normCode(code), at: Date.now() })); } catch { /* ignore */ }
}
export function takePending() {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    localStorage.removeItem(PENDING_KEY);
    if (!v || !v.code || Date.now() - (Number(v.at) || 0) > 864e5) return null;
    return v;
  } catch { return null; }
}

/** Swedish text for an RPC error. */
export function errorText(err) {
  const m = String((err && (err.message || err.details || err.hint)) || err || '');
  if (/invite_invalid/.test(m)) return 'Koden gäller inte längre. Be om en ny.';
  if (/household_full/.test(m)) return `Hushållet är fullt (${MAX_MEMBERS}).`;
  if (/too_many_invites/.test(m)) return 'Ni har redan 5 aktiva inbjudningar. Återkalla en först.';
  if (/friend_code_invalid/.test(m)) return 'Hittade ingen med den vänkoden.';
  if (/not_owner/.test(m)) return 'Bara den som äger hushållet kan ta bort någon.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Ingen anslutning. Försök igen när du är online.';
  return 'Något gick fel. Försök igen.';
}
