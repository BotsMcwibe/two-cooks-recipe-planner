/**
 * Prep phase for "Preppa först".
 *
 * Prep rule: a node is prep when its recipe is tagged `prep` (the same tag the
 * Scheduler prioritises with prepFirst, and what the old prep/cook split counted;
 * its step-word fallback only matched plain-string steps, which parsed steps never are).
 *
 * A prep node can only be in the prep phase if everything it depends on is too.
 * Prep-tagged nodes that consume cooked output (e.g. "Skiva kyckling" after
 * "Rosta kyckling") cannot run before cooking starts, so they belong to the cook
 * phase. The Scheduler treats them the same way: they get priority only once ready.
 * The master node is always in the cook phase.
 *
 * @param {Array<{id:string, recipe:object, deps:string[]}>} nodes Scheduler nodes
 * @param {string} rootId master node id
 * @returns {Set<string>} ids of nodes in the prep phase
 */
export function prepPhaseIds(nodes, rootId) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const memo = new Map();
  const isPrep = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    const n = byId.get(id);
    if (!n || id === rootId || seen.has(id)) return false;
    seen.add(id);
    const tagged = !!(n.recipe && n.recipe.hasTag && n.recipe.hasTag('prep'));
    const v = tagged && n.deps.every(d => !byId.has(d) || isPrep(d, seen));
    memo.set(id, v);
    return v;
  };
  const out = new Set();
  for (const n of nodes) if (isPrep(n.id)) out.add(n.id);
  return out;
}

/** True when the recipe carries the `prep` tag (badge display). */
export function isPrepTagged(recipe) {
  return !!(recipe && recipe.hasTag && recipe.hasTag('prep'));
}
