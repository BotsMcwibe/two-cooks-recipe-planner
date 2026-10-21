import { RecipeGraph } from '../core/recipe-graph.js?v=20261021eq';
import { equipmentListHtml } from '../core/equipment.js?v=20261021eq';
import { kitchenProfile } from '../core/kitchen-prefs.js?v=20261021eq';
import { formatNiceAmount } from '../utils/helpers.js';
import {
  allergenLabel,
  difficultyLabel,
  displayTags,
  escapeAttr,
  escapeHtml,
  isPantryIngredient,
  isScalable,
  starHtml,
  subtitleFromSearchText,
} from '../utils/catalog-ui.js?v=20261011u';
import { imgFailed, isPhotoMissing, recordPhotoFailure, recordPhotoSuccess } from '../utils/photo-fallback.js?v=20261011u';
import * as UserState from '../core/user-recipe-state.js?v=20261013b';
import { spiceMixTogglesHtml } from './spice-mix-ui.js?v=20261012e';
import { bindStatusControls, refreshStatusControls, statusControlHtml } from './recipe-status-ui.js?v=20261013b';

/**
 * HelloFresh-inspired recipe overview modal.
 * Loads master via repository without mutating the cooking "current" payload
 * until the user commits via "Dags att laga".
 */
export class OverviewModal {
  /**
   * @param {import('../core/state.js').AppState} state
   * @param {Array<object>} catalog
   * @param {import('../data/loader.js?v=20261021eq').RecipeRepository} repository
   * @param {Array} baseIngredients
   * @param {{
   *   onCook: (id: string, portions: number) => void,
   *   onOpen?: (id: string, opts?: { nav?: boolean }) => void,
   *   onClose?: () => void,
   *   getNavList?: () => string[],
   * }} hooks
   */
  constructor(state, catalog, repository, baseIngredients, hooks) {
    this.state = state;
    this.catalog = catalog;
    this.catalogById = Object.fromEntries(catalog.map(c => [c.id, c]));
    this.repository = repository;
    this.baseIngredients = baseIngredients;
    this.hooks = hooks;
    this.recipeId = null;
    this.loaded = null;
    this.loadToken = 0;
    /** Local portions while modal is open (committed on CTA). */
    this.modalPortions = 4;
    /** Browse list (ids, in grid order) snapshotted when the modal opens; null = no prev/next. */
    this.navList = null;
    this._ensureDom();
    this._bind();
  }

  _ensureDom() {
    if ($('#overview-modal-root').length) {
      this.$root = $('#overview-modal-root');
      return;
    }
    $('body').append(`
      <div id="overview-modal-root" class="overview-modal-root" hidden>
        <div class="overview-backdrop" data-close="1"></div>
        <div class="overview-dialog" role="dialog" aria-modal="true" aria-labelledby="overview-title">
          <div class="overview-nav" role="group" aria-label="Bläddra bland recepten" hidden>
            <button type="button" class="overview-nav-btn" data-nav="-1" aria-label="Föregående recept" title="Föregående recept (←)"><span aria-hidden="true">‹</span></button>
            <span class="overview-nav-index" aria-live="polite"></span>
            <button type="button" class="overview-nav-btn" data-nav="1" aria-label="Nästa recept" title="Nästa recept (→)"><span aria-hidden="true">›</span></button>
          </div>
          <button type="button" class="overview-close" data-close="1" aria-label="Stäng">×</button>
          <div class="overview-body" id="overview-body">
            <p class="overview-loading">Laddar recept…</p>
          </div>
        </div>
      </div>
    `);
    this.$root = $('#overview-modal-root');
  }

