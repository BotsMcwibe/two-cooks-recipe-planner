/**
 * Shared catalog presentation helpers (Swedish labels, filters, stars).
 */

const PROTEIN_LABELS = {
  'protein:chicken': 'Kyckling',
  'protein:beef': 'Nötkött',
  'protein:pork': 'Fläsk',
  'protein:fish': 'Fisk',
  'protein:lamb': 'Lamm',
  'protein:shrimp': 'Skaldjur',
  'protein:mixed': 'Blandat',
  'protein:vegetarian': 'Vego',
};

const DIFFICULTY_LABELS = {
  easy: 'Lätt',
  medium: 'Medel',
  hard: 'Svår',
};

const CURATED_TAG_LABELS = {
  family: 'Familj',
  familj: 'Familj',
  'family-friendly': 'Familj',
  veggie: 'Vego',
  vegetarisk: 'Vego',
  vegetarian: 'Vego',
  quick: 'Snabbt',
  dessert: 'Dessert',
  breakfast: 'Frukost',
  pasta: 'Pasta',
  lunch: 'Lunch',
  sides: 'Tillbehör',
};

const SKIP_TAGS = new Set(['master', 'kött', 'kyckling']);

export function proteinLabel(tag) {
  return PROTEIN_LABELS[tag] || null;
}

