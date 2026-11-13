#!/usr/bin/env node
/**
 * Builds js/data/pantry-staples.js: the ranked "Föreslagna basvaror" for #skafferi.
 *
 * Sources (raw scrapes, outside the repo):
 *   - Linas Matkasse  <recipes>/linas-raw/linas-*.json   ingredients[].isBasis === true
 *   - HelloFresh SE   <recipes>/raw/*.json               ingredients[].shipped === false ("ingår ej i lådan",
 *                                                         e.g. "Salt till sås", "Olivolja (steg 3)")
 *   - Our own recipes data/recipes/*.json (only for the second tier, "Fler vanliga").
 *
 * Counting is per recipe (an ingredient counts once per recipe). Raw names are
 * normalised ("Salt till sås" -> "salt", "Olivolja (steg 3)" -> "olivolja") and
 * mapped to data/ingredients.json ids with NAME_MAP below. Anything unmapped is
 * printed (and written to the module's UNMAPPED list) instead of being added to
 * ingredients.json.
 *
 * Usage: node scripts/build-pantry-staples.mjs [--recipes /workspace/recipes]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argi = process.argv.indexOf('--recipes');
const RAW = argi > 0 ? process.argv[argi + 1] : '/workspace/recipes';
const OUT = path.join(ROOT, 'js/data/pantry-staples.js');

/** Normalised raw name -> ingredient id(s). null = deliberately not a staple (by-product / not food). */
const NAME_MAP = {
  'salt': ['salt'], 'svartpeppar': ['pepper'], 'salt och peppar': ['salt', 'pepper'],
  'vatten': ['water'], 'olja': ['oil'], 'olivolja': ['olive_oil'], 'socker': ['sugar'],
  'smör': ['butter'], 'rumstempererat smör': ['butter'],
  'vetemjöl': ['flour'], 'mjöl': ['flour'], 'mjölk': ['milk'],
  'ägg': ['egg'], 'äggulor': ['egg'], 'äggula': ['egg'],
  'ättiksprit': ['vinegar_spirit'], 'balsamvinäger': ['balsamic_vinegar'], 'vitvinsvinäger': ['white_wine_vinegar'],
  'ketchup': ['ketchup'], 'kanel': ['cinnamon'],
  // Not something you buy or keep in the pantry
  'pastavatten': null, 'sparat pastavatten': null, 'sparat nudelvatten': null, 'sparat potatisvatten': null,
};
/** Fresh goods: suggested, but not part of "Lägg till alla vanliga". */
const PERISHABLE = new Set(['egg', 'milk']);
/** Always counted as at home (tap water); not shown as a choice. */
const IMPLICIT = new Set(['water']);
/** Tier 1 threshold: mean share of recipes across the two sources. */
const COMMON_MIN = 0.02;

