/**
 * IngredientAggregator - Combines and aggregates ingredients from multiple recipes
 * Handles unit conversion and ingredient consolidation for shopping lists
 */
class IngredientAggregator {
    constructor(unitMap, ingredientMap, allRecipes, tagsMap = {}) {
        this.unitMap = unitMap;
        this.ingredientMap = ingredientMap;
        this.allRecipes = allRecipes; // Need all recipes to resolve the tree
        this.tagsMap = tagsMap; // Tags mapping
        this.aggregatedIngredients = new Map();
    }

    /**
     * Add ingredients from a recipe to the aggregated list
     * Resolves the recipe tree to get base ingredients only
     * @param {Recipe} recipe - Recipe object containing ingredients
     * @param {number} portionScale - Scale factor for recipe portions (default: 1.0)
     */
    addRecipeIngredients(recipe, portionScale = 1.0) {
        if (!recipe || !recipe.inputs) {
            console.warn('Invalid recipe or no inputs found:', recipe);
            return;
        }

        // Use the recipe tree builder to get base ingredients
        const {totals, units} = RecipeTreeBuilder.computeBaseIngredientTotals(
            recipe, 
            this.allRecipes, 
            portionScale
        );

        // Add each base ingredient to the aggregated list
        Object.entries(totals).forEach(([ingredientId, amount]) => {
            const unitAbbr = units[ingredientId];
            this.addIngredient(ingredientId, amount, unitAbbr, recipe.name);
        });
    }

    /**
     * Add a single ingredient to the aggregated list with unit conversion
     * @param {string} ingredientId - ID of the ingredient
     * @param {number} amount - Amount of the ingredient
     * @param {string} unitAbbr - Unit abbreviation
     * @param {string} recipeName - Name of the recipe this ingredient comes from
     */
    addIngredient(ingredientId, amount, unitAbbr, recipeName) {
        const unit = this.unitMap[unitAbbr];
        if (!unit) {
            console.warn(`Unknown unit: ${unitAbbr}`);
            return;
        }

        // Check if we already have this ingredient in a compatible unit
        let existingEntry = null;
        let existingKey = null;

        // Look for existing entries with compatible units
        for (const [key, existing] of this.aggregatedIngredients.entries()) {
            if (existing.ingredientId === ingredientId && existing.unit.isCompatibleWith(unit)) {
                existingEntry = existing;
                existingKey = key;
                break;
            }
        }

        if (existingEntry) {
            // Convert new amount to the same unit as existing
            const existingInBaseUnit = existingEntry.unit.toBaseUnit(existingEntry.amount);
            const newInBaseUnit = unit.toBaseUnit(amount);
            const totalInBaseUnit = existingInBaseUnit + newInBaseUnit;
            
            // Choose the best unit for the total amount
            const bestUnit = this.chooseBestUnit(totalInBaseUnit, existingEntry.unit, unit);
            const totalInBestUnit = bestUnit.fromBaseUnit(totalInBaseUnit);

            // Update existing entry
            existingEntry.amount = totalInBestUnit;
            // Capture previous unit abbreviation before updating unit
            const prevAbbr = existingEntry.unit.abbreviation;
            existingEntry.unit = bestUnit;
            existingEntry.sources.add(recipeName);

            // If the unit changed, update the key
            if (bestUnit.abbreviation !== prevAbbr) {
                this.aggregatedIngredients.delete(existingKey);
                const newKey = `${ingredientId}_${bestUnit.abbreviation}`;
                this.aggregatedIngredients.set(newKey, existingEntry);
            }
        } else {
            // Create new entry
            const key = `${ingredientId}_${unitAbbr}`;
            this.aggregatedIngredients.set(key, {
                ingredientId: ingredientId,
                ingredient: this.ingredientMap[ingredientId],
                amount: amount,
                unit: unit,
                sources: new Set([recipeName])
            });
        }
    }

    /**
     * Choose the best unit for display based on the total amount in base units
     * @param {number} totalInBaseUnit - Total amount in base units
     * @param {Unit} currentUnit - Current unit
     * @param {Unit} newUnit - New unit being added
     * @returns {Unit} Best unit for display
     */
    chooseBestUnit(totalInBaseUnit, currentUnit, newUnit) {
        // For volume measurements, prefer larger units for larger amounts
        if (currentUnit.type === 'volume' && currentUnit.baseUnit === 'ml') {
            // totalInBaseUnit is in ml
            if (totalInBaseUnit >= 1000) return this.unitMap['l'] || currentUnit;      // Use liters for 1000ml+
            if (totalInBaseUnit >= 100) return this.unitMap['dl'] || currentUnit;      // Use deciliters for 100ml+
            if (totalInBaseUnit >= 15) return this.unitMap['msk'] || currentUnit;      // Use tablespoons for 15ml+
            if (totalInBaseUnit >= 5) return this.unitMap['tsk'] || currentUnit;       // Use teaspoons for 5ml+
            
            // For very small amounts, keep the smaller unit (nypa, skvätt, klick)
            return currentUnit;
        }
        
        // For weight measurements
        if (currentUnit.type === 'weight' && currentUnit.baseUnit === 'g') {
            // totalInBaseUnit is in grams
            if (totalInBaseUnit >= 1000) return this.unitMap['kg'] || currentUnit;     // Use kg for 1000g+
            return this.unitMap['g'] || currentUnit;                                   // Use g for smaller amounts
        }
        
        // For count and other types, keep the current unit
        return currentUnit;
    }

