/**
 * Recipe journal (Goodreads-style, per user): cook log ("Datum lagad"), private
 * notes, own lists, "Inte för oss" and the yearly cook challenge.
 *
 * Stored in localStorage and synced via user_preferences.prefs (see sync.js) under
 * the keys in JOURNAL_KEYS. Every value is a map of records with a stable id and
 * an updatedAt (epoch ms); deletes are tombstones ({ deleted: true }). Records are
 * merged one by one (newer updatedAt wins), so cook-log entries from two devices
 * are unioned by id and notes/lists are last-write-wins per record.
 *
 * Records carry `by` (the signed-in user id, null when local) and lists carry
 * `owner` + `members`, so a shared household can later move them to their own
 * tables without changing their shape.
 *
 *   cookLog       { [entryId]: { id, recipeId, date: 'YYYY-MM-DD', cooks?: 1|2, by, createdAt, updatedAt, deleted? } }
 *   recipeNotes   { [recipeId]: { recipeId, text, by, updatedAt } }            (text '' = cleared)
 *   recipeLists   { [listId]: { id, name, recipeIds: [...], owner, members: [], createdAt, updatedAt, deleted? } }
 *   notForUs      { [recipeId]: { recipeId, on: bool, by, updatedAt } }
 *   cookChallenge { [year]: { year, goal: int|null, updatedAt } }
 *
 * Fires `journalchange` on window ({ detail: { key } }) after any change.
 */
import { touchPref } from './prefs-meta.js?v=20261021g12';

export const JOURNAL_KEYS = {
  cookLog: 'yessy.cookLog.v1',
  recipeNotes: 'yessy.recipeNotes.v1',
  recipeLists: 'yessy.recipeLists.v1',
  notForUs: 'yessy.notForUs.v1',
  cookChallenge: 'yessy.cookChallenge.v1',
};

let actor = null;
/** Signed-in user id stamped on new records (sync.js sets it on auth change). */
export function setActor(userId) { actor = userId || null; }

const cache = {};
function read(key) {
  if (cache[key]) return cache[key];
  let v = {};
  try {
    const p = JSON.parse(localStorage.getItem(JOURNAL_KEYS[key]) || '{}');
    if (p && typeof p === 'object' && !Array.isArray(p)) v = p;
  } catch { /* corrupt: start empty */ }
  cache[key] = v;
  return v;
}
function write(key, v) {
  cache[key] = v;
  try { localStorage.setItem(JOURNAL_KEYS[key], JSON.stringify(v)); } catch { /* private mode */ }
}
function fire(key) { window.dispatchEvent(new CustomEvent('journalchange', { detail: { key } })); }
/** User change: store, stamp the pref, notify. */
function commit(key, v) { write(key, v); touchPref(key); fire(key); }

window.addEventListener('storage', (e) => {
  const key = Object.keys(JOURNAL_KEYS).find((k) => JOURNAL_KEYS[k] === e.key);
  if (!key) return;
  delete cache[key];
  fire(key);
});

