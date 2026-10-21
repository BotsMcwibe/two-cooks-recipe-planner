/**
 * Kryddskåpet: spice ids the user has at home. Stored in localStorage and
 * synced via user_preferences.prefs.spicesOwned (see sync.js).
 * Fires `spicesownedchange` on window when it changes.
 */
import { touchPref } from './prefs-meta.js?v=20261021g18';

const KEY = 'yessy.spicesOwned.v1';

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
const fire = () => window.dispatchEvent(new CustomEvent('spicesownedchange'));

export function ownedSpices() { return read(); }

export function setSpiceOwned(id, on) {
  const s = read();
  if (on) s.add(id); else s.delete(id);
  write(s); touchPref('spicesOwned'); fire();
}

export function clearSpicesOwned() {
  write(new Set()); touchPref('spicesOwned'); fire();
}

/** Replace the whole set (remote sync). Does not mark the pref as locally changed. */
export function replaceSpicesOwned(ids) {
  const next = [...new Set((Array.isArray(ids) ? ids : []).map(String))].sort();
  if (JSON.stringify(next) === JSON.stringify([...read()].sort())) return;
  write(new Set(next)); fire();
}
