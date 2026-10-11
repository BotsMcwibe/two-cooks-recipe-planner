/**
 * App Shell - shows browse or cooking based on state.currentPhase.
 * Header home is the brand link (href="#browse"); the router clears
 * #cook/ and #overview/ and returns to the grid. No header tabs.
 * Översikt is modal-only (browse card click).
 */
export class AppShell {
  constructor(state) {
    this.state = state;
    this.tabs = ['browse', 'cooking'];
    this.$tabs = $('#app-tabs');
    this.$views = {
      browse: $('#app-layout'),
      cooking: $('#view-cooking'),
      spices: $('#view-spices'),
    };
    this.onFocusShopping = null;
    this._bind();
    this._render();
    state.on('phase', () => this._render());
    state.on('selectedRecipeId', () => this._renderRecipeDependent());
    state.on('shoppingChange', () => this._renderShoppingBadge());
  }

  _bind() {
    this.$tabs.on('click', '[data-tab]', (e) => {
      const tab = $(e.currentTarget).data('tab');
      if ($(e.currentTarget).prop('disabled')) return;

      // Inköpslista → stay/go to browse and focus sidebar
      if (tab === 'shopping') {
        this.state.currentPhase = 'browse';
        if (this.onFocusShopping) this.onFocusShopping();
        return;
      }

      // Matlagning requires a selected recipe
      if (tab === 'cooking' && !this.state.selectedRecipeId) {
        return;
      }
      this.state.currentPhase = tab;
    });
  }

  /** @param {() => void} fn */
  setFocusShoppingHandler(fn) {
    this.onFocusShopping = fn;
  }

  _renderRecipeDependent() {
    const has = !!this.state.selectedRecipeId;
    this.$tabs.find('[data-needs-recipe]').prop('disabled', !has);
  }

  _renderShoppingBadge() {
    const n = this.state.shoppingSelections.size;
    const $btn = this.$tabs.find('[data-tab="shopping"]');
    $btn.text(n > 0 ? `Inköpslista (${n})` : 'Inköpslista');
  }

  _render() {
    const active = this.state.currentPhase;
    this.$tabs.find('[data-tab]').each(function () {
      const tab = $(this).data('tab');
      // shopping is never an "active phase"
      if (tab === 'shopping') {
        $(this).toggleClass('active', false);
        return;
      }
      $(this).toggleClass('active', tab === active);
    });
    for (const [name, $el] of Object.entries(this.$views)) {
      if (!$el.length) continue;
      $el.css('display', name === active ? '' : 'none');
    }
    this._renderRecipeDependent();
    this._renderShoppingBadge();

    // Wider layout on browse
    const recipePhase = active === 'cooking';
    $('main').toggleClass('main-browse', active === 'browse');
    $('main').toggleClass('main-recipe', recipePhase);
    $('main').toggleClass('main-spices', active === 'spices');
    $('#spice-link').attr('aria-current', active === 'spices' ? 'page' : null);
    $('#app-layout').toggleClass('is-browse', active === 'browse');
  }
}
