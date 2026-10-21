/**
 * Skafferiet exclusions: pantry ingredient ids the user doesn't want.
 * Every recipe using one is hidden in #browse. Stored in localStorage and
 * synced via user_preferences.prefs.pantryExcluded (see sync.js).
 * Fires `pantryexcludechange` on window when it changes.
 */
import { touchPref } from './prefs-meta.js?v=20261021g10';

const KEY = 'yessy.pantryExcluded.v1';
export const PANTRY_URL = 'data/pantry.json?v=20261021g10';

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    return new Set();
  }
}
function write(s) {
  try { localStorage.setItem(KEY, JSON.stringify([...s].sort())); } catch { /* private mode */ }
}
const fire = () => window.dispatchEvent(new CustomEvent('pantryexcludechange'));

export function excludedPantry() { return read(); }

export function setPantryExcluded(id, on) {
  const s = read();
  if (on) s.add(id); else s.delete(id);
  write(s); touchPref('pantryExcluded'); fire();
}

export function clearPantryExcluded() {
  write(new Set()); touchPref('pantryExcluded'); fire();
}

/** Replace the whole set (remote sync). Does not mark the pref as locally changed. */
export function replacePantryExcluded(ids) {
  const next = [...new Set((Array.isArray(ids) ? ids : []).map(String))].sort();
  if (JSON.stringify(next) === JSON.stringify([...read()].sort())) return;
  write(new Set(next)); fire();
}

let dataPromise = null;
/** Shared pantry data (items + recipe -> pantry ids). */
export function loadPantry() {
  if (!dataPromise) {
    dataPromise = fetch(PANTRY_URL).then((r) => {
      if (!r.ok) throw new Error(`Kunde inte ladda skafferiet (${r.status})`);
      return r.json();
    }).catch((e) => { dataPromise = null; throw e; });
  }
  return dataPromise;
}
