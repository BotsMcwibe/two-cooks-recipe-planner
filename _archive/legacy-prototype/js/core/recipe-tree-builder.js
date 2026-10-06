class RecipeTreeBuilder {
    static buildRecipeTree(recipe, recipes) {
        return {
            ...(recipe.outputIngredient
                ? { recipe,
                    inputs: recipe.inputs.map(({ingredient, amount, unit}) => {
                        const sub = recipes.find(r => r.outputIngredient.id === ingredient.id);
                        return sub
                            ? this.buildRecipeTree(sub, recipes)
                            : { ingredient, amount, unit };
                    })
                }
                : {}
            )
        };
    }
    
    static getSubtreeRecipes(root, recipes) {
        const map = new Map();
        const dfs = (r) => {
            if (map.has(r.outputIngredient.id)) return;
            map.set(r.outputIngredient.id, r);
            r.inputs.forEach(({ingredient}) => {
                const sub = recipes.find(x => x.outputIngredient.id === ingredient.id);
                if (sub) dfs(sub);
            });
        };
        dfs(root);
        return Array.from(map.values());
    }
    
    static computeBaseIngredientTotals(root, recipes, neededAmount = 1) {
        const totals = {};
        const units = {};
        const dfs = (r, multiplier = neededAmount) => {
            r.inputs.forEach(({ingredient, amount, unit}) => {
                const sub = recipes.find(x => x.outputIngredient.id === ingredient.id);
                if (sub) {
                    const batchesNeeded = (amount * multiplier) / (sub.outputAmount || 1);
                    dfs(sub, batchesNeeded);
                } else {
                    totals[ingredient.id] = (totals[ingredient.id] || 0) + amount * multiplier;
                    units[ingredient.id] = unit.abbreviation;
                }
            });
        };
        dfs(root);
        return {totals, units};
    }
}

window.RecipeTreeBuilder = RecipeTreeBuilder;
