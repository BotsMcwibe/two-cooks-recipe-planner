import { Unit } from '../models/unit.js';
import { Ingredient } from '../models/ingredient.js';
import { Recipe } from '../models/recipe.js';
import { RecipeGraph } from '../core/recipe-graph.js';

const DATA_BASE = new URL('../../data/', import.meta.url);

async function fetchJSON(relativePath) {
  const url = new URL(relativePath, DATA_BASE);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${relativePath}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Raw nutrition.perPortion.energyKcal from each master file.
 * Ids with no file or no numeric kcal are omitted (not stored as 0).
 * Does not build recipe graphs.
 * @param {string[]} ids
 * @returns {Promise<Map<string, number>>}
 */
export async function loadPortionEnergyKcal(ids) {
  const out = new Map();
  await Promise.all((ids || []).map(async (id) => {
    if (!id) return;
    try {
      const data = await fetchJSON(`recipes/${id}.json`);
      const k = data && data.nutrition && data.nutrition.perPortion
        ? data.nutrition.perPortion.energyKcal
        : undefined;
      if (typeof k === 'number' && Number.isFinite(k)) out.set(id, k);
    } catch {
      /* missing master or unreadable JSON */
    }
  }));
  return out;
}

/**
 * Loads units, base ingredients (pantry only), and catalog.
 * Does NOT load full recipe graphs.
 */
export async function loadStaticData() {
  const [unitsRaw, ingredientsRaw, catalog] = await Promise.all([
    fetchJSON('units.json'),
    fetchJSON('ingredients.json'),
    fetchJSON('catalog.json'),
  ]);

  const unitMap = {};
  for (const [abbr, cfg] of Object.entries(unitsRaw)) {
    unitMap[abbr] = new Unit(cfg.name, abbr, cfg.type, cfg.baseUnit, cfg.conversionFactor);
  }

  const ingredientTagsData = ingredientsRaw.tags || {};
  const baseIngredientMap = {};
  for (const [id, obj] of Object.entries(ingredientsRaw.ingredients || ingredientsRaw)) {
    if (id === 'tags') continue;
    baseIngredientMap[id] = new Ingredient(obj, id);
  }

  return { unitMap, baseIngredientMap, ingredientTagsData, catalog };
}

/**
 * Lazy-loading cache for master recipe graphs (+ shared prep deps).
 */
export class RecipeRepository {
  constructor(unitMap, baseIngredientMap) {
    this.unitMap = unitMap;
    this.baseIngredientMap = baseIngredientMap;
    /** @type {Map<string, { graph: RecipeGraph, root: import('../models/recipe.js').Recipe, basePortions: number, resolveMap: object, outputMap: object }>} */
    this.cache = new Map();
    /** @type {Map<string, object>} shared prep pack cache (raw JSON) */
    this.prepCache = new Map();
  }

  /**
   * Create a fresh resolve map: base pantry ingredients + recipe outputs for this load.
   * Base map is never mutated with recipe outputs for shopping/category listing.
   */
  _createResolveMaps() {
    const resolveMap = Object.create(null);
    for (const [id, ing] of Object.entries(this.baseIngredientMap)) {
      resolveMap[id] = ing;
    }
    const outputMap = Object.create(null);
    return { resolveMap, outputMap };
  }

  async _loadPrepPack(packId) {
    if (this.prepCache.has(packId)) return this.prepCache.get(packId);
    const data = await fetchJSON(`prep/${packId}.json`);
    this.prepCache.set(packId, data);
    return data;
  }

  /**
   * Load a master recipe and its local nodes + shared prep dependencies.
   * @returns {{ graph: RecipeGraph, root: Recipe, basePortions: number }}
   */
  async loadMaster(masterId) {
    if (this.cache.has(masterId)) return this.cache.get(masterId);

    const recipeData = await fetchJSON(`recipes/${masterId}.json`);
    const { resolveMap, outputMap } = this._createResolveMaps();

    const allNodes = [];

    // Shared prep packs first (so their outputs exist for local refs)
    for (const packId of recipeData.sharedPrep || []) {
      const pack = await this._loadPrepPack(packId);
      for (const node of pack.nodes || []) {
        allNodes.push(node);
      }
    }

    for (const node of recipeData.nodes || []) {
      allNodes.push(node);
    }

    // First pass: register all output ingredients so cross-refs in steps resolve
    for (const node of allNodes) {
      if (!resolveMap[node.id]) {
        const ingName = node.outputName || node.name;
        outputMap[node.id] = new Ingredient({ name: ingName, tags: ['recipe_output'] }, node.id);
        resolveMap[node.id] = outputMap[node.id];
      }
    }

    const recipes = [];
    for (const node of allNodes) {
      // Attach basePortions only on the master node
      const nodeData = node.id === recipeData.masterId
        ? { ...node, basePortions: recipeData.basePortions }
        : node;
      recipes.push(Recipe.fromJSON(nodeData, resolveMap, this.unitMap, outputMap));
    }

    const graph = new RecipeGraph(recipes);
    const root = graph.get(recipeData.masterId);
    if (!root) {
      throw new Error(`Master recipe "${recipeData.masterId}" not found in loaded nodes`);
    }
    root.basePortions = recipeData.basePortions || 4;

    const result = {
      graph,
      root,
      basePortions: recipeData.basePortions || 4,
      resolveMap,
      outputMap,
      masterId: recipeData.masterId,
      images: recipeData.images || null,
      nutrition: recipeData.nutrition || null,
    };
    this.cache.set(masterId, result);
    return result;
  }

  /** Clear a single master from cache (e.g. after hot-reload). */
  invalidate(masterId) {
    this.cache.delete(masterId);
  }
}
