/**
 * Computes a cooking schedule for a DAG of recipe nodes with 1 or 2 cooks.
 *
 * - Wait time (oven, simmering, rising) does not occupy a cook; only active time does.
 * - Ready nodes are ordered by slack against the unlimited-cook critical path
 *   (latest start), then by remaining path length.
 * - Preppa först (config.prepFirst): cold prep (`prep` tag) is moved ahead only of
 *   steps that have slack to spare. Steps on the critical path (oven preheat before a
 *   long roast, boiling water, rising dough…) keep their early start. Several urgency
 *   thresholds are tried and the most prep-forward one that costs at most
 *   PREP_TOLERANCE minutes versus the plain schedule wins.
 * - Two cooks: a step stays with the cook who made its input when that cook is free,
 *   or free soon enough (a couple of minutes; longer for same-pan continuations and
 *   for trivial ≤2 min steps). Otherwise it goes to the free cook with the least
 *   hands-on time so far (P1 on a full tie). If keeping steps with their cook would
 *   cost more than AFFINITY_TOLERANCE minutes overall, the plain assignment is used.
 * - Equipment (SCHEMA.md "Equipment, heat & resources"): equipment[].after is a dependency
 *   like an input (preheated oven before baking, previous user of a reused pan), but not food.
 *   Oven uses are limited by the kitchen profile (config.kitchen = { ovenTrays, ovenFan }):
 *   concurrent uses may not need more than ovenTrays trays (a `ref`'d plåt counts once), and
 *   uses at different effective temperatures/modes may not overlap. A later use waits for the
 *   earlier one (same rule and [start, end) intervals as scripts/check-equipment.mjs).
 * - Preppa först: "Ta fram" nodes (soften butter, bring meat to room temperature) go first so
 *   their 30 min wait starts early.
 */

import { effectiveOven, isResource, recipeAfterIds, typeInfo } from '../core/equipment.js?v=20261021eq';
import { isTakeOutNode } from '../utils/prep-phase.js?v=20261021eq';

const PREP_TOLERANCE = 1;
const DEFAULT_KITCHEN = { ovenTrays: 2, ovenFan: false };
const AFFINITY_TOLERANCE = 1;
/** Urgency thresholds (minutes of slack) tried for Preppa först, most prep-forward first. */
const PREP_THRESHOLDS = [0, 1, 2, 4, 8, 'tie'];
const VESSEL_RE = /stekpanna|panna|kastrull|gryta|wok/;
const CONTINUE_RE = /samma (stek)?panna|samma kastrull|samma gryta|samma wok/;
const CONTINUE_START_RE = /^(tillsätt|häll (i|ner|över)|rör (ner|i)|lägg (i|ner)|vänd ner)/;

export class Scheduler {
  constructor(rootRecipe, allRecipes, config = {}) {
    this.root = rootRecipe;
    this.recipeMap = allRecipes instanceof Map
      ? allRecipes
      : (allRecipes?.byId instanceof Map
          ? allRecipes.byId
          : new Map((allRecipes || []).map(r => [r.outputIngredient.id, r])));
    this.config = config;
    this.kitchen = { ...DEFAULT_KITCHEN, ...(config.kitchen || {}) };
    this.threads = config.cooks || 1;
    this._init();
  }

  _init() {
    this.nodes = this._gatherNodes(this.root);
    this.nodeById = new Map(this.nodes.map(n => [n.id, n]));
    this._computeInfiniteSchedule();
    this._computeBottomLevels();
    this._computeLatestStarts();
    this.threads = Math.min(this.threads, this.maxThreads);
    this._computeResourceSchedule();
    this._layoutRows();
  }

