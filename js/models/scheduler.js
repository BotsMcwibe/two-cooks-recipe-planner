/**
 * Computes a schedule for a DAG of recipes under a thread-limit.
 * Uses Map lookups instead of linear Array.find.
 */
export class Scheduler {
  constructor(rootRecipe, allRecipes, config = {}) {
    this.root = rootRecipe;
    this.recipeMap = allRecipes instanceof Map
      ? allRecipes
      : (allRecipes?.byId instanceof Map
          ? allRecipes.byId
          : new Map((allRecipes || []).map(r => [r.outputIngredient.id, r])));
    this.config = config;
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
      }
    }
    return Array.from(needed).map(id => {
      const recipe = this.recipeMap.get(id);
      const active = recipe.duration || 1;
      const wait = recipe.wait || 0;
      return {
        id,
        recipe,
        totalDuration: active + wait,
        activeDuration: active,
        deps: recipe.inputs
          .map(i => i.ingredient.id)
          .filter(iid => this.recipeMap.has(iid)),
        start: 0,
        activeEnd: 0,
        end: 0,
        row: 0
      };
    });
  }

  _computeInfiniteSchedule() {
    const map = this.nodeById;
    const sorted = [...this.nodes].sort((a, b) => a.deps.length - b.deps.length);
    sorted.forEach(node => {
      node.start = node.deps.length
        ? Math.max(...node.deps.map(d => map.get(d).start + map.get(d).totalDuration))
        : 0;
      node.activeEnd = node.start + node.activeDuration;
      node.end = node.start + node.totalDuration;
    });
    const events = this.nodes.flatMap(n => [
      { t: n.start, d: +1 },
      { t: n.activeEnd, d: -1 }
    ]).sort((a, b) => a.t - b.t || b.d - a.d);
    let conc = 0;
    this.maxThreads = 0;
    for (const ev of events) {
      conc += ev.d;
      this.maxThreads = Math.max(this.maxThreads, conc);
    }
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

  _sortReady(ready, now) {
    if (this.config.prepFirst) {
      ready.sort((a, b) => {
        const aPrep = a.recipe.hasTag && a.recipe.hasTag("prep");
        const bPrep = b.recipe.hasTag && b.recipe.hasTag("prep");
        if (aPrep !== bPrep) return bPrep - aPrep;
        const slackA = this.latestStart[a.id] - now;
        const slackB = this.latestStart[b.id] - now;
        if (slackA !== slackB) return slackA - slackB;
        return this.bottomLevel[b.id] - this.bottomLevel[a.id];
      });
    } else {
      ready.sort((a, b) => {
        const slackA = this.latestStart[a.id] - now;
        const slackB = this.latestStart[b.id] - now;
        if (slackA !== slackB) return slackA - slackB;
        return this.bottomLevel[b.id] - this.bottomLevel[a.id];
      });
    }
  }

  _computeResourceSchedule() {
    const depCount = Object.fromEntries(this.nodes.map(n => [n.id, n.deps.length]));
    const ready = this.nodes.filter(n => depCount[n.id] === 0);
    let available = this.threads;
    let time = 0;
    this._sortReady(ready, time);
    const events = [];

    const cookSchedule = this.threads === 2 ? { P1: [], P2: [] } : null;

    while (ready.length || events.length) {
      while (available > 0 && ready.length) {
        const node = ready.shift();
        node.start = time;
        node.activeEnd = time + node.activeDuration;
        node.end = time + node.totalDuration;

        if (cookSchedule) {
          node.assignedCook = this._assignOptimalCook(node, cookSchedule, time);
        }

        events.push({ time: node.activeEnd, type: 'thread', node });
        events.push({ time: node.end, type: 'dep', node });
        available--;
      }
      if (!events.length) break;
      events.sort((a, b) => a.time - b.time);
      const ev = events.shift();
      time = ev.time;
      if (ev.type === 'thread') {
        available++;
      } else {
        this.nodes.forEach(child => {
          if (child.deps.includes(ev.node.id)) {
            depCount[child.id]--;
            if (depCount[child.id] === 0) {
              ready.push(child);
              this._sortReady(ready, time);
            }
          }
        });
      }
    }
    this.totalTime = Math.max(...this.nodes.map(n => n.end));
  }

  _assignOptimalCook(node, cookSchedule, currentTime) {
    const p1Available = this._getCookAvailableTime(cookSchedule.P1, currentTime);
    const p2Available = this._getCookAvailableTime(cookSchedule.P2, currentTime);

    const assignedCook = p1Available <= p2Available ? 'P1' : 'P2';

    cookSchedule[assignedCook].push({
      start: node.start,
      end: node.activeEnd,
      recipe: node.recipe.name
    });

    return assignedCook;
  }

  _getCookAvailableTime(cookTasks, currentTime) {
    if (cookTasks.length === 0) return currentTime;
    const latestEnd = Math.max(...cookTasks.map(task => task.end));
    return Math.max(latestEnd, currentTime);
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
