#!/usr/bin/env node
/**
 * Recipe times from the graph: the same Scheduler the cook page / flow graph uses.
 *
 *   node scripts/compute-times.mjs              # all recipes in data/catalog.json, writes files
 *   node scripts/compute-times.mjs <id> [<id>]  # only these masters
 *   node scripts/compute-times.mjs --check      # write nothing; exit 1 if a stored time is missing/stale
 *
 * Per recipe (default app view: 1 cook, Preppa först off, default kitchen profile):
 *   totalMin   = Scheduler makespan (critical path with one cook; wait time such as oven,
 *                simmering or resting runs in parallel, active time does not overlap)
 *   activeMin  = sum of node `duration` (hands-on minutes)
 * Written to data/recipes/<id>.json as `time: { totalMin, activeMin, computedFrom: "graph" }`
 * and to data/catalog.json `totalMinutes` (what the recipe cards show).
 * Source prep/total times (HelloFresh prepTime/totalTime, Linas cookingTime…) are never used.
 * Nodes without `duration` count as 1 min (Scheduler default) and are listed as warnings.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

// The app modules fetch data/*.json and read localStorage; give them file reads and an empty store.
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const url = new URL(String(u));
  if (url.protocol !== 'file:') return realFetch(u, o);
  try {
    const text = await readFile(fileURLToPath(url), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, status: 404, statusText: 'Not Found' };
  }
};
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};

// Same module URLs (incl. ?v=) as the app, so the loader and the scheduler share state.
const mod = p => import(pathToFileURL(join(ROOT, p)).href + (p.includes('loader') ? '' : '?v=20261109g21'));
const { loadStaticData, RecipeRepository } = await mod('js/data/loader.js');
const { Scheduler } = await mod('js/models/scheduler.js');
const { kitchenProfile } = await mod('js/core/kitchen-prefs.js');

export function computeTime(root, subtree) {
  const s = new Scheduler(root, subtree, { prepFirst: false, cooks: 1, kitchen: kitchenProfile() }).getSchedule();
  const totalMin = Math.round(s.totalTime);
  const activeMin = Math.round(s.nodes.reduce((a, n) => a + n.activeDuration, 0));
  return { totalMin, activeMin, computedFrom: 'graph' };
}

const writeJSON = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const only = args.filter(a => !a.startsWith('--'));

  const stat = await loadStaticData();
  const repo = new RecipeRepository(stat.unitMap, stat.baseIngredientMap, stat.spiceData);
  const catalogPath = join(DATA, 'catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const ids = only.length ? only : catalog.map(e => e.id);

  const rows = [];
  for (const id of ids) {
    const file = join(DATA, 'recipes', `${id}.json`);
    const raw = JSON.parse(await readFile(file, 'utf8'));
    const m = await repo.loadMaster(id);
    const subtree = m.graph.getSubtreeRecipes(m.root);
    const time = computeTime(m.root, subtree);
    const noDuration = (raw.nodes || []).filter(n => !Number.isFinite(n.duration)).map(n => n.id);
    const entry = catalog.find(e => e.id === id);
    const stale = raw.time?.totalMin !== time.totalMin || raw.time?.activeMin !== time.activeMin
      || entry?.totalMinutes !== time.totalMin;
    rows.push({ id, before: entry?.totalMinutes ?? null, ...time, noDuration, stale });

    if (check) continue;
    // `time` goes right after basePortions; everything else keeps its order.
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'time') continue;
      out[k] = v;
      if (k === 'basePortions') out.time = time;
    }
    if (!out.time) out.time = time;
    await writeJSON(file, out);
    if (entry) entry.totalMinutes = time.totalMin;
  }
  if (!check) await writeJSON(catalogPath, catalog);

  for (const r of rows) {
    const flag = r.noDuration.length ? `  no duration: ${r.noDuration.join(', ')}` : '';
    const mark = check && r.stale ? '  STALE (run without --check)' : '';
    console.log(`${r.id}\ttotal ${r.totalMin} (catalog ${r.before ?? '-'})\tactive ${r.activeMin}${flag}${mark}`);
  }
  const stale = rows.filter(r => r.stale).length;
  console.log(`${rows.length} recipes${check ? ` checked (nothing written), ${stale} stale` : ' written'}.`);
  if (args.includes('--json')) console.log(JSON.stringify(rows));
  if (check && stale) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
