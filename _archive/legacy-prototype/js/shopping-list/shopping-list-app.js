/**
 * ShoppingListApp - Main application class for the shopping list page
 * Initializes data and manages the shopping list functionality
 */
class ShoppingListApp {
    constructor() {
        this.unitMap = {};
        this.ingredientMap = {};
        this.recipes = [];
        this.shoppingListManager = null;
        
        this.init();
    }

    /**
     * Initialize the application
     */
    init() {
        console.log('Initializing Shopping List App...');
        this.initializeData();
        this.initializeShoppingListManager();
        this.addNavigationLink();
        console.log('Shopping List App initialized successfully');
    }

    /**
     * Initialize data structures (units, ingredients, recipes)
     */
    initializeData() {
        // Initialize units map
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

        // Initialize tags map
        this.tagsMap = ingredientTagsJSON;

        // Initialize ingredients map
        for (const [id, obj] of Object.entries(ingredientsJSON)) {
            this.ingredientMap[id] = new Ingredient(obj, id);
        }

        // Set ingredient IDs
        for (const id in this.ingredientMap) {
            if (this.ingredientMap.hasOwnProperty(id)) {
                this.ingredientMap[id].id = id;
            }
        }

        // Initialize recipes
        this.recipes = recipesData.map(d => Recipe.fromJSON(d, this.ingredientMap, this.unitMap));
        
        console.log(`Loaded ${this.recipes.length} recipes for shopping list`);
    }

    /**
     * Initialize the shopping list manager
     */
    initializeShoppingListManager() {
        this.shoppingListManager = new ShoppingListManager(
            this.recipes,
            this.unitMap,
            this.ingredientMap,
            this.tagsMap
        );
    }

    /**
     * Add a link back to the main recipe app in the navigation
     */
    addNavigationLink() {
        // This could be enhanced to check if we came from the main app
        // and provide a more contextual navigation experience
        const mainAppUrl = new URL('index.html', window.location.href).href;
        
        // Update the navigation link if it exists
        const navLink = $('#navigation-header a');
        if (navLink.length) {
            navLink.attr('href', mainAppUrl);
        }
    }

    /**
     * Get application statistics
     * @returns {Object} Application statistics
     */
    getStatistics() {
        const baseStats = {
            totalRecipes: this.recipes.length,
            totalIngredients: Object.keys(this.ingredientMap).length,
            totalUnits: Object.keys(this.unitMap).length
        };

        if (this.shoppingListManager) {
            return {
                ...baseStats,
                ...this.shoppingListManager.getStatistics()
            };
        }

        return baseStats;
    }

    /**
     * Export shopping list data (for future features like saving/sharing)
     * @returns {Object} Shopping list data
     */
    exportShoppingListData() {
        if (!this.shoppingListManager) {
            return null;
        }

        const stats = this.shoppingListManager.getStatistics();
        const categorizedIngredients = this.shoppingListManager.ingredientAggregator.getIngredientsByTag();

        return {
            timestamp: new Date().toISOString(),
            selectedRecipes: stats.allSources,
            ingredients: categorizedIngredients,
            statistics: stats
        };
    }

    /**
     * Handle potential future features like URL parameters for pre-selected recipes
     */
    handleUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const preSelectedRecipes = urlParams.get('recipes');
        
        if (preSelectedRecipes) {
            const recipeIds = preSelectedRecipes.split(',');
            // This could be implemented to pre-select recipes based on URL parameters
            console.log('Pre-selected recipes from URL:', recipeIds);
        }
    }
}

// Initialize the shopping list app when the document is ready
$(document).ready(function() {
    try {
        window.shoppingListApp = new ShoppingListApp();
    } catch (error) {
        console.error('Failed to initialize Shopping List App:', error);
        
        // Show error message to user
        $('body').prepend(`
            <div style="background:#fed7d7;color:#c53030;padding:15px;margin:20px;border-radius:6px;text-align:center;">
                <strong>Fel:</strong> Kunde inte ladda inköpslistan. Kontrollera att alla nödvändiga filer är laddade.
                <br><small>Teknisk information: ${error.message}</small>
            </div>
        `);
    }
});
