import { ShoppingListAggregator } from '../core/shopping-list.js?v=20261021g2';
import { formatNiceAmount } from '../utils/helpers.js';
import { escapeAttr, escapeHtml, isPantryIngredient, isScalable } from '../utils/catalog-ui.js?v=20261021g2';

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
   * @param {import('../data/loader.js?v=20261021g2').RecipeRepository} repository
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
    this._clearConfirmTimer = null;
    /** Drawer (≤900px) open state, saved page scroll and the element to refocus on close. */
    this._drawerOpen = false;
    this._savedScrollY = 0;
    this._returnFocus = null;
    this._drawerMq = window.matchMedia('(max-width: 900px)');
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
    // Title → översikt: close the mobile drawer first so the modal is never behind it,
    // then let the anchor's #overview/<id> hash drive the router.
    this.$container.on('click', '.shop-recipe-link', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
      if (this._drawerOpen) this.closeDrawer({ restoreFocus: false });
    });
    this.$container.on('click', '.shopping-sidebar-close', (e) => {
      e.preventDefault();
      this.closeDrawer();
    });
    this.$container.on('click', '.shopping-copy-btn', (e) => {
      e.preventDefault();
      this._copyShoppingList(e.currentTarget);
    });
    this.$container.on('click', '.shopping-clear-btn', (e) => {
      e.preventDefault();
      this._clearShoppingList(e.currentTarget);
    });
    this.$toggle.on('click', (e) => {
      e.preventDefault();
      this.openDrawer();
    });
    // Backdrop click closes drawer on narrow screens
    $(document).on('click', '#shopping-sidebar-backdrop', () => this.closeDrawer());
    // Escape closes; Tab stays inside the open drawer
    $(document).on('keydown.shoppingDrawer', (e) => {
      if (!this._drawerOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeDrawer();
      } else if (e.key === 'Tab') {
        this._trapTab(e);
      }
    });
    // Widening to desktop while open: drop the drawer state (sidebar is inline there)
    this._drawerMq.addEventListener?.('change', (e) => {
      if (!e.matches && this._drawerOpen) this.closeDrawer({ restoreFocus: false });
    });
  }

  _isDrawerMode() {
    return this._drawerMq.matches;
  }

  openDrawer() {
    if (!this._isDrawerMode()) {
      // Desktop: sidebar is always visible; just bring it into focus
      this.$container.attr('tabindex', '-1').trigger('focus');
      return;
    }
    if (this._drawerOpen) return;
    this._drawerOpen = true;
    this._returnFocus = document.activeElement;
    // Lock page scroll (iOS-safe: fix the body in place, restore on close)
    this._savedScrollY = window.scrollY;
    const body = document.body;
    body.style.top = `-${this._savedScrollY}px`;
    body.classList.add('shopping-sidebar-open', 'scroll-locked');
    $('#shopping-sidebar-backdrop').prop('hidden', false);
    this.$container.attr({ role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
    const scroller = this.$container.find('.shopping-sidebar-body')[0];
    if (scroller) scroller.scrollTop = 0;
    // Focus the panel itself (not a button) so nothing looks pre-selected
    this.$container[0].focus({ preventScroll: true });
  }

  closeDrawer({ restoreFocus = true } = {}) {
    const wasOpen = this._drawerOpen;
    this._drawerOpen = false;
    const body = document.body;
    body.classList.remove('shopping-sidebar-open');
    $('#shopping-sidebar-backdrop').prop('hidden', true);
    this.$container.removeAttr('role aria-modal');
    if (!wasOpen) return;
    body.classList.remove('scroll-locked');
    body.style.top = '';
    window.scrollTo(0, this._savedScrollY);
    const back = this._returnFocus;
    this._returnFocus = null;
    if (restoreFocus && back && document.contains(back) && typeof back.focus === 'function') {
      back.focus({ preventScroll: true });
    } else if (restoreFocus && !this.$toggle.prop('hidden')) {
      this.$toggle[0]?.focus({ preventScroll: true });
    }
  }

  _trapTab(e) {
    const root = this.$container[0];
    const items = [...root.querySelectorAll('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.offsetParent !== null);
    if (!items.length) { e.preventDefault(); root.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !root.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  /** Focus/open sidebar (used when Inköpslista tab is clicked). */
  focus() {
    this.openDrawer();
    const el = this.$container.find('.shopping-sidebar-body')[0];
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
    const restoreLabel = button.dataset.defaultLabel || 'Kopiera';
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

  _clearShoppingList(button) {
    if (!this.state.shoppingSelections.size) return;
    if (!button.classList.contains('is-confirming')) {
      button.classList.add('is-confirming');
      button.textContent = 'Säker?';
      clearTimeout(this._clearConfirmTimer);
      this._clearConfirmTimer = setTimeout(() => {
        button.classList.remove('is-confirming');
        button.textContent = button.dataset.defaultLabel || 'Rensa';
      }, 2000);
      return;
    }
    clearTimeout(this._clearConfirmTimer);
    this._clearConfirmTimer = null;
    this.state.clearShoppingList();
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
            <button type="button" class="shopping-copy-btn" data-default-label="Kopiera"${count ? '' : ' disabled'}>Kopiera</button>
            <button type="button" class="shopping-clear-btn" data-default-label="Rensa"${count ? '' : ' disabled'}>Rensa</button>
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
          html += `<a class="shopping-recipe-name shop-recipe-link" href="#overview/${encodeURIComponent(id)}" data-id="${escapeAttr(id)}" title="Öppna översikt"><span class="shop-recipe-link-text">${escapeHtml(c.name)}</span><span class="shop-recipe-link-chevron" aria-hidden="true">›</span></a>`;
          html += `<button type="button" class="shop-remove-btn" data-id="${escapeAttr(id)}" aria-label="Ta bort">×</button>`;
          html += `</div>`;
          // Fixed-yield recipes (scalable: false) have no portion stepper
          if (isScalable(c)) {
            html += `<div class="shop-portion-controls">`;
            html += `<button type="button" class="shop-portion-minus" data-id="${escapeAttr(id)}" ${portions <= 2 ? 'disabled' : ''}>−</button>`;
            html += `<span class="shop-portion-display">${portions} port.</span>`;
            html += `<button type="button" class="shop-portion-plus" data-id="${escapeAttr(id)}" ${portions >= 24 ? 'disabled' : ''}>+</button>`;
            html += `</div>`;
          }
          html += `</div>`;
        }
        html += '</div>';

        const aggregator = new ShoppingListAggregator(
          this.unitMap, this.baseIngredientMap, this.tagsData
        );

        for (const id of selectedIds) {
          const c = this.catalogById[id];
          if (!c) continue;
          const base = c.basePortions || 4;
          // Fixed-yield recipes always use base amounts, ignoring any saved portion count
          const scale = isScalable(c) ? this.state.getShoppingPortions(id) / base : 1;
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
      // Keep the list's scroll position and keyboard focus across re-renders
      const prevBody = this.$container.find('.shopping-sidebar-body')[0];
      const prevScroll = prevBody ? prevBody.scrollTop : 0;
      const act = document.activeElement;
      let focusSel = null;
      if (act && this.$container[0].contains(act) && act !== this.$container[0]) {
        const cls = [...act.classList].find(c => /^(shop-|shopping-)/.test(c));
        const id = act.getAttribute('data-id');
        if (cls) focusSel = `.${cls}${id ? `[data-id="${CSS.escape(id)}"]` : ''}`;
      }
      this.$container.html(html);
      const nextBody = this.$container.find('.shopping-sidebar-body')[0];
      if (nextBody && prevScroll) nextBody.scrollTop = prevScroll;
      if (focusSel) {
        const el = this.$container[0].querySelector(focusSel);
        if (el && !el.disabled) el.focus({ preventScroll: true });
        else if (this._drawerOpen) this.$container[0].focus({ preventScroll: true });
      }
      this._updateToggleBadge();
      this._syncVisibility();
    } finally {
      this._rendering = false;
    }
  }
}

/** @deprecated Use ShoppingSidebar — kept as alias for older imports */
export const ShoppingView = ShoppingSidebar;