  _gatherNodes(root) {
    const needed = new Set();
    const queue = [root];
    while (queue.length) {
      const r = queue.shift();
      if (!needed.has(r.outputIngredient.id)) {
        needed.add(r.outputIngredient.id);
        for (const inp of r.inputs) {
          const sub = this.recipeMap.get(inp.ingredient.id);
          if (sub) queue.push(sub);
        }
        // Equipment ordering: preheat resource, previous user of a reused vessel
        for (const aid of recipeAfterIds(r)) {
          const sub = this.recipeMap.get(aid);
          if (sub) queue.push(sub);
        }
      }
    }
    return Array.from(needed).map(id => {
      const recipe = this.recipeMap.get(id);
      const active = recipe.duration || 1;
      const wait = recipe.wait || 0;
      const inputDeps = [...new Set(recipe.inputs
        .map(i => i.ingredient.id)
        .filter(iid => this.recipeMap.has(iid)))];
      const eqDeps = recipeAfterIds(recipe)
        .filter(aid => this.recipeMap.has(aid) && !inputDeps.includes(aid));
      return {
        id,
        recipe,
        totalDuration: active + wait,
        activeDuration: active,
        deps: [...inputDeps, ...eqDeps],
        /** deps that are equipment ordering only (drawn dashed in the flow graph) */
        eqDeps,
        oven: this._ovenUse(recipe),
        start: 0,
        activeEnd: 0,
        end: 0,
        row: 0
      };
    });
  }

  /**
   * Oven use of a node: trays it occupies (a ref'd plåt/form is one key, so two nodes on
   * the same shared plåt count once) and its effective setting under the kitchen profile.
   * @returns {{ keys: string[], setting: string, text: string }|null}
   */
  _ovenUse(recipe) {
    if (isResource(recipe)) return null;
    const eq = recipe.equipment || [];
    const ov = eq.find(e => e.type === 'ugn');
    if (!ov) return null;
    const keys = [];
    for (const e of eq) {
      const t = typeInfo(e.type);
      if (!t || !e.ref) continue;
      if (t.kind === 'ovenware' || t.ovenSafe) {
        for (let k = 0; k < (t.ovenSlots || 1); k++) keys.push(`${e.ref}#${k}`);
      }
    }
    const need = Math.max(1, Number.isInteger(ov.slots) ? ov.slots : 1);
    while (keys.length < need) keys.push(`${recipe.outputIngredient.id}:slot${keys.length}`);
    const o = effectiveOven(ov, this.kitchen);
    return { keys, setting: o.key, text: o.text };
  }

  /** Can n use the oven during [s, s + totalDuration) next to the already placed uses? */
  _ovenFits(n, s, ovenPlaced) {
    const e = s + n.totalDuration;
    if (!(e > s)) return true;
    const cap = Math.max(1, Number(this.kitchen.ovenTrays) || 1);
    const overlap = ovenPlaced.filter(o => o.s < e - 1e-9 && o.e > s + 1e-9);
    if (!overlap.length) return true;
    if (overlap.some(o => o.setting !== n.oven.setting)) return false;
    if (n.oven.keys.length > cap) return false; // needs the whole oven (and more): run alone
    const points = [s, ...overlap.map(o => o.s).filter(p => p > s && p < e)];
    for (const p of points) {
      const live = overlap.filter(o => o.s <= p + 1e-9 && o.e > p + 1e-9);
      const keys = new Set(n.oven.keys);
      for (const o of live) for (const k of o.keys) keys.add(k);
      if (keys.size > cap) return false;
    }
    return true;
  }

  /** Earliest t' ≥ t at which n's oven use fits (t itself for nodes without an oven use). */
  _ovenStart(n, t, ovenPlaced) {
    if (!n.oven || !ovenPlaced.length) return t;
    const times = [t, ...ovenPlaced.map(o => o.e).filter(x => x > t)].sort((a, b) => a - b);
    for (const c of times) if (this._ovenFits(n, c, ovenPlaced)) return c;
    return times[times.length - 1];
  }

