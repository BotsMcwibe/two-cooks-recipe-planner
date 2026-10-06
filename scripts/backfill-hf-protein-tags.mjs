#!/usr/bin/env node
/**
 * Backfill catalog hfTags (from HF raw) + protein:* tags (from graph ingredients).
 * Usage: node scripts/backfill-hf-protein-tags.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '..');
const DATA = join(APP, 'data');
const RAW = '/workspace/recipes/raw';
const PIPELINE = '/workspace/recipes/conversion-queue/pipeline-state.json';

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function slugifyName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractHfTagSlugs(raw) {
  const tags = raw?.recipe?.tags || [];
  const out = [];
  const seen = new Set();
  for (const t of tags) {
    const slug =
      (t.slug && String(t.slug).trim()) ||
      (t.type && String(t.type).trim()) ||
      slugifyName(t.name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/** Animal protein families (not vegetarian). */
const FAMILIES = ['chicken', 'turkey', 'pork', 'beef', 'lamb', 'shrimp', 'fish'];

/**
 * Classify a pantry ingredient into a protein family, or null.
 * Ignores stocks/bouillon/broth flavorings.
 */
function classifyIngredient(id, ing) {
  const name = (ing?.name || '').toLowerCase();
  const text = `${id} ${name}`.toLowerCase();

  // Flavorings / stocks — not main proteins
  if (
    /bouillon|buljong|stock|broth|fond\b|fish.?sauce|sojasås|soy.?sauce/.test(text) ||
    /bouillon|buljong|stock|broth/.test(id)
  ) {
    return null;
  }

  // Must look like animal protein (pantry meat/fish/processed_meat OR clear name)
  const tags = ing?.tags || [];
  const pantryAnimal =
    tags.includes('meat') ||
    tags.includes('fish') ||
    tags.includes('processed_meat') ||
    tags.includes('seafood');

  // Explicit family matchers (order matters for specificity)
  // turkey before chicken
  if (/\bturkey\b|kalkon/.test(text)) return 'turkey';
  if (/\bchicken\b|kyckling/.test(text)) return 'chicken';

  // shrimp before fish
  if (/\bshrimp\b|räkor|rakor|prawn|scampi/.test(text)) return 'shrimp';

  // fish (not shrimp)
  if (
    tags.includes('fish') ||
    tags.includes('seafood') ||
    /\bfish\b|\bfisk\b|lax|salmon|torsk|cod\b|tonfisk|tuna|ansjovis|anchovy|makrill|mackerel|sej\b|kolja|haddock|öring|trout|forell/.test(
      text
    )
  ) {
    // seafood shellfish other than shrimp → still fish family for filter simplicity? prefer fish
    if (/\bkrabba\b|crab|mussla|mussel|blåmussl|scampi/.test(text) && !/\bshrimp\b|räkor|rakor|prawn/.test(text)) {
      // crab/mussels → fish (no dedicated tag)
      return 'fish';
    }
    if (/\bshrimp\b|räkor|rakor|prawn/.test(text)) return 'shrimp';
    return 'fish';
  }

  if (/\blamb\b|lamm/.test(text)) return 'lamb';

  // pork
  if (
    /\bpork\b|fläsk|flask|bacon|skinka|\bham\b|prosciutto|pancetta|kassler|chorizo|salami|pepperoni|korv|sausage|ribs\b|karr[eé]|kotlett/.test(
      text
    )
  ) {
    return 'pork';
  }

  // beef — careful with "nöt" (nuts = nötter/nötter)
  if (
    /\bbeef\b|oxe|oxkött|oxkott|rump|entrecote|entrecôte|cowboy|högrev|hogrev|oxfil[eé]|nötfärs|notfars|nötkött|notkott|köttfärs|kottfars|ground_beef|sirloin|brisket/.test(
      text
    ) ||
    (/\bnöt/.test(text) && !/nötter|notter|hasselnöt|valnöt|pinjenöt|cashew|jordnöt|pistage|mandel/.test(text))
  ) {
    return 'beef';
  }

  // blandfärs / mixed mince → special sentinel handled by caller
  if (/mixed_mince|blandfärs|blandfars|blandfars/.test(text)) {
    return 'mixed_mince';
  }

  // Generic meat tag without specific family
  if (pantryAnimal && tags.includes('meat')) {
    // last-resort: kött without specificity
    if (/\bkött\b|\bkott\b|meat/.test(text)) return 'beef'; // Swedish "köttfärs" often beef; flag later
  }

  return null;
}

function collectBaseIngredientIds(master, ingredients, prepPacks) {
  const nodeIds = new Set();
  const packs = master.sharedPrep || [];
  for (const packId of packs) {
    const pack = prepPacks[packId];
    if (!pack) continue;
    for (const n of pack.nodes || []) nodeIds.add(n.id);
  }
  for (const n of master.nodes || []) nodeIds.add(n.id);

  const baseIds = new Set();
  const allNodes = [...(master.nodes || [])];
  for (const packId of packs) {
    const pack = prepPacks[packId];
    if (pack) allNodes.push(...(pack.nodes || []));
  }
  for (const n of allNodes) {
    for (const inp of n.inputs || []) {
      if (!nodeIds.has(inp.id) && ingredients[inp.id]) {
        baseIds.add(inp.id);
      }
    }
  }
  return baseIds;
}

