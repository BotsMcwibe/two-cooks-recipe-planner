/**
 * Personal per-recipe state (Goodreads-style): status + own 1–5 star rating.
 *
 * Stored only in this browser's localStorage (no account/server yet) under a
 * versioned key. Catalog fields `cooked` / `personalRating` act as seed values
 * for recipes the user has never touched; anything saved locally wins, including
 * an explicit "cleared" value.
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
  }
}

export function get(id) {
  const rec = local[id] || seeds[id];
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
  local[id] = { status: cleanStatus(rec.status), rating: cleanRating(rec.rating), updatedAt: ts };
  save();
  emit(id);
  return true;
}
