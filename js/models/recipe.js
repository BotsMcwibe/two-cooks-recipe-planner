import { Ingredient } from './ingredient.js';

function parseStepTemplate(stepString, ingredientMap) {
  const re = /\{\{([^}]+)\}\}/g;
  let last = 0, m;
  const parts = [];
  while ((m = re.exec(stepString))) {
    if (m.index > last) {
      parts.push(stepString.slice(last, m.index));
    }
    const id = m[1].trim();
    if (!ingredientMap[id]) {
      throw new Error(`Unknown ingredient "${id}" in step`);
    }
    parts.push({ type: "ingredient", ingredient: ingredientMap[id] });
    last = re.lastIndex;
  }
  if (last < stepString.length) {
    parts.push(stepString.slice(last));
  }
  return parts;
}

/**
 * Optional authoring helper for writing recipes in JS before exporting to JSON.
 * Runtime loads JSON via fetch + Recipe.fromJSON — do not import RecipeBuilder
 * modules into the app import graph.
 */
export class RecipeBuilder {
  constructor(id, name) {
    this.recipe = {
      id: id,
      name: name,
      inputs: [],
      outputName: "",
      steps: [],
      duration: 5,
      wait: -0.01,
      tips: [],
      tags: [],
      basePortions: null,
    };
  }

  setId(id) { this.recipe.id = id; return this; }
  setName(name) { this.recipe.name = name; return this; }
  output(outputName) { this.recipe.outputName = outputName; return this; }
  duration(duration) { this.recipe.duration = duration; return this; }
  wait(wait) { this.recipe.wait = wait; return this; }
  input(id, amount, unit) { this.recipe.inputs.push({ id, amount, unit }); return this; }
  step(step) { this.recipe.steps.push(step); return this; }
  steps(steps) { this.recipe.steps = steps; return this; }
  inputs(inputs) { this.recipe.inputs = inputs; return this; }
  tips(tips) { this.recipe.tips = tips; return this; }
  tip(tip) { this.recipe.tips.push(tip); return this; }
  tags(tags) { this.recipe.tags = tags; return this; }
  tag(tag) { this.recipe.tags.push(tag); return this; }
  basePortions(n) { this.recipe.basePortions = n; return this; }

  build() {
    if (!this.recipe.id || !this.recipe.name || !this.recipe.outputName || this.recipe.steps.length === 0) {
      throw new Error("Recipe must have an id, name, outputName, and at least one step.");
    }
    return { ...this.recipe };
  }
}

export class Recipe {
  constructor(name, inputs = [], outputId = null, outputConfig = {}, steps = [], duration = 0, outputAmount = 1, tips = [], tags = [], ingredientMap = null) {
    this.name = name;
    this.inputs = inputs;
    if (typeof outputId === 'string') {
      const ingMap = ingredientMap;
      if (ingMap && !ingMap[outputId]) {
        const ingName = outputConfig.name || name;
        ingMap[outputId] = new Ingredient({ name: ingName, tags: ['recipe_output'] }, outputId);
      }
      this.outputIngredient = ingMap ? ingMap[outputId] : null;
    } else {
      this.outputIngredient = outputId;
    }
    this.steps = steps;
    this.duration = duration;
    this.outputAmount = outputAmount;
    this.tips = tips;
    this.tags = tags;
    this.basePortions = null;
    this.id = this.outputIngredient ? this.outputIngredient.id : null;
  }

  scaleRecipe(scaleFactor) {
    const scaledRecipe = new Recipe(
      this.name,
      this.inputs.map(input => ({
        ingredient: input.ingredient,
        amount: this.scaleAmount(input.amount, scaleFactor),
        unit: input.unit
      })),
      this.outputIngredient,
      {},
      this.steps,
      this.duration,
      this.outputAmount * scaleFactor,
      this.tips,
      this.tags
    );
    scaledRecipe.wait = this.wait;
    scaledRecipe.id = this.id;
    scaledRecipe.basePortions = this.basePortions;
    return scaledRecipe;
  }

  scaleAmount(amount, scaleFactor) {
    const scaled = amount * scaleFactor;
    if (Math.abs(scaled - 0.25) < 0.1) return 0.25;
    if (Math.abs(scaled - 0.5) < 0.1) return 0.5;
    if (Math.abs(scaled - 0.75) < 0.1) return 0.75;
    if (Math.abs(scaled - 1.5) < 0.1) return 1.5;
    if (Math.abs(scaled - 2.5) < 0.1) return 2.5;
    if (scaled < 1) return Math.round(scaled * 100) / 100;
    if (scaled < 10) return Math.round(scaled * 10) / 10;
    return Math.round(scaled);
  }

  /**
   * @param {object} data - JSON recipe node
   * @param {object} ingMap - mutable map of id -> Ingredient (base + recipe outputs)
   * @param {object} unitMap - id -> Unit
   * @param {object} [outputMap] - optional separate map for recipe outputs (kept out of pantry)
   */
  static fromJSON(data, ingMap, unitMap, outputMap = null) {
    const targetMap = outputMap || ingMap;
    if (!targetMap[data.id]) {
      const ingName = data.outputName || data.name;
      targetMap[data.id] = new Ingredient({ name: ingName, tags: ['recipe_output'] }, data.id);
    }
    // Ensure resolution map can look up this output (for steps/inputs)
    if (ingMap !== targetMap) {
      ingMap[data.id] = targetMap[data.id];
    } else if (!ingMap[data.id]) {
      ingMap[data.id] = targetMap[data.id];
    }

    const rec = new Recipe(data.name, [], ingMap[data.id], { name: data.outputName }, [], 0, 1, [], [], ingMap);
    rec.id = data.id;
    rec.duration = data.duration;
    rec.wait = data.wait || 0;
    rec.outputAmount = data.outputAmount != null ? data.outputAmount : 1;
    rec.basePortions = data.basePortions != null ? data.basePortions : null;
    rec.steps = data.steps.map(step => parseStepTemplate(step, ingMap));
    rec.inputs = data.inputs.map(i => {
      if (!ingMap[i.id]) {
        throw new Error(`Unknown input ingredient "${i.id}" in recipe "${data.id}"`);
      }
      if (!unitMap[i.unit]) {
        throw new Error(`Unknown unit "${i.unit}" in recipe "${data.id}"`);
      }
      return {
        ingredient: ingMap[i.id],
        amount: i.amount,
        unit: unitMap[i.unit],
      };
    });
    rec.tips = data.tips || [];
    rec.tags = data.tags || [];
    return rec;
  }

  hasTag(tag) {
    return this.tags && this.tags.includes(tag);
  }
}
