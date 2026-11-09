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
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_JS_URL } from '../config.js?v=20261109g20';
import * as UserState from './user-recipe-state.js?v=20261109g20';
import { prefTs, setPrefTs } from './prefs-meta.js?v=20261109g20';
import { missingMixes, replaceMissingMixes } from './spice-prefs.js?v=20261109g20';
import { excludedPantry, replacePantryExcluded } from './pantry-exclude.js?v=20261109g20';
import { ownedSpices, replaceSpicesOwned } from './spices-owned.js?v=20261109g20';
import { savedTheme, applySyncedTheme } from '../utils/theme.js?v=20261109g20';
import { storedKitchen, replaceKitchen } from './kitchen-prefs.js?v=20261109g20';
import { storedSettings as storedWeekSettings, replaceSettings as replaceWeekSettings, storedPlan as storedWeekPlan, replacePlan as replaceWeekPlan } from './week-plan.js?v=20261109g20';
import { setActor, journalValue, replaceJournal, mergeJournal } from './recipe-journal.js?v=20261109g20';
import * as Household from './household.js?v=20261109g20';
import * as Tables from './table-sync.js?v=20261109g20';

/** Signed-in journal data uses household tables only; failures stay queued locally. */
const RETIRED_PREF_KEYS = ['cookLog', 'recipeNotes', 'recipeLists', 'notForUs', 'journalMigratedAt'];
let tablesMode = false;

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
/** Run a full sync now (after joining/leaving a household, etc.). */
export function syncNow() { return mergeAll(); }
/** The supabase client (null when unavailable). */
export function getClient() { return client; }
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
    // Veckoplaneraren: settings and the week's picks are separate keys (newest wins per key)
    weekPlanSettings: { get: () => storedWeekSettings(), set: (v) => replaceWeekSettings(v) },
    weekPlan: { get: () => storedWeekPlan(), set: (v) => replaceWeekPlan(v) },
    // Personal/account-wide; merge each year independently, including cleared goals.
    cookChallenge: {
      get: () => journalValue('cookChallenge'),
      set: (v) => replaceJournal('cookChallenge', v),
      merge: mergeJournal,
    },
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
    if (a.merge && !Object.keys(value).length && !prefTs(key)) continue;
    out[key] = { value, updatedAt: prefTs(key) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Merge + write-through
// ---------------------------------------------------------------------------
let merging = null;
let mergeAgain = false;
/** Full merge; concurrent calls are folded into one extra run. */
function mergeAll() {
  if (!client || !user) return Promise.resolve();
  if (merging) { mergeAgain = true; return merging; }
  merging = (async () => {
    try {
      do { mergeAgain = false; await mergeOnce(); } while (mergeAgain);
    } finally { merging = null; }
  })();
  return merging;
}

async function mergeOnce() {
  if (!client || !user) return;
  try {
    // Household tables? (also creates my profile + personal kitchen on first sign-in)
    // (a network/server error throws: retry later, keep the current mode)
    const hid = await Tables.detect(client, user);
    if (!hid) throw new Error('Household tables unavailable; local changes kept for retry');
    tablesMode = true;
    Household.setMode('tables');
    if (hid) await Household.refresh(hid).catch((err) => console.warn('[household] refresh failed', err));
    if (tablesMode) {
      await Tables.syncAll(hid);
      subscribeLive(hid);
      Household.loadFeed().catch((err) => console.warn('[feed] load failed', err));
    }
    await mergePrefs();
    setDirty(false);
  } catch (err) {
    setDirty(true);
    console.warn('[sync] merge failed (will retry when online)', err);
  }
}

// ---------------------------------------------------------------------------
// Live updates (Supabase Realtime, migration 0004): another member's change
// triggers a debounced full sync + feed reload. RLS decides which rows arrive.
// ---------------------------------------------------------------------------
let liveChannel = null;
let liveHid = null;
let liveTimer = 0;
const LIVE_TABLES = ['household_recipe_state', 'cook_log', 'recipe_lists', 'recipe_list_items', 'recipe_ratings'];

function fromMe(table, row) {
  const me = user && user.id;
  if (!row || !me) return false;
  if (table === 'household_recipe_state') return row.updated_by === me;
  if (table === 'recipe_ratings') return row.user_id === me;
  return false;
}
function onLive(payload) {
  const row = payload && (payload.new && Object.keys(payload.new).length ? payload.new : payload.old);
  if (fromMe(payload && payload.table, row)) return; // echo of my own write
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => mergeAll(), 1200);
}
function subscribeLive(hid) {
  if (!client || typeof client.channel !== 'function') return;
  if (liveChannel && liveHid === hid) return;
  unsubscribeLive();
  liveHid = hid;
  try {
    let ch = client.channel(`hh-${hid}`);
    for (const table of LIVE_TABLES) {
      const opts = { event: '*', schema: 'public', table };
      if (['household_recipe_state', 'cook_log', 'recipe_lists'].includes(table)) opts.filter = `household_id=eq.${hid}`;
      ch = ch.on('postgres_changes', opts, onLive);
    }
    liveChannel = ch.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.info('[live] realtime unavailable, syncing on focus instead');
    });
  } catch (err) {
    console.info('[live] realtime unavailable', err);
    liveChannel = null; liveHid = null;
  }
}
function unsubscribeLive() {
  if (liveChannel && client) { try { client.removeChannel(liveChannel); } catch {} }
  liveChannel = null; liveHid = null;
  clearTimeout(liveTimer);
}

