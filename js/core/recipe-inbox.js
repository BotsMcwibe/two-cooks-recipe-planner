/**
 * Receptinkorg (#inkorg): a signed-in user pastes a link to a recipe; Alfred's
 * morning routine reviews it later (supabase/migrations/20261109220329_recipe_inbox.sql,
 * docs/recipe-inbox-plan.md). Rows are private to the submitter.
 *
 * Wraps: rpc submit_recipe_inbox, select own recipe_inbox rows, delete own 'new' rows.
 * Keeps the last list in memory and fires `recipeinboxchange` on window.
 */
import { getClient, currentUser, onAuthChange } from './sync.js?v=20261113g25';
import { checkRecipeUrl, URL_REASON_SV, NOTE_MAX } from './recipe-url.js?v=20261113g25';

const COLS = 'id,url,note,status,suggestion,review_notes,recipe_id,duplicate_of,created_at,reviewed_at';

/** Swedish messages for RPC / network errors. */
export const ERROR_SV = {
  rate_limited_user: 'Du har skickat många länkar den senaste timmen. Vänta en stund och försök igen.',
  rate_limited_global: 'Många tipsar om recept just nu. Försök igen om en timme.',
  too_many_pending: 'Du har 25 länkar som väntar på granskning. Vänta tills några är granskade innan du skickar fler.',
  submissions_paused: 'Dina inskick är pausade eftersom flera länkar spärrats som skräp. Säg till om det blivit fel.',
  invalid_url: 'Länken godkändes inte. Den måste börja med https:// och gå till en vanlig webbplats.',
  note_too_long: `Anteckningen får vara högst ${NOTE_MAX} tecken.`,
  not_signed_in: 'Logga in för att skicka länkar.',
  not_ready: 'Receptinkorgen är inte igång än. Försök igen senare.',
  network: 'Kunde inte nå servern. Kontrollera anslutningen och försök igen.',
  unknown: 'Något gick fel. Försök igen om en stund.',
};

const KNOWN = ['rate_limited_user', 'rate_limited_global', 'too_many_pending', 'submissions_paused', 'invalid_url', 'note_too_long', 'not_signed_in'];

/** Map a supabase error (or RPC error code) to a key of ERROR_SV. */
export function errorKey(err) {
  if (!err) return 'unknown';
  if (typeof err === 'string') return KNOWN.includes(err) ? err : 'unknown';
  const msg = String(err.message || '');
  const hit = KNOWN.find((k) => msg.includes(k));
  if (hit) return hit;
  // Function / table missing: the SQL has not been run on this project yet.
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(err.code)) return 'not_ready';
  if (/fetch|network|offline/i.test(msg)) return 'network';
  return 'unknown';
}

let rows = null; // null = not loaded
let loadedFor = null;
let lastError = null;
let loading = null;

function fire() { window.dispatchEvent(new CustomEvent('recipeinboxchange')); }

export function items() { return rows || []; }
export function isLoaded() { return rows !== null && loadedFor === (currentUser() || {}).id; }
export function loadError() { return lastError; }
/** Links still waiting for review (ny + granskad). */
export function pendingCount() { return items().filter((r) => r.status === 'new' || r.status === 'reviewed').length; }

/** Fetch my submissions (newest first). Resolves to the list; never throws. */
export function refresh() {
  const client = getClient();
  const user = currentUser();
  if (!client || !user) { rows = null; loadedFor = null; lastError = null; fire(); return Promise.resolve([]); }
  if (loading) return loading;
  loading = (async () => {
    try {
      const { data, error } = await client.from('recipe_inbox').select(COLS)
        .eq('added_by', user.id).order('created_at', { ascending: false }).limit(200);
      if (error) { lastError = errorKey(error); console.warn('[inkorg] list failed', error.message || error); return items(); }
      rows = Array.isArray(data) ? data : [];
      loadedFor = user.id;
      lastError = null;
      return rows;
    } catch (e) {
      lastError = errorKey(e);
      console.warn('[inkorg] list failed', e);
      return items();
    } finally {
      loading = null;
      fire();
    }
  })();
  return loading;
}

/**
 * Submit a link. Validates locally first (same rules as the RPC).
 * @returns {Promise<{ ok: true, id: string, created: boolean } | { ok: false, error: string, message: string }>}
 */
export async function submit(url, note) {
  const check = checkRecipeUrl(url);
  if (!check.ok) return { ok: false, error: check.reason, message: URL_REASON_SV[check.reason] };
  const n = String(note || '').trim();
  if ([...n].length > NOTE_MAX) return { ok: false, error: 'note_too_long', message: ERROR_SV.note_too_long };
  const client = getClient();
  if (!client || !currentUser()) return { ok: false, error: 'not_signed_in', message: ERROR_SV.not_signed_in };
  let res;
  try {
    res = await client.rpc('submit_recipe_inbox', { p_url: String(url).trim(), p_note: n || null });
  } catch (e) {
    const k = errorKey(e);
    return { ok: false, error: k, message: ERROR_SV[k] };
  }
  if (res.error) {
    const k = errorKey(res.error);
    if (k === 'unknown') console.warn('[inkorg] submit failed', res.error.message || res.error);
    return { ok: false, error: k, message: ERROR_SV[k] };
  }
  const d = res.data || {};
  if (!d.ok) {
    const k = errorKey(d.error);
    return { ok: false, error: k, message: ERROR_SV[k] };
  }
  await refresh();
  return { ok: true, id: d.id, created: !!d.created };
}

/** Withdraw one of my links that has not been reviewed yet. */
export async function withdraw(id) {
  const client = getClient();
  if (!client || !currentUser()) return false;
  const { error } = await client.from('recipe_inbox').delete().eq('id', id);
  if (error) { console.warn('[inkorg] delete failed', error.message || error); return false; }
  rows = items().filter((r) => !(r.id === id && r.status === 'new'));
  fire();
  refresh();
  return true;
}

onAuthChange((u) => {
  if (!u || (loadedFor && loadedFor !== u.id)) { rows = null; loadedFor = null; lastError = null; fire(); }
});
