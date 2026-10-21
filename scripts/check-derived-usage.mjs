#!/usr/bin/env node
/**
 * Check recipe graphs for misuse of derived ingredients (node outputs used as inputs).
 *
 * THE RULE: every dish-local derived ingredient is consumed exactly once IN TOTAL.
 * Either one consumer takes 1 st, or consumers split it with st amounts summing to 1
 * (e.g. 0.7 st + 0.3 st). Anything else makes scaled amounts wrong.
 * See /workspace/recipes/docs/hf-to-graph-conversion.md §4.2.
 *
 * Errors (exit 1):
 *   sum             a dish-local node's output is consumed with a total ≠ 1 st (tolerance 0.01)
 *   derived-unit    a derived input (node output) uses a unit other than st
 *   no-use          a dish-local node (not the master) is not an input to any node (orphan)
 *   master-used     the master node is used as an input
 *   dangling        an input id is not a node in this recipe, not a sharedPrep output,
 *                   and not a pantry ingredient (ingredients.json)
 *   placeholder     a {{ref}} in a node's steps that is not one of that node's inputs
 *
 * Warnings (exit 0 if only warnings):
 *   shared-multi-use     a sharedPrep output is used by 2+ nodes in this recipe
 *   equipment-multi-use  a dish-local node with no inputs (not a resource) is used by 2+ nodes
 *
 * Resources (nodes tagged "resource", e.g. preheated ovens) are NOT derived ingredients: they are
 * excluded from the sum rule and from the multi-use warnings. They must be referenced through
 * node.equipment[].after (see check-equipment.mjs); a resource with no such reference is "no-use".
 *   shared-unused        a sharedPrep pack is listed but no local node uses its output
 *   unmentioned-input    an input is never referenced as {{id}} in that node's steps
 *   duplicate-input      the same input id is listed twice in one node
 *   long-node            a local node has 5+ steps; split at a natural break if it makes sense (§4.3)
 *
 * Each consumer in a sum error gets a triage hint from its step text:
 *   [silent]  never mentions {{id}} in its steps (edge with no text; most suspicious)
 *   [timing]  mentioned only as a timer / same-pan anchor ("när det återstår", "samma stekpanna")
 *   [split]   takes part of it ("från", "hälften av", "resten av", "resterande")
 *   [whole]   mentioned with none of the above
 *
 * Usage:
 *   node scripts/check-derived-usage.mjs                    all recipes
 *   node scripts/check-derived-usage.mjs norska_kottbullar  one or more masterIds
 *   node scripts/check-derived-usage.mjs --json             machine-readable output
 *   node scripts/check-derived-usage.mjs --errors-only      hide warnings in text output
 *
 * Also imported by scripts/validate-recipes.mjs (checkDerivedUsage).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');

export const SUM_TOLERANCE = 0.01;
export const ERROR_TYPES = ['sum', 'derived-unit', 'no-use', 'master-used', 'dangling', 'placeholder'];
export const WARNING_TYPES = ['shared-multi-use', 'equipment-multi-use', 'shared-unused', 'unmentioned-input', 'duplicate-input', 'long-node'];
export const MAX_NODE_STEPS = 4;

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadAll() {
  const ingredientsFile = readJSON(join(DATA, 'ingredients.json'));
  const ingredients = ingredientsFile.ingredients || ingredientsFile;

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
    masters[data.masterId || f.replace(/\.json$/, '')] = data;
  }

  return { ingredients, prepPacks, masters };
}

function extractStepRefs(steps) {
  const ids = new Set();
  const re = /\{\{([^}]+)\}\}/g;
  for (const step of steps || []) {
    let m;
    while ((m = re.exec(step))) if (!m[1].trim().startsWith('eq:')) ids.add(m[1].trim()); // {{eq:…}} = equipment (check-equipment.mjs)
  }
  return ids;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Classify how a consumer node's steps use a derived input (triage hint only). */
function usageHint(consumer, id) {
  const ref = `{{${id}}}`;
  const lines = (consumer.steps || []).filter(s => s.includes(ref));
  if (!lines.length) return 'silent';
  const r = escapeRe(ref);
  const timing = new RegExp(
    `(återstår|kvar)[^.]*${r}|${r}[^.]*(återstår|är avlyft)|samma (stek)?(panna|kastrull|gryta)[^.]*${r}|` +
    `(stekpannan|kastrullen|pannan) (från|som|efter) ${r}|efter ${r}|när ${r} är`, 'i');
  const split = new RegExp(`(från|ur|i) ${r}|(hälften|resten|resterande|merparten|lite) (av )?${r}`, 'i');
  if (lines.every(l => timing.test(l))) return 'timing';
  if (lines.some(l => split.test(l))) return 'split';
  return 'whole';
}

const fmtAmt = n => String(Math.round(n * 1000) / 1000);

