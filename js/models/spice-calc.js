/**
 * Spice pantry math: how many whole packets of ONE blend fit in what you have.
 * Each blend is counted on its own (the blends compete for the same jars, so
 * the numbers are "if I only made this one", not a combined plan).
 */

const EPS = 1e-9;

/**
 * Parse a user-typed gram amount. Accepts "12", "12,5", "12.5", " 7 g".
 * Empty / invalid / negative → 0.
 * @param {string|number|null|undefined} raw
 * @returns {number}
 */
export function parseGrams(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0;
  const s = String(raw ?? '').trim().replace(/\s*g$/i, '').replace(',', '.');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {{ name: string, packetGrams: number, spices: Record<string, number> }} blend
 * @param {Record<string, number>} have grams on hand per spice id (missing = 0)
 * @returns {{ packets: number, limiting: string[], short: string[] }}
 *   packets  max whole packets of this blend alone
 *   limiting spice ids that run out first (ties included)
 *   short    spice ids with less than one packet's worth (only when packets is 0)
 */
export function blendCapacity(blend, have) {
  let min = Infinity;
  const ratios = [];
  for (const [id, need] of Object.entries(blend.spices)) {
    if (!(need > 0)) continue;
    const r = (have[id] || 0) / need;
    ratios.push([id, r]);
    if (r < min) min = r;
  }
  if (!ratios.length) return { packets: 0, limiting: [], short: [] };
  const packets = Math.max(0, Math.floor(min + EPS));
  const limiting = ratios.filter(([, r]) => r <= min + EPS).map(([id]) => id);
  const short = packets === 0 ? ratios.filter(([, r]) => r + EPS < 1).map(([id]) => id) : [];
  return { packets, limiting, short };
}

/**
 * @param {Array<{ name: string, packetGrams: number, spices: Record<string, number> }>} blends
 * @param {Record<string, number>} have
 */
export function allCapacities(blends, have) {
  return blends.map(b => ({ blend: b, ...blendCapacity(b, have) }));
}
