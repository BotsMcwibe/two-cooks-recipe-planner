/**
 * ShoppingListManager - Manages the shopping list UI and user interactions
 * Handles recipe selection, list generation, and ingredient checking
 */
class ShoppingListManager {
    constructor(recipes, unitMap, ingredientMap, tagsMap = {}) {
        this.recipes = recipes;
        this.unitMap = unitMap;
        this.ingredientMap = ingredientMap;
        this.tagsMap = tagsMap;
        this.selectedRecipes = new Set();
        this.recipePortions = new Map(); // Track portions for each selected recipe
        this.ingredientAggregator = new IngredientAggregator(unitMap, ingredientMap, recipes, tagsMap);
        this.checkedIngredients = new Set();
        this.recipeAnalyzer = new RecipeAnalyzer(recipes, unitMap, ingredientMap);
        this.cookingOptions = {
            cooks: 1,
            prepFirst: false
        };
        
        this.initializeUI();
        this.bindEvents();
    }

    /**
     * Initialize the UI components
     */
    initializeUI() {
        this.renderCookingOptions();
        this.renderRecipeSelection();
        this.updateGenerateButton();
    }

    /**
     * Render cooking options (two cooks, prep first)
     */
    renderCookingOptions() {
        const optionsHtml = `
            <div id="cooking-options" class="cooking-options">
                <div class="option-group">
                    <label class="option-label">
                        <input type="checkbox" id="cooks-toggle" ${this.cookingOptions.cooks > 1 ? 'checked' : ''}>
                        <span class="option-text">Två kockar</span>
                        <span class="option-help">Beräkna tid för två personer som lagar mat tillsammans</span>
                    </label>
                </div>
                <div class="option-group">
                    <label class="option-label">
                        <input type="checkbox" id="prep-first-toggle" ${this.cookingOptions.prepFirst ? 'checked' : ''}>
                        <span class="option-text">Förbered först</span>
                        <span class="option-help">Gör alla förberedelser innan tillagning börjar</span>
                    </label>
                </div>
            </div>
        `;
        
        // Insert before recipe checkboxes
        const recipeContainer = $('#recipe-checkboxes');
        if (recipeContainer.length && !$('#cooking-options').length) {
            recipeContainer.before(optionsHtml);
        }
    }

    /**
     * Render the recipe selection checkboxes
     */
    renderRecipeSelection() {
        const container = $('#recipe-checkboxes');
        container.empty();

        // Filter for main recipes (master recipes) - recipes that produce a complete dish
        const mainRecipes = this.recipes.filter(recipe => 
            recipe.tags && recipe.tags.includes('master')
        );

        // If no recipes are tagged as master, show all recipes
        const recipesToShow = mainRecipes.length > 0 ? mainRecipes : this.recipes;

        recipesToShow.forEach(recipe => {
            const analysisData = this.recipeAnalyzer.analyzeRecipe(recipe, this.cookingOptions);
            
            const recipeItem = $(`
                <div class="recipe-checkbox-item" data-recipe-id="${recipe.id}">
                    <input type="checkbox" id="recipe-${recipe.id}" value="${recipe.id}">
                    <div class="recipe-info">
                        <div class="recipe-name">${recipe.name}</div>
                        <div class="recipe-summary">${analysisData.shortDescription}</div>
                        <div class="recipe-expandable">
                            <button class="recipe-expand-btn" type="button">
                                <span class="expand-text">Visa detaljer</span>
                                <span class="expand-icon">▼</span>
                            </button>
                            <div class="recipe-details" style="display: none;">
                                <div class="detail-section">${analysisData.detailedDescription}</div>
                                ${this.generateRecipeStepsPreview(analysisData)}
                            </div>
                        </div>
                    </div>
                </div>
            `);

            container.append(recipeItem);
        });
    }

    /**
     * Generate a preview of recipe steps
     */
    generateRecipeStepsPreview(analysis) {
        if (!analysis.timing || analysis.timing.steps <= 1) {
            return '';
        }

        const stepsHtml = `
            <div class="detail-section">
                <strong>Översikt av stegen:</strong><br>
                ${this.generateStepsOverview(analysis)}
            </div>
        `;
        
        return stepsHtml;
    }