function norm(n) {
  return String(n || '').toLowerCase().replace(/\*/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+till\s+.*$/, '')
    .replace(/,.*$/, '')
    .replace(/\s+/g, ' ').trim();
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function scan(dir, filter, pick) {
  const raw = new Map(); // normalised name -> recipes
  const ids = new Map(); // ingredient id -> recipes
  let n = 0;
  for (const f of fs.readdirSync(dir).filter(filter)) {
    const r = (readJson(path.join(dir, f)).recipe) || {};
    const ings = r.ingredients || [];
    if (!ings.length) continue;
    n++;
    const names = new Set(ings.filter(pick).map((i) => norm(i.name)).filter(Boolean));
    const mapped = new Set();
    for (const nm of names) {
      raw.set(nm, (raw.get(nm) || 0) + 1);
      for (const id of NAME_MAP[nm] || []) mapped.add(id);
    }
    for (const id of mapped) ids.set(id, (ids.get(id) || 0) + 1);
  }
  return { n, raw, ids };
}

const linas = scan(path.join(RAW, 'linas-raw'), (f) => /^linas-.*\.json$/.test(f), (i) => i.isBasis === true);
const hf = scan(path.join(RAW, 'raw'), (f) => f.endsWith('.json') && !f.startsWith('_'), (i) => i.shipped === false);

const ingredients = readJson(path.join(ROOT, 'data/ingredients.json')).ingredients;
const unmapped = [];
for (const [src, s] of [['linas', linas], ['hellofresh', hf]]) {
  for (const [nm, c] of s.raw) {
    if (nm in NAME_MAP) {
      for (const id of NAME_MAP[nm] || []) if (!ingredients[id]) unmapped.push({ name: nm, source: src, recipes: c, reason: `id ${id} saknas i ingredients.json` });
      if (NAME_MAP[nm] === null) unmapped.push({ name: nm, source: src, recipes: c, reason: 'inte en basvara (rest från tillagningen)' });
    } else {
      unmapped.push({ name: nm, source: src, recipes: c, reason: 'ingen motsvarighet i ingredients.json' });
    }
  }
}

const pct = (c, n) => Math.round((c / n) * 1000) / 10;
const tier1 = [];
for (const id of new Set([...linas.ids.keys(), ...hf.ids.keys()])) {
  if (!ingredients[id]) continue;
  const l = linas.ids.get(id) || 0, h = hf.ids.get(id) || 0;
  const score = (l / linas.n + h / hf.n) / 2;
  tier1.push({ id, linas: pct(l, linas.n), hellofresh: pct(h, hf.n), score: Math.round(score * 1000) / 1000 });
}
tier1.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

// Tier 2: shelf-stable basics and spices our own recipes use a lot (buljong, soja, kryddor ...).
const ours = new Map();
let ourN = 0;
const recDir = path.join(ROOT, 'data/recipes');
const tracked = new Set((process.env.RECIPE_IDS || '').split(',').filter(Boolean));
for (const f of fs.readdirSync(recDir).filter((x) => x.endsWith('.json'))) {
  if (tracked.size && !tracked.has(f.replace(/\.json$/, ''))) continue;
  const d = readJson(path.join(recDir, f));
  ourN++;
  const s = new Set();
  for (const nd of d.nodes || []) for (const i of nd.inputs || []) if (ingredients[i.id]) s.add(i.id);
  for (const id of s) ours.set(id, (ours.get(id) || 0) + 1);
}
const EXTRA_OK = new Set(['soy_sauce', 'tomato_paste', 'panko', 'breadcrumbs']);
const t1ids = new Set(tier1.map((t) => t.id));
const tier2 = [];
for (const [id, c] of ours) {
  if (t1ids.has(id)) { tier1.find((t) => t.id === id).ours = pct(c, ourN); continue; }
  const tags = ingredients[id].tags || [];
  const stapleTag = tags.some((t) => ['basic', 'spices', 'oils'].includes(t));
  if (tags.includes('fresh') || tags.includes('spice_blend') || ingredients[id].blendId) continue;
  if (!stapleTag && !EXTRA_OK.has(id)) continue;
  if (c < 2) continue;
  tier2.push({ id, ours: pct(c, ourN), score: Math.round((c / ourN) * 1000) / 1000 });
}
tier2.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

const staples = [
  ...tier1.map((t) => ({ ...t, tier: t.score >= COMMON_MIN ? 'common' : 'extra', ...(PERISHABLE.has(t.id) ? { perishable: true } : {}) })),
  ...tier2.slice(0, 20).map((t) => ({ ...t, tier: 'extra' })),
].filter((s) => !IMPLICIT.has(s.id));
// Extras: rank by the stronger of the two signals (sources' pantry share, share of our recipes)
const rank = (s) => Math.max(s.score, (s.ours || 0) / 100);
staples.sort((a, b) => (a.tier === b.tier ? (a.tier === 'common' ? b.score - a.score : rank(b) - rank(a)) : (a.tier === 'common' ? -1 : 1)) || a.id.localeCompare(b.id));
unmapped.sort((a, b) => b.recipes - a.recipes);

const body = `/**
 * Föreslagna basvaror for #skafferi. GENERATED by scripts/build-pantry-staples.mjs; do not edit by hand.
 *
 * tier 'common': flagged as "har du hemma" by Linas Matkasse (isBasis) and/or "ingår ej" by
 *   HelloFresh (shipped: false), mean share of recipes >= ${COMMON_MIN * 100} %. "Lägg till alla vanliga"
 *   adds these except perishable ones.
 * tier 'extra': shelf-stable basics/spices used in >= 2 of our own ${ourN} recipes.
 * linas / hellofresh / ours = % of that source's recipes that use it.
 */
export const PANTRY_SOURCES = ${JSON.stringify({ linasRecipes: linas.n, hellofreshRecipes: hf.n, ourRecipes: ourN, builtAt: new Date().toISOString().slice(0, 10) })};

/** Always treated as at home (tap water); never listed as something to buy. */
export const IMPLICIT_HAVE = ${JSON.stringify([...IMPLICIT])};

export const PANTRY_STAPLES = [
${staples.map((s) => '  ' + JSON.stringify(s)).join(',\n')},
];

/** Raw pantry names from the sources that did not map to an ingredient id. */
export const UNMAPPED = [
${unmapped.map((s) => '  ' + JSON.stringify(s)).join(',\n')},
];
`;
fs.writeFileSync(OUT, body);
console.log(`linas ${linas.n} recipes, hellofresh ${hf.n}, ours ${ourN}`);
console.table(staples.map((s) => ({ id: s.id, name: ingredients[s.id].name, tier: s.tier, linas: s.linas, hf: s.hellofresh, ours: s.ours, score: s.score })));
console.log('unmapped'); console.table(unmapped);