function deriveProteinTags(master, ingredients, prepPacks) {
  const baseIds = collectBaseIngredientIds(master, ingredients, prepPacks);
  const families = new Set();
  const matched = [];

  for (const id of baseIds) {
    const ing = ingredients[id];
    const fam = classifyIngredient(id, ing);
    if (!fam) continue;
    if (fam === 'mixed_mince') {
      families.add('beef');
      families.add('pork');
      matched.push({ id, family: 'mixed_mince' });
      continue;
    }
    families.add(fam);
    matched.push({ id, family: fam });
  }

  const animal = FAMILIES.filter((f) => families.has(f));
  const tags = [];
  if (animal.length === 0) {
    tags.push('protein:vegetarian');
  } else {
    for (const f of animal) tags.push(`protein:${f}`);
    if (animal.length >= 2) tags.push('protein:mixed');
  }
  return { tags, matched, animal };
}

function stripProteinTags(tags) {
  return (tags || []).filter((t) => !String(t).startsWith('protein:'));
}

function main() {
  const catalog = readJSON(join(DATA, 'catalog.json'));
  const ingredientsFile = readJSON(join(DATA, 'ingredients.json'));
  const ingredients = ingredientsFile.ingredients || ingredientsFile;
  const pipeline = readJSON(PIPELINE);

  const prepDir = join(DATA, 'prep');
  const prepPacks = {};
  for (const f of readdirSync(prepDir).filter((x) => x.endsWith('.json'))) {
    const pack = readJSON(join(prepDir, f));
    prepPacks[pack.id || f.replace(/\.json$/, '')] = pack;
  }

  const masters = {};
  const recipesDir = join(DATA, 'recipes');
  for (const f of readdirSync(recipesDir).filter((x) => x.endsWith('.json'))) {
    const data = readJSON(join(recipesDir, f));
    masters[data.masterId] = data;
  }

  // hfId map from pipeline + discover bbq_lax_ranch raw by name match
  const masterToHf = new Map();
  for (const c of pipeline.converted || []) {
    if (c.hfId && c.masterId) masterToHf.set(c.masterId, c.hfId);
  }
  // Known extra HF link not in pipeline converted list
  if (!masterToHf.has('bbq_lax_ranch') && existsSync(join(RAW, '6655aaded9c97d64003b1def.json'))) {
    masterToHf.set('bbq_lax_ranch', '6655aaded9c97d64003b1def');
  }

  const ambiguous = [];
  const proteinDist = {};
  let withHfTags = 0;
  let withHfTagsNonEmpty = 0;
  let proteinUpdated = 0;

  for (const entry of catalog) {
    const master = masters[entry.id];
    if (!master) {
      console.warn('WARN: catalog entry without master file', entry.id);
      continue;
    }

    // hfTags
    const hfId = masterToHf.get(entry.id);
    if (hfId) {
      const rawPath = join(RAW, `${hfId}.json`);
      if (existsSync(rawPath)) {
        const raw = readJSON(rawPath);
        entry.hfTags = extractHfTagSlugs(raw);
      } else {
        entry.hfTags = [];
        ambiguous.push({ id: entry.id, reason: `hfId ${hfId} raw missing` });
      }
    } else {
      // non-HF originals: omit hfTags or empty — use [] for consistency with schema "empty OK"
      entry.hfTags = [];
    }
    withHfTags++;
    if (entry.hfTags.length) withHfTagsNonEmpty++;

    // protein tags
    const { tags: proteinTags, matched, animal } = deriveProteinTags(
      master,
      ingredients,
      prepPacks
    );

    // Ambiguity heuristics
    if (matched.some((m) => m.family === 'mixed_mince')) {
      ambiguous.push({
        id: entry.id,
        reason: 'blandfärs/mixed_mince treated as beef+pork → protein:mixed',
        matched,
      });
    }
    if (animal.includes('beef') && animal.includes('pork') && !matched.some((m) => m.family === 'mixed_mince')) {
      ambiguous.push({
        id: entry.id,
        reason: 'multiple distinct animal proteins → protein:mixed',
        matched,
      });
    }
    // bacon-only as garnish alongside steak is intentional mixed

    const baseTags = stripProteinTags(entry.tags || []);
    // Keep order: existing curated tags first, then protein tags (stable)
    entry.tags = [...baseTags, ...proteinTags];
    proteinUpdated++;

    for (const t of proteinTags) {
      proteinDist[t] = (proteinDist[t] || 0) + 1;
    }
  }

  writeFileSync(join(DATA, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');

  const report = {
    catalogEntries: catalog.length,
    withHfTagsField: withHfTags,
    withNonEmptyHfTags: withHfTagsNonEmpty,
    hfLinked: masterToHf.size,
    proteinUpdated,
    proteinDist,
    ambiguous,
  };
  console.log(JSON.stringify(report, null, 2));
}

main();
