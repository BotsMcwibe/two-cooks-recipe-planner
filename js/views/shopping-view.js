import { ShoppingListAggregator } from '../core/shopping-list.js';
import { formatNiceAmount } from '../utils/helpers.js';
import { escapeAttr, escapeHtml, isPantryIngredient } from '../utils/catalog-ui.js?v=20261011s';

/**
 * Persistent Inköpslista sidebar: selected recipes + portion controls + aggregated list.
 * Reuses ShoppingListAggregator; primary selection happens via browse card checkboxes.
 */
export class ShoppingSidebar {
  /**
   * @param {import('../core/state.js').AppState} state
   * @param {Array<object>} catalog
   * @param {object} unitMap
   * @param {object} baseIngredientMap
   * @param {object} tagsData
   * @param {import('../data/loader.js').RecipeRepository} repository
   */
  constructor(state, catalog, unitMap, baseIngredientMap, tagsData, repository) {
    this.state = state;
    this.catalog = catalog;
    this.catalogById = Object.fromEntries(catalog.map(c => [c.id, c]));
    this.unitMap = unitMap;
    this.baseIngredientMap = baseIngredientMap;
    this.tagsData = tagsData;
    this.repository = repository;
    this.$container = $('#shopping-sidebar');
    this.$toggle = $('#shopping-drawer-toggle');
    this._rendering = false;
    this._copyPayload = { ingredienser: [], skafferi: [] };
    this._copyFeedbackTimer = null;
    this._bind();
    state.on('shoppingChange', () => this.render());
    state.on('phase', () => this._syncVisibility());
  }

  _bind() {
    this.$container.on('click', '.shop-portion-minus', (e) => {
      e.preventDefault();
      const id = $(e.currentTarget).data('id');
      const cur = this.state.getShoppingPortions(id);
      if (cur > 2) this.state.setShoppingPortions(id, cur - 2);
    });
    this.$container.on('click', '.shop-portion-plus', (e) => {
      e.preventDefault();
      const id = $(e.currentTarget).data('id');
      const cur = this.state.getShoppingPortions(id);
      if (cur < 24) this.state.setShoppingPortions(id, cur + 2);
    });
    this.$container.on('click', '.shop-remove-btn', (e) => {
      e.preventDefault();
      const id = $(e.currentTarget).data('id');
      if (this.state.isShoppingRecipeSelected(id)) {
        this.state.toggleShoppingRecipe(id);
      }
    });
    this.$container.on('click', '.shopping-sidebar-close', (e) => {
      e.preventDefault();
      this.closeDrawer();
    });
    this.$container.on('click', '.shopping-copy-btn', (e) => {
      e.preventDefault();
      this._copyShoppingList(e.currentTarget);
    });
    this.$toggle.on('click', (e) => {
      e.preventDefault();
      this.openDrawer();
    });
    // Backdrop click closes drawer on narrow screens
    $(document).on('click', '#shopping-sidebar-backdrop', () => this.closeDrawer());
  }

  openDrawer() {
    document.body.classList.add('shopping-sidebar-open');
    $('#shopping-sidebar-backdrop').prop('hidden', false);
    this.$container.attr('tabindex', '-1').trigger('focus');
  }

  closeDrawer() {
    document.body.classList.remove('shopping-sidebar-open');
    $('#shopping-sidebar-backdrop').prop('hidden', true);
  }

  /** Focus/open sidebar (used when Inköpslista tab is clicked). */
  focus() {
    this.openDrawer();
    const el = this.$container.get(0);
    if (el) el.scrollTop = 0;
  }

  _syncVisibility() {
    const onBrowse = this.state.currentPhase === 'browse';
    $('#app-layout').toggleClass('is-browse', onBrowse);
    this.$toggle.prop('hidden', !onBrowse);
    if (!onBrowse) this.closeDrawer();
    this._updateToggleBadge();
  }

  _updateToggleBadge() {
    const n = this.state.shoppingSelections.size;
    const label = n > 0 ? `Inköpslista (${n})` : 'Inköpslista';
    this.$toggle.text(label);
    this.$toggle.toggleClass('has-items', n > 0);
  }

  /** Convert the currently aggregated entries to the sender-friendly JSON shape. */
  _buildCopyPayload(groups) {
    const payload = { ingredienser: [], skafferi: [] };
    for (const entries of Object.values(groups)) {
      for (const entry of entries) {
        const unit = entry.unit?.abbreviation || '';
        const item = {
          name: entry.ingredient ? entry.ingredient.name : entry.ingredientId,
          // Keep the same rounded/fractional display used in the sidebar.
          amount: formatNiceAmount(entry.amount, unit),
          unit,
        };
        const target = isPantryIngredient(entry.ingredient)
          ? payload.skafferi
          : payload.ingredienser;
        target.push(item);
      }
    }
    return payload;
  }

