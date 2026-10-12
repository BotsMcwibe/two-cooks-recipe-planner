/**
 * Loader-time spice mix steps.
 *
 * Every spice mix (ingredient with `blendId`) used by a recipe gets its own
 * prep node `<master>__kryddmix_<mixId>`:
 *   - normal:  "Kryddmix: <namn>" measuring out the mix (one input, grams),
 *   - "Har inte mixen": "Blanda <namn>" with the blend's components, scaled to
 *     the recipe's grams (graph scaling then follows portions).
 * Steps that used the mix now take the node's output instead. When a packet is
 * split over several steps, one shared node feeds them all; each consumer gets
 * its share (grams / total) so the derived-input rule shows "½ <namn>".
 */

const TSK_ML = 5;

/**
 * Amount → grams for a mix. g/kg direct; förp = packet (or store bag);
 * volume units via gramsPerTsk (default 2.5 g per tsk of ground blend).
 * @returns {number|null}
 */
export function mixAmountToGrams(amount, unitAbbr, blend, unitMap) {
  const a = Number(amount);
  if (!Number.isFinite(a)) return null;
  if (unitAbbr === 'g') return a;
  if (unitAbbr === 'kg') return a * 1000;
  if (unitAbbr === 'förp' || unitAbbr === 'pkt' || unitAbbr === 'påse') {
    return blend ? a * (blend.bag || blend.packetGrams) : null;
  }
  const u = unitMap && unitMap[unitAbbr];
  if (u && u.type === 'volume') {
    const ml = a * (u.conversionFactor || 1);
    const perTsk = (blend && blend.gramsPerTsk) || 2.5;
    return (ml / TSK_ML) * perTsk;
  }
  return null;
}

const round1 = (g) => Math.round(g * 10) / 10;

/**
 * Rewrite raw recipe nodes in place-free fashion.
 * @param {Array<object>} nodes raw JSON nodes (shared prep + local)
 * @param {string} masterId
 * @param {{ mixIngredients: Record<string, object>, blendsById: Record<string, object>,
 *           spiceIngredientId: Record<string,string>, unitMap: object, isMissing: (id:string)=>boolean }} ctx
 * @returns {{ nodes: Array<object>, mixes: Array<object> }}
 */
export function addSpiceMixSteps(nodes, masterId, ctx) {
  const { mixIngredients, blendsById, spiceIngredientId, unitMap, isMissing } = ctx;
  // mixId -> [{ node, index, grams }]
  const uses = new Map();
  for (const node of nodes) {
    (node.inputs || []).forEach((inp, index) => {
      const ing = mixIngredients[inp.id];
      if (!ing) return;
      const blend = blendsById[ing.blendId] || null;
      const grams = mixAmountToGrams(inp.amount, inp.unit, blend, unitMap);
      if (grams == null || grams <= 0) return;
      if (!uses.has(inp.id)) uses.set(inp.id, []);
      uses.get(inp.id).push({ node, index, grams });
    });
  }
  if (!uses.size) return { nodes, mixes: [] };

  const out = nodes.map(n => ({ ...n, inputs: [...(n.inputs || [])], steps: [...(n.steps || [])] }));
  const byId = new Map(out.map(n => [n.id, n]));
  const mixes = [];
  const added = [];

  for (const [mixId, list] of uses) {
    const ing = mixIngredients[mixId];
    const blend = blendsById[ing.blendId] || null;
    const name = ing.name;
    const total = list.reduce((s, u) => s + u.grams, 0);
    const nodeId = `${masterId}__kryddmix_${mixId}`;
    const missing = !!(blend && isMissing(mixId));

    let mixNode;
    if (missing) {
      const scale = total / blend.packetGrams;
      const comps = Object.entries(blend.spices)
        .map(([key, g]) => ({ id: spiceIngredientId[key], amount: round1(g * scale) }))
        .filter(c => c.id && c.amount > 0);
      const refs = comps.map(c => `{{${c.id}}}`);
      const list = refs.length > 1 ? `${refs.slice(0, -1).join(', ')} och ${refs[refs.length - 1]}` : refs[0];
      mixNode = {
        id: nodeId,
        name: `Blanda ${name}`,
        outputName: name,
        inputs: comps.map(c => ({ id: c.id, amount: c.amount, unit: 'g' })),
        steps: [`Blanda ${list} i en liten skål.`],
        duration: 2, wait: 0,
        tags: ['prep', 'no-timer', 'spice-mix', 'spice-mix-homemade'],
      };
    } else {
      mixNode = {
        id: nodeId,
        name: `Kryddmix: ${name}`,
        outputName: name,
        inputs: [{ id: mixId, amount: round1(total), unit: 'g' }],
        steps: [`Mät upp {{${mixId}}}.`],
        duration: 1, wait: 0,
        tags: ['prep', 'no-timer', 'spice-mix'],
      };
    }
    added.push(mixNode);

    // Point consumers at the mix node (share of the batch), and their step text too
    const ref = new RegExp(`\\{\\{${mixId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g');
    for (const u of list) {
      const n = byId.get(u.node.id);
      n.inputs[u.index] = { id: nodeId, amount: Math.round((u.grams / total) * 1000) / 1000, unit: 'st' };
      n.steps = n.steps.map(st => (typeof st === 'string' ? st.replace(ref, `{{${nodeId}}}`) : st));
    }

    mixes.push({
      ingredientId: mixId,
      blendId: ing.blendId,
      name,
      grams: total,
      hasRecipe: !!blend,
      missing,
      nodeId,
      consumers: list.length,
    });
  }
  // Mix steps first so they read as prep at the top of the list
  return { nodes: [...added, ...out], mixes };
}
