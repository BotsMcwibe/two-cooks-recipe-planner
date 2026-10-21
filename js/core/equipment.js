/**
 * Equipment, heat and oven helpers (see SCHEMA.md "Equipment, heat & resources").
 * Vocabulary comes from data/equipment.json (set once by the loader).
 *
 * - Resource nodes (tag `resource`, e.g. "Värm ugnen") produce ready equipment, not food.
 *   They are referenced only via equipment[].after and never shown as an ingredient.
 * - Oven temperatures follow the kitchen profile: fanTemp when ovenFan, else temp.
 *   A derived fanTemp (temp − 20) is shown as "ca".
 */

let vocab = { types: {}, burners: {}, heatLevels: ['låg', 'medellåg', 'medel', 'medelhög', 'hög'] };

export function setEquipmentVocab(v) {
  if (v && typeof v === 'object') vocab = { ...vocab, ...v, types: v.types || {}, burners: v.burners || {} };
}
export function equipmentVocab() { return vocab; }

export const HEAT_LEVELS = ['låg', 'medellåg', 'medel', 'medelhög', 'hög'];

/** Short noun for reuse hints ("Använd samma stekpanna"). */
const NOUN = {
  kastrull_liten: 'kastrull', kastrull_medelstor: 'kastrull', kastrull_stor: 'kastrull',
  stekpanna_liten: 'stekpanna', stekpanna_medelstor: 'stekpanna', stekpanna_stor: 'stekpanna',
  sauterpanna: 'sauterpanna', grillpanna: 'grillpanna', wok: 'wok', gryta: 'gryta', grill: 'grill',
  plat: 'plåt', muffinsplat: 'muffinsplåt', ugnsform: 'ugnsform', ugnsform_stor: 'ugnsform',
  springform: 'form', bakform: 'form', galler: 'galler',
  skal_liten: 'skål', skal_medelstor: 'skål', skal_stor: 'skål',
};


const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const afterIds = (e) => (e == null || e.after == null ? [] : Array.isArray(e.after) ? e.after : [e.after]);

export function isResource(r) {
  if (!r) return false;
  if (typeof r.hasTag === 'function') return r.hasTag('resource');
  return (r.tags || []).includes('resource');
}

/** Unique node ids this recipe's equipment waits for (resource ordering, not food). */
export function recipeAfterIds(recipe) {
  const out = [];
  for (const e of (recipe && recipe.equipment) || []) for (const a of afterIds(e)) if (!out.includes(a)) out.push(a);
  return out;
}

export function typeInfo(type) { return vocab.types[type] || null; }
export function typeKind(type) { return vocab.types[type]?.kind || null; }
export function typeLabel(type) { return vocab.types[type]?.label || String(type || '').replace(/_/g, ' '); }
export function typeNoun(type) { return NOUN[type] || vocab.types[type]?.forms?.noun || typeLabel(type).toLowerCase(); }

/** Swedish form of a type ("en stor stekpanna", "plåtar"); falls back to the label. */
export function typeForm(type, form = 'indef') {
  const f = vocab.types[type]?.forms;
  return (f && (f[form] || f.indef)) || typeLabel(type).toLowerCase();
}

const cap = (t) => (t ? t.charAt(0).toLocaleUpperCase('sv') + t.slice(1) : t);

/** "Använd en separat skärbräda för rå kyckling och rått kött" for a separate:true board entry. */
export function separateBoardHint(e) {
  if (!e || !e.separate) return '';
  const labels = vocab.rawAnimalLabels || {};
  const words = [];
  for (const k of Array.isArray(e.rawKinds) ? e.rawKinds : []) {
    const w = labels[k];
    if (w && !words.includes(w)) words.push(w);
  }
  const what = words.length > 1 ? `${words.slice(0, -1).join(', ')} och ${words[words.length - 1]}` : (words[0] || 'rått kött, fågel och fisk');
  return `Använd en separat ${typeNoun(e.type)} för ${what}`;
}

/** Plain-text extras for an entry: "med lock", "med bakplåtspapper", "(valfritt)". */
function entryExtras(e) {
  const out = [];
  if (e.lid) out.push('med lock');
  if (e.liner) out.push('med bakplåtspapper');
  return out;
}

