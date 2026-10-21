/**
 * Optional Supabase account sync. The app works fully without it (localStorage).
 *
 * - supabase-js v2 is loaded lazily from a CDN; if that fails the app stays local-only.
 * - Auth: magic link (signInWithOtp) with PKCE. The link returns with ?code=… in the
 *   query string, which the client exchanges itself (detectSessionInUrl); the hash
 *   router never sees it. Legacy/implicit tokens or errors in the hash are cleared
 *   before routing (see consumeAuthRedirect).
 * - On sign-in: merge local ↔ remote (newer updatedAt wins, per recipe and per
 *   preference key), then write-through on every local change (optimistic; failures
 *   mark the store dirty and a full merge runs again when back online).
 */
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_JS_URL } from '../config.js?v=20261013a';
import * as UserState from './user-recipe-state.js?v=20261013b';
import { prefTs, setPrefTs } from './prefs-meta.js?v=20261013a';
import { missingMixes, replaceMissingMixes } from './spice-prefs.js?v=20261013a';
import { excludedPantry, replacePantryExcluded } from './pantry-exclude.js?v=20261013gr';
import { ownedSpices, replaceSpicesOwned } from './spices-owned.js?v=20261013ko';
import { savedTheme, applySyncedTheme } from '../utils/theme.js?v=20261013b';
import { storedKitchen, replaceKitchen } from './kitchen-prefs.js?v=20261021eq';

const listeners = new Set();
let client = null;
let user = null;
let appState = null;
let applying = false;
let dirty = false;
let readyPromise = null;
let lastSyncAt = 0;
const statusListeners = new Set();

function setDirty(v) {
  dirty = v;
  if (!v) lastSyncAt = Date.now();
  notifyStatus();
}

function notifyStatus() {
  for (const fn of statusListeners) { try { fn(syncStatus()); } catch (err) { console.error(err); } }
}

function markWritten() {
  lastSyncAt = Date.now();
  notifyStatus();
}

/**
 * 'local' (not signed in) | 'offline' | 'pending' (a write failed, will retry) | 'synced'
 */
export function syncStatus() {
  if (!user) return 'local';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return dirty ? 'pending' : 'synced';
}

export function lastSyncTime() { return lastSyncAt; }

export function onSyncStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

