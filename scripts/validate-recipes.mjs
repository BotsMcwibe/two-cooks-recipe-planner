#!/usr/bin/env node
/**
 * Validate recipe JSON data for uniqueness, references, units, DAG, masters, basePortions,
 * and derived-ingredient usage (scripts/check-derived-usage.mjs: every dish-local node output
 * is consumed exactly 1 st in total; no orphans, dangling inputs, or placeholders outside a
 * node's inputs). Derived-usage warnings print but do not fail.
 *
 * Usage: node scripts/validate-recipes.mjs
 * Exit 0 on success, 1 on failure.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDerivedUsage, formatProblem } from './check-derived-usage.mjs';
import { checkEquipment, formatProblem as formatEqProblem } from './check-equipment.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');

const errors = [];
const warnings = [];

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadAll() {
  const units = readJSON(join(DATA, 'units.json'));
  const ingredientsFile = readJSON(join(DATA, 'ingredients.json'));
  const tags = ingredientsFile.tags || {};
  const ingredients = ingredientsFile.ingredients || ingredientsFile;
  const catalog = readJSON(join(DATA, 'catalog.json'));

  const prepDir = join(DATA, 'prep');
  const prepPacks = {};
  if (existsSync(prepDir)) {
    for (const f of readdirSync(prepDir).filter(x => x.endsWith('.json'))) {
      const pack = readJSON(join(prepDir, f));
      prepPacks[pack.id || f.replace(/\.json$/, '')] = pack;
    }
  }

  const recipesDir = join(DATA, 'recipes');
  const masters = {};
  for (const f of readdirSync(recipesDir).filter(x => x.endsWith('.json'))) {
    const data = readJSON(join(recipesDir, f));
    masters[data.masterId] = data;
  }

  return { units, tags, ingredients, catalog, prepPacks, masters };
}

function extractStepRefs(steps) {
  const ids = new Set();
  const re = /\{\{([^}]+)\}\}/g;
  for (const step of steps || []) {
    let m;
    while ((m = re.exec(step))) ids.add(m[1].trim());
  }
  return ids;
}

function checkAcyclic(nodesById) {
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  function dfs(id, path) {
    if (visiting.has(id)) {
      cycles.push([...path, id].join(' -> '));
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const node = nodesById.get(id);
    if (node) {
      for (const inp of node.inputs || []) {
        if (nodesById.has(inp.id)) dfs(inp.id, [...path, id]);
      }
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of nodesById.keys()) dfs(id, []);
  return cycles;
}

function main() {

  // source is an open site slug (not a closed hellofresh|ica enum).
  // createdAt is unix seconds, integer, not milliseconds.
  function checkSiteSource(value, label) {
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`${label}: source must be a non-empty string`);
    }
  }

  function checkCreatedAt(value, label) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      fail(`${label}: createdAt must be an integer unix timestamp in seconds`);
      return;
    }
    if (value < 1000000000 || value >= 10000000000) {
      fail(`${label}: createdAt must be unix seconds, not milliseconds (got ${value})`);
    }
  }

  const loaded = loadAll();
  const { units, ingredients, catalog, prepPacks, masters } = loaded;

  // --- Catalog ---
  const catalogIds = new Set();
  for (const entry of catalog) {
    if (!entry.id) fail('Catalog entry missing id');
    if (catalogIds.has(entry.id)) fail(`Duplicate catalog id: ${entry.id}`);
    catalogIds.add(entry.id);
    if (entry.basePortions == null || !(entry.basePortions > 0)) {
      fail(`Catalog ${entry.id}: missing/invalid basePortions`);
    }
    checkSiteSource(entry.source, `Catalog ${entry.id}`);
    checkCreatedAt(entry.createdAt, `Catalog ${entry.id}`);
    const masterForEntry = masters[entry.id];
    if (masterForEntry) {
      if (entry.source !== masterForEntry.source) {
        fail(`Catalog ${entry.id}: source "${entry.source}" != master source "${masterForEntry.source}"`);
      }
      if (entry.createdAt !== masterForEntry.createdAt) {
        fail(`Catalog ${entry.id}: createdAt ${entry.createdAt} != master createdAt ${masterForEntry.createdAt}`);
      }
    }
    if (!masters[entry.id]) {
      fail(`Catalog ${entry.id}: no matching recipes/${entry.id}.json`);
    }
  }

  for (const mid of Object.keys(masters)) {
    if (!catalogIds.has(mid)) {
      warn(`Master ${mid} exists on disk but is not in catalog.json`);
    }
  }

  // Global uniqueness of all recipe node ids (across prep + all masters)
  const globalIds = new Map(); // id -> source

  function registerNodes(nodes, source) {
    for (const n of nodes) {
      if (!n.id) {
        fail(`${source}: node missing id`);
        continue;
      }
      if (globalIds.has(n.id)) {
        // Shared prep nodes may appear in multiple masters' resolved graphs,
        // but on disk each id should be defined in exactly one place.
        fail(`Duplicate recipe id "${n.id}" in ${source} (also in ${globalIds.get(n.id)})`);
      } else {
        globalIds.set(n.id, source);
      }
    }
  }

  for (const [packId, pack] of Object.entries(prepPacks)) {
    registerNodes(pack.nodes || [], `prep/${packId}.json`);
  }

  // Build known resolve set: base ingredients + all recipe/prep ids we'll register
  // First register master local nodes, then validate refs against ingredients + all recipe ids.
  for (const [mid, data] of Object.entries(masters)) {
    registerNodes(data.nodes || [], `recipes/${mid}.json`);
  }

  // Validate each master in isolation (with its shared prep)
  for (const [mid, data] of Object.entries(masters)) {
    const source = `recipes/${mid}.json`;

    if (data.masterId !== mid) {
      fail(`${source}: masterId "${data.masterId}" != filename stem "${mid}"`);
    }
    if (data.basePortions == null || !(data.basePortions > 0)) {
      fail(`${source}: missing/invalid basePortions`);
    }
    checkSiteSource(data.source, source);
    checkCreatedAt(data.createdAt, source);

    const localIds = new Set((data.nodes || []).map(n => n.id));
    if (!localIds.has(mid)) {
      fail(`${source}: nodes must include master id "${mid}"`);
    }

    const masterNode = (data.nodes || []).find(n => n.id === mid);
    if (masterNode && !(masterNode.tags || []).includes('master')) {
      fail(`${source}: master node "${mid}" must have tag "master"`);
    }

    // Resolve shared prep
    const resolvedNodes = new Map();
    for (const packId of data.sharedPrep || []) {
      const pack = prepPacks[packId];
      if (!pack) {
        fail(`${source}: sharedPrep "${packId}" not found in data/prep/`);
        continue;
      }
      for (const n of pack.nodes || []) resolvedNodes.set(n.id, n);
    }
    for (const n of data.nodes || []) {
      if (resolvedNodes.has(n.id)) {
        fail(`${source}: local node "${n.id}" collides with shared prep id`);
      }
      resolvedNodes.set(n.id, n);
    }

    // Inputs / steps / units
    for (const n of resolvedNodes.values()) {
      for (const inp of n.inputs || []) {
        if (!units[inp.unit]) {
          fail(`${source}: node "${n.id}" uses unknown unit "${inp.unit}"`);
        }
        const known =
          ingredients[inp.id] ||
          resolvedNodes.has(inp.id);
        if (!known) {
          fail(`${source}: node "${n.id}" input "${inp.id}" does not resolve to ingredient or recipe`);
        }
      }
      for (const ref of extractStepRefs(n.steps)) {
        const known = ingredients[ref] || resolvedNodes.has(ref);
        if (!known) {
          fail(`${source}: node "${n.id}" step refs unknown "{{${ref}}}"`);
        }
      }
      if (!n.steps || n.steps.length === 0) {
        fail(`${source}: node "${n.id}" has no steps`);
      }
    }

    // DAG acyclic among recipe nodes only
    const cycles = checkAcyclic(resolvedNodes);
    for (const c of cycles) {
      fail(`${source}: cycle detected: ${c}`);
    }
  }

  // --- Derived-ingredient usage (sum-to-1-st rule; see scripts/check-derived-usage.mjs) ---
  const derived = checkDerivedUsage(loaded);
  for (const p of derived.problems) {
    if (p.level === 'error') fail(`derived-usage ${formatProblem(p)}`);
    else warn(`derived-usage ${formatProblem(p)}`);
  }

  // --- Equipment, heat & oven resources (see scripts/check-equipment.mjs) ---
  const eq = checkEquipment({ ...loaded, equipment: readJSON(join(DATA, 'equipment.json')) });
  for (const p of eq.problems) {
    if (p.level === 'error') fail(`equipment ${formatEqProblem(p)}`);
    else warn(`equipment ${formatEqProblem(p)}`);
  }

  // --- Optional images / nutrition / ratings (SCHEMA.md) ---
  const NUTRITION_KEYS = new Set([
    'energyKcal', 'energyKj', 'fatG', 'saturatedFatG',
    'carbsG', 'sugarsG', 'fiberG', 'proteinG', 'saltG',
  ]);

  function checkImagePath(value, label) {
    if (value == null) return;
    if (typeof value !== 'string' || !value.trim()) {
      fail(`${label}: image path must be a non-empty string or null`);
      return;
    }
    if (value.startsWith('data:') || value.length > 1024) {
      fail(`${label}: image must be a relative path (no data URLs / blobs)`);
    }
    if (value.startsWith('/') || /^[a-z]+:\/\//i.test(value)) {
      warn(`${label}: prefer path relative to app root (got "${value.slice(0, 60)}")`);
    }
  }

  function checkNutritionBlock(nutrition, source) {
    if (nutrition == null) return;
    if (typeof nutrition !== 'object' || Array.isArray(nutrition)) {
      fail(`${source}: nutrition must be an object`);
      return;
    }
    if (nutrition.basis != null && nutrition.basis !== 'per_portion' && nutrition.basis !== 'per_recipe') {
      fail(`${source}: nutrition.basis must be "per_portion" or "per_recipe"`);
    }
    if (nutrition.servingSizeGrams != null && typeof nutrition.servingSizeGrams !== 'number') {
      fail(`${source}: nutrition.servingSizeGrams must be a number`);
    }
    const pp = nutrition.perPortion;
    if (pp == null) {
      fail(`${source}: nutrition present but missing perPortion`);
      return;
    }
    if (typeof pp !== 'object' || Array.isArray(pp)) {
      fail(`${source}: nutrition.perPortion must be an object`);
      return;
    }
    for (const [k, v] of Object.entries(pp)) {
      if (typeof v !== 'number' || Number.isNaN(v)) {
        fail(`${source}: nutrition.perPortion.${k} must be a number`);
      }
      if (!NUTRITION_KEYS.has(k)) {
        warn(`${source}: nutrition.perPortion unknown key "${k}" (allowed: ${[...NUTRITION_KEYS].join(', ')})`);
      }
    }
    if (nutrition.perRecipe != null) {
      warn(`${source}: nutrition.perRecipe present — prefer computing from perPortion × basePortions in UI`);
    }
  }


  function checkRatingsBlock(ratings, source) {
    if (ratings == null) return;
    if (typeof ratings !== 'object' || Array.isArray(ratings)) {
      fail(`${source}: ratings must be an object`);
      return;
    }
    if (typeof ratings.average !== 'number' || Number.isNaN(ratings.average)) {
      fail(`${source}: ratings.average must be a number`);
    }
    if (ratings.count != null) {
      if (typeof ratings.count !== 'number' || Number.isNaN(ratings.count) || ratings.count < 0) {
        fail(`${source}: ratings.count must be a number ≥ 0`);
      }
    }
    if (ratings.source != null && typeof ratings.source !== 'string') {
      fail(`${source}: ratings.source must be a string`);
    }
  }

  for (const entry of catalog) {
    if ('image' in entry) checkImagePath(entry.image, `Catalog ${entry.id}.image`);
    if ('ratingAverage' in entry && entry.ratingAverage != null) {
      if (typeof entry.ratingAverage !== 'number' || Number.isNaN(entry.ratingAverage)) {
        fail(`Catalog ${entry.id}: ratingAverage must be a number`);
      }
    }
    if ('ratingCount' in entry && entry.ratingCount != null) {
      if (typeof entry.ratingCount !== 'number' || Number.isNaN(entry.ratingCount) || entry.ratingCount < 0) {
        fail(`Catalog ${entry.id}: ratingCount must be a number ≥ 0`);
      }
    }
  }

  for (const [mid, data] of Object.entries(masters)) {
    const source = `recipes/${mid}.json`;
    const localIds = new Set((data.nodes || []).map(n => n.id));
    // include shared prep ids for byNode key checks
    const knownNodeIds = new Set(localIds);
    for (const packId of data.sharedPrep || []) {
      const pack = prepPacks[packId];
      if (pack) for (const n of pack.nodes || []) knownNodeIds.add(n.id);
    }

    if (data.images != null) {
      if (typeof data.images !== 'object' || Array.isArray(data.images)) {
        fail(`${source}: images must be an object`);
      } else {
        if ('main' in data.images) checkImagePath(data.images.main, `${source} images.main`);
        const byNode = data.images.byNode;
        if (byNode != null) {
          if (typeof byNode !== 'object' || Array.isArray(byNode)) {
            fail(`${source}: images.byNode must be an object`);
          } else {
            for (const [nodeId, p] of Object.entries(byNode)) {
              checkImagePath(p, `${source} images.byNode[${nodeId}]`);
              if (!knownNodeIds.has(nodeId)) {
                warn(`${source}: images.byNode key "${nodeId}" is not a node in this master/sharedPrep`);
              }
            }
          }
        }
      }
    }

    checkNutritionBlock(data.nutrition, source);
    checkRatingsBlock(data.ratings, source);

    for (const n of data.nodes || []) {
      if ('image' in n) checkImagePath(n.image, `${source} node "${n.id}".image`);
    }
  }

  for (const [packId, pack] of Object.entries(prepPacks)) {
    for (const n of pack.nodes || []) {
      if ('image' in n) checkImagePath(n.image, `prep/${packId}.json node "${n.id}".image`);
    }
  }

  // chopped_onion collision specifically should be gone
  if (globalIds.has('chopped_onion')) {
    fail('Legacy id "chopped_onion" still present — use dish-local <masterId>__chopped_onion');
  }

  // Report
  for (const w of warnings) console.warn('WARN:', w);
  if (errors.length) {
    console.error(`\n${errors.length} error(s):`);
    for (const e of errors) console.error(' ERROR:', e);
    process.exit(1);
  }
  console.log(`OK — ${catalog.length} catalog masters, ${globalIds.size} unique recipe nodes, ${Object.keys(prepPacks).length} prep packs.`);
  process.exit(0);
}

main();