    /**
     * Generate steps overview based on analysis
     */
    generateStepsOverview(analysis) {
        // This is a simplified version - in a full implementation,
        // you'd use the scheduler to get the actual step sequence
        const steps = [];
        
        if (analysis.methods.methods.includes('Förberedelse')) {
            steps.push('• Förbered ingredienser');
        }
        if (analysis.methods.methods.includes('Stekning')) {
            steps.push('• Stek komponenter');
        }
        if (analysis.methods.methods.includes('Kokning')) {
            steps.push('• Koka ingredienser');
        }
        if (analysis.methods.methods.includes('Ugnsbakning')) {
            steps.push('• Grädda i ugn');
        }
        if (analysis.methods.methods.includes('Blandning')) {
            steps.push('• Blanda ihop');
        }
        if (analysis.methods.methods.includes('Formning')) {
            steps.push('• Forma och servera');
        }

        return steps.length > 0 ? steps.join('<br>') : '• Enkla steg att följa';
    }

    /**
     * Bind event handlers
     */
    bindEvents() {
        // Recipe checkbox changes
        $(document).on('change', '#recipe-checkboxes input[type="checkbox"]', (e) => {
            const recipeId = e.target.value;
            const isChecked = e.target.checked;
            
            if (isChecked) {
                this.selectedRecipes.add(recipeId);
                this.recipePortions.set(recipeId, 1.0); // Default to 4 portions (scale 1.0)
                $(e.target).closest('.recipe-checkbox-item').addClass('selected');
            } else {
                this.selectedRecipes.delete(recipeId);
                this.recipePortions.delete(recipeId);
                $(e.target).closest('.recipe-checkbox-item').removeClass('selected');
            }
            
            this.updateGenerateButton();
        });

        // Recipe item click (toggle checkbox)
        $(document).on('click', '.recipe-checkbox-item', (e) => {
            if (e.target.type !== 'checkbox' && !$(e.target).closest('.recipe-expandable').length) {
                const checkbox = $(e.currentTarget).find('input[type="checkbox"]');
                checkbox.prop('checked', !checkbox.prop('checked')).trigger('change');
            }
        });

        // Recipe expand/collapse button
        $(document).on('click', '.recipe-expand-btn', (e) => {
            e.stopPropagation();
            const button = $(e.currentTarget);
            const details = button.siblings('.recipe-details');
            const icon = button.find('.expand-icon');
            const text = button.find('.expand-text');
            
            if (details.is(':visible')) {
                details.slideUp(200);
                icon.text('▼');
                text.text('Visa detaljer');
            } else {
                details.slideDown(200);
                icon.text('▲');
                text.text('Dölj detaljer');
            }
        });

        // Generate shopping list button
        $('#generate-list-btn').on('click', () => {
            this.generateShoppingList();
        });

        // Ingredient checkbox changes
        $(document).on('change', '.ingredient-checkbox', (e) => {
            const ingredientKey = e.target.dataset.ingredientKey;
            const isChecked = e.target.checked;
            const ingredientItem = $(e.target).closest('.ingredient-item');
            
            if (isChecked) {
                this.checkedIngredients.add(ingredientKey);
                ingredientItem.addClass('checked');
            } else {
                this.checkedIngredients.delete(ingredientKey);
                ingredientItem.removeClass('checked');
            }
        });

        // Print list button
        $('#print-list-btn').on('click', () => {
            window.print();
        });

        // Reset list button
        $('#reset-list-btn').on('click', () => {
            this.resetShoppingList();
        });

        // Portion control buttons
        $(document).on('click', '.recipe-portion-minus', (e) => {
            const recipeId = $(e.target).data('recipe-id');
            this.adjustRecipePortions(recipeId, -1);
        });

        $(document).on('click', '.recipe-portion-plus', (e) => {
            const recipeId = $(e.target).data('recipe-id');
            this.adjustRecipePortions(recipeId, 1);
        });

        // Cooking options changes
        $(document).on('change', '#cooks-toggle, #prep-first-toggle', () => {
            this.cookingOptions.cooks = $('#cooks-toggle').prop('checked') ? 2 : 1;
            this.cookingOptions.prepFirst = $('#prep-first-toggle').prop('checked');
            
            // Re-render recipe selection with updated analysis
            this.renderRecipeSelection();
        });
    }

