/**
 * Skafferiet "Har hemma": ingredient ids (data/ingredients.json) the user usually
 * has at home. Recipes, the cook page and the shopping list show those rows as
 * "har troligen hemma" (dimmed, sorted last). Stored in localStorage and synced
 * per account via user_preferences.prefs.pantryHave (see sync.js), like spicesOwned.
 * Fires `pantryhavechange` on window when it changes.
 *
 * likelyHave() = the marked set + tap water + spices marked in Kryddskåpet (#kryddor).
 */
import { touchPref } from './prefs-meta.js?v=20261113g25';
import { ownedSpices } from './spices-owned.js?v=20261113g25';
import { IMPLICIT_HAVE } from '../data/pantry-staples.js?v=20261113g25';

const KEY = 'yessy.pantryHave.v1';
let spiceIngredientId = {};

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
const fire = () => window.dispatchEvent(new CustomEvent('pantryhavechange'));

/** Ids the user marked themselves. */
export function havePantry() { return read(); }

export function setPantryHave(id, on) {
  const s = read();
  if (on) s.add(id); else s.delete(id);
  write(s); touchPref('pantryHave'); fire();
}

/** Add several ids at once (Lägg till alla vanliga). Returns how many were new. */
export function addPantryHave(ids) {
  const s = read();
  const before = s.size;
  for (const id of ids || []) s.add(String(id));
  if (s.size === before) return 0;
  write(s); touchPref('pantryHave'); fire();
  return s.size - before;
}

export function clearPantryHave() {
  write(new Set()); touchPref('pantryHave'); fire();
}

/** Replace the whole set (remote sync). Does not mark the pref as locally changed. */
export function replacePantryHave(ids) {
  const next = [...new Set((Array.isArray(ids) ? ids : []).map(String))].sort();
  if (JSON.stringify(next) === JSON.stringify([...read()].sort())) return;
  write(new Set(next)); fire();
}

/** spice-blends.json spice id -> ingredient id (set by the loader). */
export function setSpiceIngredientMap(map) { spiceIngredientId = map || {}; }

/** Ingredient ids of spices marked in Kryddskåpet. */
export function spiceHaveIds() {
  const out = new Set();
  for (const s of ownedSpices()) if (spiceIngredientId[s]) out.add(spiceIngredientId[s]);
  return out;
}

/** Everything we treat as "har troligen hemma". */
export function likelyHave() {
  const s = read();
  for (const id of IMPLICIT_HAVE) s.add(id);
  for (const id of spiceHaveIds()) s.add(id);
  return s;
}

/** Call fn when anything feeding likelyHave() changes. */
export function onLikelyHaveChange(fn) {
  window.addEventListener('pantryhavechange', fn);
  window.addEventListener('spicesownedchange', fn);
}

/** Small inline marker shown next to a dimmed row. */
export const HAVE_BADGE = '<span class="have-badge" title="Du har troligen detta hemma (Skafferiet)">hemma</span>';