    /**
     * Get all aggregated ingredients organized by tags
     * @returns {Object} Object with tag display names as keys and ingredient arrays as values
     */
    getIngredientsByTag() {
        // Initialize empty tag groups using the tags map
        const tagGroups = {};
        Object.entries(this.tagsMap).forEach(([key, tagObj]) => {
            tagGroups[tagObj.displayName] = [];
        });
        
        // Add fallback group if not present
        if (!tagGroups['Övrigt']) {
            tagGroups['Övrigt'] = [];
        }

        this.aggregatedIngredients.forEach(aggregatedIngredient => {
            const tagDisplayName = this.categorizeIngredient(aggregatedIngredient.ingredientId);
            tagGroups[tagDisplayName].push(aggregatedIngredient);
        });

        // Sort ingredients within each tag group, prioritizing basic ingredients
        Object.keys(tagGroups).forEach(tagName => {
            tagGroups[tagName].sort((a, b) => {
                const aIngredient = this.ingredientMap[a.ingredientId];
                const bIngredient = this.ingredientMap[b.ingredientId];
                
                // Basic ingredients first
                const aIsBasic = aIngredient.hasTag('basic');
                const bIsBasic = bIngredient.hasTag('basic');
                
                if (aIsBasic && !bIsBasic) return -1;
                if (!aIsBasic && bIsBasic) return 1;
                
                // Then alphabetically
                return a.ingredient.name.localeCompare(b.ingredient.name, 'sv');
            });
        });

        // Remove empty tag groups
        Object.keys(tagGroups).forEach(tagName => {
            if (tagGroups[tagName].length === 0) {
                delete tagGroups[tagName];
            }
        });

        return tagGroups;
    }

    /**
     * Get all aggregated ingredients organized by category (backward compatibility)
     * @returns {Object} Object with categories as keys and ingredient arrays as values
     */
    getIngredientsByCategory() {
        return this.getIngredientsByTag();
    }

    /**
     * Categorize an ingredient based on its primary tag
     * @param {string} ingredientId - ID of the ingredient
     * @returns {string} Tag display name
     */
    categorizeIngredient(ingredientId) {
        const ingredient = this.ingredientMap[ingredientId];
        
        if (!ingredient) {
            console.warn(`Unknown ingredient: ${ingredientId}`);
            return 'Övrigt';
        }

        // Get the primary tag (first tag in the array)
        const primaryTag = ingredient.primaryTag;
        if (primaryTag && this.tagsMap[primaryTag]) {
            return this.tagsMap[primaryTag].displayName;
        }

        // Fallback to 'Övrigt' if tag not found
        return 'Övrigt';
    }

    /**
     * Format amount for display
     * @param {number} amount - Amount to format
     * @param {Unit} unit - Unit object
     * @returns {string} Formatted amount string
     */
    formatAmount(amount, unit) {
        const abbr = unit.abbreviation || '';
        const isTinyVolume = unit.type === 'volume' && ['nypa','skvätt','klick','tsk','msk'].includes(abbr);
        const isCount = unit.type === 'count';

        let roundedAmount = amount;
        if (isTinyVolume || isCount) {
            // Use halves for small/count units
            roundedAmount = Math.round(amount * 2) / 2;
        } else if (amount >= 10) {
            roundedAmount = Math.round(amount);
        } else if (amount >= 1) {
            roundedAmount = Math.round(amount * 10) / 10;
        } else {
            roundedAmount = Math.round(amount * 100) / 100;
        }

        // Convert common halves to unicode fractions where nice
        const toFraction = (val) => {
            if (Math.abs(val - Math.floor(val) - 0.5) < 1e-9) {
                return `${Math.floor(val)}½`.replace(/^0/, '½');
            }
            return `${val}`;
        };

        const displayAmount = (isTinyVolume || isCount) ? toFraction(roundedAmount) : `${roundedAmount}`;
        const unitLabel = abbr || unit.name || '';
        return `${displayAmount} ${unitLabel}`.trim();
    }

    /**
     * Clear all aggregated ingredients
     */
    clear() {
        this.aggregatedIngredients.clear();
    }

    /**
     * Get total number of unique ingredients
     * @returns {number} Number of unique ingredients
     */
    getIngredientCount() {
        return this.aggregatedIngredients.size;
    }

    /**
     * Get all recipe sources mentioned in the aggregated ingredients
     * @returns {Set<string>} Set of recipe names
     */
    getAllSources() {
        const allSources = new Set();
        this.aggregatedIngredients.forEach(ingredient => {
            ingredient.sources.forEach(source => allSources.add(source));
        });
        return allSources;
    }
}
