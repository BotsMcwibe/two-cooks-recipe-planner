// Unit class
class Unit {
  constructor(name, abbreviation, type = "other", baseUnit = null, conversionFactor = 1) {
    this.name = name;
    this.abbreviation = abbreviation;
    this.type = type; // "volume", "weight", "count", "other"
    this.baseUnit = baseUnit || abbreviation;
    this.conversionFactor = conversionFactor;
  }

  /**
   * Convert amount from this unit to base unit
   * @param {number} amount - Amount in this unit
   * @returns {number} Amount in base unit
   */
  toBaseUnit(amount) {
    return amount * this.conversionFactor;
  }

  /**
   * Convert amount from base unit to this unit
   * @param {number} baseAmount - Amount in base unit
   * @returns {number} Amount in this unit
   */
  fromBaseUnit(baseAmount) {
    return baseAmount / this.conversionFactor;
  }

  /**
   * Check if this unit can be converted to another unit
   * @param {Unit} otherUnit - Unit to check compatibility with
   * @returns {boolean} True if units are compatible
   */
  isCompatibleWith(otherUnit) {
    return this.type === otherUnit.type && this.baseUnit === otherUnit.baseUnit;
  }
}

// Ingredient class
class Ingredient {
  constructor(json, id = null) {
    this.json = json; // Save the full JSON object
    this.id = id;
  }
  get name() {
    return this.json.name;
  }
  get tags() {
    return this.json.tags || [];
  }
  get primaryTag() {
    return this.tags.length > 0 ? this.tags[0] : 'other';
  }
  get category() {
    // Backward compatibility - return the primary tag
    return this.primaryTag;
  }
  hasTag(tag) {
    return this.tags.includes(tag);
  }
  // Add more getters here if you add more fields to the JSON
}

// RecipeBuilder.js
// Builder for creating recipe JSON matching the recipesData structure
class RecipeBuilder {
  constructor(id, name) {
    this.recipe = {
      id: id,
      name: name,
      inputs: [],
      outputName: "",
      steps: [],
      duration: 5,
      wait: -0.01,
      tips: [], // Add tips array
      tags: [], // Add tags array
    };
  }

  setId(id) {
    this.recipe.id = id;
    return this;
  }

  setName(name) {
    this.recipe.name = name;
    return this;
  }

  output(outputName) {
    this.recipe.outputName = outputName;
    return this;
  }

  duration(duration) {
    this.recipe.duration = duration;
    return this;
  }

  wait(wait) {
    this.recipe.wait = wait;
    return this;
  }

  input(id, amount, unit) {
    this.recipe.inputs.push({ id, amount, unit });
    return this;
  }

  step(step) {
    this.recipe.steps.push(step);
    return this;
  }

  steps(steps) {
    this.recipe.steps = steps;
    return this;
  }

  inputs(inputs) {
    this.recipe.inputs = inputs;
    return this;
  }

  tips(tips) {
    this.recipe.tips = tips;
    return this;
  }

  tip(tip) {
    this.recipe.tips.push(tip);
    return this;
  }

  tags(tags) {
    this.recipe.tags = tags;
    return this;
  }

  tag(tag) {
    this.recipe.tags.push(tag);
    return this;
  }

  build() {
    if (
      !this.recipe.id ||
      !this.recipe.name ||
      !this.recipe.outputName ||
      this.recipe.steps.length === 0
    ) {
      throw new Error(
        "Recipe must have an id, name, outputName, and at least one step."
      );
    }
    return { ...this.recipe };
  }
}

// Helper function to parse step templates
function parseStepTemplate(stepString, ingredientMap) {
  const re = /\{\{([^}]+)\}\}/g;
  let last = 0,
    m;
  const parts = [];
  while ((m = re.exec(stepString))) {
    if (m.index > last) {
      parts.push(stepString.slice(last, m.index));
    }
    const id = m[1].trim();
    if (!ingredientMap[id]) {
      throw new Error(`Unknown ingredient "${id}" in step`);
    }
    parts.push({ type: "ingredient", ingredient: ingredientMap[id] });
    last = re.lastIndex;
  }
  if (last < stepString.length) {
    parts.push(stepString.slice(last));
  }
  return parts;
}

