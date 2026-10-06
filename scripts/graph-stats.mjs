#!/usr/bin/env node
/**
 * Graph statistics for recipe DAGs (read-only; never writes recipe data).
 *
 * Graph model per recipe:
 *   - cooking nodes = the recipe's local nodes + nodes of listed sharedPrep packs that feed it
 *   - derived edges = node -> node (an input id that is another node); these form the DAG
 *   - pantry ingredients (ingredients.json ids) are leaves, counted separately
 *
 * Metrics (per recipe):
 *   nodes, localNodes, sharedNodes, pantry (unique ingredient ids), edges (derived), pantryEdges
 *   maxDepth   longest path, in nodes, from any source node to the master (master counts)
 *   minDepth   shortest path, in nodes, from any leaf node (no derived inputs) to the master
 *   minDepthFood  same, but only leaves that take pantry ingredients (skips oven/equipment nodes)
 *   critMin    critical-path time: max over paths of sum(duration + wait), minutes
 *   leaves     number of source chains (nodes with no derived inputs)
 *   maxIn      most derived inputs into one node;  avgIn = derived edges / nodes;
 *   avgInInternal = derived edges / non-leaf nodes;  merges = nodes with derived in-degree >= 2
 *   width      max nodes on one depth level (level = longest path from a source, ASAP layering)
 *   shared     sharedPrep packs listed, and how many local nodes consume each pack output
 *
 * Usage:
 *   node scripts/graph-stats.mjs                     table + global stats + top-5 lists + by-source
 *   node scripts/graph-stats.mjs norska_kottbullar   single-recipe detail (one or more ids)
 *   node scripts/graph-stats.mjs --json out.json     also write all per-recipe stats to a file
 *   node scripts/graph-stats.mjs --json -            JSON to stdout only
 *
 * Also imported by scripts/build-graph-viewer.mjs (loadAll, analyzeRecipe).
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');

const readJSON = p => JSON.parse(readFileSync(p, 'utf8'));

export function loadAll() {
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
  const masters = {};
  for (const f of readdirSync(join(DATA, 'recipes')).filter(x => x.endsWith('.json')).sort()) {
    const data = readJSON(join(DATA, 'recipes', f));
    masters[data.masterId || f.replace(/\.json$/, '')] = data;
  }
  return { ingredients, prepPacks, masters };
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Build the graph and compute all metrics for one recipe. */
export function analyzeRecipe(mid, data, { ingredients, prepPacks }) {
  const sharedOf = new Map(); // node id -> pack id
  const all = new Map();
  for (const packId of data.sharedPrep || []) {
    for (const n of prepPacks[packId]?.nodes || []) { all.set(n.id, n); sharedOf.set(n.id, packId); }
  }
  for (const n of data.nodes || []) if (!all.has(n.id)) all.set(n.id, n);

  // Keep only nodes that reach the master (shared pack nodes nobody uses drop out).
  const preds = new Map(); // id -> [{id, amount, unit}] derived inputs
  for (const [id, n] of all) preds.set(id, (n.inputs || []).filter(i => i && all.has(i.id)));
  const keep = new Set();
  const stack = [mid];
  while (stack.length) {
    const id = stack.pop();
    if (keep.has(id) || !all.has(id)) continue;
    keep.add(id);
    for (const p of preds.get(id)) stack.push(p.id);
  }
  const unreachable = [...all.keys()].filter(id => !keep.has(id) && !sharedOf.has(id));
  const ids = [...keep];

  const edges = [];
  const pantryEdges = [];
  for (const id of ids) {
    for (const inp of all.get(id).inputs || []) {
      if (!inp?.id) continue;
      if (keep.has(inp.id)) edges.push({ from: inp.id, to: id, amount: inp.amount, unit: inp.unit });
      else pantryEdges.push({ from: inp.id, to: id, amount: inp.amount, unit: inp.unit, known: Boolean(ingredients[inp.id]) });
    }
  }
  const inDeg = new Map(ids.map(id => [id, 0]));
  const succ = new Map(ids.map(id => [id, []]));
  for (const e of edges) { inDeg.set(e.to, inDeg.get(e.to) + 1); succ.get(e.from).push(e.to); }

  // Topological order (Kahn)
  const indeg = new Map(inDeg);
  const order = [];
  const q = ids.filter(id => indeg.get(id) === 0);
  while (q.length) {
    const id = q.shift();
    order.push(id);
    for (const s of succ.get(id)) { indeg.set(s, indeg.get(s) - 1); if (indeg.get(s) === 0) q.push(s); }
  }
  const cyclic = order.length !== ids.length;

  const cost = id => num(all.get(id).duration) + num(all.get(id).wait);
  const level = new Map();   // longest path from a source, 0-based
  const crit = new Map();    // longest time path ending at node (inclusive)
  const critPrev = new Map();
  for (const id of order) {
    let lv = 0, best = 0, bestPrev = null;
    for (const p of preds.get(id)) {
      if (!keep.has(p.id)) continue;
      lv = Math.max(lv, level.get(p.id) + 1);
      if (bestPrev === null || crit.get(p.id) > best) { best = crit.get(p.id); bestPrev = p.id; }
    }
    level.set(id, lv);
    crit.set(id, best + cost(id));
    critPrev.set(id, bestPrev);
  }
  // Longest path (nodes) from node to master, for ALAP layout
  const toMaster = new Map();
  for (const id of [...order].reverse()) {
    const s = succ.get(id);
    toMaster.set(id, s.length ? 1 + Math.max(...s.map(x => toMaster.get(x))) : 1);
  }
  // Shortest path (nodes) from master backwards
  const dist = new Map([[mid, 1]]);
  const bq = [mid];
  while (bq.length) {
    const id = bq.shift();
    for (const p of preds.get(id)) if (keep.has(p.id) && !dist.has(p.id)) { dist.set(p.id, dist.get(id) + 1); bq.push(p.id); }
  }

  const leaves = ids.filter(id => inDeg.get(id) === 0);
  const foodLeaves = leaves.filter(id => pantryEdges.some(e => e.to === id));
  const maxDepth = cyclic ? null : level.get(mid) + 1;
  const minOf = arr => (arr.length ? Math.min(...arr) : null);
  const minDepth = minOf(leaves.map(id => dist.get(id)));
  const minDepthFood = minOf(foodLeaves.map(id => dist.get(id)));

  const criticalPath = [];
  for (let c = mid; c; c = critPrev.get(c)) criticalPath.unshift(c);

  const perLevel = {};
  for (const id of ids) perLevel[level.get(id)] = (perLevel[level.get(id)] || 0) + 1;
  const width = Math.max(...Object.values(perLevel));
  const nonLeaf = ids.length - leaves.length;
  const maxIn = Math.max(...ids.map(id => inDeg.get(id)));
  const maxInNode = ids.find(id => inDeg.get(id) === maxIn);

  const sharedUse = {};
  for (const packId of data.sharedPrep || []) {
    const packIds = new Set((prepPacks[packId]?.nodes || []).map(n => n.id));
    const consumers = new Set(edges.filter(e => packIds.has(e.from) && !packIds.has(e.to)).map(e => e.to));
    sharedUse[packId] = consumers.size;
  }

  // Outputs consumed by 2+ nodes: fractional split (0.7 + 0.3 st), equipment (no-input node), or shared prep
  const multiOut = ids.filter(id => succ.get(id).length >= 2).map(id => ({
    id, consumers: succ.get(id).length,
    kind: sharedOf.has(id) ? 'shared' : !(all.get(id).inputs || []).length ? 'equipment' : 'split',
  }));

  const stats = {
    id: mid,
    name: data.nodes.find(n => n.id === mid)?.outputName || data.nodes.find(n => n.id === mid)?.name || mid,
    source: data.source || 'unknown',
    nodes: ids.length,
    localNodes: ids.filter(id => !sharedOf.has(id)).length,
    sharedNodes: ids.filter(id => sharedOf.has(id)).length,
    pantry: new Set(pantryEdges.map(e => e.from)).size,
    edges: edges.length,
    pantryEdges: pantryEdges.length,
    maxDepth, minDepth, minDepthFood,
    critMin: crit.get(mid),
    totalMin: ids.reduce((s, id) => s + cost(id), 0),
    leaves: leaves.length,
    maxIn, maxInNode,
    avgIn: +(edges.length / ids.length).toFixed(2),
    avgInInternal: nonLeaf ? +(edges.length / nonLeaf).toFixed(2) : 0,
    merges: ids.filter(id => inDeg.get(id) >= 2).length,
    width,
    perLevel,
    sharedPrep: sharedUse,
    multiOut,
    criticalPath,
    unreachable,
    cyclic,
  };

  const graph = {
    nodes: ids.map(id => {
      const n = all.get(id);
      return {
        id, name: n.name, outputName: n.outputName, duration: n.duration ?? null, wait: n.wait ?? null,
        tags: n.tags || [], shared: sharedOf.get(id) || null, master: id === mid,
        level: level.get(id), alap: maxDepth - toMaster.get(id), inDeg: inDeg.get(id),
        crit: criticalPath.includes(id),
      };
    }),
    edges, pantryEdges: pantryEdges.map(e => ({ ...e, name: ingredients[e.from]?.name || e.from })),
  };
  return { stats, graph };
}

