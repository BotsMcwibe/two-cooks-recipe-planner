import { isResource, recipeAfterIds } from './equipment.js?v=20261021g6';

/**
 * Map-based recipe graph for O(1) lookups by recipe/output id.
 */
/** Rough grams per ml for weight ↔ volume of dry pantry items (default: ground spice). */
const GRAMS_PER_ML = { salt: 1.2, sugar: 0.8, brown_sugar: 0.8, powdered_sugar: 0.5 };

/** Convert amount between units; weight ↔ volume via GRAMS_PER_ML. Null if impossible. */
export function convertAmount(amount, from, to, ingredientId) {
  if (!from || !to || from === to || from.abbreviation === to.abbreviation) return amount;
  if (from.isCompatibleWith(to)) return to.fromBaseUnit(from.toBaseUnit(amount));
  const gPerMl = GRAMS_PER_ML[ingredientId] || 0.5;
  const isW = (u) => u.type === 'weight';
  const isV = (u) => u.type === 'volume';
  if (isW(from) && isV(to)) return to.fromBaseUnit(from.toBaseUnit(amount) / gPerMl);
  if (isV(from) && isW(to)) return to.fromBaseUnit(from.toBaseUnit(amount) * gPerMl);
  return null;
}

export class RecipeGraph {
  /**
   * @param {Iterable<import('../models/recipe.js?v=20261021g6').Recipe>|Map<string, import('../models/recipe.js?v=20261021g6').Recipe>} recipes
   */
  constructor(recipes) {
    this.byId = new Map();
    if (recipes instanceof Map) {
      for (const [id, r] of recipes) {
        this.byId.set(id, r);
      }
    } else if (recipes) {
      for (const r of recipes) {
        const id = r.id || r.outputIngredient?.id;
        if (id) this.byId.set(id, r);
      }
    }
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  has(id) {
    return this.byId.has(id);
  }

  get recipes() {
    return Array.from(this.byId.values());
  }

  get size() {
    return this.byId.size;
  }

  /** Merge another graph's recipes into this one (does not overwrite). */
  merge(other) {
    for (const [id, r] of other.byId) {
      if (!this.byId.has(id)) this.byId.set(id, r);
    }
    return this;
  }

  buildRecipeTree(recipe) {
    return {
      ...(recipe.outputIngredient
        ? {
            recipe,
            inputs: recipe.inputs.map(({ ingredient, amount, unit }) => {
              const sub = this.byId.get(ingredient.id);
              return sub ? this.buildRecipeTree(sub) : { ingredient, amount, unit };
            })
          }
        : {})
    };
  }

  getSubtreeRecipes(root) {
    const map = new Map();
    const dfs = (r) => {
      const id = r.outputIngredient.id;
      if (map.has(id)) return;
      map.set(id, r);
      r.inputs.forEach(({ ingredient }) => {
        const sub = this.byId.get(ingredient.id);
        if (sub) dfs(sub);
      });
      // Resource ordering (preheated oven, previous user of a reused pan) is part of the dish
      for (const aid of recipeAfterIds(r)) {
        const sub = this.byId.get(aid);
        if (sub) dfs(sub);
      }
    };
    dfs(root);
    return Array.from(map.values());
  }

  /** Return a new RecipeGraph containing only the subtree. */
  getSubtreeGraph(root) {
    return new RecipeGraph(this.getSubtreeRecipes(root));
  }

  computeBaseIngredientTotals(root, neededAmount = 1) {
    const totals = {};
    const units = {};
    const dfs = (r, multiplier = neededAmount) => {
      r.inputs.forEach(({ ingredient, amount, unit }) => {
        const sub = this.byId.get(ingredient.id);
        if (sub) {
          const batchesNeeded = (amount * multiplier) / (sub.outputAmount || 1);
          dfs(sub, batchesNeeded);
        } else {
          const id = ingredient.id;
          let add = amount * multiplier;
          if (units[id] && unitObjs[id] && unitObjs[id].type === 'weight' && unit.type === 'volume') {
            // Prefer the recipe's spoon measure over homemade-mix grams: convert what we have so far
            const conv = convertAmount(totals[id] || 0, unitObjs[id], unit, id);
            if (conv != null) {
              totals[id] = conv;
              unitObjs[id] = unit;
              units[id] = unit.abbreviation;
            }
          }
          if (units[id] && unitObjs[id] && unitObjs[id] !== unit) {
            // Merge into the unit already in use (e.g. homemade-mix grams of salt into tsk)
            const conv = convertAmount(add, unit, unitObjs[id], id);
            if (conv != null) add = conv;
          } else if (!units[id]) {
            unitObjs[id] = unit;
            units[id] = unit.abbreviation;
          }
          totals[id] = (totals[id] || 0) + add;
        }
      });
    };
    const unitObjs = {};
    dfs(root);
    return { totals, units };
  }

  /** Dishes nothing else consumes. Resource nodes (preheated oven) are equipment, never a dish. */
  getMainRecipes() {
    const inputIds = new Set();
    for (const r of this.byId.values()) {
      for (const i of r.inputs) inputIds.add(i.ingredient.id);
      for (const aid of recipeAfterIds(r)) inputIds.add(aid);
    }
    return this.recipes.filter(r => !isResource(r) && !inputIds.has(r.outputIngredient.id));
  }

  getMasters() {
    return this.recipes.filter(r => r.hasTag && r.hasTag('master'));
  }

  /**
   * Base pantry ingredients only — never recipe outputs.
   * @param {Iterable} baseIngredients - Ingredient instances from ingredients.json
   * @param {Iterable} subtreeRecipes - recipes in current subtree (unused for filtering pantry; kept for API)
   */
  static getBaseIngredients(baseIngredients, subtreeRecipes) {
    const outputIds = new Set(
      [...subtreeRecipes].map(r => r.outputIngredient.id)
    );
    return [...baseIngredients].filter(ing => !outputIds.has(ing.id));
  }

  getCheckedBaseIngredientTotals(subtreeRecipes, checkedPreparedIds) {
    const amounts = {};
    const units = {};
    const subtreeMap = subtreeRecipes instanceof Map
      ? subtreeRecipes
      : new Map([...subtreeRecipes].map(r => [r.outputIngredient.id, r]));

    for (const rid of checkedPreparedIds) {
      const recipe = subtreeMap.get(rid);
      if (recipe) {
        for (const input of recipe.inputs) {
          if (!subtreeMap.has(input.ingredient.id)) {
            amounts[input.ingredient.id] = (amounts[input.ingredient.id] || 0) + input.amount;
            units[input.ingredient.id] = input.unit.abbreviation;
          }
        }
      }
    }
    return { amounts, units };
  }

  /** Scale every recipe in the graph; returns a new RecipeGraph. */
  scaleAll(scaleFactor) {
    if (scaleFactor === 1.0) return this;
    const scaled = new Map();
    for (const [id, r] of this.byId) {
      scaled.set(id, r.scaleRecipe(scaleFactor));
    }
    return new RecipeGraph(scaled);
  }

  // --- Static helpers for callers that still pass arrays ---

  static fromRecipes(recipes) {
    return new RecipeGraph(recipes);
  }

  static getSubtreeRecipes(root, recipes) {
    const g = recipes instanceof RecipeGraph ? recipes : new RecipeGraph(recipes);
    return g.getSubtreeRecipes(root);
  }

  static computeBaseIngredientTotals(root, recipes, neededAmount = 1) {
    const g = recipes instanceof RecipeGraph ? recipes : new RecipeGraph(recipes);
    return g.computeBaseIngredientTotals(root, neededAmount);
  }

  static getMainRecipes(recipes) {
    const g = recipes instanceof RecipeGraph ? recipes : new RecipeGraph(recipes);
    return g.getMainRecipes();
  }

  static getCheckedBaseIngredientTotals(subtreeRecipes, checkedPreparedIds) {
    const g = new RecipeGraph(subtreeRecipes);
    return g.getCheckedBaseIngredientTotals(subtreeRecipes, checkedPreparedIds);
  }
}