export function difficultyLabel(d) {
  if (!d) return '';
  return DIFFICULTY_LABELS[String(d).toLowerCase()] || d;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

/** First clause from searchText as optional short subtitle; skip if it just repeats the name. */
export function subtitleFromSearchText(entry) {
  const raw = (entry.searchText || '').trim();
  if (!raw) return '';
  const name = (entry.name || '').toLowerCase();
  // Prefer a readable phrase: take words after the name-like start, or first 6–8 words
  const words = raw.split(/\s+/).filter(Boolean);
  // Drop leading words that appear in the title
  const nameWords = new Set(name.split(/\s+/));
  let start = 0;
  while (start < words.length && nameWords.has(words[start].toLowerCase())) start++;
  const rest = words.slice(start, start + 8).join(' ');
  if (!rest || rest.toLowerCase() === name) return '';
  // Capitalize first letter
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Display tags for a card: curated + protein (friendly), skip master. */
export function displayTags(entry, limit = 2) {
  const out = [];
  const seen = new Set();
  const add = (label) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(label);
  };

  for (const t of entry.tags || []) {
    if (SKIP_TAGS.has(t)) continue;
    if (t.startsWith('protein:')) {
      const pl = proteinLabel(t);
      if (pl) add(pl);
      continue;
    }
    if (CURATED_TAG_LABELS[t]) add(CURATED_TAG_LABELS[t]);
  }
  for (const t of entry.hfTags || []) {
    if (CURATED_TAG_LABELS[t]) add(CURATED_TAG_LABELS[t]);
  }
  return out.slice(0, limit);
}

const has = (entry, t) => (entry.tags || []).includes(t) || (entry.hfTags || []).includes(t);
const hasAny = (entry, list) => list.some(t => has(entry, t));

const BREAKFAST_TAGS = ['breakfast', 'breakfast-kits', 'smoothie'];
const LUNCH_TAGS = ['lunch', 'lunch-sandwiches', 'lunch-salad'];
const DESSERT_TAGS = ['dessert', 'dessert-baking'];
const SIDE_TAGS = ['sides', 'side', 'sides-veggie', 'sides-salad', 'sides-bites', 'sides-proteins', 'sides-bread'];
const VEGO_TAGS = ['protein:vegetarian', 'veggie', 'vegetarisk', 'vegetarian'];

/** Dinner-type main course: not breakfast, lunch, dessert or a side dish. */
export function isDinner(entry) {
  return !hasAny(entry, BREAKFAST_TAGS) && !hasAny(entry, LUNCH_TAGS) && !hasAny(entry, DESSERT_TAGS) && !hasAny(entry, SIDE_TAGS);
}

/** A main course (lunch or dinner): what the weekly planner picks from by default. */
export function isMainCourse(entry) {
  return !hasAny(entry, BREAKFAST_TAGS) && !hasAny(entry, DESSERT_TAGS) && !hasAny(entry, SIDE_TAGS);
}

/**
 * Category chip definitions, grouped by context:
 *   meal    Frukost, Lunch, Middag, Dessert
 *   protein Kyckling, Nötkött, Fläsk, Lamm, Fisk, Skaldjur, Vego
 *   other   Familj, Snabbt, Pasta, Tillbehör
 * Chips without any matching recipe are left out. Fisk and Skaldjur are
 * separate (protein:fish vs protein:shrimp; no recipe has both). Vego merges
 * protein:vegetarian with the veggie/vegetarisk tags. No "Blandat" chip.
 */
const CATEGORY_DEFS = [
  { id: 'meal:breakfast', group: 'meal', label: 'Frukost', match: (e) => hasAny(e, BREAKFAST_TAGS) },
  { id: 'meal:lunch', group: 'meal', label: 'Lunch', match: (e) => hasAny(e, LUNCH_TAGS) },
  { id: 'meal:dinner', group: 'meal', label: 'Middag', match: isDinner },
  { id: 'meal:dessert', group: 'meal', label: 'Dessert', match: (e) => hasAny(e, DESSERT_TAGS) },
  { id: 'protein:chicken', group: 'protein', label: 'Kyckling', match: (e) => has(e, 'protein:chicken') },
  { id: 'protein:beef', group: 'protein', label: 'Nötkött', match: (e) => has(e, 'protein:beef') },
  { id: 'protein:pork', group: 'protein', label: 'Fläsk', match: (e) => has(e, 'protein:pork') },
  { id: 'protein:lamb', group: 'protein', label: 'Lamm', match: (e) => has(e, 'protein:lamb') },
  { id: 'protein:fish', group: 'protein', label: 'Fisk', match: (e) => has(e, 'protein:fish') || has(e, 'fish') },
  { id: 'protein:shrimp', group: 'protein', label: 'Skaldjur', match: (e) => has(e, 'protein:shrimp') || has(e, 'shrimp') },
  { id: 'protein:vegetarian', group: 'protein', label: 'Vego', match: (e) => hasAny(e, VEGO_TAGS) },
  { id: 'tag:family', group: 'other', label: 'Familj', match: (e) => hasAny(e, ['family', 'familj', 'family-friendly']) },
  { id: 'tag:quick', group: 'other', label: 'Snabbt', match: (e) => has(e, 'quick') },
  { id: 'tag:pasta', group: 'other', label: 'Pasta', match: (e) => has(e, 'pasta') },
  { id: 'tag:sides', group: 'other', label: 'Tillbehör', match: (e) => hasAny(e, SIDE_TAGS) },
];

/** Category chips (no "Alla") that match at least one recipe, in display order. */
export function categoryChips(catalog) {
  return CATEGORY_DEFS.filter(d => catalog.some(d.match)).map(d => ({ ...d }));
}

/** Look up one category by id (e.g. 'protein:fish'), or null. */
export function categoryById(id) {
  const d = CATEGORY_DEFS.find(x => x.id === id);
  return d ? { ...d } : null;
}

/**
 * Build filter chip definitions: "Alla", then categoryChips() grouped by
 * context (each chip carries .group: 'all' | 'meal' | 'protein' | 'other').
 */
export function buildFilterChips(catalog) {
  return [{ id: 'all', group: 'all', label: 'Alla', match: () => true }, ...categoryChips(catalog)];
}

/**
 * kcal figure the overview and cook pages show:
 * Math.round(nutrition.perPortion.energyKcal). Null when unknown.
 */
export function displayedPortionKcal(energyKcal) {
  const k = Number(energyKcal);
  if (!Number.isFinite(k)) return null;
  return Math.round(k);
}

/** True when the displayed per-portion kcal is strictly under the limit (default 650). */
export function isUnderDisplayedPortionKcal(energyKcal, limit = 650) {
  const shown = displayedPortionKcal(energyKcal);
  return shown != null && shown < limit;
}

/**
 * Personal score is separate from public ratings.
 * Catalog stores the score (out of 10); master stores { score, outOf }.
 */
export function personalScore(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { score: value, outOf: 10 };
  }
  if (typeof value === 'object' && Number.isFinite(Number(value.score))) {
    const outOf = Number(value.outOf);
    return { score: Number(value.score), outOf: Number.isFinite(outOf) && outOf > 0 ? outOf : 10 };
  }
  return null;
}