export function analyzeAll(loaded = loadAll()) {
  const out = {};
  for (const [mid, data] of Object.entries(loaded.masters)) out[mid] = analyzeRecipe(mid, data, loaded);
  return out;
}

// ---------- reporting ----------
const METRICS = [
  ['nodes', 'nodes'], ['pantry', 'pantry ingr.'], ['edges', 'derived edges'], ['maxDepth', 'max depth'],
  ['minDepth', 'min depth (any leaf)'], ['minDepthFood', 'min depth (food leaf)'], ['critMin', 'critical path min'],
  ['totalMin', 'sum of all node time'], ['leaves', 'leaves (chains)'], ['maxIn', 'max in-degree'],
  ['avgInInternal', 'avg in-deg (non-leaf)'], ['merges', 'merge nodes'], ['width', 'width'],
];
export function summarize(values) {
  const v = values.filter(x => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return { min: null, median: null, mean: null, max: null };
  const mid = v.length >> 1;
  return {
    min: v[0], max: v[v.length - 1],
    median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2,
    mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2),
  };
}
export const branchScore = s => s.leaves * 100 + s.merges * 10 + s.maxIn; // rank: leaves, then merges, then maxIn

const pad = (s, n) => String(s ?? '-').padEnd(n);
const lpad = (s, n) => String(s ?? '-').padStart(n);
const fmt = x => (x == null ? '-' : Number.isInteger(x) ? String(x) : x.toFixed(2));

