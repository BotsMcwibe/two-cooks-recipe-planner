import { EventBus } from './event-bus.js';
import { debounce } from '../utils/helpers.js';
import { touchPref } from './prefs-meta.js?v=20261021ng';

const STORAGE_KEY = 'recipeApp.state.v3';

export class AppState {
  constructor() {
    this.bus = new EventBus();

    this._selectedRecipeId = null;
    this._currentPhase = 'browse';
    this._portionScale = 1.0;
    this._basePortions = 4;
    this._schedulerOptions = { prepFirst: false, cooks: 1 };
    this._checkedIngredients = [];
    this._completedSteps = {};
    this._shoppingSelections = new Set();
    this._shoppingPortions = {};

    this._debouncedSave = debounce(() => this._saveToStorage(), 200);
    this._loadFromStorage();
  }

  // --- Selected recipe ---
  get selectedRecipeId() { return this._selectedRecipeId; }
  set selectedRecipeId(id) {
    const old = this._selectedRecipeId;
    if (id === old) return;
    this._selectedRecipeId = id;
    this.bus.emit('selectedRecipeId', id, old);
    this.bus.emit('change');
  }

  // --- Phase ---
  get currentPhase() { return this._currentPhase; }
  set currentPhase(phase) {
    const old = this._currentPhase;
    if (phase === old) return;
    this._currentPhase = phase;
    this.bus.emit('phase', phase, old);
  }

  // --- Portion scale (relative to current recipe's basePortions) ---
  get portionScale() { return this._portionScale; }
  set portionScale(scale) {
    const old = this._portionScale;
    if (scale === old) return;
    this._portionScale = scale;
    this.bus.emit('portionScale', scale, old);
    this.bus.emit('change');
  }

  get basePortions() { return this._basePortions; }
  setBasePortions(n) {
    const next = n || 4;
    if (next === this._basePortions) return;
    // Keep displayed portions stable when switching recipes when possible
    const currentDisplayed = this.currentPortions;
    this._basePortions = next;
    this._portionScale = currentDisplayed / next;
    this.bus.emit('portionScale', this._portionScale);
  }

  get currentPortions() { return Math.round(this._portionScale * this._basePortions); }

  adjustPortions(direction) {
    const cur = this.currentPortions;
    const next = Math.max(2, Math.min(24, cur + direction * 2));
    this.portionScale = next / this._basePortions;
  }

  // --- Scheduler options ---
  get schedulerOptions() { return { ...this._schedulerOptions }; }
  setSchedulerOption(key, value) {
    this._schedulerOptions[key] = value;
    this.bus.emit('schedulerOptions', this.schedulerOptions);
    this.bus.emit('change');
  }

  // --- Checked ingredients ---
  get checkedIngredients() { return [...this._checkedIngredients]; }

  addCheckedIngredient(id) {
    if (!this._checkedIngredients.includes(id)) {
      this._checkedIngredients.push(id);
      this.bus.emit('change');
      this._debouncedSave();
    }
  }

  removeCheckedIngredient(id) {
    const idx = this._checkedIngredients.indexOf(id);
    if (idx > -1) {
      this._checkedIngredients.splice(idx, 1);
      this.bus.emit('change');
      this._debouncedSave();
    }
  }

  isIngredientChecked(id) {
    return this._checkedIngredients.includes(id);
  }

  // --- Completed steps ---
  get completedSteps() { return { ...this._completedSteps }; }

  completeStep(recipeId, stepIndex) {
    const key = `${recipeId}:${stepIndex}`;
    this._completedSteps[key] = true;
    this.bus.emit('change');
    this._debouncedSave();
  }

  uncompleteStep(recipeId, stepIndex) {
    const key = `${recipeId}:${stepIndex}`;
    delete this._completedSteps[key];
    this.bus.emit('change');
    this._debouncedSave();
  }

  isStepCompleted(recipeId, stepIndex) {
    return !!this._completedSteps[`${recipeId}:${stepIndex}`];
  }

