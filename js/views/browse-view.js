import { loadPortionEnergyKcal } from '../data/loader.js?v=20261013a';
import {
  buildFilterChips,
  displayTags,
  difficultyLabel,
  displayedPortionKcal,
  escapeAttr,
  escapeHtml,
  recipeVisual,
  starHtml,
  subtitleFromSearchText,
} from '../utils/catalog-ui.js?v=20261011u';
import * as UserState from '../core/user-recipe-state.js?v=20261013b';
import { imgFailed, isPhotoMissing, recordPhotoFailure, recordPhotoSuccess, photosLikelyUnavailable } from '../utils/photo-fallback.js?v=20261011u';
import { cardStateHtml } from './recipe-status-ui.js?v=20261013b';

/**
 * Browse page: searchable/filterable recipe card grid.
 * Clicking a card opens the overview modal (via hooks.onOpenOverview).
 * Top-left checkbox toggles shopping selection without opening the modal.
 */
export class BrowseView {
  /**
   * @param {import('../core/state.js').AppState} state
   * @param {Array<object>} catalog
   * @param {{ onOpenOverview: (id: string) => void }} hooks
   */
  constructor(state, catalog, hooks) {
    this.state = state;
    this.catalog = catalog;
    this.hooks = hooks;
    this.$container = $('#view-browse');
    this.filterChips = buildFilterChips(catalog);
    this.activeFilter = 'all';
    this.kcalOnly = false;
    /** @type {'want'|'cooking'|'cooked'|null} personal status filter */
    this.statusFilter = null;
    this.testedOnly = false;
    this.query = '';
    /** @type {Map<string, number>|null} raw per-portion energyKcal, null until loaded */
    this.kcalById = null;
    this._kcalReady = loadPortionEnergyKcal(catalog.map(c => c.id)).then((map) => {
      this.kcalById = map;
      if (this.kcalOnly) this.render();
    });
    this._buildChrome();
    this._bind();
    this._bindPhotoFallback();
    this.render();
    state.on('shoppingChange', () => this._syncCheckboxes());
    UserState.subscribe(() => this.render());
  }

  _chipHtml(chip, group, active) {
    const title = chip.title ? ` title="${escapeAttr(chip.title)}"` : '';
    const pressed = group === 'tag' ? '' : ` aria-pressed="${active}"`;
    return `<button type="button" class="filter-chip${active ? ' active' : ''}" data-group="${escapeAttr(group)}" data-filter="${escapeAttr(chip.id)}"${title}${pressed}>${escapeHtml(chip.label)}</button>`;
  }

  _buildChrome() {
    const chips = this.filterChips.map((c, i) =>
      this._chipHtml(c, 'tag', i === 0)
    ).join('');
    const kcal = this._chipHtml(
      { id: 'kcal', label: 'Under 650 kcal', title: 'Under 650 kcal per portion' },
      'kcal',
      false,
    );
    const status = UserState.STATUSES.map(s => this._chipHtml(
      { id: s, label: UserState.STATUS_LABELS[s], title: `Visa recept märkta ”${UserState.STATUS_LABELS[s]}”` },
      'status',
      false,
    )).join('');
    const tested = this._chipHtml(
      { id: 'tested', label: 'Testad', title: 'Visa recept som testats i köket' }, 'tested', false);

    this.$container.html(`
      <div class="browse-toolbar">
        <div class="browse-search-wrap">
          <input type="search" id="browse-search" class="browse-search"
            placeholder="Sök recept…" autocomplete="off" aria-label="Sök recept">
        </div>
        <div class="filter-chips" role="group" aria-label="Filter">${chips}</div>
        <div class="filter-chips filter-chips-extra">
          <span class="filter-chip-group" role="group" aria-label="Kalorier">${kcal}${tested}</span>
          <span class="filter-chip-group filter-chip-group-status" role="group" aria-label="Min status">${status}</span>
        </div>
      </div>
      <div class="browse-grid" id="browse-grid"></div>
      <p class="browse-empty" id="browse-empty" hidden>Inga recept matchade.</p>
    `);
  }

