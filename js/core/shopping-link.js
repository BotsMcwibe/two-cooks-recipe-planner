/**
 * Shareable Inköpslista links: #inkop/<code>, no login or database needed.
 * code = recipes joined by '.', each 'recipe_id-portions', e.g.
 *   #inkop/chicken_kiev-4.pastagratang_ziti-6
 * Recipe ids are [a-z0-9_], so the code is URL-safe as is.
 *
 * Checked-off items are kept locally per list (key 'mine' for the user's own
 * list, the code for a shared one) in localStorage.
 */
const CHECKS_KEY = 'yessy.shopChecks.v1';
const MAX_LISTS = 20;

/** @param {{ id: string, portions: number }[]} items */
export function encodeShoppingList(items) {
  return items
    .filter((it) => /^[a-z0-9_]+$/.test(it.id))
    .map((it) => `${it.id}-${Math.max(1, Math.min(99, Math.round(Number(it.portions) || 4)))}`)
    .join('.');
}

/** @returns {{ id: string, portions: number|null }[]} unknown/garbled parts are dropped */
export function decodeShoppingList(code) {
  const out = [];
  const seen = new Set();
  for (const part of String(code || '').split('.')) {
    const m = part.match(/^([a-z0-9_]+?)(?:-(\d{1,2}))?$/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], portions: m[2] ? Number(m[2]) : null });
  }
  return out;
}

export function shareUrl(code) {
  return `${location.origin}${location.pathname}#inkop/${code}`;
}

function readAll() {
  try { const v = JSON.parse(localStorage.getItem(CHECKS_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/** Set of checked item keys for one list. */
export function checkedItems(listKey) {
  const r = readAll()[listKey];
  return new Set(r && Array.isArray(r.items) ? r.items : []);
}

export function setChecked(listKey, itemKey, on) {
  const all = readAll();
  const s = new Set(all[listKey] && Array.isArray(all[listKey].items) ? all[listKey].items : []);
  if (on) s.add(itemKey); else s.delete(itemKey);
  all[listKey] = { items: [...s], at: Date.now() };
  // Keep the newest lists only
  const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
  for (const k of keys.slice(MAX_LISTS)) if (k !== 'mine') delete all[k];
  try { localStorage.setItem(CHECKS_KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

export function clearChecked(listKey) {
  const all = readAll();
  delete all[listKey];
  try { localStorage.setItem(CHECKS_KEY, JSON.stringify(all)); } catch { /* private mode */ }
}
