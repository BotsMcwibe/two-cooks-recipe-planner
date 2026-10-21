/**
 * Hash-based deep links for GitHub Pages (static hosting).
 *
 * Routes:
 *   #cook/<masterId>      → Matlagning for that recipe
 *   #overview/<masterId>  → öppna översikt-modal
 *   #kryddor              → kryddskåpet (spice blend calculator)
 *   #skafferi             → skafferiet (pantry staples → recipes)
 *   #vecka                → veckoplaneraren (week planner)
 *   #inkop[/<code>]       → inköpslista som sida (own, or a shared list code)
 *   #browse | # | empty   → receptlista (browse)
 */

/**
 * @typedef {{ route: 'browse' | 'cook' | 'overview' | 'kryddor', masterId: string | null }} AppRoute
 */

/**
 * Normalize a hash string for comparison (leading #, decode path id).
 * @param {string} hash
 * @returns {string}
 */
export function normalizeHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw || raw === 'browse') return 'browse';
  if (/^inkop(\/|$)/i.test(raw)) return `inkop${raw.slice(5)}`;
  const m = raw.match(/^(cook|overview)\/(.+)$/i);
  if (!m) return raw.toLowerCase();
  let id = m[2];
  try {
    id = decodeURIComponent(id);
  } catch {
    /* keep raw segment */
  }
  return `${m[1].toLowerCase()}/${id}`;
}

/**
 * Parse location.hash (or any hash string) into a route object.
 * @param {string} [hash]
 * @returns {AppRoute}
 */
export function parseHash(hash = typeof location !== 'undefined' ? location.hash : '') {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw || raw === 'browse') {
    return { route: 'browse', masterId: null };
  }
  if (raw.toLowerCase() === 'kryddor') {
    return { route: 'kryddor', masterId: null };
  }
  if (raw.toLowerCase() === 'skafferi') {
    return { route: 'skafferi', masterId: null };
  }
  const ink = raw.match(/^inkop(?:\/(.*))?$/i);
  if (ink) {
    return { route: 'inkop', masterId: ink[1] ? ink[1] : null };
  }
  if (raw.toLowerCase() === 'vecka') {
    return { route: 'vecka', masterId: null };
  }
  if (raw.toLowerCase() === 'konto') {
    return { route: 'konto', masterId: null };
  }

  const m = raw.match(/^(cook|overview)\/(.+)$/i);
  if (!m) {
    return { route: 'browse', masterId: null };
  }

  let masterId = m[2];
  try {
    masterId = decodeURIComponent(masterId);
  } catch {
    /* keep encoded-as-is */
  }
  if (!masterId) {
    return { route: 'browse', masterId: null };
  }

  return { route: m[1].toLowerCase(), masterId };
}

/**
 * Build a hash string for a route (includes leading #).
 * @param {'browse' | 'cook' | 'overview' | 'kryddor'} route
 * @param {string | null} [masterId]
 * @returns {string}
 */
export function hashFor(route, masterId = null) {
  if (route === 'cook' && masterId) {
    return `#cook/${encodeURIComponent(masterId)}`;
  }
  if (route === 'overview' && masterId) {
    return `#overview/${encodeURIComponent(masterId)}`;
  }
  if (route === 'kryddor') return '#kryddor';
  if (route === 'konto') return '#konto';
  if (route === 'vecka') return '#vecka';
  if (route === 'inkop') return masterId ? `#inkop/${masterId}` : '#inkop';
  if (route === 'skafferi') return '#skafferi';
  return '#browse';
}

/**
 * Update the URL hash without looping when already matching.
 * @param {'browse' | 'cook' | 'overview' | 'kryddor'} route
 * @param {string | null} [masterId]
 * @param {{ replace?: boolean }} [opts] replace=true → replaceState; false → pushState
 * @returns {boolean} true if the URL was changed
 */
export function setHash(route, masterId = null, opts = {}) {
  const replace = opts.replace !== false;
  const next = hashFor(route, masterId);
  if (normalizeHash(location.hash) === normalizeHash(next)) return false;

  const url = `${location.pathname}${location.search}${next}`;
  if (replace) {
    history.replaceState(null, '', url);
  } else {
    // pushState updates the hash without firing hashchange (unlike location.hash = …).
    // Back/forward still works via popstate; we listen for both in main.js.
    history.pushState(null, '', url);
  }
  return true;
}
