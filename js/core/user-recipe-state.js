/**
 * Personal per-recipe state (Goodreads-style): status + own 1–5 star rating.
 *
 * Stored only in this browser's localStorage (no account/server yet) under a
 * versioned key. Every visitor starts empty. Catalog fields `cooked` /
 * `personalRating` used to seed statuses and ratings; they are now only used to
 * recognise and clear those old seeded records once (see migrateSeeds).
 *
 *   get(id)                 → { status: 'want'|'cooking'|'cooked'|null, rating: 1..5|null }
 *   set(id, { status?, rating? })
 *   setStatus(id, status) / setRating(id, rating)   (null clears)
 *   subscribe(fn)           → unsubscribe; fn(id|null) after any change (id null = bulk/other tab)
 */
export const STORAGE_KEY = 'jesse.recipeState.v1';

export const STATUSES = ['want', 'cooking', 'cooked'];
export const STATUS_LABELS = { want: 'Vill laga', cooking: 'Lagar nu', cooked: 'Lagad' };

const listeners = new Set();
/** @type {Record<string, {status: string|null, rating: number|null}>} */
let seeds = {};
/** Catalog "tested in the kitchen" markers, read-only, never stored or synced. */
let marks = {};
/** @type {Record<string, {status: string|null, rating: number|null, updatedAt?: number}>} */
let local = load();

function cleanStatus(v) { return STATUSES.includes(v) ? v : null; }
function cleanRating(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { return {}; }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const recipes = parsed && typeof parsed === 'object' ? parsed.recipes : null;
    if (!recipes || typeof recipes !== 'object' || Array.isArray(recipes)) return {};
    const out = {};
    for (const [id, v] of Object.entries(recipes)) {
      if (!v || typeof v !== 'object') continue;
      out[id] = { status: cleanStatus(v.status), rating: cleanRating(v.rating), updatedAt: Number(v.updatedAt) || 0 };
    }
    return out;
  } catch {
    return {}; // corrupt JSON: start fresh, overwritten on next save
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, recipes: local }));
  } catch { /* storage full / private mode: keep in memory */ }
}

function emit(id) {
  for (const fn of listeners) {
    try { fn(id); } catch (err) { console.error(err); }
  }
}

/**
 * Seed from catalog fields (cooked: true → 'cooked'; personalRating out of 10 → 1–5 stars).
 * Seeds are not written to storage; they only apply while no local record exists.
 */
export function seedFromCatalog(catalog) {
  seeds = {};
  for (const c of catalog || []) {
    if (!c || !c.id) continue;
    const cooked = c.cooked === true || (c.cooked && typeof c.cooked === 'object');
    let rating = null;
    const pr = c.personalRating;
    if (typeof pr === 'number' && Number.isFinite(pr)) rating = cleanRating((pr / 10) * 5);
    else if (pr && typeof pr === 'object' && Number.isFinite(Number(pr.score))) {
      const outOf = Number(pr.outOf) > 0 ? Number(pr.outOf) : 10;
      rating = cleanRating((Number(pr.score) / outOf) * 5);
    }
    if (cooked || rating) seeds[c.id] = { status: cooked ? 'cooked' : null, rating };
    if (cooked || rating) marks[c.id] = { tested: cooked, rating, score: kitchenScore(pr) };
  }
  migrateSeeds();
}

/** One-time migration flag: when seeded records were cleared (ms). */
export const SEED_MIGRATION_KEY = 'yessy.seedMigration.v1';
function migratedAt() {
  try { return Number(localStorage.getItem(SEED_MIGRATION_KEY)) || 0; } catch { return 0; }
}
/** True when a record is exactly what catalog seeding produced (status and rating). */
function isSeedCopy(id, rec) {
  const s = seeds[id];
  if (!s || !rec) return false;
  if (rec.status == null && rec.rating == null) return false;
  return rec.status === s.status && rec.rating === s.rating;
}
/**
 * Clear local records that are exact copies of the old catalog seed, once.
 * Cleared records get a fresh updatedAt so sync writes null/null over any
 * seed-derived server rows instead of pulling them back.
 */
function migrateSeeds() {
  if (migratedAt()) return;
  const now = Date.now();
  let changed = false;
  for (const [id, rec] of Object.entries(local)) {
    if (isSeedCopy(id, rec)) { local[id] = { status: null, rating: null, updatedAt: now }; changed = true; }
  }
  try { localStorage.setItem(SEED_MIGRATION_KEY, String(now)); } catch { /* ignore */ }
  if (changed) { save(); emit(null); }
}

function kitchenScore(pr) {
  if (typeof pr === 'number' && Number.isFinite(pr)) return `${pr}/10`;
  if (pr && typeof pr === 'object' && Number.isFinite(Number(pr.score))) return `${Number(pr.score)}/${Number(pr.outOf) > 0 ? Number(pr.outOf) : 10}`;
  return null;
}

/** Catalog marker: { tested, rating (1–5 or null), score ('8/10' or null) } or null. Not the user's state. */
export function catalogMark(id) {
  const m = marks[id];
  return m ? { ...m } : null;
}
/** UI name of the catalog "tested" mark: a seal of approval. */
export const TESTED_LABEL = 'Godkänd';

export function get(id) {
  const rec = local[id];
  return { status: rec ? rec.status : null, rating: rec ? rec.rating : null };
}

export function set(id, patch) {
  if (!id) return;
  const cur = get(id);
  const next = {
    status: 'status' in patch ? cleanStatus(patch.status) : cur.status,
    rating: 'rating' in patch ? cleanRating(patch.rating) : cur.rating,
  };
  if (next.status === cur.status && next.rating === cur.rating && local[id]) return;
  local[id] = { ...next, updatedAt: Date.now() };
  save();
  emit(id);
}

export function setStatus(id, status) { set(id, { status }); }
export function setRating(id, rating) { set(id, { rating }); }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Keep tabs in sync.
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  local = load();
  emit(null);
});

/** Every locally stored record (not seeds), for sync. */
export function allLocal() {
  return Object.fromEntries(Object.entries(local).map(([id, v]) => [id, { ...v }]));
}

/**
 * Apply a record from the server when it is newer than the local one.
 * @returns {boolean} true if applied
 */
export function applyRemote(id, rec) {
  if (!id || !rec) return false;
  const ts = Number(rec.updatedAt) || 0;
  const cur = local[id];
  if (cur && (Number(cur.updatedAt) || 0) >= ts) return false;
  // A server row created from the old seed before the migration: clear it
  // locally with a newer timestamp so sync overwrites it with null/null.
  const m = migratedAt();
  const clean = { status: cleanStatus(rec.status), rating: cleanRating(rec.rating) };
  if (m && ts < m && isSeedCopy(id, clean)) {
    local[id] = { status: null, rating: null, updatedAt: Math.max(m, ts + 1) };
    save();
    emit(id);
    return true;
  }
  local[id] = { status: cleanStatus(rec.status), rating: cleanRating(rec.rating), updatedAt: ts };
  save();
  emit(id);
  return true;
}
