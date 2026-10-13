import { AppState } from './core/state.js?v=20261013sh';
import { parseHash, setHash } from './core/router.js?v=20261013sk';
import { loadStaticData, RecipeRepository } from './data/loader.js?v=20261013a';
import { AppShell } from './views/app-shell.js?v=20261013sk';
import { RecipeChrome } from './views/recipe-selector.js?v=20261011u';
import { isScalable } from './utils/catalog-ui.js?v=20261011u';
import { BrowseView } from './views/browse-view.js?v=20261013cs';
import { OverviewModal } from './views/overview-modal.js?v=20261013f';
import { FlowGraph } from './views/flow-graph.js?v=20261011u';
import { CookingView } from './views/cooking-view.js?v=20261013f';
import { ShoppingSidebar } from './views/shopping-view.js?v=20261013sh';
import { Timer } from './views/timer.js';
import { spiceMixTogglesHtml } from './views/spice-mix-ui.js?v=20261012e';
import { setMixMissing } from './core/spice-prefs.js?v=20261013a';
import { SpiceView } from './views/spice-view.js?v=20261013ko';
import { PantryView } from './views/pantry-view.js?v=20261013tx2';
import * as UserState from './core/user-recipe-state.js?v=20261013b';
import { initSync, hasAuthRedirect } from './core/sync.js?v=20261013ko';
import { AccountView } from './views/account-view.js?v=20261013ko';
import { initAuthUi } from './views/auth-ui.js?v=20261013ko';
import { initThemeToggle } from './utils/theme.js?v=20261013b';
import { initBackToTop } from './utils/back-to-top.js?v=20261011t';

initThemeToggle(null);
initBackToTop();