export function burnerLabel(type) {
  const b = vocab.types[type]?.burner;
  const info = b ? vocab.burners[b] : null;
  return info ? { key: b, label: info.label, cm: info.cm } : null;
}

export function ovenEntryOf(recipe) {
  return ((recipe && recipe.equipment) || []).find(e => e.type === 'ugn') || null;
}

/**
 * Effective oven setting for an ugn entry or a resource node's `oven` block.
 * @returns {{ temp: number|null, approx: boolean, fan: boolean, mode: string|null, key: string, text: string }}
 */
export function effectiveOven(src, kitchen) {
  const fan = !!(kitchen && kitchen.ovenFan);
  const base = typeof src?.temp === 'number' ? src.temp : null;
  let temp = base;
  let approx = false;
  if (fan && base != null) {
    if (typeof src.fanTemp === 'number') { temp = src.fanTemp; approx = src.fanTempSource === 'derived'; }
    else { temp = base - 20; approx = true; }
  }
  const mode = src?.mode || null;
  const modeText = mode === 'grill' ? ' · grill' : mode ? ` · ${mode}` : '';
  const text = temp == null
    ? `Ugn enligt förpackningen${modeText}`
    : `Ugn ${approx ? 'ca ' : ''}${temp} °C${fan ? ' varmluft' : ''}${modeText}`;
  return { temp, approx, fan, mode, key: `${temp ?? '?'}|${fan ? 'fan' : 'std'}|${mode || ''}`, text };
}

export function heatIndex(level) {
  const i = HEAT_LEVELS.indexOf(level);
  return i < 0 ? 0 : i + 1;
}

/**
 * Heat level as bars (height + count, cividis-style colour) plus the word, never colour alone.
 * @param {string} level
 * @param {{ guess?: boolean }} [opts]
 */
export function heatHtml(level, opts = {}) {
  const n = heatIndex(level);
  if (!n) return '';
  let bars = '';
  for (let i = 1; i <= 5; i++) bars += `<span class="heat-bar${i <= n ? ' is-on' : ''}"></span>`;
  const word = `${level}`;
  const title = `Värme: ${level} (${n} av 5)`;
  return `<span class="heat heat-${n}" title="${esc(title)}"><span class="heat-bars" aria-hidden="true">${bars}</span><span class="heat-word">${esc(word)}</span><span class="sr-only"> (${n} av 5)</span></span>`;
}

function reuseHint(e) {
  const noun = typeNoun(e.type);
  if (e.transition === 'keep') return `Använd samma ${noun}`;
  if (e.transition === 'wipe') return `Använd samma ${noun}, torka ur den först`;
  if (e.transition === 'wash') return `Använd samma ${noun}, diska ur den först`;
  return '';
}

/**
 * Chips for one node: oven ("Ugn 240 °C"), stovetop vessel ("Stor stekpanna · medelhög"),
 * ovenware, appliances and tools, plus reuse and separate-board hints. Bowls, plates and
 * boards are left out as chips (always at hand); a separate raw-food board gets a hint.
 * @returns {string} HTML ('' when the node has no equipment)
 */