function buildGlobalIndex(prepPacks, masters) {
  const prepNodeToPack = new Map();
  for (const [packId, pack] of Object.entries(prepPacks)) {
    for (const n of pack.nodes || []) prepNodeToPack.set(n.id, packId);
  }
  const localNodeToMaster = new Map();
  for (const [mid, data] of Object.entries(masters)) {
    for (const n of data.nodes || []) localNodeToMaster.set(n.id, mid);
  }
  return { prepNodeToPack, localNodeToMaster };
}

function checkRecipe(mid, data, ctx) {
  const { ingredients, prepPacks, prepNodeToPack, localNodeToMaster } = ctx;
  const problems = [];
  const add = (level, type, node, message, extra = {}) =>
    problems.push({ recipe: mid, level, type, node, message, ...extra });

  const localNodes = data.nodes || [];
  const localIds = new Set(localNodes.map(n => n.id));

  const sharedNodes = new Map(); // id -> packId
  const sharedById = new Map();
  for (const packId of data.sharedPrep || []) {
    const pack = prepPacks[packId];
    if (!pack) continue; // validate-recipes.mjs reports missing packs
    for (const n of pack.nodes || []) {
      sharedNodes.set(n.id, packId);
      sharedById.set(n.id, n);
    }
  }

  const resolved = [...sharedById.values(), ...localNodes.filter(n => !sharedById.has(n.id))];
  const byId = new Map(resolved.map(x => [x.id, x]));

  for (const n of localNodes) {
    const k = (n.steps || []).length;
    if (k > MAX_NODE_STEPS) add('warning', 'long-node', n.id, `${k} steps (max ${MAX_NODE_STEPS}); split at a natural break if it makes sense (§4.3)`);
  }

  // uses: input id -> [{ consumer, amount, unit }] (every input entry, duplicates included)
  const uses = new Map();
  for (const n of resolved) {
    const seen = new Set();
    for (const inp of n.inputs || []) {
      if (!inp || !inp.id) continue;
      if (seen.has(inp.id)) add('warning', 'duplicate-input', n.id, `input "${inp.id}" listed more than once`);
      seen.add(inp.id);
      if (!uses.has(inp.id)) uses.set(inp.id, []);
      uses.get(inp.id).push({ consumer: n.id, amount: inp.amount, unit: inp.unit });
    }
  }

  const isMaster = n => n.id === mid || (n.tags || []).includes('master');
  const isResource = n => (n.tags || []).includes('resource');
  const afterRefs = new Set();
  for (const n of resolved) for (const e of n.equipment || []) for (const a of [].concat(e.after ?? [])) afterRefs.add(a);

  // Dish-local derived ingredients: sum-to-1-st rule
  for (const n of localNodes) {
    if (sharedById.has(n.id)) continue;
    if (isResource(n)) {
      if (!afterRefs.has(n.id)) add('error', 'no-use', n.id, 'resource is not referenced by any node equipment[].after', { consumers: [] });
      continue; // never an ingredient: no sum rule, no multi-use warning (inputs use is an error in check-equipment)
    }
    const list = uses.get(n.id) || [];
    const consumers = [...new Set(list.map(u => u.consumer))];
    if (isMaster(n)) {
      if (list.length) add('error', 'master-used', n.id, `master node is used as an input by: ${consumers.join(', ')}`);
      continue;
    }
    if (!list.length) {
      add('error', 'no-use', n.id, 'output is not an input to any node (orphan)', { consumers: [] });
      continue;
    }
    const equipment = !(n.inputs || []).length;
    for (const u of list) {
      if (u.unit !== 'st') {
        add('error', 'derived-unit', u.consumer,
          `derived input "${n.id}" uses unit "${u.unit}" (must be st)`, { input: n.id, unit: u.unit });
      }
    }
    if (equipment) {
      if (consumers.length >= 2) {
        add('warning', 'equipment-multi-use', n.id,
          `no-input node used by ${consumers.length} nodes: ${consumers.join(', ')}`, { consumers });
      }
      continue;
    }
    const total = list.reduce((s, u) => s + (typeof u.amount === 'number' ? u.amount : NaN), 0);
    if (!(Math.abs(total - 1) <= SUM_TOLERANCE)) {
      const parts = list.map(u => `${u.consumer} ${u.amount} ${u.unit} [${usageHint(byId.get(u.consumer), n.id)}]`);
      add('error', 'sum', n.id, `consumed ${Number.isNaN(total) ? 'NaN' : fmtAmt(total)} st in total (must be 1): ${parts.join(', ')}`,
        { total, consumers, uses: list });
    }
  }

  // Shared prep: exempt from the sum rule, multi-use is a warning
  const usedPacks = new Set();
  for (const [id, packId] of sharedNodes) {
    const consumers = [...new Set((uses.get(id) || []).map(u => u.consumer))];
    if (consumers.some(c => !sharedNodes.has(c)) || afterRefs.has(id)) usedPacks.add(packId);
    if (isResource(sharedById.get(id))) continue;
    if (consumers.length >= 2) {
      add('warning', 'shared-multi-use', id,
        `shared prep (${packId}) used by ${consumers.length} nodes: ${consumers.join(', ')}`, { consumers, pack: packId });
    }
  }
  for (const packId of data.sharedPrep || []) {
    if (prepPacks[packId] && !usedPacks.has(packId)) {
      add('warning', 'shared-unused', null, `sharedPrep "${packId}" is listed but no local node uses its output`, { pack: packId });
    }
  }

  // Dangling inputs and placeholder mismatches (local nodes; packs are checked on their own)
  const knownHere = id => localIds.has(id) || sharedNodes.has(id) || Boolean(ingredients[id]);
  for (const n of localNodes) {
    if (sharedById.has(n.id)) continue;
    const inputIds = new Set((n.inputs || []).filter(i => i && i.id).map(i => i.id));
    for (const id of inputIds) {
      if (knownHere(id)) continue;
      let why = 'not a node in this recipe, not a sharedPrep output, not a pantry ingredient';
      if (prepNodeToPack.has(id)) why = `prep pack "${prepNodeToPack.get(id)}" output, but pack is not in sharedPrep`;
      else if (localNodeToMaster.has(id)) why = `local node of another recipe ("${localNodeToMaster.get(id)}")`;
      add('error', 'dangling', n.id, `input "${id}": ${why}`, { input: id });
    }
    const refs = extractStepRefs(n.steps);
    for (const ref of refs) {
      if (!inputIds.has(ref)) {
        add('error', 'placeholder', n.id,
          `step placeholder "{{${ref}}}" is not one of this node's inputs` + (knownHere(ref) ? '' : ' (and resolves to nothing)'),
          { ref });
      }
    }
    for (const id of inputIds) {
      if (!refs.has(id)) {
        add('warning', 'unmentioned-input', n.id, `input "${id}" is never referenced as {{${id}}} in its steps`, { input: id });
      }
    }
  }

  return problems;
}

