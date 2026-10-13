/**
 * Per-key "last changed" timestamps for synced preferences (theme, spiceMixMissing,
 * shopping), so local and remote can be merged key by key (newer wins).
 * touch(key) also fires `yessy:prefchange` so the sync layer can write through.
 */
const KEY = 'yessy.prefsMeta.v1';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export function prefTs(key) {
  return Number(read()[key]) || 0;
}

export function setPrefTs(key, ts) {
  const m = read();
  m[key] = ts;
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ }
}

export function touchPref(key) {
  setPrefTs(key, Date.now());
  window.dispatchEvent(new CustomEvent('yessy:prefchange', { detail: { key } }));
}
