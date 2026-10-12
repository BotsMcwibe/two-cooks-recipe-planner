/**
 * Shared rule for showing amounts of derived step inputs (ingredients produced
 * by an earlier step, e.g. "Förvärmd ugn", "Hackad dill").
 *
 * Rule: a derived input is shown WITHOUT amount, unless that step takes only
 * part of what the producing step makes (input amount < producer outputAmount,
 * i.e. the output is split between several steps). Then the share is shown as
 * a fraction of the batch ("½ Hackad dill"), which is identical at every
 * portion scale since input and output scale together. Steps that each use the
 * whole output (an oven shared by two bakes) are not a split.
 * Non-derived (raw) inputs always keep amount + unit.
 */

const FRACTIONS = [
  [1 / 8, '⅛'], [1 / 5, '⅕'], [1 / 4, '¼'], [1 / 3, '⅓'], [2 / 5, '⅖'], [1 / 2, '½'],
  [3 / 5, '⅗'], [2 / 3, '⅔'], [3 / 4, '¾'], [4 / 5, '⅘'], [7 / 8, '⅞'],
];

/** "½", "¾" … or "30 %" for a share 0 < r < 1. */
export function formatShare(r) {
  for (const [v, s] of FRACTIONS) if (Math.abs(r - v) < 0.03) return s;
  return `${Math.round(r * 100)} %`;
}

/**
 * @param {{ingredient:object, amount:number, unit?:object}} input
 * @param {Map<string, {outputAmount:number}>} producers recipe by output ingredient id
 * @returns {{derived:boolean, split:boolean, share:number|null}}
 */
export function derivedInputInfo(input, producers) {
  const id = input.ingredient?.id;
  const producer = producers.get(id);
  const derived = !!producer
    || !!(input.ingredient?.hasTag && input.ingredient.hasTag('recipe_output'));
  if (!derived || !producer) return { derived, split: false, share: null };
  // Denominator = whole batch: max(producer output, sum of all consumers' amounts).
  // Using the consumer sum makes the share immune to per-amount rounding when scaled.
  const out = Math.max(Number(producer.outputAmount) || 0, producers.consumed?.get(id) || 0) || 1;
  const share = Number(input.amount) / out;
  const split = Number.isFinite(share) && share > 0 && share < 0.995;
  return { derived, split, share: split ? share : null };
}

/**
 * Label for one step input ("200 g Pasta", "Förvärmd ugn", "½ Hackad dill").
 * Returns plain text; caller escapes.
 */
export function formatStepInputText(input, producers, formatAmount) {
  const name = input.ingredient.name;
  const info = derivedInputInfo(input, producers);
  if (info.derived) return info.split ? `${formatShare(info.share)} ${name}` : name;
  const abbr = input.unit ? input.unit.abbreviation : '';
  const amt = formatAmount ? formatAmount(input.amount, abbr) : `${input.amount}${abbr ? ' ' + abbr : ''}`;
  return `${amt} ${name}`;
}

/** Build output-id → recipe map from a list of recipes (or steps with .recipe). */
export function producerMap(recipes) {
  const m = new Map();
  for (const r of recipes) {
    const rec = r && r.recipe ? r.recipe : r;
    const id = rec?.outputIngredient?.id;
    if (id && !m.has(id)) m.set(id, rec);
  }
  // Total amount consumed per produced id, across all steps
  const consumed = new Map();
  for (const rec of m.values()) {
    for (const inp of rec.inputs || []) {
      const iid = inp.ingredient?.id;
      if (iid && m.has(iid)) consumed.set(iid, (consumed.get(iid) || 0) + (Number(inp.amount) || 0));
    }
  }
  m.consumed = consumed;
  return m;
}