  /** Unlimited-cook ASAP schedule (dependency order) → max useful parallelism. */
  _computeInfiniteSchedule() {
    const map = this.nodeById;
    const memo = new Map();
    const visiting = new Set();
    const startOf = (node) => {
      if (memo.has(node.id)) return memo.get(node.id);
      if (visiting.has(node.id)) return 0; // cycle guard
      visiting.add(node.id);
      const s = node.deps.length
        ? Math.max(...node.deps.map(d => { const dn = map.get(d); return startOf(dn) + dn.totalDuration; }))
        : 0;
      visiting.delete(node.id);
      memo.set(node.id, s);
      return s;
    };
    this.nodes.forEach(node => {
      node.start = startOf(node);
      node.activeEnd = node.start + node.activeDuration;
      node.end = node.start + node.totalDuration;
    });
    const events = this.nodes.flatMap(n => [
      { t: n.start, d: +1 },
      { t: n.activeEnd, d: -1 }
    ]).sort((a, b) => a.t - b.t || a.d - b.d);
    let conc = 0;
    this.maxThreads = 0;
    for (const ev of events) {
      conc += ev.d;
      this.maxThreads = Math.max(this.maxThreads, conc);
    }
    this.maxThreads = Math.max(1, this.maxThreads);
  }

  _computeBottomLevels() {
    this.bottomLevel = {};
    const children = {};
    this.nodes.forEach(n => { children[n.id] = []; });
    this.nodes.forEach(n => n.deps.forEach(d => children[d].push(n.id)));
    const dfs = id => {
      if (this.bottomLevel[id] != null) return this.bottomLevel[id];
      const node = this.nodeById.get(id);
      const maxChild = children[id].length
        ? Math.max(...children[id].map(did => dfs(did)))
        : 0;
      return this.bottomLevel[id] = node.totalDuration + maxChild;
    };
    this.nodes.forEach(n => dfs(n.id));
  }

  _computeLatestStarts() {
    this.criticalPath = Math.max(...this.nodes.map(n => n.end));
    this.latestStart = {};
    this.nodes.forEach(n => {
      this.latestStart[n.id] = this.criticalPath - this.bottomLevel[n.id];
    });
  }

  _isPrep(node) {
    return !!(node.recipe.hasTag && node.recipe.hasTag('prep'));
  }

  _text(node) {
    if (node._text != null) return node._text;
    const r = node.recipe;
    const steps = (r.steps || []).map(s => Array.isArray(s)
      ? s.map(x => (typeof x === 'string' ? x : (x?.ingredient?.json?.name || x?.ingredient?.name || x?.name || ''))).join('')
      : String(s));
    node._firstStep = (steps[0] || '').trim().toLowerCase();
    node._text = steps.join(' ').toLowerCase();
    return node._text;
  }

  /**
   * n continues in the vessel dep was cooked in (e.g. Stek salsiccia → Sjud tomatsås).
   * Uses equipment refs (same `ref` = same physical pan/pot/plåt). Nodes without any
   * equipment data (e.g. generated spice-mix steps) fall back to the step text.
   */
  _sameVessel(dep, n) {
    const dEq = dep.recipe.equipment;
    const nEq = n.recipe.equipment;
    if (Array.isArray(dEq) || Array.isArray(nEq)) {
      const isVessel = (e) => { const k = typeInfo(e.type)?.kind; return k === 'stovetop' || k === 'ovenware'; };
      const refs = new Set((dEq || []).filter(e => e.ref && isVessel(e)).map(e => e.ref));
      return (nEq || []).some(e => e.ref && refs.has(e.ref));
    }
    if (!VESSEL_RE.test(this._text(dep))) return false;
    const t = this._text(n);
    if (CONTINUE_RE.test(t)) return true;
    return CONTINUE_START_RE.test(n._firstStep) && !/hetta upp/.test(t);
  }

