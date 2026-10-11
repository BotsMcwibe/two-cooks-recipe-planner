/**
 * Shared catalog presentation helpers (Swedish labels, filters, stars).
 */

const PROTEIN_LABELS = {
  'protein:chicken': 'Kyckling',
  'protein:beef': 'Nötkött',
  'protein:pork': 'Fläsk',
  'protein:fish': 'Fisk',
  'protein:lamb': 'Lamm',
  'protein:mixed': 'Blandat',
  'protein:vegetarian': 'Vegetariskt',
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

/**
 * Build filter chip definitions from catalog frequencies.
 * Always includes "Alla". Prefer protein + Familj/Vego/Snabbt/Dessert when present.
 */
export function buildFilterChips(catalog) {
  const chips = [{ id: 'all', label: 'Alla', match: () => true }];

  const proteinCounts = new Map();
  const curatedCounts = new Map();

  for (const c of catalog) {
    for (const t of c.tags || []) {
      if (t.startsWith('protein:')) {
        proteinCounts.set(t, (proteinCounts.get(t) || 0) + 1);
      }
      if (CURATED_TAG_LABELS[t] && !t.startsWith('protein:')) {
        curatedCounts.set(t, (curatedCounts.get(t) || 0) + 1);
      }
    }
    for (const t of c.hfTags || []) {
      if (CURATED_TAG_LABELS[t]) {
        curatedCounts.set(t, (curatedCounts.get(t) || 0) + 1);
      }
    }
  }

  // Curated first (Familj, Vego, Snabbt, Dessert…)
  const curatedOrder = ['family', 'family-friendly', 'veggie', 'vegetarisk', 'quick', 'dessert', 'breakfast', 'pasta', 'lunch'];
  const usedLabels = new Set();
  for (const key of curatedOrder) {
    if (!curatedCounts.has(key)) continue;
    const label = CURATED_TAG_LABELS[key];
    if (usedLabels.has(label)) continue;
    usedLabels.add(label);
    chips.push({
      id: `tag:${key}`,
      label,
      match: (entry) =>
        (entry.tags || []).includes(key) ||
        (entry.hfTags || []).includes(key) ||
        (entry.tags || []).some(t => CURATED_TAG_LABELS[t] === label) ||
        (entry.hfTags || []).some(t => CURATED_TAG_LABELS[t] === label),
    });
  }

  // Protein chips (skip vegetarian if Vego already present)
  const proteinOrder = [
    'protein:chicken', 'protein:beef', 'protein:pork', 'protein:fish',
    'protein:lamb', 'protein:mixed', 'protein:vegetarian',
  ];
  for (const key of proteinOrder) {
    if (!proteinCounts.has(key)) continue;
    const label = proteinLabel(key);
    if (!label) continue;
    if (label === 'Vegetariskt' && usedLabels.has('Vego')) continue;
    chips.push({
      id: key,
      label,
      match: (entry) => (entry.tags || []).includes(key),
    });
  }

  return chips;
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