const AUTH_HASH_RE = /(^|[#&])(access_token|refresh_token|error|error_description|error_code)=/;

function emit() {
  for (const fn of listeners) {
    try { fn(user); } catch (err) { console.error(err); }
  }
}

export function onAuthChange(fn) {
  listeners.add(fn);
  fn(user);
  return () => listeners.delete(fn);
}

export function currentUser() { return user; }
export function isAvailable() { return !!client; }

/** True when the URL carries an auth redirect (PKCE code or hash tokens/errors). */
export function hasAuthRedirect() {
  const q = new URLSearchParams(location.search);
  return q.has('code') || AUTH_HASH_RE.test(location.hash);
}

/** Error text from an auth redirect in the hash, if any (e.g. expired link). */
function hashAuthError() {
  if (!AUTH_HASH_RE.test(location.hash)) return null;
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  return p.get('error_description') || p.get('error') || null;
}

/** Remove auth params from the URL without adding history entries. */
function cleanAuthFromUrl() {
  const url = new URL(location.href);
  let changed = false;
  for (const k of ['code', 'error', 'error_description', 'error_code']) {
    if (url.searchParams.has(k)) { url.searchParams.delete(k); changed = true; }
  }
  if (AUTH_HASH_RE.test(url.hash)) { url.hash = '#browse'; changed = true; }
  if (changed) history.replaceState(history.state, '', url.toString());
}

// ---------------------------------------------------------------------------
// Preferences adapters: key → { get(): value, set(value) }
// ---------------------------------------------------------------------------
function prefAdapters() {
  return {
    theme: { get: () => savedTheme(), set: (v) => applySyncedTheme(v) },
    spiceMixMissing: { get: () => [...missingMixes()].sort(), set: (v) => replaceMissingMixes(v) },
    pantryExcluded: { get: () => [...excludedPantry()].sort(), set: (v) => replacePantryExcluded(v) },
    spicesOwned: { get: () => [...ownedSpices()].sort(), set: (v) => replaceSpicesOwned(v) },
    kitchen: { get: () => storedKitchen(), set: (v) => replaceKitchen(v) },
    shopping: {
      get: () => (appState ? appState.getShoppingData() : null),
      set: (v) => appState && appState.replaceShoppingData(v),
    },
  };
}

function localPrefs() {
  const out = {};
  for (const [key, a] of Object.entries(prefAdapters())) {
    const value = a.get();
    if (value == null) continue;
    out[key] = { value, updatedAt: prefTs(key) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Merge + write-through
// ---------------------------------------------------------------------------
const toRow = (id, rec) => ({
  recipe_id: id,
  status: rec.status || null,
  rating: rec.rating || null,
  updated_at: new Date(Number(rec.updatedAt) || Date.now()).toISOString(),
});

async function mergeAll() {
  if (!client || !user) return;
  try {
    // Recipe state
    const { data: rows, error } = await client.from('user_recipe_state').select('recipe_id,status,rating,updated_at');
    if (error) throw error;
    const remote = new Map((rows || []).map(r => [r.recipe_id, r]));
    const push = [];
    applying = true;
    try {
      for (const r of remote.values()) {
        UserState.applyRemote(r.recipe_id, { status: r.status, rating: r.rating, updatedAt: Date.parse(r.updated_at) });
      }
    } finally {
      applying = false;
    }
    const local = UserState.allLocal(); // after applyRemote, so seed-clears get pushed
    for (const [id, rec] of Object.entries(local)) {
      const r = remote.get(id);
      if (!r || (Number(rec.updatedAt) || 0) > Date.parse(r.updated_at)) push.push(toRow(id, rec));
    }
    if (push.length) {
      const { error: upErr } = await client.from('user_recipe_state').upsert(push, { onConflict: 'user_id,recipe_id' });
      if (upErr) throw upErr;
    }

    // Preferences (per key)
    const { data: prefRow, error: pErr } = await client.from('user_preferences').select('prefs').maybeSingle();
    if (pErr) throw pErr;
    const remotePrefs = (prefRow && prefRow.prefs) || {};
    const mine = localPrefs();
    const merged = { ...remotePrefs };
    const adapters = prefAdapters();
    applying = true;
    try {
      for (const [key, rv] of Object.entries(remotePrefs)) {
        const lv = mine[key];
        if (adapters[key] && rv && (!lv || (Number(rv.updatedAt) || 0) > (Number(lv.updatedAt) || 0))) {
          adapters[key].set(rv.value);
          setPrefTs(key, Number(rv.updatedAt) || 0);
        }
      }
    } finally {
      applying = false;
    }
    let changed = !prefRow;
    for (const [key, lv] of Object.entries(mine)) {
      const rv = remotePrefs[key];
      if (!rv || (Number(lv.updatedAt) || 0) > (Number(rv.updatedAt) || 0)) {
        merged[key] = lv;
        changed = true;
      }
    }
    if (changed) await writePrefs(merged);
    setDirty(false);
  } catch (err) {
    setDirty(true);
    console.warn('[sync] merge failed (will retry when online)', err);
  }
}

async function writePrefs(prefs) {
  const { error } = await client.from('user_preferences')
    .upsert({ prefs, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
  markWritten();
}

async function pushRecipe(id) {
  if (!client || !user || applying || !id) return;
  const rec = UserState.allLocal()[id];
  if (!rec) return;
  try {
    const { error } = await client.from('user_recipe_state').upsert(toRow(id, rec), { onConflict: 'user_id,recipe_id' });
    if (error) throw error;
    markWritten();
  } catch (err) {
    setDirty(true);
    console.warn('[sync] recipe write failed, queued', err);
  }
}

let prefTimer = null;
function schedulePrefPush() {
  if (!client || !user || applying) return;
  clearTimeout(prefTimer);
  prefTimer = setTimeout(async () => {
    try {
      // Read-modify-write so keys changed on another device are kept
      const { data, error } = await client.from('user_preferences').select('prefs').maybeSingle();
      if (error) throw error;
      const remote = (data && data.prefs) || {};
      const merged = { ...remote };
      for (const [key, lv] of Object.entries(localPrefs())) {
        const rv = remote[key];
        if (!rv || (Number(lv.updatedAt) || 0) >= (Number(rv.updatedAt) || 0)) merged[key] = lv;
      }
      await writePrefs(merged);
    } catch (err) {
      setDirty(true);
      console.warn('[sync] preferences write failed, queued', err);
    }
  }, 400);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start auth/sync. Resolves once the session (incl. a magic-link redirect) is known.
 * Never throws; on any failure the app stays local-only.
 * @param {{ state: import('./state.js').AppState }} opts
 */
export function initSync({ state } = {}) {
  appState = state || appState;
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const redirectError = hashAuthError();
    try {
      const { createClient } = await import(SUPABASE_JS_URL);
      client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
      });
      const { data } = await client.auth.getSession();
      user = data && data.session ? data.session.user : null;
      cleanAuthFromUrl();
      if (redirectError) console.warn('[auth] sign-in link error:', redirectError);
      client.auth.onAuthStateChange((event, session) => {
        const prev = user && user.id;
        user = session ? session.user : null;
        emit();
        notifyStatus();
        if (user && user.id !== prev) mergeAll();
      });
      emit();
      if (user) mergeAll();
    } catch (err) {
      client = null;
      cleanAuthFromUrl();
      console.warn('[auth] Supabase unavailable, staying local-only', err);
      emit();
    }
    return { user, error: redirectError };
  })();

  UserState.subscribe((id) => { if (id) pushRecipe(id); });
  window.addEventListener('yessy:prefchange', () => schedulePrefPush());
  window.addEventListener('online', () => { setDirty(dirty); if (dirty) mergeAll(); });
  window.addEventListener('offline', () => setDirty(dirty));
  return readyPromise;
}

/** Send a magic sign-in link that returns to this page (path incl. /two-cooks-recipe-planner/). */
export async function signInWithEmail(email) {
  if (!client) throw new Error('Inloggning är inte tillgänglig just nu.');
  const emailRedirectTo = `${location.origin}${location.pathname}`;
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: true } });
  if (error) throw error;
}

export async function signOut() {
  if (!client) return;
  await client.auth.signOut();
}
