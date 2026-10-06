#!/usr/bin/env node
/**
 * Map HelloFresh scraped ingredient PNGs onto app pantry ingredients by
 * normalized Swedish name, copy into assets/ingredients/<id>.png, and
 * set optional `image` on ingredients.json entries.
 *
 * Matching: casefold (sv), strip "(steg N)", collapse whitespace — against
 * ingredients[id].name. Prefer converted hfIds from pipeline-state.json, then
 * scan more raw files to fill gaps. Copies local scrape only (no CDN).
 *
 * Usage: node scripts/backfill-ingredient-images.mjs
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '..');
const DATA = join(APP, 'data');
const OUT_DIR = join(APP, 'assets', 'ingredients');
const RAW_DIR = '/workspace/recipes/raw';
const IMG_ROOT = '/workspace/recipes/images';
const PIPELINE = '/workspace/recipes/conversion-queue/pipeline-state.json';

/** Prefer converted HF ids first, then scan more raw files to fill gaps. */
const EXTRA_RAW_LIMIT = 800;

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** casefold, strip (steg N), collapse whitespace */
function normalizeName(name) {
  return String(name || '')
    .toLocaleLowerCase('sv')
    .replace(/\(steg\s*\d+\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractIngredientIdFromUrl(url) {
  const m = String(url || '').match(/\/ingredient\/([a-f0-9]+)-/i);
  return m ? m[1] : null;
}

/**
 * From one raw HF recipe, map normalizedName -> relative file under images/.
 * Resolve local file via ingredient id in image URL, else slug label.
 */
function collectFromRaw(raw, into) {
  const images = raw?.images || [];
  const idToFile = new Map();
  const labelToFile = new Map();

  for (const img of images) {
    const file = img?.file;
    if (!file || !String(file).startsWith('ingredients/')) continue;
    if (!existsSync(join(IMG_ROOT, file))) continue;

    const hfIngId = extractIngredientIdFromUrl(img.url);
    if (hfIngId) idToFile.set(hfIngId, file);

    const label = String(img.label || '');
    if (label) labelToFile.set(label, file);
  }

  for (const hing of raw?.recipe?.ingredients || []) {
    const name = hing?.name;
    if (!name) continue;
    const key = normalizeName(name);
    if (!key) continue;

    let file = hing.id ? idToFile.get(hing.id) : null;
    if (!file) {
      const slug = hing.slug || '';
      file =
        labelToFile.get(`ing_${slug}`) ||
        labelToFile.get(`ing-${slug}`) ||
        null;
    }
    if (!file) continue;
    if (!existsSync(join(IMG_ROOT, file))) continue;

    if (!into.has(key)) into.set(key, file);
  }
}

function orderedRawPaths() {
  const paths = [];
  const seen = new Set();

  if (existsSync(PIPELINE)) {
    const state = readJSON(PIPELINE);
    for (const c of state.converted || []) {
      const hfId = c.hfId;
      if (!hfId || seen.has(hfId)) continue;
      const p = join(RAW_DIR, `${hfId}.json`);
      if (existsSync(p)) {
        paths.push(p);
        seen.add(hfId);
      }
    }
  }

  const extras = readdirSync(RAW_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  let added = 0;
  for (const f of extras) {
    const hfId = f.replace(/\.json$/, '');
    if (seen.has(hfId)) continue;
    paths.push(join(RAW_DIR, f));
    seen.add(hfId);
    added++;
    if (added >= EXTRA_RAW_LIMIT) break;
  }
  return paths;
}

function main() {
  const ingredientsFile = readJSON(join(DATA, 'ingredients.json'));
  const ingredients = ingredientsFile.ingredients || {};

  const hfNameToFile = new Map();
  const rawPaths = orderedRawPaths();
  for (const p of rawPaths) {
    let raw;
    try {
      raw = readJSON(p);
    } catch {
      continue;
    }
    collectFromRaw(raw, hfNameToFile);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const matched = [];
  const unmatched = [];

  // Optional manual aliases: scripts/ingredient-image-aliases.json
  const aliasFile = join(APP, 'scripts', 'ingredient-image-aliases.json');
  let aliases = {};
  if (existsSync(aliasFile)) {
    try {
      const aliasDoc = readJSON(aliasFile);
      aliases = aliasDoc.aliases || aliasDoc;
    } catch {
      aliases = {};
    }
  }

  const aliased = [];

  for (const [id, obj] of Object.entries(ingredients)) {
    const key = normalizeName(obj.name);
    const file = hfNameToFile.get(key);
    if (file) {
      const destRel = `assets/ingredients/${id}.png`;
      const destAbs = join(APP, destRel);
      copyFileSync(join(IMG_ROOT, file), destAbs);
      obj.image = destRel;
      matched.push({ id, name: obj.name, from: file });
      continue;
    }

    // Alias map (id -> relative path under /workspace/recipes/images)
    const aliasSrc = aliases[id];
    if (aliasSrc && existsSync(join(IMG_ROOT, aliasSrc))) {
      const destRel = `assets/ingredients/${id}.png`;
      const destAbs = join(APP, destRel);
      copyFileSync(join(IMG_ROOT, aliasSrc), destAbs);
      obj.image = destRel;
      aliased.push({ id, name: obj.name, from: aliasSrc });
      matched.push({ id, name: obj.name, from: `alias:${aliasSrc}` });
      continue;
    }

    // Keep pre-existing local image if file still exists (e.g. generated yeast)
    if (obj.image) {
      const abs = join(APP, obj.image);
      if (existsSync(abs)) {
        matched.push({ id, name: obj.name, from: `existing:${obj.image}` });
        continue;
      }
      delete obj.image;
    } else {
      // Auto-wire if assets/ingredients/<id>.png already on disk
      const destRel = `assets/ingredients/${id}.png`;
      const destAbs = join(APP, destRel);
      if (existsSync(destAbs)) {
        obj.image = destRel;
        matched.push({ id, name: obj.name, from: `existing:${destRel}` });
        continue;
      }
    }
    unmatched.push({ id, name: obj.name });
  }

  // Do not strip image from unmatched that somehow still have a valid file
  for (const u of unmatched) {
    const obj = ingredients[u.id];
    if (!obj?.image) continue;
    const abs = join(APP, obj.image);
    if (!existsSync(abs)) delete obj.image;
  }

  writeFileSync(
    join(DATA, 'ingredients.json'),
    JSON.stringify(ingredientsFile, null, 2) + '\n',
    'utf8'
  );

  const report = {
    rawScanned: rawPaths.length,
    hfNamesWithFiles: hfNameToFile.size,
    matched: matched.length,
    aliased: aliased.length,
    unmatched: unmatched.length,
    unmatchedNames: unmatched
      .map((u) => u.name)
      .sort((a, b) => a.localeCompare(b, 'sv')),
    unmatchedIds: unmatched.map((u) => u.id),
    matchedIds: matched.map((m) => m.id),
    aliasedIds: aliased.map((a) => a.id),
  };

  writeFileSync(
    join(APP, 'scripts', 'backfill-ingredient-images.report.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8'
  );

  console.log(`Scanned ${report.rawScanned} raw recipes`);
  console.log(`HF names with local PNGs: ${report.hfNamesWithFiles}`);
  console.log(`Matched & copied: ${report.matched} → ${OUT_DIR}`);
  console.log(`Via alias map: ${report.aliased}`);
  console.log(`Unmatched: ${report.unmatched}`);
  if (report.unmatchedNames.length) {
    console.log('Unmatched names:');
    for (const n of report.unmatchedNames) console.log(`  - ${n}`);
  }
}

main();
