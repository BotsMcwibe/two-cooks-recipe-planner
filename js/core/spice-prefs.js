/**
 * Per-mix "Har inte mixen" preference (localStorage, keyed by mix ingredient id).
 * Fires a `spicemixchange` event on window when it changes.
 */
import { touchPref } from './prefs-meta.js?v=20261021g7';

const KEY = 'yessy.spiceMixMissing.v1';

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}

export function isMixMissing(id) {
  return read().has(id);
}

export function missingMixes() {
  return read();
}

export function setMixMissing(id, missing) {
  const s = read();
  if (missing) s.add(id); else s.delete(id);
  try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* private mode */ }
  touchPref('spiceMixMissing');
  window.dispatchEvent(new CustomEvent('spicemixchange', { detail: { id, missing } }));
}

/** Replace the whole set (remote sync). Does not mark the pref as locally changed. */
export function replaceMissingMixes(ids) {
  const next = [...new Set((Array.isArray(ids) ? ids : []).map(String))].sort();
  const cur = [...read()].sort();
  if (JSON.stringify(next) === JSON.stringify(cur)) return;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('spicemixchange', { detail: { id: null, missing: null } }));
}