export function nodeEquipmentHtml(recipe, kitchen) {
  const eq = (recipe && recipe.equipment) || [];
  const chips = [];
  const hints = [];
  if (isResource(recipe) && recipe.oven) {
    const o = effectiveOven(recipe.oven, kitchen);
    chips.push(`<span class="eq-chip eq-oven" title="Förvärm ugnen">${esc(o.text)}</span>`);
  }
  const order = { oven: 0, stovetop: 1, ovenware: 2, appliance: 3, tool: 4 };
  const sorted = eq.map((e, i) => ({ e, i, k: typeKind(e.type) }))
    .filter(x => x.k in order)
    .sort((a, b) => order[a.k] - order[b.k] || a.i - b.i);
  for (const { e, k } of sorted) {
    if (k === 'oven') {
      const o = effectiveOven(e, kitchen);
      const slots = Number(e.slots) > 1 ? ` · ${e.slots} plåtar` : '';
      chips.push(`<span class="eq-chip eq-oven">${esc(o.text + slots)}</span>`);
      continue;
    }
    const n = Number(e.count) > 1 ? `<span class="eq-count">${Number(e.count)} ×</span> ` : '';
    let html = `${n}<span class="eq-name">${esc(typeLabel(e.type))}</span>`;
    for (const x of entryExtras(e)) html += `<span class="eq-sep">·</span><span class="eq-muted">${esc(x)}</span>`;
    if (k === 'stovetop') {
      const burner = burnerLabel(e.type);
      if (burner) html += `<span class="eq-sep">·</span><span class="eq-burner" title="${esc(`${burner.label} (${burner.cm} cm)`)}">${esc(burner.label.toLowerCase())}</span>`;
      if (e.offHeat) html += `<span class="eq-sep">·</span><span class="eq-offheat">av värmen</span>`;
      else if (recipe.heat) html += `<span class="eq-sep">·</span>${heatHtml(recipe.heat, { guess: recipe.heatSource === 'inferred' })}`;
    } else if (e.shared) {
      html += '<span class="eq-sep">·</span><span class="eq-muted">delas</span>';
    }
    if (e.optional) html += ' <span class="eq-optional">(valfritt)</span>';
    chips.push(`<span class="eq-chip eq-${k}">${html}</span>`);
    const hint = reuseHint(e);
    if (hint) hints.push(`<span class="eq-reuse"><span aria-hidden="true">↻</span> ${esc(hint)}</span>`);
  }
  for (const e of eq) {
    const h = typeKind(e.type) === 'board' ? separateBoardHint(e) : '';
    if (h && !hints.some(x => x.includes(esc(h)))) {
      hints.push(`<span class="eq-separate"><span class="eq-separate-label">Hygien</span> ${esc(h)}</span>`);
    }
  }
  if (!chips.length && !hints.length) return '';
  return `<span class="eq-chips">${chips.join('')}${hints.join('')}</span>`;
}

/** Heat override for one step ("sänk till medellåg"), or ''. */
export function stepHeatHtml(recipe, stepIndex) {
  const lvl = recipe && recipe.stepHeat ? recipe.stepHeat[String(stepIndex)] : null;
  if (!lvl) return '';
  return `<span class="step-heat">${heatHtml(lvl, { guess: recipe.heatSource === 'inferred' })}</span>`;
}

/**
 * Utrustning for a whole recipe: ovens (distinct effective settings), distinct pots/pans per
 * type (by ref; an entry without ref counts as one, `count` items each), plåtar/formar,
 * appliances, tools, plates used while cooking and cutting boards (a separate raw-food board
 * is its own row). Bowls are left out (always at hand); serving dishes are in servingItems().
 * @param {Iterable<object>} recipes subtree recipes
 * @returns {Array<{ kind: string, label: string, count: number, guess: boolean, extras: string[], optional: boolean, hint?: string }>}
 */
