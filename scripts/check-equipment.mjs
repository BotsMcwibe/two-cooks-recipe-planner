#!/usr/bin/env node
/**
 * Check equipment, heat and oven resources in recipe graphs.
 * See SCHEMA.md "Equipment, heat & resources" and hf-to-graph-conversion.md §4.6.
 *
 * Model
 *   - node.equipment: [{ type, ref?, after?, transition?, sizeSource?, hold?, lid?, mode?, temp? }]
 *       type        id in data/equipment.json (kastrull_medelstor, stekpanna_stor, plat, ugn, ...)
 *       ref         dish-local instance name ("stekpanna_1"); the same ref in several nodes = the SAME
 *                   physical pot/pan, reused in order. Exclusive vessels without ref are single-use.
 *       after       node id (or array) this equipment must wait for: the preheat resource for "ugn",
 *                   or the previous user of a vessel when no ingredient edge orders them.
 *       transition  fresh | keep | wipe | wash  (state of a reused vessel before this node)
 *       offHeat     true = stovetop vessel used off the burner (mash in the pot, toss in the pan): no heat needed
 *       hold        true = output stays in this vessel until its consumer takes it ("under lock")
 *       shared      true = ovenware used AT THE SAME TIME by several nodes (two things side by side on
 *                   one plåt); exempt from eq-overlap and counted as one oven slot
 *       ugn entries (one per oven use) carry: slots (trays/forms needed at once), temp (vanlig ugn °C,
 *                   null only if the raw says "enligt förpackningen"), fanTemp (varmluft °C) with
 *                   fanTempSource "derived" when it was computed as temp − 20 instead of read from the raw,
 *                   and optional mode ("grill").
 *   - Kitchen profile { ovenTrays, ovenFan }: capacity = ovenTrays; the effective temperature of a use is
 *     fanTemp when ovenFan is true, else temp. Two different effective settings at once = oven-temp.
 *   - node.heat: låg | medellåg | medel | medelhög | hög (node default), node.stepHeat: { "<0-based step>": level }
 *   - Resource nodes (tag "resource", e.g. preheated ovens) are NOT ingredients: never inputs,
 *     never part of the sum-to-1 rule (check-derived-usage.mjs), referenced only via equipment.after.
 *
 * Errors: oven-use, eq-unknown-type, eq-bad-field, eq-after-dangling, eq-ref-type, eq-overlap, eq-held,
 *         oven-slots, oven-temp, oven-no-resource, heat-invalid, heat-no-stovetop
 * Warnings: pan-too-small, stovetop-no-heat, reuse-transition, burners
 *
 * Timing for oven/burner concurrency uses an as-soon-as-possible schedule over inputs + equipment.after
 * (end = start + duration + wait). Add `after` on the equipment entry to serialise two oven loads.
 *
 * Usage: node scripts/check-equipment.mjs [masterId ...] [--trays N] [--fan|--no-fan] [--json] [--errors-only]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'data');
const readJSON = p => JSON.parse(readFileSync(p, 'utf8'));

export const HEAT_LEVELS = ['låg', 'medellåg', 'medel', 'medelhög', 'hög'];
export const TRANSITIONS = ['fresh', 'keep', 'wipe', 'wash'];
// Kitchen profile (per account in the app). The checker validates against data/equipment.json
// defaultKitchen ({ ovenTrays: 2, ovenFan: false }) unless --trays N / --fan / --no-fan is given.
export const DEFAULT_KITCHEN = { ovenTrays: 2, ovenFan: false };
export const MAX_BURNERS = 4;
export const ERROR_TYPES = ['eq-unknown-type', 'eq-bad-field', 'eq-after-dangling', 'eq-ref-type', 'eq-overlap', 'eq-held',
  'oven-slots', 'oven-temp', 'oven-no-resource', 'oven-use', 'heat-invalid', 'heat-no-stovetop'];
export const WARNING_TYPES = ['pan-too-small', 'stovetop-no-heat', 'reuse-transition', 'burners'];
const FIELDS = new Set(['type', 'ref', 'after', 'transition', 'sizeSource', 'hold', 'shared', 'lid', 'mode', 'temp', 'note', 'offHeat', 'slots', 'fanTemp', 'fanTempSource']);

// Rough volume model (ml). 1 g ≈ 1 ml; pieces use a typical weight.
const UNIT_ML = { g: 1, kg: 1000, ml: 1, dl: 100, l: 1000, msk: 15, tsk: 5, krm: 1, skvätt: 10, nypa: 0, klick: 15,
  skiva: 30, bit: 50, klyfta: 5, förp: 50, påse: 50, pkt: 200, burk: 400, huvud: 400, kruka: 20, portioner: 200 };
const PIECE_G = { garlic: 5, onion: 150, red_onion: 120, shallot: 40, cucumber: 300, tomato: 100, lemon: 100, organic_lemon: 100,
  lime: 70, carrot: 80, egg: 55, paprika: 150, apple: 150, pear: 150, fresh_chili: 10, zucchini: 250, mango: 300,
  aubergine: 300, avocado: 150, spring_onion: 15, parsley: 20, coriander: 20, fresh_basil: 20, basil: 20, mint: 15, dill: 20,
  chives: 15, tarragon: 15, rosemary: 5, parsnip: 120, beetroot: 150, lettuce: 300, romaine_lettuce: 300, orange: 150,
  leek: 200, kohlrabi: 300, butternut_squash: 1000, ginger: 20, pak_choi: 150, salmon_fillet: 125, fennel: 250, celery: 50,
  tortillas: 40, mini_tortillas: 25, baguette: 250, sourdough_baguette: 250, pita_bread: 70, brioche_bun: 60, ciabatta: 250,
  flatbread: 80, mozzarella: 125, chicken_bouillon: 10, vegetable_bouillon: 10, sun_dried_tomatoes: 10 };

function loadAll() {
  const ingredientsFile = readJSON(join(DATA, 'ingredients.json'));
  const prepPacks = {};
  const prepDir = join(DATA, 'prep');
  if (existsSync(prepDir)) for (const f of readdirSync(prepDir).filter(x => x.endsWith('.json'))) {
    const pack = readJSON(join(prepDir, f)); prepPacks[pack.id || f.replace(/\.json$/, '')] = pack;
  }
  const masters = {};
  for (const f of readdirSync(join(DATA, 'recipes')).filter(x => x.endsWith('.json'))) {
    const d = readJSON(join(DATA, 'recipes', f)); masters[d.masterId || f.replace(/\.json$/, '')] = d;
  }
  return { ingredients: ingredientsFile.ingredients || ingredientsFile, prepPacks, masters };
}

export const afterList = e => (e.after == null ? [] : Array.isArray(e.after) ? e.after : [e.after]);
export const isResource = n => (n.tags || []).includes('resource');

function checkRecipe(mid, data, ctx) {
  const { equipment, prepPacks, kitchen } = ctx;
  const OVEN_SLOTS = kitchen.ovenTrays;
  const types = equipment.types;
  const problems = [];
  const add = (level, type, node, message) => problems.push({ recipe: mid, level, type, node, message });

  const byId = new Map();
  for (const pid of data.sharedPrep || []) for (const n of (prepPacks[pid] || {}).nodes || []) byId.set(n.id, n);
  for (const n of data.nodes || []) byId.set(n.id, n);
  const local = data.nodes || [];

  // Dependency graph: ingredient edges + equipment.after
  const deps = new Map();
  for (const n of byId.values()) {
    const ds = new Set((n.inputs || []).map(i => i.id).filter(id => byId.has(id)));
    for (const e of n.equipment || []) for (const a of afterList(e)) if (byId.has(a)) ds.add(a);
    deps.set(n.id, ds);
  }
  const ancMemo = new Map();
  const anc = id => {
    if (ancMemo.has(id)) return ancMemo.get(id);
    const s = new Set(); ancMemo.set(id, s);
    for (const d of deps.get(id) || []) { s.add(d); for (const x of anc(d)) s.add(x); }
    return s;
  };
  const ordered = (a, b) => anc(b).has(a) || anc(a).has(b);
  const consumers = new Map();
  for (const n of byId.values()) for (const i of n.inputs || []) {
    if (!consumers.has(i.id)) consumers.set(i.id, []); consumers.get(i.id).push(n.id);
  }

  // ASAP schedule
  const startMemo = new Map();
  const start = id => {
    if (startMemo.has(id)) return startMemo.get(id);
    startMemo.set(id, 0);
    let s = 0;
    for (const d of deps.get(id) || []) s = Math.max(s, end(d));
    startMemo.set(id, s); return s;
  };
  const end = id => { const n = byId.get(id); return start(id) + (n.duration || 0) + (n.wait || 0); };

  // Volume estimate (ml) of a node's contents
  const volMemo = new Map();
  const vol = id => {
    if (volMemo.has(id)) return volMemo.get(id);
    volMemo.set(id, 0);
    const n = byId.get(id); let v = 0;
    const drained = /häll av|låt rinna av|sila av|i en sil|i ett durkslag/i.test((n.steps || []).join(' '));
    for (const i of n.inputs || []) {
      if (drained && i.id === 'water') continue;
      if (byId.has(i.id)) { if (!isResource(byId.get(i.id))) v += vol(i.id) * (i.amount || 0); continue; }
      const per = i.unit === 'st' ? (PIECE_G[i.id] ?? 100) : UNIT_ML[i.unit];
      if (per != null) v += per * (i.amount || 0);
    }
    volMemo.set(id, v); return v;
  };

  const refs = new Map(); // ref -> [{node, entry}]
  const ovenUsers = [];
  const stoveUsers = [];
  for (const n of local) {
    if (isResource(n)) continue;
    const eq = n.equipment || [];
    let stovetop = null; let ovenEntry = null; const slotKeys = []; let ovenwareCount = 0;
    for (const e of eq) {
      for (const k of Object.keys(e)) if (!FIELDS.has(k)) add('error', 'eq-bad-field', n.id, `equipment field "${k}" is not allowed`);
      const t = types[e.type];
      if (!t) { add('error', 'eq-unknown-type', n.id, `equipment type "${e.type}" is not in equipment.json`); continue; }
      if (e.transition && !TRANSITIONS.includes(e.transition)) add('error', 'eq-bad-field', n.id, `transition "${e.transition}" (allowed: ${TRANSITIONS.join(', ')})`);
      for (const a of afterList(e)) if (!byId.has(a)) add('error', 'eq-after-dangling', n.id, `equipment.after "${a}" is not a node in this recipe or its sharedPrep`);
      if (t.kind === 'stovetop') stovetop = e;
      if (t.kind === 'oven') ovenEntry = e;
      if (t.kind === 'ovenware' || (t.ovenSafe && eq.some(x => x.type === 'ugn'))) {
        ovenwareCount += t.ovenSlots || 1;
        if (e.ref) for (let k = 0; k < (t.ovenSlots || 1); k++) slotKeys.push(`${e.ref}#${k}`);
      }
      if (e.ref) { if (!refs.has(e.ref)) refs.set(e.ref, []); refs.get(e.ref).push({ node: n.id, entry: e }); }
    }
    // heat
    const heats = [n.heat, ...Object.values(n.stepHeat || {})].filter(h => h != null);
    for (const h of heats) if (!HEAT_LEVELS.includes(h)) add('error', 'heat-invalid', n.id, `heat "${h}" (allowed: ${HEAT_LEVELS.join(', ')})`);
    for (const k of Object.keys(n.stepHeat || {})) if (!(Number(k) >= 0 && Number(k) < (n.steps || []).length)) add('error', 'heat-invalid', n.id, `stepHeat index ${k} out of range`);
    if (heats.length && !stovetop) add('error', 'heat-no-stovetop', n.id, 'heat is set but the node has no stovetop vessel');
    if (stovetop && !heats.length && !eq.every(e => !types[e.type] || types[e.type].kind !== 'stovetop' || e.offHeat)) add('warning', 'stovetop-no-heat', n.id, `uses ${stovetop.type} but has no heat level`);
    if (stovetop) {
      stoveUsers.push(n.id);
      const t = types[stovetop.type], v = vol(n.id);
      if (t.capacityL && v > t.capacityL * 1000 * 1.1) add('warning', 'pan-too-small', n.id, `≈${(v / 1000).toFixed(1)} l of contents in ${stovetop.type} (${t.capacityL} l)`);
    }
    for (const e of eq) {
      const t = types[e.type];
      if (t && t.kind === 'ovenware' && t.capacityL) {
        const v = vol(n.id);
        if (v > t.capacityL * 1000 * 1.25) add('warning', 'pan-too-small', n.id, `≈${(v / 1000).toFixed(1)} l on/in ${e.type} (${t.capacityL} l)`);
      }
    }
    if (ovenEntry) {
      const res = afterList(ovenEntry).map(a => byId.get(a)).find(x => x && isResource(x) && x.oven);
      if (!res) add('error', 'oven-no-resource', n.id, 'ugn entry has no `after` pointing to a preheat resource node');
      const slots = ovenEntry.slots;
      if (!Number.isInteger(slots) || slots < 1) add('error', 'oven-use', n.id, 'ugn entry needs integer slots ≥ 1');
      else if (slots < ovenwareCount) add('error', 'oven-use', n.id, `ugn slots ${slots} < ${ovenwareCount} ovenware items in the node`);
      if (!('temp' in ovenEntry)) add('error', 'oven-use', n.id, 'ugn entry needs temp (vanlig ugn °C, or null when the raw gives none)');
      if (typeof ovenEntry.temp === 'number' && typeof ovenEntry.fanTemp !== 'number') add('error', 'oven-use', n.id, 'ugn entry with temp needs fanTemp (raw value, or temp − 20 with fanTempSource "derived")');
      if (ovenEntry.fanTempSource && ovenEntry.fanTempSource !== 'derived') add('error', 'oven-use', n.id, 'fanTempSource must be "derived" or absent');
      const need = Math.max(1, slots || 1);
      while (slotKeys.length < need) slotKeys.push(`${n.id}:slot${slotKeys.length}`);
      if (need > OVEN_SLOTS) add('error', 'oven-slots', n.id, `needs ${need} oven trays, kitchen has ${OVEN_SLOTS}`);
      const eff = kitchen.ovenFan ? ovenEntry.fanTemp : ovenEntry.temp;
      ovenUsers.push({ id: n.id, keys: slotKeys, setting: `${eff ?? '?'}°C${kitchen.ovenFan ? ' varmluft' : ''}${ovenEntry.mode ? ' ' + ovenEntry.mode : ''}` });
    }
  }
  // inputs must never be resources
  for (const n of byId.values()) for (const i of n.inputs || []) {
    if (byId.has(i.id) && isResource(byId.get(i.id))) add('error', 'eq-bad-field', n.id, `resource "${i.id}" is used as an ingredient input; use equipment [{type:"ugn", after:"${i.id}"}]`);
  }

  // shared vessels: same type, totally ordered, transitions, holds
  for (const [ref, users] of refs) {
    const ts = new Set(users.map(u => u.entry.type));
    if (ts.size > 1) add('error', 'eq-ref-type', users[0].node, `ref "${ref}" used with different types: ${[...ts].join(', ')}`);
    const t = types[users[0].entry.type];
    if (!t || t.exclusive === false) continue;
    for (let a = 0; a < users.length; a++) for (let b = a + 1; b < users.length; b++) {
      const A = users[a].node, B = users[b].node;
      if (users[a].entry.shared && users[b].entry.shared) continue;
      if (A !== B && !ordered(A, B)) add('error', 'eq-overlap', B, `${ref} (${t.label}) is also used by ${A}, and nothing orders the two nodes (add an ingredient edge or equipment.after)`);
    }
    const seq = [...users].sort((x, y) => (anc(y.node).has(x.node) ? -1 : anc(x.node).has(y.node) ? 1 : 0));
    seq.forEach((u, k) => {
      const tr = u.entry.transition || 'fresh';
      if (k === 0 && tr !== 'fresh') add('warning', 'reuse-transition', u.node, `${ref}: first use has transition "${tr}"`);
      if (k > 0 && tr === 'fresh') add('warning', 'reuse-transition', u.node, `${ref}: reused after ${seq[k - 1].node} but transition is fresh (keep/wipe/wash?)`);
      if (k > 0 && seq[k - 1].entry.hold) {
        const prev = seq[k - 1].node;
        const cs = consumers.get(prev) || [];
        if (!cs.includes(u.node) && !cs.every(c => anc(u.node).has(c)))
          add('error', 'eq-held', u.node, `${ref} still holds ${prev} (hold) until ${cs.join(', ')} takes it`);
      }
    });
  }

  // oven concurrency (ASAP)
  const events = ovenUsers.map(o => ({ ...o, s: start(o.id), e: end(o.id) })).filter(o => o.e > o.s);
  for (const o of events) {
    const live = events.filter(x => x.s <= o.s && x.e > o.s);
    const total = new Set(live.flatMap(x => x.keys)).size;
    if (total > OVEN_SLOTS) add('error', 'oven-slots', o.id, `at t=${o.s} min the oven holds ${total} trays (${live.map(x => x.id).join(', ')}); kitchen has ${OVEN_SLOTS}`);
    const settings = new Set(live.map(x => x.setting));
    if (settings.size > 1) add('error', 'oven-temp', o.id, `at t=${o.s} min the oven is needed at ${[...settings].join(' and ')} (${live.map(x => x.id).join(', ')})`);
  }
  const burners = stoveUsers.map(id => ({ id, s: start(id), e: end(id) }));
  for (const o of burners) {
    const live = burners.filter(x => x.s <= o.s && x.e > o.s);
    if (live.length > MAX_BURNERS) add('warning', 'burners', o.id, `${live.length} stovetop nodes at once at t=${o.s} min`);
  }
  return problems;
}

export function checkEquipment(loaded, ids, kitchenOverride) {
  const base = loaded || loadAll();
  const equipment = base.equipment || readJSON(join(DATA, 'equipment.json'));
  const kitchen = { ...DEFAULT_KITCHEN, ...(equipment.defaultKitchen || {}), ...(kitchenOverride || {}) };
  delete kitchen._doc;
  const ctx = { equipment, prepPacks: base.prepPacks, kitchen };
  const targets = ids && ids.length ? ids : Object.keys(base.masters).sort();
  const byRecipe = {};
  for (const mid of targets) byRecipe[mid] = checkRecipe(mid, base.masters[mid], ctx);
  // shared prep resource nodes must carry oven info
  for (const [pid, pack] of Object.entries(base.prepPacks)) for (const n of pack.nodes || [])
    if (isResource(n) && n.id.includes('oven') && !n.oven) (byRecipe[`prep/${pid}`] ||= []).push({ recipe: `prep/${pid}`, level: 'error', type: 'eq-bad-field', node: n.id, message: 'resource oven node lacks `oven: {temp}`' });
  const problems = Object.values(byRecipe).flat();
  const count = (lvl, ts) => Object.fromEntries(ts.map(t => [t, problems.filter(p => p.level === lvl && p.type === t).length]));
  const summary = { kitchen, recipesChecked: targets.length, errors: problems.filter(p => p.level === 'error').length,
    warnings: problems.filter(p => p.level === 'warning').length, errorsByType: count('error', ERROR_TYPES), warningsByType: count('warning', WARNING_TYPES) };
  return { byRecipe, problems, summary };
}

export const formatProblem = p => `${p.recipe}: ${p.type} ${p.node ? p.node + ': ' : ''}${p.message}`;

function main() {
  const argv = process.argv.slice(2);
  const kitchen = {};
  const ids = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--trays') kitchen.ovenTrays = Number(argv[++i]);
    else if (a.startsWith('--trays=')) kitchen.ovenTrays = Number(a.slice(8));
    else if (a === '--fan') kitchen.ovenFan = true;
    else if (a === '--no-fan') kitchen.ovenFan = false;
    else if (!a.startsWith('--')) ids.push(a);
  }
  if ('ovenTrays' in kitchen && !(Number.isInteger(kitchen.ovenTrays) && kitchen.ovenTrays >= 1)) { console.error('--trays needs an integer ≥ 1'); process.exit(2); }
  const { byRecipe, summary } = checkEquipment(null, ids, kitchen);
  if (argv.includes('--json')) { console.log(JSON.stringify({ summary, byRecipe }, null, 2)); }
  else {
    for (const [mid, list] of Object.entries(byRecipe)) {
      const ps = list.filter(p => !argv.includes('--errors-only') || p.level === 'error');
      if (!ps.length) continue;
      console.log(mid);
      for (const p of ps) console.log(`  ${p.level === 'error' ? 'ERROR' : 'WARN '} ${p.type.padEnd(18)} ${p.node ? p.node + ': ' : ''}${p.message}`);
    }
    const fmt = o => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    console.log(`\nKitchen: ${summary.kitchen.ovenTrays} oven tray(s), varmluft ${summary.kitchen.ovenFan ? 'ja' : 'nej'}.`);
    console.log(`Checked ${summary.recipesChecked} recipe(s). Errors: ${summary.errors} (${fmt(summary.errorsByType)}). Warnings: ${summary.warnings} (${fmt(summary.warningsByType)})`);
  }
  process.exit(summary.errors ? 1 : 0);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