/**
 * Run the derived-usage check. `loaded` = { ingredients, prepPacks, masters } (as loaded by
 * validate-recipes.mjs); omitted → load from data/. Returns { byRecipe, problems, summary }.
 */
export function checkDerivedUsage(loaded, ids) {
  const { ingredients, prepPacks, masters } = loaded || loadAll();
  const { prepNodeToPack, localNodeToMaster } = buildGlobalIndex(prepPacks, masters);
  const ctx = { ingredients, prepPacks, prepNodeToPack, localNodeToMaster };
  const targets = ids && ids.length ? ids : Object.keys(masters).sort();

  const byRecipe = {};
  for (const mid of targets) byRecipe[mid] = checkRecipe(mid, masters[mid], ctx);

  const problems = Object.values(byRecipe).flat();
  const errors = problems.filter(p => p.level === 'error');
  const warnings = problems.filter(p => p.level === 'warning');
  const countBy = (list, types) => Object.fromEntries(types.map(t => [t, list.filter(p => p.type === t).length]));
  const summary = {
    recipesChecked: targets.length,
    recipesWithErrors: Object.values(byRecipe).filter(ps => ps.some(p => p.level === 'error')).length,
    recipesClean: Object.values(byRecipe).filter(ps => ps.length === 0).length,
    errors: errors.length,
    warnings: warnings.length,
    errorsByType: countBy(errors, ERROR_TYPES),
    warningsByType: countBy(warnings, WARNING_TYPES),
  };
  return { byRecipe, problems, summary };
}

export function formatProblem(p) {
  return `${p.recipe}: ${p.type} ${p.node ? p.node + ': ' : ''}${p.message}`;
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const errorsOnly = argv.includes('--errors-only');
  const ids = argv.filter(a => !a.startsWith('--'));

  const loaded = loadAll();
  const unknown = ids.filter(id => !loaded.masters[id]);
  if (unknown.length) {
    console.error(`Unknown masterId(s): ${unknown.join(', ')}`);
    process.exit(2);
  }

  const { byRecipe, problems, summary } = checkDerivedUsage(loaded, ids);

  if (asJson) {
    console.log(JSON.stringify({ summary, problems }, null, 2));
  } else {
    for (const [mid, list] of Object.entries(byRecipe)) {
      const ps = list.filter(p => !errorsOnly || p.level === 'error');
      if (!ps.length) continue;
      console.log(mid);
      ps.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
      for (const p of ps) {
        const tag = p.level === 'error' ? 'ERROR' : 'WARN ';
        console.log(`  ${tag} ${p.type.padEnd(19)} ${p.node ? p.node + ': ' : ''}${p.message}`);
      }
    }
    const fmt = o => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    console.log('');
    console.log(`Checked ${summary.recipesChecked} recipe(s): ${summary.recipesWithErrors} with errors, ${summary.recipesClean} fully clean.`);
    console.log(`Errors: ${summary.errors} (${fmt(summary.errorsByType)})`);
    console.log(`Warnings: ${summary.warnings} (${fmt(summary.warningsByType)})${errorsOnly && summary.warnings ? ' [hidden by --errors-only]' : ''}`);
  }

  process.exit(summary.errors ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