// Recipe class
class Recipe {
  constructor(
    name,
    inputs = [],
    outputId = null,
    outputConfig = {}, // { name?:string, unit?:Unit }
    steps = [],
    duration = 0,
    outputAmount = 1,
    tips = [], // Add tips to constructor
    tags = [], // Add tags to constructor
    ingredientMap = null // Optional ingredient map for backwards compatibility
  ) {    this.name = name;
    this.inputs = inputs;
    if (typeof outputId === "string") {
      // Use provided ingredient map or fallback to global (for backwards compatibility)
      const ingMap = ingredientMap || (typeof window !== 'undefined' && window.ingredientMap);
      if (ingMap && !ingMap[outputId]) {
        // create a new ingredient if it doesn't exist
        const ingName = outputConfig.name || name;
        ingMap[outputId] = new Ingredient({ name: ingName }, outputId);
      }
      this.outputIngredient = ingMap ? ingMap[outputId] : null;
    } else {
      this.outputIngredient = outputId;
    }
    this.steps = steps;
    this.duration = duration;
    this.outputAmount = outputAmount;
    this.tips = tips; // Store tips
    this.tags = tags; // Store tags
  }

  // fromJSON and hasTag defined once below

  // Add recipe scaling methods
  scaleRecipe(scaleFactor) {
    const scaledRecipe = new Recipe(
      this.name,
      this.inputs.map(input => ({
        ingredient: input.ingredient,
        amount: this.scaleAmount(input.amount, scaleFactor),
        unit: input.unit
      })),
      this.outputIngredient,
      {},
      this.steps, // Steps don't change with scaling
      this.duration, // Duration doesn't change with scaling
      this.outputAmount * scaleFactor,
      this.tips,
      this.tags
    );
    
    // Copy other properties
    scaledRecipe.wait = this.wait;
    return scaledRecipe;
  }
  scaleAmount(amount, scaleFactor) {
    // For very small amounts (like spices), we might want different scaling logic
    const scaled = amount * scaleFactor;
    
    // Handle special cases for common fractions
    if (Math.abs(scaled - 0.25) < 0.1) return 0.25; // ¼
    if (Math.abs(scaled - 0.5) < 0.1) return 0.5;   // ½
    if (Math.abs(scaled - 0.75) < 0.1) return 0.75; // ¾
    if (Math.abs(scaled - 1.5) < 0.1) return 1.5;   // 1½
    if (Math.abs(scaled - 2.5) < 0.1) return 2.5;   // 2½
    
    // Round to reasonable precision
    if (scaled < 1) {
      return Math.round(scaled * 100) / 100; // 2 decimal places for small amounts
    } else if (scaled < 10) {
      return Math.round(scaled * 10) / 10; // 1 decimal place for medium amounts
    } else {
      return Math.round(scaled); // Whole numbers for large amounts
    }
  }

  static fromJSON(data, ingMap, unitMap) {
    // Create the output ingredient if it doesn't exist
    if (!ingMap[data.id]) {
      const ingName = data.outputName || data.name;
      ingMap[data.id] = new Ingredient({ name: ingName }, data.id);
    }
    
    const rec = new Recipe(
      data.name, 
      [], 
      ingMap[data.id], 
      { name: data.outputName }, 
      [], 
      0, 
      1, 
      [], 
      [], 
      ingMap // Pass the ingredient map
    );
    
    // Set the recipe ID
    rec.id = data.id;
    rec.duration = data.duration;
    rec.wait = data.wait || 0;
    rec.steps = data.steps.map(step => parseStepTemplate(step, ingMap));
    rec.inputs = data.inputs.map((i) => ({
      ingredient: ingMap[i.id],
      amount: i.amount,
      unit: unitMap[i.unit],
    }));
    rec.tips = data.tips || [];
    rec.tags = data.tags || [];
    return rec;
  }

