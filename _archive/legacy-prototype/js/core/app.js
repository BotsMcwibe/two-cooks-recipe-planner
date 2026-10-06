class RecipeApp {    constructor() {
        this.unitMap = {};
        this.ingredientMap = {};
        this.ingredients = [];
        this.recipes = [];
        this.selectedId = null;
        this.phaseManager = null;
        this.uiStateManager = new UIStateManager();
        this.portionScale = 1.0; // Default scale for 4 portions
        this.hasUserInteracted = false; // Track if user has adjusted portions
        this.showPortionInfoBox = false; // Track info box visibility
        
        this.init();
    }
    
    init() {
        this.initializeData();
        this.initializePhaseManager();
        this.initializeUI();
        this.bindEvents();
    }
    
    initializeData() {
        this.unitMap = Object.entries(unitsJson)
            .reduce((map, [abbr, cfg]) => {
                map[abbr] = new Unit(
                    cfg.name, 
                    abbr, 
                    cfg.type, 
                    cfg.baseUnit, 
                    cfg.conversionFactor
                );
                return map;
            }, {});

        for (const [id, obj] of Object.entries(ingredientsJSON)) {
            this.ingredientMap[id] = new Ingredient(obj, id);
        }

        for (const id in this.ingredientMap) {
            if (this.ingredientMap.hasOwnProperty(id)) {
                this.ingredientMap[id].id = id;
            }
        }

        this.ingredients = Object.values(this.ingredientMap);
        this.recipes = recipesData.map(d => Recipe.fromJSON(d, this.ingredientMap, this.unitMap));
    }
      initializePhaseManager() {
        this.phaseManager = new EnhancedPhaseManager();
        this.phaseManager.addListener((newPhase, oldPhase) => {
            console.log(`Phase changed: ${oldPhase} -> ${newPhase}`);
            this.updateUI();
        });
        
        // Set up state synchronization
        this.phaseManager.stateManager.setState('selectedId', this.selectedId);
        this.phaseManager.stateManager.on('stateChange:selectedId', (newValue) => {
            this.selectedId = newValue;
        });
    }
      initializeUI() {
        this.buildRecipeSelector();
        this.selectedId = ui.getMainRecipes(this.recipes)[0]?.outputIngredient.id;
        // Ensure phase state knows about initial selection
        if (this.phaseManager) {
            this.phaseManager.stateManager.setState('selectedId', this.selectedId);
        }
        this.updateUI();
        Timer.initializeAll();
    }    buildRecipeSelector() {
        const mainRecipes = ui.getMainRecipes(this.recipes);
        
        $("#main-recipe-selector").html(`
            <div style="text-align:center;">
                <label for="main-recipe-select"><strong>Välj Huvudrecept:</strong></label>
                <select id="main-recipe-select" style="margin-left:10px;padding:8px;border-radius:4px;border:1px solid #ddd;font-size:1em;">
                    ${mainRecipes.map(r => 
                        `<option value="${r.outputIngredient.id}">
                            ${r.outputIngredient.name} (${r.name})
                        </option>`).join('')
                    }
                </select>
            </div>
        `);
    }
            bindEvents() {
        $('#main-recipe-select').on('change', (e) => this.onRecipeChange(e.target.value));
        $(document).on('click', '#portion-minus', () => this.onPortionAdjust(-1));
        $(document).on('click', '#portion-plus', () => this.onPortionAdjust(1));
        $('#prep-first-toggle, #cooks-toggle').on('change', () => this.updateUI());
        
                // Step click handling is implemented in ui.js to avoid duplicate toggles
                this.bindTimerEvents();
    }
    
    
    bindTimerEvents() {
        const timerActions = {
            '.timer-minus': (timer) => timer.adjustTime(-30),
            '.timer-plus': (timer) => timer.adjustTime(30),
            '.timer-reset': (timer) => timer.reset(),
            '.timer-turnoff': (timer) => timer.turnOff(),
            '.timer-start': (timer) => timer.toggle()
        };
        
        Object.entries(timerActions).forEach(([selector, action]) => {
            $(document).on('click', selector, function() {
                const $row = $(this).closest('.step-timer-row');
                const timer = Timer.fromRow($row);
                if (timer) action(timer);
            });
        });
    }    onRecipeChange(newSelectedId) {
        this.selectedId = newSelectedId;
        this.phaseManager.stateManager.setState('selectedId', newSelectedId);
        // Maintain current portion scale when changing recipes - no longer needed with buttons
        this.uiStateManager.reset();
        this.updateUI();
    }

    onPortionScaleChange(newScale) {
        this.portionScale = newScale;
        console.log(`Portion scale changed to: ${newScale}x (${newScale * 4} portions)`);
        this.updateUI();
    }    onPortionAdjust(direction) {
        const currentPortions = Math.round(this.portionScale * 4);
        const newPortions = Math.max(2, Math.min(24, currentPortions + (direction * 2)));
        const newScale = newPortions / 4;
        
        if (newScale !== this.portionScale) {
            this.portionScale = newScale;
            
            // Update info box visibility state based on whether we're at default (4 portions)
            if (newPortions === 4) {
                this.showPortionInfoBox = false;
            } else {
                this.showPortionInfoBox = true;
            }
            this.hasUserInteracted = true;
            
            console.log(`Portion adjusted to: ${newScale}x (${newPortions} portions)`);
            this.updateUI();
        }
    }    updatePortionControls() {
        const currentPortions = Math.round(this.portionScale * 4);
        $('#portion-display').text(`${currentPortions} portioner`);
        $('#portion-minus').prop('disabled', currentPortions <= 2);
        $('#portion-plus').prop('disabled', currentPortions >= 24);
    }getScaledRecipes() {
        if (this.portionScale === 1.0) {
            return this.recipes; // No scaling needed
        }
        
        return this.recipes.map(recipe => recipe.scaleRecipe(this.portionScale));
    }
      updateUI() {
        const scaledRecipes = this.getScaledRecipes();
        const root = scaledRecipes.find(r => r.outputIngredient.id === this.selectedId);
        if (!root) return;
        
        const subtree = RecipeTreeBuilder.getSubtreeRecipes(root, scaledRecipes);
        
        const options = this.getSchedulerOptions();
        const currentPhase = this.phaseManager.getCurrentPhase();
        
        if (currentPhase === 'precook') {
            this.renderPrecookPhase(root, subtree, options);
        } else if (currentPhase === 'cooking') {
            this.renderCookingPhase(root, subtree, options);
        }
    }
    
    getSchedulerOptions() {
        return {
            prepFirst: $('#prep-first-toggle').prop('checked'),
            cooks: $('#cooks-toggle').prop('checked') ? 2 : 1
        };
    }
    
    renderPrecookPhase(root, subtree, options) {
        const sched = new Scheduler(root, subtree, options);
        const viz = new ui.ProcessVisualizer(sched);
        viz.render('process-visualization');
        
        this.renderIngredientTracking(root, subtree);
    }    renderCookingPhase(root, subtree, options) {
        const scaledRecipes = this.getScaledRecipes();
        const tree = RecipeTreeBuilder.buildRecipeTree(root, scaledRecipes);
        ui.displayIngredientTree(tree, 'recipe-tree');
        
        const sched = new Scheduler(root, subtree, options);
        const recipeChangeHandler = this.createRecipeChangeHandler(subtree);
        const stepChangeHandler = this.createStepChangeHandler(subtree);
        
        ui.mountPreparedIngredientTree(
            subtree,
            this.uiStateManager.getCheckedIngredients(),
            'prepared-ingredients',
            recipeChangeHandler,
            this.uiStateManager.getCompletedSteps(),
            stepChangeHandler
        );
        
        ui.renderCompletedPreparedIngredients(
            ui.getPreparedIngredients(this.ingredients, subtree),
            this.uiStateManager.getCheckedIngredients(),
            subtree,
            'completed-prepared-ingredients'
        );
        
        ui.renderOrderedStepList(
            sched,
            this.uiStateManager.getCheckedIngredients(),
            this.uiStateManager.getCompletedSteps(),
            'recipe-steps',
            stepChangeHandler
        );
        
        Timer.initializeAll();
        this.renderIngredientTracking(root, subtree);
    }    renderIngredientTracking(root, subtree) {
        const scaledRecipes = this.getScaledRecipes();
        const baseIngs = ui.getBaseIngredients(this.ingredients, subtree);
        const {totals: required, units: requiredUnits} = RecipeTreeBuilder.computeBaseIngredientTotals(root, scaledRecipes);
        const {amounts: used, units: usedUnits} = ui.getCheckedBaseIngredientTotals(subtree, this.uiStateManager.getCheckedIngredients());
        
        // Create portion controls data for base ingredients
        const currentPortions = Math.round(this.portionScale * 4);
        const portionControls = { 
            currentPortions,
            showInfoBox: this.showPortionInfoBox
        };
        
        ui.renderBaseIngredients(baseIngs, 'base-ingredients', required, used, requiredUnits, portionControls);
        ui.renderUsedBaseIngredients(baseIngs, 'used-base-ingredients', used, usedUnits);
        ui.renderBaseIngredientsLeft(baseIngs, 'base-ingredients-left', required, used, requiredUnits);
    }
      createRecipeChangeHandler(subtree) {
        return (id, checked) => {
            const recipe = subtree.find(r => r.outputIngredient.id === id);
            
            if (checked) {
                this.uiStateManager.addCheckedIngredient(id);
                if (recipe) {
                    this.uiStateManager.markAllRecipeStepsComplete(id, recipe);
                }
            } else {
                this.uiStateManager.removeCheckedIngredient(id);
                if (recipe) {
                    this.uiStateManager.markAllRecipeStepsIncomplete(id, recipe);
                }
            }
            this.updateUI();
        };
    }    createStepChangeHandler(subtree) {
        return (recipeId, stepIndex, isChecked) => {
            // Update the step completion state
            if (isChecked) {
                this.uiStateManager.completeStep(recipeId, stepIndex);
            } else {
                this.uiStateManager.uncompleteStep(recipeId, stepIndex);
            }
            
            // Find the recipe to check if all steps are completed
            const recipe = subtree.find(r => r.outputIngredient.id === recipeId);
            if (recipe) {
                const allStepsCompleted = this.uiStateManager.areAllRecipeStepsComplete(recipeId, recipe);
                const isRecipeChecked = this.uiStateManager.isIngredientChecked(recipeId);
                
                // Auto-check/uncheck recipe based on step completion
                if (allStepsCompleted && !isRecipeChecked) {
                    this.uiStateManager.addCheckedIngredient(recipeId);
                } else if (!allStepsCompleted && isRecipeChecked) {
                    this.uiStateManager.removeCheckedIngredient(recipeId);
                }
            }
            
            // Update the UI
            this.updateUI();
        };
    }}
