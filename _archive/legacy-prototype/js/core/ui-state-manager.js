class UIStateManager {
    constructor() {
        this.checkedPreparedIds = [];
        this.completedSteps = {};
        this.eventManager = new EventManager();
        this.storageKey = 'recipeApp.uiState.v1';
        // Debounce saves to avoid frequent writes
        this._debouncedSave = (typeof UtilityFunctions !== 'undefined' && UtilityFunctions.debounce)
            ? UtilityFunctions.debounce(() => this._saveToStorageImmediate(), 200)
            : (() => this._saveToStorageImmediate());
        this._loadFromStorage();
    }
    
    addCheckedIngredient(id) {
        if (!this.checkedPreparedIds.includes(id)) {
            this.checkedPreparedIds.push(id);
            this.eventManager.emit('ingredientChecked', id);
            this._debouncedSave();
        }
    }
    
    removeCheckedIngredient(id) {
        const index = this.checkedPreparedIds.indexOf(id);
        if (index > -1) {
            this.checkedPreparedIds.splice(index, 1);
            this.eventManager.emit('ingredientUnchecked', id);
            this._debouncedSave();
        }
    }
    
    isIngredientChecked(id) {
        return this.checkedPreparedIds.includes(id);
    }
    
    getCheckedIngredients() {
        return [...this.checkedPreparedIds];
    }
    
    completeStep(recipeId, stepIndex) {
        const stepKey = `${recipeId}:${stepIndex}`;
        this.completedSteps[stepKey] = true;
        this.eventManager.emit('stepCompleted', recipeId, stepIndex);
    this._debouncedSave();
    }
    
    uncompleteStep(recipeId, stepIndex) {
        const stepKey = `${recipeId}:${stepIndex}`;
        delete this.completedSteps[stepKey];
        this.eventManager.emit('stepUncompleted', recipeId, stepIndex);
    this._debouncedSave();
    }
    
    isStepCompleted(recipeId, stepIndex) {
        const stepKey = `${recipeId}:${stepIndex}`;
        return !!this.completedSteps[stepKey];
    }
    
    getCompletedSteps() {
        return { ...this.completedSteps };
    }
    
    markAllRecipeStepsComplete(recipeId, recipe) {
        if (recipe && recipe.steps) {
            recipe.steps.forEach((_, stepIndex) => {
                this.completeStep(recipeId, stepIndex);
            });
        }
    }
    
    markAllRecipeStepsIncomplete(recipeId, recipe) {
        if (recipe && recipe.steps) {
            recipe.steps.forEach((_, stepIndex) => {
                this.uncompleteStep(recipeId, stepIndex);
            });
        }
    }
    
    areAllRecipeStepsComplete(recipeId, recipe) {
        if (!recipe || !recipe.steps) return false;
        
        return recipe.steps.every((_, stepIndex) => {
            return this.isStepCompleted(recipeId, stepIndex);
        });
    }
    
    reset() {
        this.checkedPreparedIds = [];
        this.completedSteps = {};
        this.eventManager.emit('stateReset');
    this._debouncedSave();
    }
    
    on(event, callback) {
        this.eventManager.on(event, callback);
    }
    
    off(event, callback) {
        this.eventManager.off(event, callback);
    }

    _loadFromStorage() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (Array.isArray(data.checkedPreparedIds)) {
                this.checkedPreparedIds = data.checkedPreparedIds.slice(0);
            }
            if (data.completedSteps && typeof data.completedSteps === 'object') {
                this.completedSteps = { ...data.completedSteps };
            }
        } catch (e) {
            console.warn('Failed to load UI state from storage:', e);
        }
    }

    _saveToStorageImmediate() {
        try {
            const payload = JSON.stringify({
                checkedPreparedIds: this.checkedPreparedIds,
                completedSteps: this.completedSteps
            });
            localStorage.setItem(this.storageKey, payload);
        } catch (e) {
            console.warn('Failed to save UI state to storage:', e);
        }
    }
}

window.UIStateManager = UIStateManager;
