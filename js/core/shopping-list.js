import { RecipeGraph, convertAmount } from './recipe-graph.js?v=20261021g8';
import { formatNiceAmount } from '../utils/helpers.js';

/**
 * Aggregates base ingredients from multiple recipes with unit conversion support.
 * Uses baseIngredientMap only — recipe outputs never appear as pantry items.
 */
export class ShoppingListAggregator {
  constructor(unitMap, baseIngredientMap, tagsData) {
    this.unitMap = unitMap;
    this.ingredientMap = baseIngredientMap;
    this.tagsData = tagsData;
    this.aggregated = new Map();
  }

  clear() {
    this.aggregated.clear();
  }

  /**
   * @param {import('../models/recipe.js?v=20261021g8').Recipe} recipe - scaled root
   * @param {RecipeGraph|Iterable} graphOrRecipes - graph containing the recipe subtree
   * @param {number} [portionScale=1.0] - extra multiplier (usually 1 if recipe already scaled)
   */
  addRecipe(recipe, graphOrRecipes, portionScale = 1.0) {
    if (!recipe || !recipe.inputs) return;
    const graph = graphOrRecipes instanceof RecipeGraph
      ? graphOrRecipes
      : new RecipeGraph(graphOrRecipes);
    const { totals, units } = graph.computeBaseIngredientTotals(recipe, portionScale);
    for (const [id, amount] of Object.entries(totals)) {
      this._addIngredient(id, amount, units[id], recipe.name);
    }
  }

  _addIngredient(ingredientId, amount, unitAbbr, sourceName) {
    const unit = this.unitMap[unitAbbr];
    if (!unit) return;

    // Skip anything that isn't a base pantry ingredient
    if (!this.ingredientMap[ingredientId]) return;

    // Weight ↔ volume for the same spice (homemade-mix grams vs a recipe's tsk): merge into the existing row
    for (const entry of this.aggregated.values()) {
      if (entry.ingredientId === ingredientId && !entry.unit.isCompatibleWith(unit)) {
        if (entry.unit.type === 'weight' && unit.type === 'volume') {
          const back = convertAmount(entry.amount, entry.unit, unit, ingredientId);
          if (back != null) { entry.amount = back; entry.unit = unit; }
        }
        const conv = convertAmount(amount, unit, entry.unit, ingredientId);
        if (conv != null) {
          entry.amount += conv;
          entry.sources.add(sourceName);
          return;
        }
      }
    }

    let existing = null;
    let existingKey = null;
    for (const [key, entry] of this.aggregated.entries()) {
      if (entry.ingredientId === ingredientId && entry.unit.isCompatibleWith(unit)) {
        existing = entry;
        existingKey = key;
        break;
      }
    }

    if (existing) {
      const totalBase = existing.unit.toBaseUnit(existing.amount) + unit.toBaseUnit(amount);
      const best = this._chooseBestUnit(totalBase, existing.unit, unit);
      existing.amount = best.fromBaseUnit(totalBase);
      const prevAbbr = existing.unit.abbreviation;
      existing.unit = best;
      existing.sources.add(sourceName);
      if (best.abbreviation !== prevAbbr) {
        this.aggregated.delete(existingKey);
        this.aggregated.set(`${ingredientId}_${best.abbreviation}`, existing);
      }
    } else {
      this.aggregated.set(`${ingredientId}_${unitAbbr}`, {
        ingredientId,
        ingredient: this.ingredientMap[ingredientId],
        amount,
        unit,
        sources: new Set([sourceName])
      });
    }
  }

  _chooseBestUnit(totalBase, unitA, unitB) {
    if (unitA.type === 'volume' && unitA.baseUnit === 'ml') {
      if (totalBase >= 1000) return this.unitMap['l'] || unitA;
      if (totalBase >= 100) return this.unitMap['dl'] || unitA;
      if (totalBase >= 15) return this.unitMap['msk'] || unitA;
      if (totalBase >= 5) return this.unitMap['tsk'] || unitA;
      return unitA;
    }
    if (unitA.type === 'weight' && unitA.baseUnit === 'g') {
      if (totalBase >= 1000) return this.unitMap['kg'] || unitA;
      return this.unitMap['g'] || unitA;
    }
    return unitA;
  }

  getByTag() {
    const groups = {};
    if (this.tagsData) {
      for (const [, tag] of Object.entries(this.tagsData)) {
        groups[tag.displayName] = [];
      }
    }
    if (!groups['Övrigt']) groups['Övrigt'] = [];

    for (const entry of this.aggregated.values()) {
      const ing = this.ingredientMap[entry.ingredientId];
      const tagKey = ing?.primaryTag;
      const displayName = (tagKey && this.tagsData[tagKey])
        ? this.tagsData[tagKey].displayName
        : 'Övrigt';
      if (!groups[displayName]) groups[displayName] = [];
      groups[displayName].push(entry);
    }

    for (const name of Object.keys(groups)) {
      groups[name].sort((a, b) => {
        const aBasic = this.ingredientMap[a.ingredientId]?.hasTag('basic');
        const bBasic = this.ingredientMap[b.ingredientId]?.hasTag('basic');
        if (aBasic && !bBasic) return -1;
        if (!aBasic && bBasic) return 1;
        return (a.ingredient?.name || '').localeCompare(b.ingredient?.name || '', 'sv');
      });
    }

    for (const name of Object.keys(groups)) {
      if (groups[name].length === 0) delete groups[name];
    }
    return groups;
  }

  formatAmount(amount, unit) {
    return formatNiceAmount(amount, unit.abbreviation);
  }
}