  _bind() {
    this.$root.on('click', '[data-close]', () => this.close());
    bindStatusControls(this.$root);
    UserState.subscribe((id) => {
      if (this.isOpen()) refreshStatusControls(this.$root, id);
    });
    this.$root.on('click', '.overview-dialog', (e) => e.stopPropagation());
    $(document).on('keydown.overviewModal', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') { this.close(); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return; // Alt+← is browser Back
      const t = e.target;
      if (t && (t.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || t.isContentEditable)) return;
      if (this.navigate(e.key === 'ArrowLeft' ? -1 : 1)) e.preventDefault();
    });
    this.$root.on('click', '.overview-nav-btn', (e) => {
      this.navigate(Number(e.currentTarget.getAttribute('data-nav')));
    });
    this._bindSwipe();
    this.$root.on('click', '#overview-portion-minus', () => this._adjustPortions(-1));
    this.$root.on('click', '#overview-portion-plus', () => this._adjustPortions(1));
    this.$root.on('click', '#overview-cta-cook', () => {
      const id = this.recipeId;
      const portions = this.modalPortions;
      // Silent close: avoid hashing #browse before #cook from onCook
      this.close({ silent: true });
      if (id && this.hooks.onCook) this.hooks.onCook(id, portions);
    });
  }

  _adjustPortions(dir) {
    if (!isScalable(this._entry())) return;
    const next = Math.max(2, Math.min(24, this.modalPortions + dir * 2));
    if (next === this.modalPortions) return;
    this.modalPortions = next;
    // Keep existing <img> nodes. Replacing #overview-body reloads hero + thumbs.
    if (!this._syncPortionDependent()) this._renderBody();
  }

  isOpen() {
    return !this.$root.prop('hidden');
  }

  /** Reload the graph (e.g. after a "Har inte mixen" switch) and re-render in place. */
  async reload() {
    if (!this.isOpen() || !this.recipeId) return;
    const body = this.$root.find('.overview-dialog')[0];
    const top = body ? body.scrollTop : 0;
    const token = ++this.loadToken;
    const loaded = await this.repository.loadMaster(this.recipeId);
    if (token !== this.loadToken) return;
    this.loaded = loaded;
    this._renderBody();
    if (body) body.scrollTop = top;
  }

  /** Ids of the neighbours in the snapshotted browse list (no wrap-around). */
  _navPos() {
    const list = this.navList;
    const i = list ? list.indexOf(this.recipeId) : -1;
    if (i < 0) return null;
    return { i, n: list.length, prev: i > 0 ? list[i - 1] : null, next: i < list.length - 1 ? list[i + 1] : null };
  }

  _renderNav() {
    const pos = this._navPos();
    const $nav = this.$root.find('.overview-nav');
    const show = !!pos && pos.n > 1;
    $nav.prop('hidden', !show);
    this.$root.find('.overview-dialog').toggleClass('has-nav', show);
    if (!show) return;
    $nav.find('.overview-nav-index').text(`${pos.i + 1} / ${pos.n}`);
    $nav.find('[data-nav="-1"]').prop('disabled', !pos.prev);
    $nav.find('[data-nav="1"]').prop('disabled', !pos.next);
  }

  /**
   * Step to the previous (-1) / next (+1) recipe of the browse list. Stops at the ends.
   * @returns {boolean} true if it moved
   */
  navigate(dir) {
    if (!this.isOpen()) return false;
    const pos = this._navPos();
    const id = pos && (dir < 0 ? pos.prev : pos.next);
    if (!id) return false;
    this.open(id, { nav: true });
    return true;
  }

  /** Horizontal swipe on touch = prev/next. Ignores vertical scrolls and horizontally scrollable areas. */
  _bindSwipe() {
    const dialog = this.$root.find('.overview-dialog')[0];
    if (!dialog) return;
    let start = null;
    dialog.addEventListener('touchstart', (e) => {
      start = null;
      if (e.touches.length !== 1) return;
      let el = e.target;
      while (el && el !== dialog) {
        if (el.matches?.('input, textarea, select')) return;
        if (el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return;
        el = el.parentElement;
      }
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, at: Date.now() };
    }, { passive: true });
    dialog.addEventListener('touchend', (e) => {
      if (!start || e.changedTouches.length !== 1) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const quick = Date.now() - start.at < 700;
      start = null;
      if (quick && Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.5) this.navigate(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  /**
   * @param {string} recipeId
   * @param {{ nav?: boolean }} [opts] nav = prev/next inside an open modal (keeps the browse snapshot)
   */
  async open(recipeId, opts = {}) {
    const nav = !!opts.nav && this.isOpen();
    if (!nav) {
      let list = null;
      try { list = this.hooks.getNavList ? this.hooks.getNavList() : null; } catch (err) { console.warn('[overview] nav list', err); }
      // Opened from outside browse (deep link, Inköpslista …): only offer prev/next if the recipe is in the current browse list.
      this.navList = list && list.includes(recipeId) ? list.slice() : null;
    }
    this.recipeId = recipeId;
    const entry = this.catalogById[recipeId];
    const base = entry?.basePortions || 4;
    // Prefer current app portions if same recipe already selected; else base
    if (!isScalable(entry)) {
      this.modalPortions = base;
    } else if (this.state.selectedRecipeId === recipeId) {
      this.modalPortions = this.state.currentPortions;
    } else {
      this.modalPortions = base;
    }

    this.$root.prop('hidden', false);
    $('body').addClass('modal-open');
    this._renderNav();
    const dialog = this.$root.find('.overview-dialog')[0];
    if (nav) {
      // Keep the old recipe visible (dimmed) until the next one is loaded: no flash of "Laddar…".
      $(dialog).addClass('is-navigating');
    } else {
      this.$root.find('#overview-body').html('<p class="overview-loading">Laddar recept…</p>');
    }
    if (this.hooks.onOpen) this.hooks.onOpen(recipeId, { nav });

    const token = ++this.loadToken;
    try {
      const loaded = await this.repository.loadMaster(recipeId);
      if (token !== this.loadToken) return;
      this.loaded = loaded;
      this._renderBody();
      $(dialog).removeClass('is-navigating');
      if (nav) { if (dialog) dialog.scrollTop = 0; this.$root[0].scrollTop = 0; }
    } catch (err) {
      if (token !== this.loadToken) return;
      $(dialog).removeClass('is-navigating');
      this.$root.find('#overview-body').html(
        `<p class="overview-error">Kunde inte ladda receptet: ${escapeHtml(err.message)}</p>`
      );
    }
  }

  /**
   * @param {{ silent?: boolean }} [opts] silent skips onClose (e.g. Dags att laga → cook)
   */
  close(opts = {}) {
    const wasOpen = this.isOpen();
    this.$root.prop('hidden', true);
    this.$root.find('.overview-dialog').removeClass('is-navigating');
    $('body').removeClass('modal-open');
    this.loadToken++;
    if (wasOpen && !opts.silent && this.hooks.onClose) this.hooks.onClose();
  }

  _entry() {
    return this.catalogById[this.recipeId] || null;
  }

  _portionScale() {
    const base = this.loaded?.basePortions || this._entry()?.basePortions || 4;
    return this.modalPortions / base;
  }

  /** Hide the hero frame when the recipe photo fails to load (photos are not deployed). */
  _bindHeroFallback() {
    const $hero = this.$root.find('#overview-body .overview-hero');
    const img = $hero.find('img.overview-hero-img')[0];
    if (!img) return;
    const src = img.getAttribute('src');
    const hide = () => { recordPhotoFailure(src); $hero.attr('hidden', true).addClass('is-missing'); };
    if (isPhotoMissing(src)) { $hero.attr('hidden', true).addClass('is-missing'); img.remove(); return; }
    img.addEventListener('error', hide, { once: true });
    img.addEventListener('load', () => recordPhotoSuccess(src), { once: true });
    if (imgFailed(img)) hide();
  }

  _renderBody() {
    const entry = this._entry();
    const loaded = this.loaded;
    if (!entry) {
      this.$root.find('#overview-body').html('<p class="overview-error">Receptet hittades inte.</p>');
      return;
    }

    const heroSrc = (loaded?.images?.main) || entry.image || '';
    const hero = heroSrc
      ? `<img class="overview-hero-img" src="${escapeAttr(heroSrc)}" alt="${escapeAttr(entry.name)}" decoding="async">`
      : `<div class="overview-hero-img overview-hero-placeholder"></div>`;

    const mins = entry.totalMinutes != null ? `${entry.totalMinutes} min` : '';
    const diff = difficultyLabel(entry.difficulty);
    const rating = starHtml(entry.ratingAverage, entry.ratingCount);
    const tags = displayTags(entry, 4).map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('');

    let kcal = '';
    const pp = loaded?.nutrition?.perPortion;
    if (pp && typeof pp.energyKcal === 'number') {
      kcal = `${Math.round(pp.energyKcal)} kcal`;
    }

    const desc = subtitleFromSearchText(entry) || '';
    const allergens = (entry.allergens || [])
      .map(a => `<span class="allergen-chip">${escapeHtml(allergenLabel(a))}</span>`)
      .join('');

    const cur = this.modalPortions;
    const { mainHtml, pantryHtml, hasPantry } = this._splitIngredients(loaded);
    const columnsClass = hasPantry ? 'overview-columns has-pantry' : 'overview-columns no-pantry';

    let html = `
      <div class="overview-hero">${hero}</div>
      <div class="overview-content">
        <div class="overview-title-row">
          <h2 id="overview-title" class="overview-title">${escapeHtml(entry.name)}</h2>
          <button type="button" class="btn-primary" id="overview-cta-cook">Dags att laga</button>
        </div>
        <div class="overview-meta-row">
          ${rating ? `<span class="overview-rating">${rating}</span>` : ''}
          ${mins ? `<span class="meta-item">${escapeHtml(mins)}</span>` : ''}
          ${kcal ? `<span class="meta-item" id="overview-kcal">${escapeHtml(kcal)}</span>` : ''}
          ${diff ? `<span class="meta-item">${escapeHtml(diff)}</span>` : ''}
        </div>
        ${tags ? `<div class="overview-tags">${tags}</div>` : ''}
        ${statusControlHtml(entry.id)}
        ${desc ? `<p class="overview-desc">${escapeHtml(desc)}</p>` : ''}
        ${allergens ? `<div class="overview-allergens"><span class="allergens-label">Allergener:</span> ${allergens}</div>` : ''}

        ${isScalable(entry) ? `
        <div class="overview-portions">
          <span class="portions-label">Portioner</span>
          <div class="portion-controls">
            <button type="button" id="overview-portion-minus" ${cur <= 2 ? 'disabled' : ''}>−</button>
            <span id="overview-portion-display">${cur} portioner</span>
            <button type="button" id="overview-portion-plus" ${cur >= 24 ? 'disabled' : ''}>+</button>
          </div>
        </div>` : ''}

        ${this._nutritionHtml(loaded)}

        <div class="${columnsClass}">
          <div class="overview-col overview-main-col">
            <h3>Ingredienser</h3>
            ${mainHtml}
          </div>
          ${hasPantry ? `
          <div class="overview-col overview-pantry-col">
            <h3>Skafferi</h3>
            ${pantryHtml}
          </div>` : ''}
        </div>
        ${this._equipmentHtml(loaded)}
        <div class="overview-spice-mixes">${spiceMixTogglesHtml(loaded && loaded.spiceMixes, this._portionScale())}</div>
      </div>`;

    this.$root.find('#overview-body').html(html);
    this._bindHeroFallback();
  }

  /**
   * Split base ingredients into main vs pantry lists for two-column layout.
   * @returns {{ mainHtml: string, pantryHtml: string, hasPantry: boolean }}
   */
  _splitIngredients(loaded) {
    if (!loaded) {
      return { mainHtml: '<p class="muted">Laddar…</p>', pantryHtml: '', hasPantry: false };
    }
    const scale = this._portionScale();
    const scaledGraph = loaded.graph.scaleAll(scale);
    const root = scaledGraph.get(this.recipeId);
    if (!root) {
      return { mainHtml: '<p class="muted">Inga ingredienser</p>', pantryHtml: '', hasPantry: false };
    }
    const subtree = scaledGraph.getSubtreeRecipes(root);
    const baseIngs = RecipeGraph.getBaseIngredients(this.baseIngredients, subtree);
    const { totals, units } = scaledGraph.computeBaseIngredientTotals(root);

    const main = [];
    const pantry = [];
    for (const ing of baseIngs) {
      const total = totals[ing.id] || 0;
      if (!(total > 0)) continue;
      const unitAbbr = units[ing.id] || '';
      const thumb = ing.image
        ? `<img class="ing-thumb" src="${escapeAttr(ing.image)}" alt="" width="44" height="44" loading="lazy" decoding="async">`
        : `<span class="ing-thumb ing-thumb-placeholder" aria-hidden="true"></span>`;
      const row = `<li class="overview-ing-row" data-ing-id="${escapeAttr(ing.id)}">${thumb}<span class="ing-name">${escapeHtml(ing.name)}</span><span class="ing-amount">${formatNiceAmount(total, unitAbbr)}</span></li>`;
      if (isPantryIngredient(ing)) pantry.push(row);
      else main.push(row);
    }

    const mainHtml = `<ul class="ingredient-list overview-ing-list">${main.join('') || '<li>Inga ingredienser</li>'}</ul>`;
    const pantryHtml = pantry.length
      ? `<ul class="ingredient-list overview-ing-list">${pantry.join('')}</ul>`
      : '';
    return { mainHtml, pantryHtml, hasPantry: pantry.length > 0 };
  }

  /** Utrustning: pots/pans/plåtar per type and the oven temperature for the user's kitchen. */
  _equipmentHtml(loaded) {
    if (!loaded) return '';
    const root = loaded.graph.get(this.recipeId);
    if (!root) return '';
    const list = equipmentListHtml(loaded.graph.getSubtreeRecipes(root), kitchenProfile());
    return list ? `<div class="overview-equipment eq-section"><h3>Utrustning</h3>${list}</div>` : '';
  }

  /** Kitchen profile changed (plåtar / varmluft): refresh the Utrustning block in place. */
  refreshEquipment() {
    if (!this.isOpen() || !this.loaded) return;
    const $eq = this.$root.find('.overview-equipment');
    const html = this._equipmentHtml(this.loaded);
    if ($eq.length) $eq.replaceWith(html);
  }

  _nutritionItems(loaded) {
    const pp = loaded?.nutrition?.perPortion;
    if (!pp || typeof pp !== 'object') return [];
    const fmtKcal = (v) => String(Math.round(v));
    const fmtG = (v) => {
      const rounded = Math.round(v * 10) / 10;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    };
    const items = [];
    if (typeof pp.energyKcal === 'number') items.push(['kcal', fmtKcal(pp.energyKcal)]);
    if (typeof pp.proteinG === 'number') items.push(['Protein', `${fmtG(pp.proteinG)} g`]);
    if (typeof pp.fatG === 'number') items.push(['Fett', `${fmtG(pp.fatG)} g`]);
    if (typeof pp.carbsG === 'number') items.push(['Kolhydrater', `${fmtG(pp.carbsG)} g`]);
    if (typeof pp.fiberG === 'number') items.push(['Fiber', `${fmtG(pp.fiberG)} g`]);
    if (typeof pp.saltG === 'number') items.push(['Salt', `${fmtG(pp.saltG)} g`]);
    return items;
  }

  /**
   * Scaled amount label per base ingredient id, same order/filter as the lists.
   * @returns {Map<string, string>|null}
   */
  _amountTextById() {
    const loaded = this.loaded;
    if (!loaded) return null;
    const scale = this._portionScale();
    const scaledGraph = loaded.graph.scaleAll(scale);
    const root = scaledGraph.get(this.recipeId);
    if (!root) return null;
    const subtree = scaledGraph.getSubtreeRecipes(root);
    const baseIngs = RecipeGraph.getBaseIngredients(this.baseIngredients, subtree);
    const { totals, units } = scaledGraph.computeBaseIngredientTotals(root);
    const map = new Map();
    for (const ing of baseIngs) {
      const total = totals[ing.id] || 0;
      if (!(total > 0)) continue;
      map.set(String(ing.id), formatNiceAmount(total, units[ing.id] || ''));
    }
    return map;
  }

  /**
   * Portion stepper: update counts, amounts, and nutrition text only.
   * Does not replace image nodes and does not assign img.src.
   * @returns {boolean} false if the modal body is not in a patchable state
   */
  _syncPortionDependent() {
    const $body = this.$root.find('#overview-body');
    const $display = $body.find('#overview-portion-display');
    if (!$display.length) return false;

    const cur = this.modalPortions;
    const portionLabel = `${cur} portioner`;
    if ($display.text() !== portionLabel) $display.text(portionLabel);
    $body.find('#overview-portion-minus').prop('disabled', cur <= 2);
    $body.find('#overview-portion-plus').prop('disabled', cur >= 24);
    $body.find('.overview-spice-mixes').html(spiceMixTogglesHtml(this.loaded && this.loaded.spiceMixes, this._portionScale()));

    const amounts = this._amountTextById();
    if (amounts) {
      const rows = $body.find('.overview-ing-row').toArray();
      const ids = rows.map(el => el.getAttribute('data-ing-id'));
      const sameSet = rows.length === amounts.size
        && ids.every(id => id && amounts.has(id));
      if (!sameSet) return false;
      for (const el of rows) {
        const text = amounts.get(el.getAttribute('data-ing-id'));
        const amt = el.querySelector('.ing-amount');
        if (amt && amt.textContent !== text) amt.textContent = text;
      }
    }

    const items = this._nutritionItems(this.loaded);
    const $values = $body.find('.nutrition-strip .nutrition-value');
    if (items.length && $values.length === items.length) {
      $values.each((i, el) => {
        if (el.textContent !== items[i][1]) el.textContent = items[i][1];
      });
    } else if (items.length || $body.find('.overview-nutrition').length) {
      const html = this._nutritionHtml(this.loaded);
      const $nut = $body.find('.overview-nutrition');
      if ($nut.length) {
        if (html) $nut.replaceWith(html);
        else $nut.remove();
      } else if (html) {
        $body.find('.overview-portions').after(html);
      }
    }

    const pp = this.loaded?.nutrition?.perPortion;
    const kcalText = pp && typeof pp.energyKcal === 'number' ? `${Math.round(pp.energyKcal)} kcal` : '';
    const $kcal = $body.find('#overview-kcal');
    if ($kcal.length && kcalText && $kcal.text() !== kcalText) $kcal.text(kcalText);

    return true;
  }

  _nutritionHtml(loaded) {
    const items = this._nutritionItems(loaded);
    if (!items.length) return '';

    let html = '<div class="overview-nutrition">';
    html += '<h3>Näringsvärde <span class="muted-inline">per portion</span></h3>';
    html += '<ul class="nutrition-strip">';
    for (const [label, value] of items) {
      html += `<li class="nutrition-item"><span class="nutrition-value">${escapeHtml(value)}</span><span class="nutrition-label">${escapeHtml(label)}</span></li>`;
    }
    html += '</ul></div>';
    return html;
  }
}
