/**
 * Veckoplaneraren (#vecka): settings + the current week's picks.
 *
 * Two synced preference keys (user_preferences.prefs, see sync.js; newest
 * updatedAt wins per key, so changing categories on one device and swapping a
 * recipe on another don't overwrite each other):
 *
 *   weekPlanSettings { cats: [{ id: 'protein:chicken', count: 1 }, …], godkandOnly: bool,
 *                      rerollSource: 'new' (Inte lagade än) | 'cooked' (Redan lagade) }
 *   weekPlan         { week: '2026-W43', picks: [{ slot, cat, recipeId|null, locked, portions|null }] }
 *
 * Stored in localStorage when logged out. Fires `weekplanchange` on window.
 */
import { touchPref } from './prefs-meta.js?v=20261021g12';

const SETTINGS_KEY = 'yessy.weekPlanSettings.v1';
const PLAN_KEY = 'yessy.weekPlan.v1';

export const DEFAULT_CATS = ['protein:chicken', 'protein:fish', 'protein:pork', 'protein:beef', 'protein:shrimp', 'protein:vegetarian'];
export const MAX_PER_CAT = 7;

export function defaultSettings() {
  return { cats: DEFAULT_CATS.map((id) => ({ id, count: 1 })), godkandOnly: true, rerollSource: 'new' };
}

function readJson(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
}
function writeJson(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}
const fire = (key) => window.dispatchEvent(new CustomEvent('weekplanchange', { detail: { key } }));

function cleanSettings(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.cats)) return defaultSettings();
  const seen = new Set();
  const cats = [];
  for (const c of v.cats) {
    const id = c && String(c.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const n = Math.round(Number(c.count));
    cats.push({ id, count: Number.isFinite(n) ? Math.min(MAX_PER_CAT, Math.max(1, n)) : 1 });
  }
  return { cats, godkandOnly: v.godkandOnly !== false, rerollSource: v.rerollSource === 'cooked' ? 'cooked' : 'new' };
}

function cleanPlan(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.picks)) return { week: null, picks: [] };
  const picks = v.picks.filter((p) => p && p.slot && p.cat).map((p) => ({
    slot: String(p.slot),
    cat: String(p.cat),
    recipeId: p.recipeId ? String(p.recipeId) : null,
    locked: !!p.locked,
    portions: Number.isFinite(Number(p.portions)) && Number(p.portions) > 0 ? Math.round(Number(p.portions)) : null,
  }));
  return { week: typeof v.week === 'string' ? v.week : null, picks };
}

/** ISO week key for a date, e.g. '2026-W43'. */
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const wk = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
}

export function settings() { return cleanSettings(readJson(SETTINGS_KEY)); }
export function plan() { return cleanPlan(readJson(PLAN_KEY)); }

/** User change of the settings. */
export function saveSettings(v) {
  writeJson(SETTINGS_KEY, cleanSettings(v)); touchPref('weekPlanSettings'); fire('weekPlanSettings');
}
/** User change of the plan. */
export function savePlan(v) {
  writeJson(PLAN_KEY, cleanPlan(v)); touchPref('weekPlan'); fire('weekPlan');
}

/** Raw stored values for sync (null when never touched). */
export function storedSettings() { return readJson(SETTINGS_KEY) ? settings() : null; }
export function storedPlan() { return readJson(PLAN_KEY) ? plan() : null; }

/** Replace from remote sync (not marked as a local change). */
export function replaceSettings(v) {
  const next = cleanSettings(v);
  if (JSON.stringify(next) === JSON.stringify(readJson(SETTINGS_KEY))) return;
  writeJson(SETTINGS_KEY, next); fire('weekPlanSettings');
}
export function replacePlan(v) {
  const next = cleanPlan(v);
  if (JSON.stringify(next) === JSON.stringify(readJson(PLAN_KEY))) return;
  writeJson(PLAN_KEY, next); fire('weekPlan');
}

window.addEventListener('storage', (e) => {
  if (e.key === SETTINGS_KEY) fire('weekPlanSettings');
  if (e.key === PLAN_KEY) fire('weekPlan');
});
