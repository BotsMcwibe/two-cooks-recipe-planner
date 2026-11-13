/**
 * Receptinkorg URL rules, mirrored 1:1 from public.normalize_recipe_url() in
 * supabase/migrations/20261109220329_recipe_inbox.sql. The client checks first so
 * the user gets a Swedish message right away; the RPC is the authority.
 * Pure module (no imports, no DOM) so it can also run in Node for the parity test.
 */

export const URL_MIN = 12;
export const URL_MAX = 2000;
export const NOTE_MAX = 500;

const TRACKING = new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid', 'msclkid', 'ref', 'ref_', 'cmpid', 'igshid', 'si']);
const BAD_CHARS = /[\s\u0000-\u001f\u007f<>"'\\^`{|}]/;
const DNS = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const TLD = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const LOCAL = /(^|\.)(localhost|local|localdomain|internal|intranet|corp|home|lan|test|example|invalid|onion|arpa)$/;

/** Swedish messages for each reason code. */
export const URL_REASON_SV = {
  empty: 'Klistra in en länk till ett recept.',
  length: 'Länken är för kort eller för lång.',
  chars: 'Länken innehåller mellanslag eller tecken som inte hör hemma i en länk.',
  https: 'Länken måste börja med https://',
  host: 'Det där ser inte ut som en vanlig webbadress.',
  userinfo: 'Länkar med användarnamn eller lösenord i adressen tas inte emot.',
  port: 'Länkar med portnummer tas inte emot.',
  ip: 'Skriv webbplatsens namn, inte en IP-adress.',
  local: 'Länken pekar på en lokal eller intern adress.',
};

const len = (s) => [...s].length;

/**
 * @param {string} input
 * @returns {{ ok: true, url: string } | { ok: false, reason: keyof typeof URL_REASON_SV }}
 */
export function checkRecipeUrl(input) {
  let u = String(input ?? '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  if (!u) return { ok: false, reason: 'empty' };
  if (len(u) < URL_MIN || len(u) > URL_MAX) return { ok: false, reason: 'length' };
  if (BAD_CHARS.test(u)) return { ok: false, reason: 'chars' };
  if (u.slice(0, 8).toLowerCase() !== 'https://') return { ok: false, reason: 'https' };

  const rest = u.slice(8);
  const hostRaw = rest.match(/^[^/?#]*/)[0];
  let host = hostRaw.toLowerCase();
  if (!host) return { ok: false, reason: 'host' };
  if (host.includes('@')) return { ok: false, reason: 'userinfo' };
  const pm = host.match(/:([0-9]+)$/);
  if (pm) {
    if (pm[1] !== '443') return { ok: false, reason: 'port' };
    host = host.replace(/:[0-9]+$/, '');
  }
  host = host.replace(/^www\./, '');
  if (/^[0-9.]+$/.test(host)) return { ok: false, reason: 'ip' };
  if (/[:[\]]/.test(host)) return { ok: false, reason: 'ip' };
  if (len(host) > 253 || !DNS.test(host)) return { ok: false, reason: 'host' };
  const tld = host.match(/([^.]+)$/)[1];
  if (!TLD.test(tld)) return { ok: false, reason: 'ip' };
  if (LOCAL.test(host) || /^metadata\./.test(host)) return { ok: false, reason: 'local' };

  let path = rest.slice(hostRaw.length);
  path = path.split('#')[0];
  let q = '';
  const qi = path.indexOf('?');
  if (qi >= 0) { q = path.slice(qi + 1); path = path.slice(0, qi); }
  path = path.replace(/\/+$/, '');

  const kept = [];
  if (q) {
    for (const pair of q.split('&')) {
      const k = pair.split('=')[0].toLowerCase();
      if (!k) continue;
      if (k.startsWith('utm_') || TRACKING.has(k)) continue;
      const eq = pair.indexOf('=');
      kept.push(`${k}=${eq >= 0 ? pair.slice(eq + 1) : ''}`);
    }
  }
  u = `https://${host}${path}`;
  if (kept.length) u += `?${kept.join('&')}`;
  if (len(u) > URL_MAX) return { ok: false, reason: 'length' };
  return { ok: true, url: u };
}

/** Same contract as the SQL function: '' when rejected, else the normalised URL. */
export function normalizeRecipeUrl(input) {
  const r = checkRecipeUrl(input);
  return r.ok ? r.url : '';
}

/** "www.ica.se/recept/…" style short text for showing an unreviewed link as plain text. */
export function displayUrl(url, max = 60) {
  const s = String(url || '').replace(/^https:\/\//i, '').replace(/^www\./i, '');
  return len(s) > max ? `${[...s].slice(0, max - 1).join('')}…` : s;
}