function printAll(all) {
  const rows = Object.values(all).map(r => r.stats)
    .sort((a, b) => b.maxDepth - a.maxDepth || b.nodes - a.nodes || a.id.localeCompare(b.id));
  const W = Math.max(...rows.map(r => r.id.length));
  const head = `${pad('recipe', W)}  ${pad('source', 9)} ${lpad('nodes', 5)} ${lpad('pantry', 6)} ${lpad('edges', 5)} ${lpad('maxD', 4)} ${lpad('minD', 4)} ${lpad('leaf', 4)} ${lpad('maxIn', 5)} ${lpad('avgIn*', 6)} ${lpad('merge', 5)} ${lpad('width', 5)} ${lpad('crit', 4)}  shared`;
  console.log(head);
  console.log('-'.repeat(head.length + 10));
  for (const s of rows) {
    const shared = Object.entries(s.sharedPrep).map(([k, v]) => `${k}×${v}`).join(',');
    console.log(`${pad(s.id, W)}  ${pad(s.source, 9)} ${lpad(s.nodes, 5)} ${lpad(s.pantry, 6)} ${lpad(s.edges, 5)} ${lpad(s.maxDepth, 4)} ${lpad(s.minDepth, 4)} ${lpad(s.leaves, 4)} ${lpad(s.maxIn, 5)} ${lpad(s.avgInInternal.toFixed(2), 6)} ${lpad(s.merges, 5)} ${lpad(s.width, 5)} ${lpad(s.critMin, 4)}  ${shared}`);
  }
  console.log('* avgIn = derived edges / non-leaf nodes. crit = critical-path minutes (duration + wait).');

  console.log(`\nGLOBAL STATS (${rows.length} recipes)`);
  console.log(`${pad('metric', 24)} ${lpad('min', 7)} ${lpad('median', 7)} ${lpad('mean', 7)} ${lpad('max', 7)}`);
  for (const [k, label] of METRICS) {
    const s = summarize(rows.map(r => r[k]));
    console.log(`${pad(label, 24)} ${lpad(fmt(s.min), 7)} ${lpad(fmt(s.median), 7)} ${lpad(fmt(s.mean), 7)} ${lpad(fmt(s.max), 7)}`);
  }

  const top = (title, sorted, f) => {
    console.log(`\n${title}`);
    sorted.slice(0, 5).forEach((s, i) => console.log(`  ${i + 1}. ${pad(s.id, W)} ${f(s)}`));
  };
  const by = (...keys) => (a, b) => { for (const [k, d] of keys) { const x = typeof k === 'function' ? k(a) - k(b) : a[k] - b[k]; if (x) return d * x; } return a.id.localeCompare(b.id); };
  top('TOP 5 DEEPEST (max depth, then nodes)', [...rows].sort(by(['maxDepth', -1], ['nodes', -1])),
    s => `depth ${s.maxDepth}, ${s.nodes} nodes, crit ${s.critMin} min, path: ${s.criticalPath.length} nodes`);
  top('TOP 5 SHALLOWEST (max depth, then fewest nodes)', [...rows].sort(by(['maxDepth', 1], ['nodes', 1])),
    s => `depth ${s.maxDepth}, ${s.nodes} nodes, ${s.leaves} leaves`);
  top('TOP 5 MOST BRANCHY (leaves, then merge nodes, then max in-degree)', [...rows].sort(by([branchScore, -1])),
    s => `${s.leaves} leaves, ${s.merges} merges, max in ${s.maxIn} (${s.maxInNode.replace(s.id + '__', '')}), width ${s.width}`);
  top('TOP 5 LONGEST CRITICAL PATH (minutes)', [...rows].sort(by(['critMin', -1])),
    s => `${s.critMin} min (all nodes summed ${s.totalMin} min), depth ${s.maxDepth}`);

  console.log('\nBY SOURCE (averages)');
  const srcKeys = ['nodes', 'pantry', 'maxDepth', 'minDepthFood', 'critMin', 'leaves', 'maxIn', 'merges', 'width'];
  console.log(`${pad('source', 11)} ${lpad('n', 3)} ` + srcKeys.map(k => lpad(k, Math.max(6, k.length))).join(' '));
  const sources = [...new Set(rows.map(r => r.source))].sort((a, b) => rows.filter(r => r.source === b).length - rows.filter(r => r.source === a).length);
  for (const src of sources) {
    const rs = rows.filter(r => r.source === src);
    console.log(`${pad(src, 11)} ${lpad(rs.length, 3)} ` + srcKeys.map(k => lpad(fmt(summarize(rs.map(r => r[k])).mean), Math.max(6, k.length))).join(' '));
  }

  const flat = rows.filter(r => r.maxDepth <= 2);
  const chains = rows.filter(r => r.width === 1);
  const multiUse = rows.filter(r => r.edges > r.nodes - 1);
  console.log('\nSHAPES');
  console.log(`  flat stars (max depth <= 2): ${flat.length ? flat.map(r => r.id).join(', ') : 'none'}`);
  console.log(`  pure chains (width 1): ${chains.length ? chains.map(r => r.id).join(', ') : 'none'}`);
  console.log(`  not a pure in-tree (an output feeds 2+ nodes): ${multiUse.length} recipes`);
  for (const kind of ['split', 'equipment', 'shared']) {
    const hits = rows.flatMap(r => r.multiOut.filter(m => m.kind === kind).map(m => `${r.id}:${m.id.replace(r.id + '__', '')}×${m.consumers}`));
    console.log(`    ${pad(kind, 10)} ${hits.length}: ${hits.join(', ') || 'none'}`);
  }
  const bad = rows.filter(r => r.cyclic || r.unreachable.length);
  if (bad.length) console.log(`  PROBLEMS: ${bad.map(r => `${r.id}${r.cyclic ? ' cyclic' : ''}${r.unreachable.length ? ' unreachable:' + r.unreachable.join('|') : ''}`).join('; ')}`);
}