    /**
     * Update the generate button state
     */
    updateGenerateButton() {
        const button = $('#generate-list-btn');
        const hasSelection = this.selectedRecipes.size > 0;
        
        button.prop('disabled', !hasSelection);
        button.text(hasSelection ? 
            `Skapa Inköpslista (${this.selectedRecipes.size} recept)` : 
            'Skapa Inköpslista'
        );
    }

    /**
     * Adjust portions for a specific recipe
     * @param {string} recipeId - ID of the recipe to adjust
     * @param {number} direction - Direction of adjustment (-1 or +1)
     */
    adjustRecipePortions(recipeId, direction) {
        if (!this.recipePortions.has(recipeId)) return;

        const currentScale = this.recipePortions.get(recipeId);
        const currentPortions = Math.round(currentScale * 4);
        const newPortions = Math.max(2, Math.min(24, currentPortions + (direction * 2)));
        const newScale = newPortions / 4;

        if (newScale !== currentScale) {
            this.recipePortions.set(recipeId, newScale);
            this.updateRecipePortionDisplay(recipeId);
            
            // If shopping list is already generated, regenerate it WITHOUT scrolling
            if ($('#shopping-list-container').is(':visible')) {
                this.regenerateShoppingListQuietly();
            }
        }
    }

    /**
     * Regenerate shopping list without scrolling or animations
     */
    regenerateShoppingListQuietly() {
        // Clear previous aggregation
        this.ingredientAggregator.clear();
        this.checkedIngredients.clear();

        // Get selected recipes and their ingredients
        const selectedRecipeObjects = this.recipes.filter(recipe => 
            this.selectedRecipes.has(recipe.id)
        );

        // Add ingredients from each selected recipe with individual portion scaling
        selectedRecipeObjects.forEach(recipe => {
            const portionScale = this.recipePortions.get(recipe.id) || 1.0;
            this.ingredientAggregator.addRecipeIngredients(recipe, portionScale);
        });

        // Re-render only the ingredient categories (not the summary)
        this.renderIngredientCategories();
    }

    /**
     * Update the portion display for a specific recipe
     * @param {string} recipeId - ID of the recipe to update
     */
    updateRecipePortionDisplay(recipeId) {
        const scale = this.recipePortions.get(recipeId) || 1.0;
        const portions = Math.round(scale * 4);
        
        $(`.recipe-portion-display[data-recipe-id="${recipeId}"]`).text(`${portions} portioner`);
        
        // Update button states
        $(`.recipe-portion-minus[data-recipe-id="${recipeId}"]`).prop('disabled', portions <= 2);
        $(`.recipe-portion-plus[data-recipe-id="${recipeId}"]`).prop('disabled', portions >= 24);
    }

    /**
     * Generate and display the shopping list
     */
    generateShoppingList() {
        // Clear previous aggregation
        this.ingredientAggregator.clear();
        this.checkedIngredients.clear();

        // Get selected recipes and their ingredients
        const selectedRecipeObjects = this.recipes.filter(recipe => 
            this.selectedRecipes.has(recipe.id)
        );

        // Add ingredients from each selected recipe with individual portion scaling
        selectedRecipeObjects.forEach(recipe => {
            const portionScale = this.recipePortions.get(recipe.id) || 1.0;
            this.ingredientAggregator.addRecipeIngredients(recipe, portionScale);
        });

        // Display the shopping list
        this.renderShoppingList(selectedRecipeObjects);
        
        // Show the shopping list container
        $('#shopping-list-container').show();
        
        // Scroll to the shopping list
        $('html, body').animate({
            scrollTop: $('#shopping-list-container').offset().top - 20
        }, 500);
    }

