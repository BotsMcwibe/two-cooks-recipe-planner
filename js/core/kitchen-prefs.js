/**
 * Kitchen profile (per account): { ovenTrays: int ≥ 1, ovenFan: bool }.
 * Stored in localStorage and synced via user_preferences.prefs.kitchen (see sync.js).
 * Defaults come from data/equipment.json → defaultKitchen (set by the loader).
 * Fires `kitchenchange` on window when it changes.
 */
import { touchPref } from './prefs-meta.js?v=20261013a';

const KEY = 'yessy.kitchen.v1';
let defaults = { ovenTrays: 2, ovenFan: false };

export const MAX_OVEN_TRAYS = 6;

function clean(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  const t = Number(v.ovenTrays);
  if (Number.isInteger(t) && t >= 1) out.ovenTrays = Math.min(t, MAX_OVEN_TRAYS);
  if (typeof v.ovenFan === 'boolean') out.ovenFan = v.ovenFan;
  return out;
}

/** Stored profile, or null when the user never changed it. */
export function storedKitchen() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = clean(JSON.parse(raw));
    return Object.keys(v).length ? v : null;
  } catch {
    return null;
  }
}

/** Effective profile: defaults overridden by the stored values. */
export function kitchenProfile() {
  return { ...defaults, ...(storedKitchen() || {}) };
}

export function setKitchenDefaults(d) {
  defaults = { ovenTrays: 2, ovenFan: false, ...clean(d) };
}

function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ }
}
const fire = () => window.dispatchEvent(new CustomEvent('kitchenchange'));

/** Change one or more fields (user action). */
export function setKitchen(patch) {
  const next = { ...kitchenProfile(), ...clean(patch) };
  write(next); touchPref('kitchen'); fire();
}

/** Replace the whole profile (remote sync). Does not mark the pref as locally changed. */
export function replaceKitchen(v) {
  const next = { ...defaults, ...clean(v) };
  const cur = kitchenProfile();
  if (next.ovenTrays === cur.ovenTrays && next.ovenFan === cur.ovenFan && storedKitchen()) return;
  write(next); fire();
}