async function bootstrap() {
  const { unitMap, baseIngredientMap, ingredientTagsData, catalog, spiceData } = await loadStaticData();
  const repository = new RecipeRepository(unitMap, baseIngredientMap, spiceData);
  const baseIngredients = Object.values(baseIngredientMap);
  const catalogById = Object.fromEntries(catalog.map(c => [c.id, c]));
  UserState.seedFromCatalog(catalog);

  const state = new AppState();
  state.currentPhase = 'browse';

  // Account sync (optional). If we are returning from a magic link, wait for the
  // session exchange and URL cleanup before the hash router runs.
  const syncReady = initSync({ state });
  initAuthUi(document.getElementById('auth'));
  if (hasAuthRedirect()) {
    await Promise.race([syncReady, new Promise(r => setTimeout(r, 6000))]);
  }

  const shell = new AppShell(state);
  const spiceView = new SpiceView(document.getElementById('view-spices'));
  const pantryView = new PantryView(document.getElementById('view-pantry'));
  const mixNames = Object.fromEntries(Object.entries(spiceData.mixIngredients || {}).map(([id, m]) => [id, m.name]));
  const accountView = new AccountView(document.getElementById('view-account'), { state, catalog, mixNames });
  state.on('phase', (p) => { if (p !== 'account') accountView.hide(); });
  const cookingView = new CookingView(state);
  const flowGraph = new FlowGraph({
    onNodeClick: (recipeId) => cookingView.scrollToGroup(recipeId),
  });
  const shoppingSidebar = new ShoppingSidebar(
    state, catalog, unitMap, baseIngredientMap, ingredientTagsData, repository
  );
  const chrome = new RecipeChrome(state, catalog);

  let current = null;
  let loadToken = 0;
  /** Guard: ignore syncHash while applying a URL hash (avoids loops). */
  let applyingHash = false;
  /** False until initial hash applied — prevents boot phase reset from clobbering deep links. */
  let routingReady = false;

  async function ensureLoaded(masterId) {
    if (!masterId) return null;
    const token = ++loadToken;
    const loaded = await repository.loadMaster(masterId);
    if (token !== loadToken) return null;
    state.setBasePortions(loaded.basePortions);
    const scalable = isScalable(catalogById[masterId]);
    // Fixed-yield recipes (one cake per pan) always use basePortions.
    if (!scalable && state.portionScale !== 1) state.portionScale = 1;
    chrome.setScalable(scalable);
    current = loaded;
    return loaded;
  }

  function applyPortions(portions) {
    if (!Number.isFinite(portions) || portions < 2) return;
    if (!isScalable(catalogById[state.selectedRecipeId])) return;
    const base = state.basePortions || 4;
    state.portionScale = portions / base;
  }

  /**
   * @param {{ softUpdate?: boolean, autoScroll?: boolean, preserveScroll?: boolean }} [opts]
   */
  function updateUI(opts = {}) {
    if (!current || !state.selectedRecipeId) return;
    if (current.masterId !== state.selectedRecipeId) return;

    const preserveScroll = opts.preserveScroll !== false;
    const scrollY = preserveScroll ? window.scrollY : 0;

    const scale = state.portionScale;
    const scaledGraph = current.graph.scaleAll(scale);
    const root = scaledGraph.get(state.selectedRecipeId);
    if (!root) return;

    const subtree = scaledGraph.getSubtreeRecipes(root);
    const schedOpts = state.schedulerOptions;
    const entry = catalogById[state.selectedRecipeId] || null;

    if (state.currentPhase === 'cooking') {
      // Flow graph at top of Matlagning; updates with prep-first / 2-cooks and step progress
      const { schedule, progress } = cookingView.render(root, subtree, scaledGraph, baseIngredients, schedOpts, {
        images: current.images,
        nutrition: current.nutrition,
        recipeName: root.name,
        portionScale: scale,
        currentPortions: state.currentPortions,
        catalogEntry: entry,
        softUpdate: !!opts.softUpdate,
        autoScroll: !!opts.autoScroll,
      }) || {};
      flowGraph.render(root, schedule, schedOpts, progress);
      $('#cook-spice-mixes').html(spiceMixTogglesHtml(current.spiceMixes, scale));
      Timer.initAll($('#cooking-steps'));
    }

    if (preserveScroll) {
      // Restore after DOM rebuild so Preppa först / 2 kockar don't jump the page.
      // Double-rAF beats focus/layout clamping that can run after synchronous scrollTo.
      const y = scrollY;
      const restore = () => { window.scrollTo(0, y); };
      restore();
      requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
      });
    }
  }

  function handleStepChange(recipeId) {
    if (!current) return;
    const scale = state.portionScale;
    const scaledGraph = current.graph.scaleAll(scale);
    const root = scaledGraph.get(state.selectedRecipeId);
    if (!root) return;
    const subtree = scaledGraph.getSubtreeRecipes(root);
    const recipe = subtree.find(r => r.outputIngredient.id === recipeId);
    if (!recipe) return;

    const allDone = state.areAllRecipeStepsComplete(recipeId, recipe);
    const isChecked = state.isIngredientChecked(recipeId);

    if (allDone && !isChecked) {
      state.addCheckedIngredient(recipeId);
    } else if (!allDone && isChecked) {
      state.removeCheckedIngredient(recipeId);
    }

    // Soft patch: keep step images/timers; preserve scroll
    updateUI({ softUpdate: true, preserveScroll: true });
  }

  async function selectAndGo(id, phase, portions) {
    if (state.selectedRecipeId !== id) {
      state.resetCookingState();
      state.selectedRecipeId = id;
    }
    await ensureLoaded(id);
    if (portions != null) applyPortions(portions);
    // Legacy 'precook' redirects to cooking (gantt now lives there)
    state.currentPhase = phase === 'precook' ? 'cooking' : phase;
    // Initial cook entry: allow scroll-to-current; later updates preserve scroll
    updateUI({ autoScroll: phase === 'cooking' || phase === 'precook', preserveScroll: false });
    syncHashFromApp({ replace: false });
  }

  /**
   * Reflect current app view in the URL hash (shareable deep links).
   * @param {{ replace?: boolean }} [opts]
   */
  function syncHashFromApp(opts = {}) {
    if (applyingHash || !routingReady) return;
    const replace = opts.replace !== false;

    if (state.currentPhase === 'spices') {
      setHash('kryddor', null, { replace });
      return;
    }
    if (state.currentPhase === 'pantry') {
      setHash('skafferi', null, { replace });
      return;
    }
    if (state.currentPhase === 'account') {
      setHash('konto', null, { replace });
      return;
    }
    if (state.currentPhase === 'cooking' && state.selectedRecipeId) {
      setHash('cook', state.selectedRecipeId, { replace });
      return;
    }
    if (modal.isOpen() && modal.recipeId) {
      setHash('overview', modal.recipeId, { replace });
      return;
    }
    setHash('browse', null, { replace });
  }

  /**
   * Apply location.hash → app state (boot + hashchange / back-forward).
   */
  async function applyHashFromLocation({ replaceUnknown = true } = {}) {
    const { route, masterId } = parseHash();
    applyingHash = true;
    try {
      if (route === 'cook') {
        if (!masterId || !catalogById[masterId]) {
          console.warn('[router] Unknown cook masterId:', masterId);
          if (modal.isOpen()) modal.close({ silent: true });
          state.currentPhase = 'browse';
          if (replaceUnknown) setHash('browse', null, { replace: true });
          return;
        }
        if (modal.isOpen()) modal.close({ silent: true });
        try {
          await selectAndGo(masterId, 'cooking');
        } catch (err) {
          console.warn('[router] Failed to open cook for', masterId, err);
          state.currentPhase = 'browse';
          if (replaceUnknown) setHash('browse', null, { replace: true });
        }
        return;
      }

      if (route === 'konto') {
        if (modal.isOpen()) modal.close({ silent: true });
        const was = state.currentPhase === 'account';
        state.currentPhase = 'account';
        accountView.show();
        if (!was) window.scrollTo(0, 0);
        return;
      }

      if (route === 'skafferi') {
        if (modal.isOpen()) modal.close({ silent: true });
        const was = state.currentPhase === 'pantry';
        state.currentPhase = 'pantry';
        await pantryView.render();
        if (!was) window.scrollTo(0, 0);
        return;
      }

      if (route === 'kryddor') {
        if (modal.isOpen()) modal.close({ silent: true });
        const wasSpices = state.currentPhase === 'spices';
        state.currentPhase = 'spices';
        await spiceView.render();
        if (!wasSpices) window.scrollTo(0, 0);
        return;
      }

      if (route === 'overview') {
        if (!masterId || !catalogById[masterId]) {
          console.warn('[router] Unknown overview masterId:', masterId);
          if (modal.isOpen()) modal.close({ silent: true });
          state.currentPhase = 'browse';
          if (replaceUnknown) setHash('browse', null, { replace: true });
          return;
        }
        state.currentPhase = 'browse';
        try {
          await modal.open(masterId);
        } catch (err) {
          console.warn('[router] Failed to open overview for', masterId, err);
          if (modal.isOpen()) modal.close({ silent: true });
          if (replaceUnknown) setHash('browse', null, { replace: true });
        }
        return;
      }

      // browse / empty / unknown shape
      if (modal.isOpen()) modal.close({ silent: true });
      state.currentPhase = 'browse';
    } finally {
      applyingHash = false;
      // Ensure hash matches what we settled on (e.g. after selectAndGo)
      syncHashFromApp({ replace: true });
    }
  }

  const modal = new OverviewModal(state, catalog, repository, baseIngredients, {
    onCook: (id, portions) => selectAndGo(id, 'cooking', portions),
    onOpen: () => {
      if (!applyingHash) syncHashFromApp({ replace: false });
    },
    onClose: () => {
      if (!applyingHash) syncHashFromApp({ replace: false });
    },
  });

  const browse = new BrowseView(state, catalog, {
    onOpenOverview: (id) => modal.open(id),
  });

  // "Har inte mixen": remember per mix, rebuild graphs (mix step ↔ Blanda step) everywhere
  $(document).on('change', '.spice-mix-missing', function () {
    setMixMissing(String(this.getAttribute('data-mix')), this.checked);
  });
  window.addEventListener('spicemixchange', async () => {
    repository.cache.clear();
    try {
      if (modal.isOpen()) await modal.reload();
      if (state.currentPhase === 'cooking' && state.selectedRecipeId) {
        const loaded = await repository.loadMaster(state.selectedRecipeId);
        current = loaded;
        updateUI({ softUpdate: false, preserveScroll: true });
      } else if (current) {
        current = await repository.loadMaster(current.masterId);
      }
    } catch (err) {
      console.warn('[kryddmix] reload failed', err);
    }
    shoppingSidebar.render();
  });

  shell.setFocusShoppingHandler(() => shoppingSidebar.focus());

  state.on('selectedRecipeId', async (id) => {
    if (!id) return;
    // Avoid double-work when selectAndGo already loaded
    if (!current || current.masterId !== id) {
      await ensureLoaded(id);
    }
    updateUI();
  });
  state.on('portionScale', () => updateUI());
  state.on('schedulerOptions', () => updateUI());
  state.on('phase', () => {
    updateUI();
    // Tab switches (Recept / Matlagning) update the hash
    if (!applyingHash) syncHashFromApp({ replace: false });
  });
  state.on('stepChange', (recipeId) => handleStepChange(recipeId));

  $(document).on('click', '.timer-minus', function () {
    Timer.fromRow($(this).closest('.timer-row'))?.adjustTime(-30);
  });
  $(document).on('click', '.timer-plus', function () {
    Timer.fromRow($(this).closest('.timer-row'))?.adjustTime(30);
  });
  $(document).on('click', '.timer-start', function () {
    Timer.fromRow($(this).closest('.timer-row'))?.toggle();
  });
  $(document).on('click', '.timer-reset', function () {
    Timer.fromRow($(this).closest('.timer-row'))?.reset();
  });
  $(document).on('click', '.timer-turnoff', function () {
    Timer.fromRow($(this).closest('.timer-row'))?.turnOff();
  });

  await shoppingSidebar.render();

  // Landing: browse. Clear stale selected recipe so Matlagning stays disabled
  // until the user picks via modal — keeps HF flow clear.
  // Keep selection if present so returning users can jump to Matlagning.
  if (state.selectedRecipeId) {
    try {
      await ensureLoaded(state.selectedRecipeId);
    } catch (e) {
      console.warn('Could not restore recipe', e);
      state._selectedRecipeId = null;
    }
  }
  // Migrate any persisted precook phase → cooking; default landing is browse
  // (deep link may override immediately after via applyHashFromLocation).
  if (state.currentPhase === 'precook') {
    state.currentPhase = 'cooking';
  } else {
    state.currentPhase = 'browse';
  }
  browse.render();

  // Deep links: apply initial hash, then listen for back/forward / pasted URLs
  await applyHashFromLocation({ replaceUnknown: true });
  routingReady = true;
  // Re-sync once ready (covers empty hash → #browse without clobbering cook/overview)
  syncHashFromApp({ replace: true });

  let routeApplyQueued = false;
  function onRouteUrlChange() {
    if (applyingHash) return;
    if (routeApplyQueued) return;
    routeApplyQueued = true;
    queueMicrotask(() => {
      routeApplyQueued = false;
      applyHashFromLocation({ replaceUnknown: true });
    });
  }
  window.addEventListener('hashchange', onRouteUrlChange);
  window.addEventListener('popstate', onRouteUrlChange);
}

bootstrap().catch(err => {
  console.error('Failed to start app:', err);
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<div style="padding:1rem;background:var(--danger-bg, #fee);color:var(--danger, #900);font-family:sans-serif;">
       Kunde inte ladda appen: ${err.message}
     </div>`
  );
});