  /**
   * Cook who should preferably continue with n: the cook of its most recently
   * finished input (resource nodes such as a preheated oven do not count).
   * @returns {{ cook: string, tol: number }|null}
   */
  _preferredCook(n, placed) {
    let best = null;
    for (const d of n.deps) {
      const dn = this.nodeById.get(d);
      const p = placed.get(d);
      if (!dn || !p || !p.cook) continue;
      if (isResource(dn.recipe)) continue;
      if (!dn.recipe.inputs || dn.recipe.inputs.length === 0) continue;
      if (!best || p.activeEnd > best.p.activeEnd ||
          (p.activeEnd === best.p.activeEnd && dn.activeDuration > best.dn.activeDuration)) {
        best = { dn, p };
      }
    }
    if (!best) return null;
    let tol = 2;
    if (n.activeDuration <= 2) tol = 3;
    if (this._sameVessel(best.dn, n)) tol = 5;
    return { cook: best.p.cook, tol };
  }

  _priorityKey(node, now, prepK) {
    const slack = this.latestStart[node.id] - now;
    const bl = -this.bottomLevel[node.id];
    if (prepK == null) return [slack, bl];
    const prep = this._isPrep(node);
    // "Ta fram" (soften butter / bring meat to room temp) first: its long wait starts early
    const takeOut = prep && isTakeOutNode(node.recipe) ? 0 : 1;
    if (prepK === 'tie') return [takeOut, slack, prep ? 0 : 1, bl];
    const group = prep ? 1 : (slack <= prepK ? 0 : 2);
    return [takeOut, group, slack, bl];
  }

  /**
   * One list-scheduling pass.
   * @param {{ prepK?: number|'tie'|null, affinity?: boolean, lookahead?: boolean, p1First?: boolean }} opts
   * @returns {{ total: number, placed: Map<string, {start:number, activeEnd:number, end:number, cook:string|null}> }}
   */
  _simulate({ prepK = null, affinity = false, lookahead = false, p1First = false } = {}) {
    const cooks = this.threads >= 2 ? ['P1', 'P2'] : ['P1'];
    const free = { P1: 0, P2: 0 };
    const hands = { P1: 0, P2: 0 };
    const placed = new Map();
    const ovenPlaced = [];
    const remaining = new Set(this.nodes.map(n => n.id));
    const depsReady = (n) => n.deps.length ? Math.max(...n.deps.map(d => placed.get(d).end)) : 0;
    const readyAt = (n) => this._ovenStart(n, depsReady(n), ovenPlaced);
    const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

    while (remaining.size) {
      const cands = [];
      for (const id of remaining) {
        const n = this.nodeById.get(id);
        if (n.deps.every(d => placed.has(d))) cands.push({ n, r: readyAt(n) });
      }
      if (!cands.length) break; // cycle; should not happen
      const minFree = Math.min(...cooks.map(c => free[c]));
      const T = Math.max(minFree, Math.min(...cands.map(c => c.r)));
      const ready = cands.filter(c => c.r <= T + 1e-9)
        .map(c => ({ ...c, key: this._priorityKey(c.n, T, prepK) }))
        .sort((a, b) => cmp(a.key, b.key));
      // Highest-priority ready step, unless (lookahead) starting it would block a
      // critical step that becomes ready meanwhile; then take a step that fits in the
      // gap, or wait for the critical one.
      let pickIdx = 0;
      let waitUntil = null;
      if (lookahead) {
        pickIdx = -1;
        for (let i = 0; i < ready.length; i++) {
          const t2 = this._criticalSoon(ready[i].n, T, cands, cooks, free);
          if (t2 == null) { pickIdx = i; break; }
          waitUntil = waitUntil == null ? t2 : Math.min(waitUntil, t2);
        }
        if (pickIdx < 0) {
          const idleCook = cooks.filter(c => free[c] <= T + 1e-9)
            .sort((a, b) => (hands[a] - hands[b]) || (a < b ? -1 : 1))[0];
          free[idleCook] = waitUntil;
          continue;
        }
      }
      const { n, r } = ready[pickIdx];

      let cook = 'P1';
      if (cooks.length > 1) {
        const pref = affinity ? this._preferredCook(n, placed) : null;
        // Wait for the producing cook only when n has slack; critical steps never wait.
        const tol = pref && this.latestStart[n.id] - T > 0 ? pref.tol : 0;
        if (pref && free[pref.cook] <= T + tol + 1e-9) {
          cook = pref.cook;
        } else {
          const freeCooks = cooks.filter(c => free[c] <= T + 1e-9);
          freeCooks.sort((a, b) => (p1First ? 0 : hands[a] - hands[b]) || (a < b ? -1 : 1));
          cook = freeCooks[0];
        }
      }
      const start = this._ovenStart(n, Math.max(free[cook], r), ovenPlaced);
      const activeEnd = start + n.activeDuration;
      placed.set(n.id, { start, activeEnd, end: start + n.totalDuration, cook: cooks.length > 1 ? cook : null });
      if (n.oven) ovenPlaced.push({ id: n.id, s: start, e: start + n.totalDuration, keys: n.oven.keys, setting: n.oven.setting });
      free[cook] = activeEnd;
      hands[cook] += n.activeDuration;
      remaining.delete(n.id);
    }
    const total = Math.max(0, ...[...placed.values()].map(p => p.end));
    return { total, placed };
  }