const now = () => Date.now();
function newId(prefix) {
  const rnd = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${now().toString(36)}${rnd}`;
}
/** Local calendar date as YYYY-MM-DD. */
export function todayIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

// ---------------------------------------------------------------------------
// Sync helpers (used by sync.js)
// ---------------------------------------------------------------------------
/** Raw stored map for a journal pref key (copy). */
export function journalValue(key) { return JSON.parse(JSON.stringify(read(key))); }

/** Record-by-record merge: union of ids, newer updatedAt wins (tie: keep a's). */
export function mergeJournal(a, b) {
  const out = { ...(a && typeof a === 'object' ? a : {}) };
  for (const [id, rb] of Object.entries(b && typeof b === 'object' ? b : {})) {
    if (!rb || typeof rb !== 'object') continue;
    const ra = out[id];
    if (!ra || (Number(rb.updatedAt) || 0) > (Number(ra.updatedAt) || 0)) out[id] = rb;
  }
  return out;
}

/** Replace a key from sync (already merged). Does not stamp the pref as locally changed. */
export function replaceJournal(key, v) {
  if (!JOURNAL_KEYS[key]) return;
  const next = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  if (JSON.stringify(next) === JSON.stringify(read(key))) return;
  write(key, next);
  fire(key);
}

// ---------------------------------------------------------------------------
// Cook log (Datum lagad + omlagningar)
// ---------------------------------------------------------------------------
const liveEntries = () => Object.values(read('cookLog')).filter((e) => e && !e.deleted && e.recipeId && isIsoDate(e.date));
const byDateDesc = (a, b) => (b.date.localeCompare(a.date)) || ((Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

/** Entries for one recipe, newest first. */
export function cookEntries(recipeId) {
  return liveEntries().filter((e) => e.recipeId === recipeId).sort(byDateDesc);
}
/** Every live entry, newest first. */
export function allCookEntries() { return liveEntries().sort(byDateDesc); }

/** { count, last: 'YYYY-MM-DD'|null } */
export function cookStats(recipeId) {
  const list = cookEntries(recipeId);
  return { count: list.length, last: list.length ? list[0].date : null };
}
/** recipeId -> { count, last } for every recipe with entries. */
export function cookStatsAll() {
  const m = new Map();
  for (const e of liveEntries()) {
    const s = m.get(e.recipeId) || { count: 0, last: null };
    s.count += 1;
    if (!s.last || e.date > s.last) s.last = e.date;
    m.set(e.recipeId, s);
  }
  return m;
}

export function addCook(recipeId, opts = {}) {
  if (!recipeId) return null;
  const t = now();
  const date = isIsoDate(opts.date) ? opts.date : todayIso();
  const e = { id: newId('ck'), recipeId, date, by: actor, createdAt: t, updatedAt: t };
  if (opts.cooks === 1 || opts.cooks === 2) e.cooks = opts.cooks;
  commit('cookLog', { ...read('cookLog'), [e.id]: e });
  return e;
}
/** Add today's entry unless one exists for today. Returns the new entry or null. */
export function ensureCookToday(recipeId, opts = {}) {
  const today = todayIso();
  if (cookEntries(recipeId).some((e) => e.date === today)) return null;
  return addCook(recipeId, { ...opts, date: today });
}
export function updateCook(entryId, patch) {
  const cur = read('cookLog')[entryId];
  if (!cur || cur.deleted) return;
  const next = { ...cur, updatedAt: now() };
  if ('date' in patch) { if (!isIsoDate(patch.date)) return; next.date = patch.date; }
  if (next.date === cur.date) return;
  commit('cookLog', { ...read('cookLog'), [entryId]: next });
}
export function removeCook(entryId) {
  const cur = read('cookLog')[entryId];
  if (!cur || cur.deleted) return;
  commit('cookLog', { ...read('cookLog'), [entryId]: { id: entryId, recipeId: cur.recipeId, date: cur.date, by: cur.by ?? null, createdAt: cur.createdAt, deleted: true, updatedAt: now() } });
}

// ---------------------------------------------------------------------------
// Mina anteckningar
// ---------------------------------------------------------------------------
export function noteText(recipeId) {
  const n = read('recipeNotes')[recipeId];
  return n && typeof n.text === 'string' ? n.text : '';
}
export function setNote(recipeId, text) {
  if (!recipeId) return;
  const t = String(text ?? '').replace(/\s+$/, '').slice(0, 4000);
  if (t === noteText(recipeId)) return;
  commit('recipeNotes', { ...read('recipeNotes'), [recipeId]: { recipeId, text: t, by: actor, updatedAt: now() } });
}
/** recipeId -> text for every non-empty note. */
export function allNotes() {
  const out = {};
  for (const [id, n] of Object.entries(read('recipeNotes'))) if (n && n.text) out[id] = n.text;
  return out;
}

// ---------------------------------------------------------------------------
// Inte för oss
// ---------------------------------------------------------------------------
export function isNotForUs(recipeId) {
  const r = read('notForUs')[recipeId];
  return !!(r && r.on);
}
export function setNotForUs(recipeId, on) {
  if (!recipeId || isNotForUs(recipeId) === !!on) return;
  commit('notForUs', { ...read('notForUs'), [recipeId]: { recipeId, on: !!on, by: actor, updatedAt: now() } });
}
export function notForUsIds() {
  return new Set(Object.values(read('notForUs')).filter((r) => r && r.on).map((r) => r.recipeId));
}

// ---------------------------------------------------------------------------
// Egna listor
// ---------------------------------------------------------------------------
export const MAX_LIST_NAME = 40;
const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LIST_NAME);

/** Live lists, oldest first (stable chip order). */
export function lists() {
  return Object.values(read('recipeLists'))
    .filter((l) => l && !l.deleted && l.id && l.name)
    .map((l) => ({ ...l, recipeIds: Array.isArray(l.recipeIds) ? l.recipeIds : [] }))
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
}
export function getList(listId) { return lists().find((l) => l.id === listId) || null; }
export function listsFor(recipeId) { return lists().filter((l) => l.recipeIds.includes(recipeId)); }

export function createList(name, recipeIds = []) {
  const n = cleanName(name);
  if (!n) return null;
  const t = now();
  const l = { id: newId('ls'), name: n, recipeIds: [...new Set(recipeIds)], owner: actor, members: [], createdAt: t, updatedAt: t };
  commit('recipeLists', { ...read('recipeLists'), [l.id]: l });
  return l;
}
function patchList(listId, fn) {
  const all = read('recipeLists');
  const cur = all[listId];
  if (!cur || cur.deleted) return;
  const next = fn({ ...cur, recipeIds: Array.isArray(cur.recipeIds) ? [...cur.recipeIds] : [] });
  if (!next) return;
  commit('recipeLists', { ...all, [listId]: { ...next, updatedAt: now() } });
}
export function renameList(listId, name) {
  const n = cleanName(name);
  if (!n) return;
  patchList(listId, (l) => (l.name === n ? null : { ...l, name: n }));
}
export function deleteList(listId) {
  patchList(listId, (l) => ({ id: l.id, name: l.name, recipeIds: [], owner: l.owner ?? null, members: [], createdAt: l.createdAt, deleted: true }));
}
export function setInList(listId, recipeId, on) {
  patchList(listId, (l) => {
    const has = l.recipeIds.includes(recipeId);
    if (has === !!on) return null;
    l.recipeIds = on ? [...l.recipeIds, recipeId] : l.recipeIds.filter((x) => x !== recipeId);
    return l;
  });
}

// ---------------------------------------------------------------------------
// Årets matutmaning
// ---------------------------------------------------------------------------
export const MAX_GOAL = 366;
export function challengeGoal(year = new Date().getFullYear()) {
  const c = read('cookChallenge')[String(year)];
  const g = c ? Number(c.goal) : NaN;
  return Number.isInteger(g) && g >= 1 ? g : null;
}
export function setChallengeGoal(year, goal) {
  const g = goal == null ? null : Math.max(1, Math.min(MAX_GOAL, Math.round(Number(goal)) || 1));
  if (g === challengeGoal(year)) return;
  commit('cookChallenge', { ...read('cookChallenge'), [String(year)]: { year: Number(year), goal: g, updatedAt: now() } });
}
/** Distinct recipes cooked in `year` (from the cook log), newest first. */
export function recipesCookedIn(year = new Date().getFullYear()) {
  const seen = new Set();
  const out = [];
  for (const e of allCookEntries()) {
    if (!e.date.startsWith(`${year}-`) || seen.has(e.recipeId)) continue;
    seen.add(e.recipeId);
    out.push(e.recipeId);
  }
  return out;
}