  async _copyShoppingList(button) {
    const restoreLabel = button.dataset.defaultLabel || 'Kopiera lista';
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('Clipboard API is unavailable');
      }
      await navigator.clipboard.writeText(JSON.stringify(this._copyPayload, null, 2));
      button.textContent = 'Kopierad';
      button.classList.add('is-copy-success');
    } catch (err) {
      console.error('Kunde inte kopiera inköpslistan:', err);
      button.textContent = 'Kunde inte kopiera';
      button.classList.add('is-copy-error');
    }

    clearTimeout(this._copyFeedbackTimer);
    this._copyFeedbackTimer = setTimeout(() => {
      button.textContent = restoreLabel;
      button.classList.remove('is-copy-success', 'is-copy-error');
    }, 1500);
  }

  async render() {
    if (this._rendering) return;
    this._rendering = true;
    try {
      const selectedIds = [...this.state.shoppingSelections];
      const count = selectedIds.length;
      this._copyPayload = { ingredienser: [], skafferi: [] };

      let html = `
        <div class="shopping-sidebar-header">
          <h3 class="shopping-sidebar-title">
            Inköpslista
            ${count ? `<span class="shopping-badge">${count}</span>` : ''}
          </h3>
          <div class="shopping-sidebar-actions">
            <button type="button" class="shopping-copy-btn" data-default-label="Kopiera lista">Kopiera lista</button>
            <button type="button" class="shopping-sidebar-close" aria-label="Stäng inköpslista">×</button>
          </div>
        </div>
        <div class="shopping-sidebar-body">`;

      if (!count) {
        html += `<p class="shopping-empty">Kryssa i recept för att bygga listan.</p>`;
      } else {
        html += '<div class="shopping-recipe-list shopping-selected-list">';
        for (const id of selectedIds) {
          const c = this.catalogById[id];
          if (!c) continue;
          const base = c.basePortions || 4;
          this.state.ensureShoppingPortions(id, base);
          const portions = this.state.getShoppingPortions(id);
          html += `<div class="shopping-recipe-row">`;
          html += `<div class="shopping-recipe-info">`;
          html += `<span class="shopping-recipe-name">${escapeHtml(c.name)}</span>`;
          html += `<button type="button" class="shop-remove-btn" data-id="${escapeAttr(id)}" aria-label="Ta bort">×</button>`;
          html += `</div>`;
          html += `<div class="shop-portion-controls">`;
          html += `<button type="button" class="shop-portion-minus" data-id="${escapeAttr(id)}" ${portions <= 2 ? 'disabled' : ''}>−</button>`;
          html += `<span class="shop-portion-display">${portions} port.</span>`;
          html += `<button type="button" class="shop-portion-plus" data-id="${escapeAttr(id)}" ${portions >= 24 ? 'disabled' : ''}>+</button>`;
          html += `</div></div>`;
        }
        html += '</div>';

        const aggregator = new ShoppingListAggregator(
          this.unitMap, this.baseIngredientMap, this.tagsData
        );

        for (const id of selectedIds) {
          const c = this.catalogById[id];
          if (!c) continue;
          const portions = this.state.getShoppingPortions(id);
          const base = c.basePortions || 4;
          const scale = portions / base;
          try {
            const loaded = await this.repository.loadMaster(id);
            const scaledGraph = loaded.graph.scaleAll(scale);
            const scaledRoot = scaledGraph.get(id);
            aggregator.addRecipe(scaledRoot, scaledGraph, 1.0);
          } catch (err) {
            console.error('Failed to load recipe for shopping:', id, err);
          }
        }

        const groups = aggregator.getByTag();
        this._copyPayload = this._buildCopyPayload(groups);
        const groupNames = Object.keys(groups);
        if (groupNames.length) {
          html += '<div class="shopping-groups">';
          html += '<h4 class="shopping-ingredients-heading">Att handla</h4>';
          for (const name of groupNames) {
            html += `<div class="shopping-group">`;
            html += `<h4>${escapeHtml(name)}</h4>`;
            html += '<ul class="ingredient-list">';
            for (const entry of groups[name]) {
              const disp = formatNiceAmount(entry.amount, entry.unit.abbreviation);
              const ingName = entry.ingredient ? entry.ingredient.name : entry.ingredientId;
              html += `<li><span class="ing-amount">${escapeHtml(disp)}</span><span class="ing-name">${escapeHtml(ingName)}</span></li>`;
            }
            html += '</ul></div>';
          }
          html += '</div>';
        }
      }

      html += '</div>';
      this.$container.html(html);
      this._updateToggleBadge();
      this._syncVisibility();
    } finally {
      this._rendering = false;
    }
  }
}

/** @deprecated Use ShoppingSidebar — kept as alias for older imports */
export const ShoppingView = ShoppingSidebar;