async function mergePrefs() {
    // Preferences (per key)
    const { data: prefRow, error: pErr } = await client.from('user_preferences').select('prefs').maybeSingle();
    if (pErr) throw pErr;
    const remotePrefs = (prefRow && prefRow.prefs) || {};
    const mine = localPrefs();
    const merged = { ...remotePrefs };
    const adapters = prefAdapters();
    let changed = !prefRow;
    applying = true;
    try {
      // Only access active preference keys. Never import retired journal records.
      for (const key of Object.keys(adapters)) {
        const rv = remotePrefs[key];
        const lv = mine[key];
        const a = adapters[key];
        if (a.merge) {
          if (!rv && !lv) continue;
          const value = a.merge(lv ? lv.value : {}, rv ? rv.value : {});
          const updatedAt = Math.max(Number(lv && lv.updatedAt) || 0, Number(rv && rv.updatedAt) || 0);
          a.set(value);
          setPrefTs(key, updatedAt);
          if (!rv || JSON.stringify(value) !== JSON.stringify(rv.value)) {
            merged[key] = { value, updatedAt };
            changed = true;
          }
          continue;
        }
        if (rv && (!lv || (Number(rv.updatedAt) || 0) > (Number(lv.updatedAt) || 0))) {
          adapters[key].set(rv.value);
          setPrefTs(key, Number(rv.updatedAt) || 0);
        }
      }
    } finally {
      applying = false;
    }
    for (const [key, lv] of Object.entries(mine)) {
      if (adapters[key].merge) continue;
      const rv = remotePrefs[key];
      if (!rv || (Number(lv.updatedAt) || 0) > (Number(rv.updatedAt) || 0)) {
        merged[key] = lv;
        changed = true;
      }
    }
    if (changed) await writePrefs(merged);
}

async function writePrefs(prefs) {
  const { error } = await client.from('user_preferences')
    .upsert({ prefs, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
  markWritten();
}

let tableTimer = null;
/** Debounced write of local changes to the household tables. */
function scheduleTablePush() {
  if (!client || !user || !tablesMode) return;
  clearTimeout(tableTimer);
  tableTimer = setTimeout(async () => {
    try {
      await Tables.pushSweep();
      markWritten();
      if (dirty) setDirty(false);
    } catch (err) {
      setDirty(true);
      console.warn('[sync] table write failed, queued', err);
    }
  }, 300);
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
      const adapters = prefAdapters();
      for (const [key, lv] of Object.entries(localPrefs())) {
        const rv = remote[key];
        const a = adapters[key];
        if (a.merge) {
          const value = a.merge(lv.value, rv ? rv.value : {});
          const updatedAt = Math.max(Number(lv.updatedAt) || 0, Number(rv && rv.updatedAt) || 0);
          merged[key] = { value, updatedAt };
          applying = true;
          try { a.set(value); setPrefTs(key, updatedAt); } finally { applying = false; }
          continue;
        }
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
      setActor(user && user.id);
      Household.attach(client, user);
      cleanAuthFromUrl();
      if (redirectError) console.warn('[auth] sign-in link error:', redirectError);
      client.auth.onAuthStateChange((event, session) => {
        const prev = user && user.id;
        user = session ? session.user : null;
        setActor(user && user.id);
        Household.attach(client, user);
        if (!user) { tablesMode = false; Tables.detach(); unsubscribeLive(); Household.setMode('local'); }
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

  UserState.subscribe((id, info) => {
    if (info && info.remote) return;
    if (tablesMode) {
      if (id) Household.setMyRating(id, UserState.get(id).rating);
      scheduleTablePush();
    }
  });
  window.addEventListener('yessy:prefchange', (e) => {
    const key = e.detail && e.detail.key;
    if (RETIRED_PREF_KEYS.includes(key)) return; // retired journals go to household tables
    schedulePrefPush();
  });
  window.addEventListener('journalchange', (e) => {
    const key = e.detail && e.detail.key;
    if (tablesMode && (!key || Tables.TABLE_KEYS.includes(key)) && !Tables.isApplying()) scheduleTablePush();
  });
  // Fresh household data when the app comes back into view (throttled), retry when dirty
  let lastFocusSync = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !user) return;
    if (Date.now() - lastFocusSync < 30000 && !dirty) return;
    lastFocusSync = Date.now();
    mergeAll();
  });
  setInterval(() => { if (dirty && user && navigator.onLine !== false) mergeAll(); }, 60000);
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