    /**
     * Render the shopping list
     * @param {Array<Recipe>} selectedRecipes - Array of selected recipe objects
     */
    renderShoppingList(selectedRecipes) {
        this.renderSelectedRecipesSummary(selectedRecipes);
        this.renderIngredientCategories();
    }

    /**
     * Render the summary of selected recipes with portion controls
     * @param {Array<Recipe>} selectedRecipes - Array of selected recipe objects
     */
    renderSelectedRecipesSummary(selectedRecipes) {
        const container = $('#recipe-list');
        container.empty();

        selectedRecipes.forEach(recipe => {
            const portionScale = this.recipePortions.get(recipe.id) || 1.0;
            const portions = Math.round(portionScale * 4);
            
            const recipeItem = $(`
                <div style="margin-bottom:10px;padding:12px;background:white;border-radius:6px;border-left:4px solid #4299e1;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <strong>${recipe.name}</strong>
                    </div>
                    <div class="recipe-portion-controls" style="display:flex;align-items:center;gap:8px;">
                        <button class="recipe-portion-minus portion-btn" data-recipe-id="${recipe.id}" 
                                ${portions <= 2 ? 'disabled' : ''}>−</button>
                        <span class="recipe-portion-display" data-recipe-id="${recipe.id}">${portions} portioner</span>
                        <button class="recipe-portion-plus portion-btn" data-recipe-id="${recipe.id}" 
                                ${portions >= 24 ? 'disabled' : ''}>+</button>
                    </div>
                </div>
            `);
            container.append(recipeItem);
        });
    }

    /**
     * Render ingredient categories/tags
     */
    renderIngredientCategories() {
        const container = $('#ingredient-categories');
        container.empty();

        const categorizedIngredients = this.ingredientAggregator.getIngredientsByTag();

        Object.entries(categorizedIngredients).forEach(([tagGroup, ingredients]) => {
            const categoryElement = $(`
                <div class="ingredient-category">
                    <div class="category-header">${tagGroup}</div>
                    <ul class="ingredient-list"></ul>
                </div>
            `);

            const ingredientList = categoryElement.find('.ingredient-list');

            ingredients.forEach(ingredient => {
                const ingredientKey = `${ingredient.ingredientId}_${ingredient.unit.abbreviation}`;
                const sourcesText = Array.from(ingredient.sources).join(', ');
                
                const ingredientItem = $(`
                    <li class="ingredient-item">
                        <input type="checkbox" class="ingredient-checkbox" data-ingredient-key="${ingredientKey}">
                        <div class="ingredient-details">
                            <div class="ingredient-text">
                                <span class="ingredient-amount">${this.ingredientAggregator.formatAmount(ingredient.amount, ingredient.unit)}</span><span class="ingredient-name">${ingredient.ingredient.name}</span>
                            </div>
                            <div class="ingredient-sources">${sourcesText}</div>
                        </div>
                    </li>
                `);

                ingredientList.append(ingredientItem);
            });

            container.append(categoryElement);
        });
    }

    /**
     * Reset the shopping list and return to recipe selection
     */
    resetShoppingList() {
        // Clear selections
        this.selectedRecipes.clear();
        this.recipePortions.clear();
        this.checkedIngredients.clear();
        this.ingredientAggregator.clear();

        // Reset UI
        $('#recipe-checkboxes input[type="checkbox"]').prop('checked', false);
        $('.recipe-checkbox-item').removeClass('selected');
        $('#shopping-list-container').hide();
        this.updateGenerateButton();

        // Scroll to top
        $('html, body').animate({
            scrollTop: 0
        }, 500);
    }

    /**
     * Get shopping list statistics
     * @returns {Object} Statistics about the shopping list
     */
    getStatistics() {
        return {
            selectedRecipeCount: this.selectedRecipes.size,
            totalIngredients: this.ingredientAggregator.getIngredientCount(),
            checkedIngredients: this.checkedIngredients.size,
            allSources: Array.from(this.ingredientAggregator.getAllSources())
        };
    }
}