  hasTag(tag) {
    return this.tags && this.tags.includes(tag);
  }
}

/**
 * Computes a schedule for a DAG of recipes under a thread-limit.
 */
class Scheduler {
    /**
     * @param {Recipe} rootRecipe
     * @param {Recipe[]} allRecipes
     * @param {Object} config Optional config object (e.g., { prepFirst: true })
     */
    constructor(rootRecipe, allRecipes, config = {}) {
        this.root = rootRecipe;
        this.recipes = allRecipes;
        this.config = config;
        this.threads = config.cooks || 1; // default to 1 thread
        this._init();
    }

    _init() {
        this.nodes = this._gatherNodes(this.root);
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
                    const sub = this.recipes.find(rr => rr.outputIngredient.id === inp.ingredient.id);
                    if (sub) queue.push(sub);
                }
            }
        }
        return Array.from(needed).map(id => {
            const recipe = this.recipes.find(r => r.outputIngredient.id === id);
            const active = recipe.duration || 1;
            const wait   = recipe.wait     || 0;
            return {
                id,
                recipe,
                totalDuration:  active + wait,
                activeDuration: active,
                deps: recipe.inputs
                           .map(i => i.ingredient.id)
                           .filter(iid => this.recipes.some(r => r.outputIngredient.id === iid)),
                start: 0,
                activeEnd: 0,
                end: 0,
                row: 0
            };
        });
    }

    _computeInfiniteSchedule() {
        const map = Object.fromEntries(this.nodes.map(n => [n.id, n]));
        const sorted = [...this.nodes].sort((a, b) => a.deps.length - b.deps.length);
        sorted.forEach(node => {
            node.start     = node.deps.length
                                ? Math.max(...node.deps.map(d => map[d].start + map[d].totalDuration))
                                : 0;
            node.activeEnd = node.start + node.activeDuration;
            node.end       = node.start + node.totalDuration;
        });
        // track max concurrent active tasks
        const events = this.nodes.flatMap(n => [
            { t: n.start,     d: +1 },
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
        this.nodes.forEach(n => children[n.id] = []);
        this.nodes.forEach(n => n.deps.forEach(d => children[d].push(n.id)));
        const dfs = id => {
            if (this.bottomLevel[id] != null) return this.bottomLevel[id];
            const node = this.nodes.find(n => n.id === id);
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
                if (aPrep !== bPrep) return bPrep - aPrep; // prep first
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
        
        // Track cook assignments for two-cook mode
        const cookSchedule = this.threads === 2 ? { P1: [], P2: [] } : null;
        let nextCook = 'P1';

        while (ready.length || events.length) {
            while (available > 0 && ready.length) {
                const node = ready.shift();
                node.start     = time;
                node.activeEnd = time + node.activeDuration;
                node.end       = time + node.totalDuration;
                
                // Assign cook for two-cook mode
                if (cookSchedule) {
                    node.assignedCook = this._assignOptimalCook(node, cookSchedule, time);
                }
                
                events.push({ time: node.activeEnd, type: 'thread', node });
                events.push({ time: node.end,       type: 'dep',    node });
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
        // Find which cook will be available earliest
        const p1Available = this._getCookAvailableTime(cookSchedule.P1, currentTime);
        const p2Available = this._getCookAvailableTime(cookSchedule.P2, currentTime);
        
        let assignedCook;
        if (p1Available <= p2Available) {
            assignedCook = 'P1';
        } else {
            assignedCook = 'P2';
        }
        
        // Add this task to the cook's schedule
        cookSchedule[assignedCook].push({
            start: node.start,
            end: node.activeEnd,
            recipe: node.recipe.name
        });
        
        return assignedCook;
    }
    
    _getCookAvailableTime(cookTasks, currentTime) {
        if (cookTasks.length === 0) return currentTime;
        
        // Find the latest end time for this cook
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

    /**
     * Returns computed schedule data for visualization.
     */
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
