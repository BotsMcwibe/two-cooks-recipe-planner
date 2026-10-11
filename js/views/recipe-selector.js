/**
 * Portion stepper and scheduler toggles for Matlagning.
 * Portions sit above "Ingredienser kvar"; toggles sit above the flow diagram.
 * No title bar above the hero.
 */
export class RecipeChrome {
  /**
   * @param {import('../core/state.js').AppState} state
   * @param {Array<object>} [_catalog] unused; kept so bootstrap call stays stable
   */
  constructor(state, _catalog) {
    this.state = state;
    this.$portions = $('#cook-portions');
    this.$toggles = $('#cook-toggles');
    this._buildHTML();
    this._bind();
    state.on('portionScale', () => this._updatePortionDisplay());
    state.on('schedulerOptions', () => this._syncSchedulerToggles());
  }

  _buildHTML() {
    const cur = this.state.currentPortions;
    const opts = this.state.schedulerOptions;
    this.$portions.html(`
      <div class="portion-controls">
        <button type="button" id="portion-minus" ${cur <= 2 ? 'disabled' : ''}>−</button>
        <span id="portion-display">${cur} portioner</span>
        <button type="button" id="portion-plus" ${cur >= 24 ? 'disabled' : ''}>+</button>
      </div>
    `);
    this.$toggles.html(`
      <div class="scheduler-controls">
        <label><input type="checkbox" id="prep-first-toggle" ${opts.prepFirst ? 'checked' : ''}> Preppa först</label>
        <label><input type="checkbox" id="cooks-toggle" ${opts.cooks === 2 ? 'checked' : ''}> 2 kockar</label>
      </div>
    `);
  }

  _bind() {
    this.$portions.on('click', '#portion-minus', () => this.state.adjustPortions(-1));
    this.$portions.on('click', '#portion-plus', () => this.state.adjustPortions(1));
    this.$toggles.on('change', '#prep-first-toggle', (e) => {
      // Blur so the browser does not scroll the focused checkbox into view after re-render
      e.target.blur();
      this.state.setSchedulerOption('prepFirst', e.target.checked);
    });
    this.$toggles.on('change', '#cooks-toggle', (e) => {
      e.target.blur();
      this.state.setSchedulerOption('cooks', e.target.checked ? 2 : 1);
    });
  }

  /** Hide the portion stepper for fixed-yield recipes (scalable: false). */
  setScalable(scalable) {
    this.$portions.toggle(scalable !== false);
  }

  _updatePortionDisplay() {
    const cur = this.state.currentPortions;
    this.$portions.find('#portion-display').text(`${cur} portioner`);
    this.$portions.find('#portion-minus').prop('disabled', cur <= 2);
    this.$portions.find('#portion-plus').prop('disabled', cur >= 24);
  }

  _syncSchedulerToggles() {
    const opts = this.state.schedulerOptions;
    this.$toggles.find('#prep-first-toggle').prop('checked', !!opts.prepFirst);
    this.$toggles.find('#cooks-toggle').prop('checked', opts.cooks === 2);
  }
}

/** @deprecated alias kept for any leftover imports */
export const RecipeSelector = RecipeChrome;
