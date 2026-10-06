import { loadPortionEnergyKcal } from '../data/loader.js';
import {
  buildFilterChips,
  buildSourceChips,
  createdInRecentWindow,
  displayTags,
  difficultyLabel,
  displayedPortionKcal,
  escapeAttr,
  escapeHtml,
  isCooked,
  starHtml,
  subtitleFromSearchText,
} from '../utils/catalog-ui.js?v=20261007';

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
    this.sourceChips = buildSourceChips(catalog);
    this.activeFilter = 'all';
    this.sourceFilter = null;
    this.recentOnly = false;
    this.kcalOnly = false;
    this.cookedOnly = false;
    this.query = '';
    /** @type {Map<string, number>|null} raw per-portion energyKcal, null until loaded */
    this.kcalById = null;
    this._kcalReady = loadPortionEnergyKcal(catalog.map(c => c.id)).then((map) => {
      this.kcalById = map;
      if (this.kcalOnly) this.render();
    });
    this._buildChrome();
    this._bind();
    this.render();
    state.on('shoppingChange', () => this._syncCheckboxes());
  }

  _chipHtml(chip, group, active) {
    const title = chip.title ? ` title="${escapeAttr(chip.title)}"` : '';
    return `<button type="button" class="filter-chip${active ? ' active' : ''}" data-group="${escapeAttr(group)}" data-filter="${escapeAttr(chip.id)}"${title}>${escapeHtml(chip.label)}</button>`;
  }

  _buildChrome() {
    const chips = this.filterChips.map((c, i) =>
      this._chipHtml(c, 'tag', i === 0)
    ).join('');
    const source = this.sourceChips.map(c => this._chipHtml(c, 'source', false)).join('');
    const recent = this._chipHtml(
      { id: 'recent', label: 'Senaste veckan', title: 'Skapade de senaste 8 dagarna' },
      'created',
      false,
    );
    const kcal = this._chipHtml(
      { id: 'kcal', label: 'Under 650 kcal', title: 'Under 650 kcal per portion' },
      'kcal',
      false,
    );
    const cooked = this._chipHtml(
      { id: 'cooked', label: 'Tillagade', title: 'Visa bara tillagade recept' },
      'cooked',
      false,
    );

    this.$container.html(`
      <div class="browse-toolbar">
        <div class="browse-search-wrap">
          <input type="search" id="browse-search" class="browse-search"
            placeholder="Sök recept…" autocomplete="off" aria-label="Sök recept">
        </div>
        <div class="filter-chips" role="group" aria-label="Filter">${chips}</div>
        <div class="filter-chips filter-chips-extra">
          <span class="filter-chip-group" role="group" aria-label="Källa">${source}</span>
          <span class="filter-chip-group" role="group" aria-label="Skapad">${recent}</span>
          <span class="filter-chip-group" role="group" aria-label="Kalorier">${kcal}</span>
          <span class="filter-chip-group" role="group" aria-label="Tillagad">${cooked}</span>
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
      } else if (group === 'source') {
        const next = this.sourceFilter === id ? null : id;
        this.sourceFilter = next;
        this.$container.find('.filter-chip[data-group="source"]').removeClass('active');
        if (next) $btn.addClass('active');
      } else if (group === 'created') {
        this.recentOnly = !this.recentOnly;
        $btn.toggleClass('active', this.recentOnly);
      } else if (group === 'kcal') {
        this.kcalOnly = !this.kcalOnly;
        $btn.toggleClass('active', this.kcalOnly);
        if (this.kcalOnly && !this.kcalById) {
          this._kcalReady.then(() => {
            if (this.kcalOnly) this.render();
          });
          return;
        }
      } else if (group === 'cooked') {
        this.cookedOnly = !this.cookedOnly;
        $btn.toggleClass('active', this.cookedOnly);
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
    const sourceChip = this.sourceChips.find(c => c.id === this.sourceFilter);
    const q = this.query;
    return this.catalog.filter((entry) => {
      if (!matchFilter(entry)) return false;
      if (sourceChip && !sourceChip.match(entry)) return false;
      if (this.recentOnly && !createdInRecentWindow(entry.createdAt)) return false;
      if (this.kcalOnly) {
        const raw = this.kcalById ? this.kcalById.get(entry.id) : undefined;
        const shown = displayedPortionKcal(raw);
        if (shown == null || shown >= 650) return false;
      }
      if (this.cookedOnly && !isCooked(entry.cooked)) return false;
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
      const img = c.image
        ? `<img class="recipe-card-img" src="${escapeAttr(c.image)}" alt="" loading="lazy" decoding="async">`
        : `<div class="recipe-card-img recipe-card-placeholder" aria-hidden="true"></div>`;
      const sub = subtitleFromSearchText(c);
      const tags = displayTags(c, 2);
      const tagHtml = tags.map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('');
      const mins = c.totalMinutes != null ? `${c.totalMinutes} min` : '';
      const diff = difficultyLabel(c.difficulty);
      const rating = starHtml(c.ratingAverage, c.ratingCount);
      const selected = this.state.isShoppingRecipeSelected(c.id);
      const checked = selected ? 'checked' : '';

      html += `
        <article class="recipe-card${selected ? ' is-shopping-selected' : ''}" data-id="${escapeAttr(c.id)}" tabindex="0" role="button"
          aria-label="${escapeAttr(c.name)}">
          <div class="recipe-card-media">
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
          </div>
        </article>`;
    }
    $grid.html(html);
  }

  show() {
    this.$container.css('display', '');
  }

  hide() {
    this.$container.css('display', 'none');
  }
}
