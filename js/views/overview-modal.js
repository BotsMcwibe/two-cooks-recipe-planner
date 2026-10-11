import { RecipeGraph } from '../core/recipe-graph.js';
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
} from '../utils/catalog-ui.js?v=20261011p';
import * as UserState from '../core/user-recipe-state.js?v=20261011p';
import { bindStatusControls, refreshStatusControls, statusControlHtml } from './recipe-status-ui.js?v=20261011p';

/**
 * HelloFresh-inspired recipe overview modal.
 * Loads master via repository without mutating the cooking "current" payload
 * until the user commits via "Dags att laga".
 */
export class OverviewModal {
  /**
   * @param {import('../core/state.js').AppState} state
   * @param {Array<object>} catalog
   * @param {import('../data/loader.js').RecipeRepository} repository
   * @param {Array} baseIngredients
   * @param {{
   *   onCook: (id: string, portions: number) => void,
   *   onOpen?: (id: string) => void,
   *   onClose?: () => void,
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
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });
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

  async open(recipeId) {
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
    this.$root.find('#overview-body').html('<p class="overview-loading">Laddar recept…</p>');
    if (this.hooks.onOpen) this.hooks.onOpen(recipeId);

    const token = ++this.loadToken;
    try {
      const loaded = await this.repository.loadMaster(recipeId);
      if (token !== this.loadToken) return;
      this.loaded = loaded;
      this._renderBody();
    } catch (err) {
      if (token !== this.loadToken) return;
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
    const hide = () => { $hero.attr('hidden', true).addClass('is-missing'); };
    img.addEventListener('error', hide, { once: true });
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) hide();
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