  /**
   * Critical step m (no slack left when it becomes ready) that becomes ready after T
   * but before n would finish, with no cook free to take it at that moment.
   * @returns {number|null} the time to wait until, or null to go ahead with n
   */
  _criticalSoon(n, T, cands, cooks, free) {
    const nSlack = this.latestStart[n.id] - T;
    if (nSlack <= 0) return null;
    const nEnd = T + n.activeDuration;
    let best = null;
    for (const { n: m, r } of cands) {
      if (m === n || r <= T + 1e-9 || r >= nEnd - 1e-9) continue;
      if (this.latestStart[m.id] - r > 0) continue;
      const othersFree = cooks.filter(c => free[c] > T + 1e-9).some(c => free[c] <= r + 1e-9);
      if (othersFree) continue;
      if (best == null || r < best) best = r;
    }
    return best;
  }

  /**
   * Best schedule for one Preppa först threshold. Variants are tried in order of
   * preference (keep steps with their cook, critical lookahead); the first one within
   * tolerance of the fastest wins.
   */
  _bestRun(prepK) {
    const variants = this.threads >= 2
      ? [{ affinity: true, lookahead: true }, { affinity: true }, { lookahead: true }, {},
          { lookahead: true, p1First: true }, { p1First: true }]
      : [{ lookahead: true }, {}];
    const runs = variants.map(v => ({ v, r: this._simulate({ prepK, ...v }) }));
    const fastest = Math.min(...runs.map(x => x.r.total));
    const pick = runs.find(x => x.r.total <= fastest + (x.v.affinity ? AFFINITY_TOLERANCE : 0));
    return pick.r;
  }

  _computeResourceSchedule() {
    const base = this._bestRun(null);
    let run = base;
    if (this.config.prepFirst) {
      run = null;
      for (const k of PREP_THRESHOLDS) {
        const r = this._bestRun(k);
        if (r.total <= base.total + PREP_TOLERANCE) { run = r; break; }
      }
      if (!run) run = base;
    }
    this.nodes.forEach(n => {
      const p = run.placed.get(n.id);
      n.start = p.start;
      n.activeEnd = p.activeEnd;
      n.end = p.end;
      if (p.cook) n.assignedCook = p.cook;
      else delete n.assignedCook;
    });
    this.totalTime = run.total;
  }

  _layoutRows() {
    const rows = [];
    this.nodes.sort((a, b) => a.start - b.start)
      .forEach(node => {
        let placed = false;
        for (let r = 0; r < rows.length; r++) {
          const last = rows[r][rows[r].length - 1];
          if (node.start >= last.end) {
            rows[r].push(node);
            node.row = r;
            placed = true;
            break;
          }
        }
        if (!placed) {
          node.row = rows.length;
          rows.push([node]);
        }
      });
    this.rows = rows;
  }

  getSchedule() {
    return {
      nodes: this.nodes,
      rows: this.rows,
      totalTime: this.totalTime,
      maxThreads: this.maxThreads,
      threads: this.threads
    };
  }
}
