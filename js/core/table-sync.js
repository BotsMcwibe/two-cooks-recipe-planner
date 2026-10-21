/**
 * Sync with the household tables (supabase 0002/0003/0005), used by sync.js when
 * the project has them. Local stores stay the source the UI reads:
 *
 *   user-recipe-state  status  <-> household_recipe_state.status / status_at   (shared)
 *                      rating  <-> recipe_ratings.rating / rating_at            (mine)
 *   journal notForUs           <-> household_recipe_state.not_for_us / nfu_at   (shared)
 *           cookLog            <-> cook_log                                     (shared)
 *           recipeLists        <-> recipe_lists + recipe_list_items            (shared, or 'Bara för mig')
 *           recipeNotes        <-> recipe_notes                                 (private)
 *
 * pull() reads every row of my household and applies what is newer than the local
 * copy; pushSweep() writes every local record newer than what the server last
 * showed us. The sweep doubles as the offline queue: a failed write leaves the
 * record "newer" and it goes out on the next sweep (online, focus, timer). The
 * database triggers make newer-wins hold on the server too (per field for status,
 * Inte för oss, stars and reviews).
 *
 * When the household changes (join/leave/removed) or another account signs in on
 * this device, the shared local data is cleared first so one household's data
 * never leaks into another's.
 */
import * as UserState from './user-recipe-state.js?v=20261021g16';
import * as Journal from './recipe-journal.js?v=20261021g16';
import * as Household from './household.js?v=20261021g16';

const CACHE_KEY = 'yessy.tableSync.v1';
export const TABLE_KEYS = ['cookLog', 'recipeNotes', 'recipeLists', 'notForUs'];
const EPOCH = new Date(0).toISOString();

let client = null;
let uid = null;
let hid = null;
let applying = false;
let remote = emptyRemote();

function emptyRemote() {
  return { status: new Map(), rating: new Map(), nfu: new Map(), cook: new Map(), note: new Map(), list: new Map(), items: new Map() };
}
const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };
const iso = (t) => new Date(Number(t) || 0).toISOString();

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') || {}; } catch { return {}; } }
function writeCache(v) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch { /* ignore */ } }

export const householdId = () => hid;
export const isApplying = () => applying;

async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

/**
 * Ask the server for my household (creates profile + personal kitchen if missing).
 * Returns the household id, or null when the project doesn't have the tables yet
 * (legacy fallback). Network errors throw.
 */
export async function detect(c, user) {
  client = c;
  uid = user ? user.id : null;
  const { data, error } = await c.rpc('ensure_my_household');
  if (error) {
    const code = String(error.code || '');
    if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(code) || error.status === 404) return null;
    throw error;
  }
  return data || null;
}

/** Clear local data that belongs to another household/account before pulling. */
function adoptHousehold(nextHid) {
  const cache = readCache();
  const accountChanged = !!(cache.uid && cache.uid !== uid);
  const householdChanged = !accountChanged && !!(cache.hid && cache.hid !== nextHid);
  if (accountChanged || householdChanged) {
    applying = true;
    try {
      UserState.resetForAccountChange({ ratings: accountChanged });
      Journal.replaceJournal('notForUs', {});
      Journal.replaceJournal('cookLog', {});
      // Keep my private lists only when I stay the same person
      const keep = {};
      if (!accountChanged) {
        for (const [id, l] of Object.entries(Journal.journalValue('recipeLists'))) {
          if (l && l.visibility === 'private' && l.owner === uid) keep[id] = l;
        }
      }
      Journal.replaceJournal('recipeLists', keep);
      if (accountChanged) Journal.replaceJournal('recipeNotes', {});
    } finally { applying = false; }
    remote = emptyRemote();
  }
  hid = nextHid;
  writeCache({ uid, hid });
  return { accountChanged, householdChanged };
}