  _bind() {
    this.$container.on('input', '#browse-search', (e) => {
      this.query = (e.target.value || '').trim().toLowerCase();
      this.render();
    });
    this.$container.on('click', '.filter-chip', (e) => {
      const $btn = $(e.currentTarget);
      const group = $btn.attr('data-group') || 'tag';
      const id = $btn.attr('data-filter');
      if (group === 'tag') {
        this.activeFilter = id;
        this.$container.find('.filter-chip[data-group="tag"]').removeClass('active');
        $btn.addClass('active');
      } else if (group === 'kcal') {
        this.kcalOnly = !this.kcalOnly;
        $btn.toggleClass('active', this.kcalOnly).attr('aria-pressed', String(this.kcalOnly));
        if (this.kcalOnly && !this.kcalById) {
          this._kcalReady.then(() => {
            if (this.kcalOnly) this.render();
          });
          return;
        }
      } else if (group === 'tested') {
        this.testedOnly = !this.testedOnly;
        $btn.toggleClass('active', this.testedOnly).attr('aria-pressed', String(this.testedOnly));
      } else if (group === 'status') {
        this.statusFilter = this.statusFilter === id ? null : id;
        this.$container.find('.filter-chip[data-group="status"]').each((_, el) => {
          const on = el.getAttribute('data-filter') === this.statusFilter;
          el.classList.toggle('active', on);
          el.setAttribute('aria-pressed', String(on));
        });
      }
      this.render();
    });
    this.$container.on('click', '.recipe-card', (e) => {
      // Ignore clicks that originated on the shopping checkbox
      if ($(e.target).closest('.recipe-card-shop').length) return;
      const id = $(e.currentTarget).data('id');
      if (id && this.hooks.onOpenOverview) this.hooks.onOpenOverview(id);
    });
    this.$container.on('keydown', '.recipe-card', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if ($(e.target).closest('.recipe-card-shop').length) return;
        e.preventDefault();
        const id = $(e.currentTarget).data('id');
        if (id && this.hooks.onOpenOverview) this.hooks.onOpenOverview(id);
      }
    });
    // Checkbox: stopPropagation so card click does not open modal
    this.$container.on('click', '.recipe-card-shop', (e) => {
      e.stopPropagation();
    });
    this.$container.on('change', '.recipe-card-shop-cb', (e) => {
      e.stopPropagation();
      const id = $(e.currentTarget).data('id');
      const entry = this.catalog.find(c => c.id === id);
      if (!entry) return;
      const base = entry.basePortions || 4;
      if (e.currentTarget.checked) {
        this.state.ensureShoppingPortions(id, base);
        if (!this.state.isShoppingRecipeSelected(id)) {
          this.state.toggleShoppingRecipe(id);
        }
      } else if (this.state.isShoppingRecipeSelected(id)) {
        this.state.toggleShoppingRecipe(id);
      }
    });
  }

  /**
   * Card photos: fade in on load; on error collapse the media box to the
   * compact placeholder strip (never a broken-image icon). load/error do not
   * bubble, so listen in the capture phase on the grid.
   */
  _bindPhotoFallback() {
    const grid = this.$container.find('#browse-grid')[0];
    if (!grid) return;
    grid.addEventListener('load', (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.classList.contains('recipe-card-img')) return;
      img.classList.add('is-loaded');
      recordPhotoSuccess(img.getAttribute('src'));
    }, true);
    grid.addEventListener('error', (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.classList.contains('recipe-card-img')) return;
      recordPhotoFailure(img.getAttribute('src'));
      this._collapseMedia(img);
      // Pages has no recipe photos at all: collapse the rest now, not one by one while scrolling
      if (photosLikelyUnavailable()) {
        grid.querySelectorAll('img.recipe-card-img:not(.is-loaded)').forEach(i => this._collapseMedia(i));
      }
    }, true);
  }

  _collapseMedia(img) {
    const media = img.closest('.recipe-card-media');
    if (!media || media.classList.contains('is-nophoto')) return;
    const ph = document.createElement('span');
    ph.className = 'recipe-card-ph';
    ph.setAttribute('aria-hidden', 'true');
    ph.textContent = media.getAttribute('data-ph-emoji') || '🍽️';
    img.replaceWith(ph);
    media.classList.add('is-nophoto');
  }

  _checkPhotos($grid) {
    $grid.find('img.recipe-card-img').each((_, img) => {
      if (imgFailed(img)) {
        recordPhotoFailure(img.getAttribute('src'));
        this._collapseMedia(img);
      } else if (img.complete && img.naturalWidth > 0) {
        img.classList.add('is-loaded');
      }
    });
  }

  _syncCheckboxes() {
    this.$container.find('.recipe-card-shop-cb').each((_, el) => {
      const id = $(el).data('id');
      const selected = this.state.isShoppingRecipeSelected(id);
      el.checked = selected;
      $(el).closest('.recipe-card').toggleClass('is-shopping-selected', selected);
    });
  }

  _filtered() {
    const chip = this.filterChips.find(c => c.id === this.activeFilter);
    const matchFilter = chip ? chip.match : () => true;
    const q = this.query;
    return this.catalog.filter((entry) => {
      if (!matchFilter(entry)) return false;
      if (this.kcalOnly) {
        const raw = this.kcalById ? this.kcalById.get(entry.id) : undefined;
        const shown = displayedPortionKcal(raw);
        if (shown == null || shown >= 650) return false;
      }
      if (this.testedOnly) { const m = UserState.catalogMark(entry.id); if (!m || !m.tested) return false; }
      if (this.statusFilter && UserState.get(entry.id).status !== this.statusFilter) return false;
      if (!q) return true;
      const hay = `${entry.name || ''} ${entry.searchText || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }

  render() {
    const list = this._filtered();
    const $grid = this.$container.find('#browse-grid');
    const $empty = this.$container.find('#browse-empty');

    if (!list.length) {
      $grid.empty();
      $empty.prop('hidden', false);
      return;
    }
    $empty.prop('hidden', true);

    let html = '';
    for (const c of list) {
      const vis = recipeVisual(c);
      const noPhoto = isPhotoMissing(c.image);
      const img = noPhoto
        ? `<span class="recipe-card-ph" aria-hidden="true">${vis.emoji}</span>`
        : `<img class="recipe-card-img" src="${escapeAttr(c.image)}" alt="" loading="lazy" decoding="async">`;
      const sub = subtitleFromSearchText(c);
      const tags = displayTags(c, 2);
      const tagHtml = tags.map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('');
      const mins = c.totalMinutes != null ? `${c.totalMinutes} min` : '';
      const diff = difficultyLabel(c.difficulty);
      const rating = starHtml(c.ratingAverage, c.ratingCount);
      const selected = this.state.isShoppingRecipeSelected(c.id);
      const checked = selected ? 'checked' : '';
      const mine = cardStateHtml(c.id);

      html += `
        <article class="recipe-card${selected ? ' is-shopping-selected' : ''}" data-id="${escapeAttr(c.id)}" tabindex="0" role="button"
          aria-label="${escapeAttr(c.name)}">
          <div class="recipe-card-media${noPhoto ? ' is-nophoto' : ''}" style="--ph-h:${vis.hue}" data-ph-emoji="${escapeAttr(vis.emoji)}">
            <label class="recipe-card-shop" title="Lägg till i inköpslista">
              <input type="checkbox" class="recipe-card-shop-cb" data-id="${escapeAttr(c.id)}"
                ${checked} aria-label="Lägg till ${escapeAttr(c.name)} i inköpslista">
              <span class="recipe-card-shop-box" aria-hidden="true"></span>
            </label>
            ${img}
          </div>
          <div class="recipe-card-body">
            <h2 class="recipe-card-title">${escapeHtml(c.name)}</h2>
            ${sub ? `<p class="recipe-card-sub">${escapeHtml(sub)}</p>` : ''}
            <div class="recipe-card-meta">
              ${mins ? `<span class="meta-item meta-time">${escapeHtml(mins)}</span>` : ''}
              ${diff ? `<span class="meta-item meta-diff">${escapeHtml(diff)}</span>` : ''}
              ${tagHtml}
            </div>
            ${rating ? `<div class="recipe-card-rating">${rating}</div>` : ''}
            ${mine}
          </div>
        </article>`;
    }
    $grid.html(html);
    this._checkPhotos($grid);
  }

  show() {
    this.$container.css('display', '');
  }

  hide() {
    this.$container.css('display', 'none');
  }
}