export function isCooked(value) {
  if (value === true) return true;
  if (value && typeof value === 'object') return true;
  return false;
}

/**
 * False when the recipe has a fixed yield (catalog/recipe `scalable: false`,
 * e.g. one cake in a fixed-size pan). Portions then stay at basePortions.
 */
export function isScalable(entry) {
  return !(entry && entry.scalable === false);
}

/**
 * Placeholder look for a recipe without a photo: an icon that carries the
 * category (so meaning never depends on colour) and a decorative hue.
 * Deterministic per recipe: category picks the base hue, the id hash nudges it.
 * @returns {{ emoji: string, hue: number, label: string }}
 */
export function recipeVisual(entry) {
  const tags = (entry && entry.tags) || [];
  const has = (t) => tags.includes(t);
  let v;
  if (has('dessert')) v = { emoji: '🍰', hue: 320, label: 'Dessert' };
  else if (has('smoothie')) v = { emoji: '🥤', hue: 45, label: 'Smoothie' };
  else if (has('breakfast')) v = { emoji: '🥞', hue: 40, label: 'Frukost' };
  else if (has('soup')) v = { emoji: '🍲', hue: 28, label: 'Soppa' };
  else if (has('protein:fish') || has('fish')) v = { emoji: '🐟', hue: 200, label: 'Fisk' };
  else if (has('protein:shrimp')) v = { emoji: '🦐', hue: 185, label: 'Skaldjur' };
  else if (has('protein:chicken')) v = { emoji: '🍗', hue: 36, label: 'Kyckling' };
  else if (has('protein:beef')) v = { emoji: '🥩', hue: 12, label: 'Nötkött' };
  else if (has('protein:pork')) v = { emoji: '🥓', hue: 24, label: 'Fläsk' };
  else if (has('protein:lamb')) v = { emoji: '🍖', hue: 18, label: 'Lamm' };
  else if (has('pasta')) v = { emoji: '🍝', hue: 48, label: 'Pasta' };
  else if (has('protein:vegetarian') || has('veggie') || has('vegetarisk')) v = { emoji: '🥦', hue: 150, label: 'Vego' };
  else v = { emoji: '🍽️', hue: 220, label: 'Recept' };
  let h = 0;
  for (const ch of String(entry?.id || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const nudge = (Math.abs(h) % 25) - 12;
  return { ...v, hue: (v.hue + nudge + 360) % 360 };
}

export function starHtml(average, count) {
  if (average == null || !Number.isFinite(Number(average))) return '';
  const avg = Number(average);
  const full = Math.round(avg);
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    stars += i <= full ? '★' : '☆';
  }
  const countPart = count != null ? ` <span class="rating-count">(${count})</span>` : '';
  return `<span class="rating-stars" title="${avg.toFixed(1)}">${stars}</span>${countPart}`;
}

export function allergenLabel(a) {
  const map = {
    gluten: 'Gluten',
    dairy: 'Mejeri',
    egg: 'Ägg',
    eggs: 'Ägg',
    nuts: 'Nötter',
    soy: 'Soja',
    fish: 'Fisk',
    shellfish: 'Skaldjur',
    crustaceans: 'Skaldjur',
    molluscs: 'Blötdjur',
    sulphites: 'Sulfiter',
    sulfites: 'Sulfiter',
    sesame: 'Sesam',
    mustard: 'Senap',
    celery: 'Selleri',
    peanuts: 'Jordnötter',
  };
  return map[String(a).toLowerCase()] || a;
}

/** Pantry-ish ingredient tags for optional grouping. */
export function isPantryIngredient(ing) {
  const tags = (ing && ing.tags) || (ing && ing.json && ing.json.tags) || [];
  return tags.some(t => ['basic', 'spices', 'oils', 'herbs', 'baking'].includes(t));
}