/** Full sync: adopt household, pull everything, push what is newer locally. */
export async function syncAll(nextHid) {
  const changed = adoptHousehold(nextHid);
  await pull();
  await pushSweep();
  return changed;
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------
export async function pull() {
  if (!client || !uid || !hid) return;
  const [hrs, cooks, lists, items, ratings, notes] = await Promise.all([
    q(client.from('household_recipe_state').select('recipe_id,status,status_at,not_for_us,nfu_at,updated_by').eq('household_id', hid)),
    q(client.from('cook_log').select('id,user_id,recipe_id,cooked_on,cooks,deleted,created_at,updated_at').eq('household_id', hid)),
    q(client.from('recipe_lists').select('id,owner_id,name,visibility,deleted,created_at,updated_at').eq('household_id', hid)),
    q(client.from('recipe_list_items').select('list_id,recipe_id,in_list,updated_at')),
    q(client.from('recipe_ratings').select('user_id,recipe_id,rating,rating_at,review,review_at')),
    q(client.from('recipe_notes').select('recipe_id,text,updated_at').eq('user_id', uid)),
  ]);
  const r = emptyRemote();
  applying = true;
  try {
    // Status + Inte för oss
    const nfuLocal = Journal.journalValue('notForUs');
    let nfuChanged = false;
    for (const row of hrs || []) {
      const sAt = ms(row.status_at);
      const nAt = ms(row.nfu_at);
      r.status.set(row.recipe_id, sAt);
      r.nfu.set(row.recipe_id, nAt);
      if (sAt > 0) UserState.applyRemoteStatus(row.recipe_id, row.status, sAt);
      if (nAt > 0) {
        const cur = nfuLocal[row.recipe_id];
        if (!cur || (Number(cur.updatedAt) || 0) < nAt) {
          nfuLocal[row.recipe_id] = { recipeId: row.recipe_id, on: !!row.not_for_us, by: row.updated_by || null, updatedAt: nAt };
          nfuChanged = true;
        }
      }
    }
    if (nfuChanged) Journal.replaceJournal('notForUs', nfuLocal);
    Household.setStatusMeta(hrs);

    // Stars (mine) + everyone's stars/reviews for display
    for (const row of ratings || []) {
      if (row.user_id !== uid) continue;
      const at = ms(row.rating_at);
      r.rating.set(row.recipe_id, at);
      if (at > 0) UserState.applyRemoteRating(row.recipe_id, row.rating, at);
    }
    Household.setRatingRows(ratings);

    // Cook log
    const ckLocal = Journal.journalValue('cookLog');
    let ckChanged = false;
    for (const row of cooks || []) {
      const at = ms(row.updated_at);
      r.cook.set(row.id, at);
      const cur = ckLocal[row.id];
      if (cur && (Number(cur.updatedAt) || 0) >= at) continue;
      const rec = { id: row.id, recipeId: row.recipe_id, date: row.cooked_on, by: row.user_id || null, createdAt: ms(row.created_at), updatedAt: at };
      if (row.cooks === 1 || row.cooks === 2) rec.cooks = row.cooks;
      if (row.deleted) rec.deleted = true;
      ckLocal[row.id] = rec;
      ckChanged = true;
    }
    if (ckChanged) Journal.replaceJournal('cookLog', ckLocal);

    // Lists (+ items; a list's timestamp is the newest of the list row and its items)
    const itemsBy = new Map();
    for (const it of items || []) {
      if (!itemsBy.has(it.list_id)) itemsBy.set(it.list_id, new Map());
      itemsBy.get(it.list_id).set(it.recipe_id, { in: !!it.in_list, at: ms(it.updated_at) });
    }
    const lsLocal = Journal.journalValue('recipeLists');
    let lsChanged = false;
    for (const row of lists || []) {
      const its = itemsBy.get(row.id) || new Map();
      let at = ms(row.updated_at);
      for (const v of its.values()) at = Math.max(at, v.at);
      r.list.set(row.id, at);
      r.items.set(row.id, its);
      const cur = lsLocal[row.id];
      if (cur && (Number(cur.updatedAt) || 0) >= at) continue;
      lsLocal[row.id] = {
        id: row.id, name: row.name, owner: row.owner_id || null, members: [], visibility: row.visibility || 'household',
        recipeIds: [...its.entries()].filter(([, v]) => v.in).map(([rid]) => rid),
        createdAt: ms(row.created_at), updatedAt: at, ...(row.deleted ? { deleted: true, recipeIds: [] } : {}),
      };
      lsChanged = true;
    }
    if (lsChanged) Journal.replaceJournal('recipeLists', lsLocal);

    // Private notes
    const ntLocal = Journal.journalValue('recipeNotes');
    let ntChanged = false;
    for (const row of notes || []) {
      const at = ms(row.updated_at);
      r.note.set(row.recipe_id, at);
      const cur = ntLocal[row.recipe_id];
      if (cur && (Number(cur.updatedAt) || 0) >= at) continue;
      ntLocal[row.recipe_id] = { recipeId: row.recipe_id, text: row.text || '', by: uid, updatedAt: at };
      ntChanged = true;
    }
    if (ntChanged) Journal.replaceJournal('recipeNotes', ntLocal);
  } finally {
    applying = false;
  }
  remote = r;
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------
let sweeping = null;
let again = false;
/** Write every local record that is newer than the server's copy. Serialised. */
export async function pushSweep() {
  if (!client || !uid || !hid) return;
  if (sweeping) { again = true; return sweeping; }
  sweeping = (async () => {
    try {
      do { again = false; await sweepOnce(); } while (again);
    } finally { sweeping = null; }
  })();
  return sweeping;
}

async function sweepOnce() {
  const errors = [];
  const run = async (fn) => { try { await fn(); } catch (err) { errors.push(err); } };
  const states = UserState.allLocal();

  // Status (household) and stars (mine): one row per call keeps the payload columns exact
  const statusRows = [];
  const ratingRows = [];
  for (const [id, rec] of Object.entries(states)) {
    const sAt = Number(rec.statusAt) || 0;
    const rs = remote.status.get(id);
    if (sAt > (rs || 0) && (rec.status || rs !== undefined)) statusRows.push({ household_id: hid, recipe_id: id, status: rec.status || null, status_at: iso(sAt), updated_by: uid, _at: sAt });
    const rAt = Number(rec.ratingAt) || 0;
    const rr = remote.rating.get(id);
    if (rAt > (rr || 0) && (rec.rating || rr !== undefined)) ratingRows.push({ user_id: uid, recipe_id: id, rating: rec.rating || null, rating_at: iso(rAt), _at: rAt });
  }
  const nfuRows = [];
  for (const rec of Object.values(Journal.journalValue('notForUs'))) {
    if (!rec || !rec.recipeId) continue;
    const at = Number(rec.updatedAt) || 0;
    const rn = remote.nfu.get(rec.recipeId);
    if (at > (rn || 0) && (rec.on || rn !== undefined)) nfuRows.push({ household_id: hid, recipe_id: rec.recipeId, not_for_us: !!rec.on, nfu_at: iso(at), updated_by: uid, _at: at });
  }
  const strip = (rows) => rows.map(({ _at, ...x }) => x);
  if (statusRows.length) await run(async () => {
    await q(client.from('household_recipe_state').upsert(strip(statusRows), { onConflict: 'household_id,recipe_id' }));
    for (const x of statusRows) remote.status.set(x.recipe_id, x._at);
  });
  if (nfuRows.length) await run(async () => {
    await q(client.from('household_recipe_state').upsert(strip(nfuRows), { onConflict: 'household_id,recipe_id' }));
    for (const x of nfuRows) remote.nfu.set(x.recipe_id, x._at);
  });
  if (ratingRows.length) await run(async () => {
    await q(client.from('recipe_ratings').upsert(strip(ratingRows), { onConflict: 'user_id,recipe_id' }));
    for (const x of ratingRows) remote.rating.set(x.recipe_id, x._at);
  });

  // Cook log
  const ckRows = [];
  for (const e of Object.values(Journal.journalValue('cookLog'))) {
    if (!e || !e.id || !e.recipeId || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) continue;
    const at = Number(e.updatedAt) || 0;
    if (at <= (remote.cook.get(e.id) || 0)) continue;
    if (e.deleted && !remote.cook.has(e.id)) { remote.cook.set(e.id, at); continue; } // never reached the server
    ckRows.push({
      id: e.id, household_id: hid, user_id: e.by || uid, recipe_id: e.recipeId, cooked_on: e.date,
      cooks: e.cooks === 1 || e.cooks === 2 ? e.cooks : null, deleted: !!e.deleted,
      created_at: iso(e.createdAt || at), updated_at: iso(at), _at: at,
    });
  }
  if (ckRows.length) await run(async () => {
    await q(client.from('cook_log').upsert(strip(ckRows), { onConflict: 'id' }));
    for (const x of ckRows) remote.cook.set(x.id, x._at);
  });

  // Lists + item diffs
  for (const l of Object.values(Journal.journalValue('recipeLists'))) {
    if (!l || !l.id || !l.name) continue;
    const at = Number(l.updatedAt) || 0;
    if (at <= (remote.list.get(l.id) || 0)) continue;
    if (l.deleted && !remote.list.has(l.id)) { remote.list.set(l.id, at); continue; }
    await run(async () => {
      await q(client.from('recipe_lists').upsert({
        id: l.id, household_id: hid, owner_id: l.owner || uid, name: String(l.name).slice(0, 40),
        visibility: l.visibility === 'private' ? 'private' : 'household', deleted: !!l.deleted,
        created_at: iso(l.createdAt || at), updated_at: iso(at),
      }, { onConflict: 'id' }));
      const known = remote.items.get(l.id) || new Map();
      const want = new Set(l.deleted ? [] : (Array.isArray(l.recipeIds) ? l.recipeIds : []));
      const rows = [];
      for (const rid of want) if (!(known.get(rid) && known.get(rid).in)) rows.push({ list_id: l.id, recipe_id: rid, in_list: true, updated_at: iso(at) });
      if (!l.deleted) for (const [rid, v] of known) if (v.in && !want.has(rid)) rows.push({ list_id: l.id, recipe_id: rid, in_list: false, updated_at: iso(at) });
      if (rows.length) await q(client.from('recipe_list_items').upsert(rows, { onConflict: 'list_id,recipe_id' }));
      const next = new Map(known);
      for (const x of rows) next.set(x.recipe_id, { in: x.in_list, at });
      remote.items.set(l.id, next);
      remote.list.set(l.id, at);
    });
  }

  // Private notes
  const ntRows = [];
  for (const n of Object.values(Journal.journalValue('recipeNotes'))) {
    if (!n || !n.recipeId) continue;
    const at = Number(n.updatedAt) || 0;
    const rn = remote.note.get(n.recipeId);
    if (at <= (rn || 0) || (!n.text && rn === undefined)) continue;
    ntRows.push({ user_id: uid, recipe_id: n.recipeId, text: String(n.text || '').slice(0, 4000), updated_at: iso(at), _at: at });
  }
  if (ntRows.length) await run(async () => {
    await q(client.from('recipe_notes').upsert(strip(ntRows), { onConflict: 'user_id,recipe_id' }));
    for (const x of ntRows) remote.note.set(x.recipe_id, x._at);
  });

  if (errors.length) throw errors[0];
}

// ---------------------------------------------------------------------------
// Reviews (Recension): written straight to the table, shown via Household
// ---------------------------------------------------------------------------
export async function saveReview(recipeId, text) {
  if (!client || !uid) throw new Error('not_signed_in');
  const review = String(text || '').trim().slice(0, 4000);
  const at = new Date().toISOString();
  await q(client.from('recipe_ratings').upsert({ user_id: uid, recipe_id: recipeId, review, review_at: at }, { onConflict: 'user_id,recipe_id' }));
  const rows = [];
  for (const [rid, list] of [[recipeId, Household.ratingsFor(recipeId)]]) {
    const mine = list.find((x) => x.user_id === uid);
    for (const x of list) if (x.user_id !== uid) rows.push({ ...x, recipe_id: rid });
    rows.push({ user_id: uid, recipe_id: rid, rating: mine ? mine.rating : UserState.get(rid).rating, rating_at: mine ? mine.rating_at : null, review, review_at: at });
  }
  Household.patchRatings(recipeId, rows);
}

/** Forget the session state (sign-out). Local data stays as it is. */
export function detach() {
  client = null; uid = null; hid = null; remote = emptyRemote();
}
export { EPOCH };