export function equipmentSummary(recipes, kitchen) {
  const ovens = new Map();
  const byType = new Map();
  const listed = { stovetop: 1, ovenware: 2, appliance: 3, tool: 4, plate: 5, board: 6 };
  for (const r of recipes) {
    if (isResource(r)) continue;
    const id = r.id || r.outputIngredient?.id;
    (r.equipment || []).forEach((e, i) => {
      const k = typeKind(e.type);
      if (k === 'oven') {
        const o = effectiveOven(e, kitchen);
        if (!ovens.has(o.key)) ovens.set(o.key, o);
        return;
      }
      if (!(k in listed)) return;
      const sep = k === 'board' && e.separate;
      const gk = sep ? `${e.type}#separate` : e.type;
      if (!byType.has(gk)) byType.set(gk, { type: e.type, kind: k, keys: new Map(), guess: false, extras: new Set(), allOptional: true, rawKinds: new Set(), separate: !!sep });
      const t = byType.get(gk);
      const key = e.ref ? `ref:${e.ref}` : `${id}#${i}`;
      const n = Number(e.count) > 1 ? Number(e.count) : 1;
      t.keys.set(key, Math.max(t.keys.get(key) || 0, n));
      if (e.sizeSource === 'inferred') t.guess = true;
      for (const x of entryExtras(e)) t.extras.add(x);
      if (!e.optional) t.allOptional = false;
      for (const rk of e.rawKinds || []) t.rawKinds.add(rk);
    });
  }
  const out = [];
  for (const o of ovens.values()) out.push({ kind: 'oven', label: o.text, count: 1, guess: o.approx, extras: [], optional: false });
  const types = [...byType.values()].sort((a, b) => listed[a.kind] - listed[b.kind]
    || (a.separate ? 1 : 0) - (b.separate ? 1 : 0)
    || typeLabel(a.type).localeCompare(typeLabel(b.type), 'sv'));
  for (const t of types) {
    let count = 0;
    for (const v of t.keys.values()) count += v;
    const item = { kind: t.kind, type: t.type, label: typeLabel(t.type), count, guess: t.guess, extras: [...t.extras], optional: t.allOptional };
    if (t.separate) {
      item.hint = separateBoardHint({ type: t.type, separate: true, rawKinds: [...t.rawKinds] });
      item.label = cap(item.hint.replace(/^Använd en /, '')); // "Separat skärbräda för rå kyckling"
    }
    out.push(item);
  }
  return out;
}

/**
 * Serving dishes from the master's `serving` list. count "portions" = one per portion.
 * @param {object} root master recipe
 * @param {number} portions chosen portions
 * @returns {Array<{ type: string, count: number, label: string, text: string }>}
 */
export function servingItems(root, portions) {
  const list = (root && Array.isArray(root.serving)) ? root.serving : [];
  const p = Math.max(1, Math.round(Number(portions) || Number(root && root.basePortions) || 4));
  return list.filter(e => e && e.type).map(e => {
    const count = e.count === 'portions' ? p : (Number(e.count) > 0 ? Math.round(Number(e.count)) : 1);
    const label = cap(count > 1 ? typeForm(e.type, 'pl') : typeForm(e.type, 'bare'));
    return { type: e.type, count, label, text: `${count} ${count > 1 ? typeForm(e.type, 'pl') : typeForm(e.type, 'bare')}` };
  });
}

/** "Servering: 4 tallrikar" line (overview), or ''. */
export function servingLineHtml(root, portions) {
  const items = servingItems(root, portions);
  if (!items.length) return '';
  return `<p class="eq-serving"><span class="eq-serving-label">Servering:</span> ${esc(items.map(it => it.text).join(', '))}</p>`;
}

function itemNameText(it) {
  let t = it.label;
  if (it.extras && it.extras.length) t += ` ${it.extras.join(', ')}`;
  return t;
}

/** <ul> for the Utrustning section, or '' when nothing is listed. */
export function equipmentListHtml(recipes, kitchen, opts = {}) {
  const items = equipmentSummary(recipes, kitchen);
  if (!items.length) return '';
  const lis = items.map(it => {
    const n = it.count > 1 ? `<span class="eq-count">${it.count} ×</span> ` : '';
    const opt = it.optional ? ' <span class="eq-optional">(valfritt)</span>' : '';
    const title = it.hint ? ` title="${esc(it.hint)}"` : '';
    return `<li class="eq-item eq-${it.kind}"${title}>${n}<span class="eq-name">${esc(itemNameText(it))}</span>${opt}</li>`;
  }).join('');
  const trays = kitchen && kitchen.ovenTrays ? kitchen.ovenTrays : null;
  const hasOven = items.some(it => it.kind === 'oven');
  const note = hasOven && opts.profileNote !== false
    ? `<p class="eq-profile">Ditt kök: ${trays} ${trays === 1 ? 'plåt' : 'plåtar'} i ugnen, ${kitchen.ovenFan ? 'varmluft' : 'vanlig ugn'}. <a href="#konto" data-acc-target="acc-installningar">Ändra</a></p>`
    : '';
  return `<ul class="eq-list">${lis}</ul>${note}`;
}

export { itemNameText as equipmentItemName };