function printOne({ stats: s, graph: g }) {
  console.log(`${s.id}  (${s.name}, source ${s.source})`);
  const kv = [
    ['nodes', `${s.nodes} (${s.localNodes} local, ${s.sharedNodes} shared prep)`],
    ['pantry ingredients', `${s.pantry} unique, ${s.pantryEdges} pantry edges`],
    ['derived edges', s.edges],
    ['max depth', `${s.maxDepth} nodes`],
    ['min depth', `${s.minDepth} (any leaf), ${s.minDepthFood} (food leaf)`],
    ['critical path', `${s.critMin} min (all nodes summed: ${s.totalMin} min)`],
    ['leaves (chains)', s.leaves],
    ['max in-degree', `${s.maxIn} (${s.maxInNode})`],
    ['avg in-degree', `${s.avgIn} all nodes, ${s.avgInInternal} non-leaf`],
    ['merge nodes', s.merges],
    ['width', `${s.width}  per level: ${JSON.stringify(s.perLevel)}`],
    ['shared prep', Object.keys(s.sharedPrep).length ? JSON.stringify(s.sharedPrep) : 'none'],
  ];
  for (const [k, v] of kv) console.log(`  ${pad(k, 20)} ${v}`);
  console.log(`  critical path:`);
  for (const id of s.criticalPath) {
    const n = g.nodes.find(x => x.id === id);
    console.log(`    ${pad(id, 50)} ${n.name}  ${n.duration ?? 0}${n.wait ? '+' + n.wait : ''} min`);
  }
  console.log('  nodes by level:');
  for (const n of [...g.nodes].sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))) {
    const ins = g.edges.filter(e => e.to === n.id).map(e => e.from.replace(s.id + '__', '') + (e.amount !== 1 || e.unit !== 'st' ? ` (${e.amount} ${e.unit})` : ''));
    console.log(`    L${n.level} ${pad(n.id.replace(s.id + '__', ''), 32)} ${pad(n.name, 28)} ${lpad(n.duration ?? 0, 3)}${n.wait ? '+' + n.wait : ''} min  ${n.crit ? '*' : ' '} <- ${ins.join(', ') || '(leaf)'}`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  let jsonOut = null;
  const ji = argv.indexOf('--json');
  if (ji >= 0) { jsonOut = argv[ji + 1] && !argv[ji + 1].startsWith('--') ? argv[ji + 1] : '-'; argv.splice(ji, jsonOut === '-' && argv[ji + 1] !== '-' ? 1 : 2); }
  const ids = argv.filter(a => !a.startsWith('--'));
  const loaded = loadAll();
  const unknown = ids.filter(id => !loaded.masters[id]);
  if (unknown.length) { console.error(`Unknown masterId(s): ${unknown.join(', ')}`); process.exit(2); }
  const all = ids.length ? Object.fromEntries(ids.map(id => [id, analyzeRecipe(id, loaded.masters[id], loaded)])) : analyzeAll(loaded);

  if (jsonOut) {
    const rows = Object.values(all).map(r => r.stats);
    const payload = {
      generatedAt: new Date().toISOString(),
      global: Object.fromEntries(METRICS.map(([k]) => [k, summarize(rows.map(r => r[k]))])),
      bySource: Object.fromEntries([...new Set(rows.map(r => r.source))].map(src => [src, Object.fromEntries(METRICS.map(([k]) => [k, summarize(rows.filter(r => r.source === src).map(r => r[k])).mean]))])),
      recipes: rows,
    };
    const text = JSON.stringify(payload, null, 2);
    if (jsonOut === '-') { console.log(text); return; }
    writeFileSync(jsonOut, text);
    console.error(`wrote ${jsonOut}`);
  }
  if (ids.length) Object.values(all).forEach((r, i) => { if (i) console.log(''); printOne(r); });
  else printAll(all);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