  markAllRecipeStepsComplete(recipeId, recipe) {
    if (recipe && recipe.steps) {
      recipe.steps.forEach((_, i) => {
        this._completedSteps[`${recipeId}:${i}`] = true;
      });
      this.bus.emit('change');
      this._debouncedSave();
    }
  }

  markAllRecipeStepsIncomplete(recipeId, recipe) {
    if (recipe && recipe.steps) {
      recipe.steps.forEach((_, i) => {
        delete this._completedSteps[`${recipeId}:${i}`];
      });
      this.bus.emit('change');
      this._debouncedSave();
    }
  }

  areAllRecipeStepsComplete(recipeId, recipe) {
    if (!recipe || !recipe.steps) return false;
    return recipe.steps.every((_, i) => this.isStepCompleted(recipeId, i));
  }

  // --- Shopping list selections ---
  get shoppingSelections() { return new Set(this._shoppingSelections); }

  toggleShoppingRecipe(recipeId) {
    if (this._shoppingSelections.has(recipeId)) {
      this._shoppingSelections.delete(recipeId);
    } else {
      this._shoppingSelections.add(recipeId);
    }
    this.bus.emit('shoppingChange');
    this._debouncedSave();
    touchPref('shopping');
  }

  isShoppingRecipeSelected(recipeId) {
    return this._shoppingSelections.has(recipeId);
  }

  getShoppingPortions(recipeId) {
    return this._shoppingPortions[recipeId] || 4;
  }

  /** Set default shopping portions once (e.g. from catalog.basePortions). */
  ensureShoppingPortions(recipeId, defaultPortions) {
    if (this._shoppingPortions[recipeId] == null) {
      this._shoppingPortions[recipeId] = defaultPortions || 4;
    }
  }

  setShoppingPortions(recipeId, portions) {
    this._shoppingPortions[recipeId] = portions;
    this.bus.emit('shoppingChange');
    this._debouncedSave();
    touchPref('shopping');
  }

  /** Clear every recipe from the shopping list. */
  clearShoppingList() {
    if (!this._shoppingSelections.size) return;
    this._shoppingSelections = new Set();
    this._shoppingPortions = {};
    this.bus.emit('shoppingChange');
    this._debouncedSave();
    touchPref('shopping');
  }

  /** Shopping list as plain data (for sync). */
  getShoppingData() {
    return { selections: [...this._shoppingSelections], portions: { ...this._shoppingPortions } };
  }

  /** Replace the shopping list from sync (not marked as a local change). */
  replaceShoppingData(data) {
    if (!data || typeof data !== 'object') return;
    this._shoppingSelections = new Set(Array.isArray(data.selections) ? data.selections.map(String) : []);
    this._shoppingPortions = data.portions && typeof data.portions === 'object' ? { ...data.portions } : {};
    this.bus.emit('shoppingChange');
    this._saveToStorage();
  }

  // --- Reset cooking state ---
  resetCookingState() {
    this._checkedIngredients = [];
    this._completedSteps = {};
    this.bus.emit('change');
    this._debouncedSave();
  }

  // --- Persistence ---
  _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.checkedIngredients)) {
        this._checkedIngredients = data.checkedIngredients;
      }
      if (data.completedSteps && typeof data.completedSteps === 'object') {
        this._completedSteps = data.completedSteps;
      }
      if (Array.isArray(data.shoppingSelections)) {
        this._shoppingSelections = new Set(data.shoppingSelections);
      }
      if (data.shoppingPortions && typeof data.shoppingPortions === 'object') {
        this._shoppingPortions = { ...data.shoppingPortions };
      }
    } catch (e) {
      console.warn('Failed to load state from storage:', e);
    }
  }

  _saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        checkedIngredients: this._checkedIngredients,
        completedSteps: this._completedSteps,
        shoppingSelections: [...this._shoppingSelections],
        shoppingPortions: this._shoppingPortions
      }));
    } catch (e) {
      console.warn('Failed to save state to storage:', e);
    }
  }

  // --- Event subscription ---
  on(event, callback) { this.bus.on(event, callback); }
  off(event, callback) { this.bus.off(event, callback); }
}
