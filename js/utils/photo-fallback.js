/**
 * Recipe photo availability. Photos under assets/recipes are not deployed to
 * GitHub Pages, so most loads 404 there. This module remembers failures (per tab
 * session) so later renders can draw the compact placeholder right away instead
 * of a full-size box that collapses after the 404.
 *
 * "Likely unavailable" = several failures and not a single success this session:
 * then every recipe photo is treated as missing up front (no layout jumps).
 */
const KEY = 'yessy.photoAvailability.v1';
const FAIL_THRESHOLD = 3;

let failed = new Set();
let successes = 0;
try {
  const raw = JSON.parse(sessionStorage.getItem(KEY) || 'null');
  if (raw && Array.isArray(raw.failed)) failed = new Set(raw.failed.filter(s => typeof s === 'string'));
  if (raw && Number.isFinite(raw.successes)) successes = raw.successes;
} catch { /* bad JSON / no storage */ }

function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ failed: [...failed].slice(-300), successes }));
  } catch { /* ignore */ }
}

/** Normalised path (attribute value, not the resolved URL). */
function keyOf(src) {
  return String(src || '').replace(/^\.\//, '').split('?')[0];
}

export function photosLikelyUnavailable() {
  return successes === 0 && failed.size >= FAIL_THRESHOLD;
}

/** True when we already know (or strongly suspect) this photo will not load. */
export function isPhotoMissing(src) {
  if (!src) return true;
  return failed.has(keyOf(src)) || photosLikelyUnavailable();
}

export function recordPhotoFailure(src) {
  const k = keyOf(src);
  if (!k || failed.has(k)) return;
  failed.add(k);
  persist();
}

export function recordPhotoSuccess(src) {
  const k = keyOf(src);
  if (failed.delete(k) || successes === 0) {
    successes += 1;
    persist();
  }
}

/** True when an <img> has finished and failed (e.g. cached 404 before listeners). */
export function imgFailed(img) {
  return !!(img && img.complete && img.getAttribute('src') && img.naturalWidth === 0);
}
