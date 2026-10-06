# Recipe JSON schema — images, nutrition & ratings (optional)

`source` and `createdAt` are **required** on every master and catalog entry. Image, nutrition, ratings, and cooked fields below stay **optional**. Existing masters without the optional blocks remain valid.
Paths are **relative strings**, never base64 blobs (scale: 6000+ recipes).

## Assets root

| Convention | Value |
|------------|--------|
| App-served root | repository root (same origin as `server.py` / GitHub Pages) |
| Recipe media | `assets/recipes/<masterId>/…` under repo root |
| Path stored in JSON | Relative to app root, e.g. `assets/recipes/bacon_tortelloni_tomato/main.jpg` |

Do **not** embed image bytes in JSON. Lazy-load: catalog may hold a main thumbnail path, flat rating mirrors, and the filter fields `source` and `createdAt`; step images, nutrition, and full `ratings` (with `ratings.source`) live on the master file fetched when the dish is selected. `source` and `createdAt` are also stored on the master so either file can be filtered alone.

When converting from HelloFresh, source files currently live under `/workspace/recipes/images/` (`{hfId}__main_s3.*`, `{hfId}__stepN_M.*`). Copying/linking into `assets/recipes/<masterId>/` is a **separate** migration step — not required for schema validity.

---

## Catalog entry (`catalog.json`)

Existing fields unchanged. Image / ratings / tag field semantics:

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `source` | yes | `string` | Site the recipe was converted from. Same string on the master. Open string, not a closed enum: current recipes use `hellofresh` or `ica`; future sites use their own non-empty slug. Not `ratings.source` and not `cooked.source`. |
| `createdAt` | yes | integer | Unix timestamp in **seconds** (not milliseconds) when the recipe was written into the graph. Same number on the master. Do not invent one from site metadata. |
| `tags` | yes | `string[]` | Curated UI tags. Always include `"master"`. Dish-type / cuisine filters (`pasta`, `dessert`, `breakfast`, …) plus **`protein:*` filter tags** (see below). Do **not** dump raw HelloFresh marketing tags here. |
| `hfTags` | no | `string[]` | **All** HelloFresh tag slugs from `recipe.tags[]` (prefer `slug`, else `type`, else slugified `name`). Dedupe; preserve raw order. Empty array OK if none / non-HF. Do **not** store full HF tag objects. Namespaced separately from curated `tags`. |
| `image` | no | `null` \| `string` | Main thumbnail for picker / shopping. Path relative to app root. `null` or omit = no image. |
| `ratingAverage` | no | `number` | Mirror of master `ratings.average` for sorting/filtering without loading the master. Omit if unknown. |
| `ratingCount` | no | `number` (int ≥ 0) | Mirror of master `ratings.count`. May be `0` when average is present. |

```json
{
  "id": "bacon_tortelloni_tomato",
  "source": "hellofresh",
  "createdAt": 1710000000,
  "name": "Bacon-tortelloni med tomatsås och ost",
  "tags": ["master", "pasta", "family", "protein:pork"],
  "hfTags": ["enkel-att-forbereda", "barnvanlig", "parents-to-kids", "comfort-food", "mediterranean", "pasta-noodles", "quick-prep"],
  "image": "assets/recipes/bacon_tortelloni_tomato/main.jpg",
  "basePortions": 4,
  "cuisine": "italian",
  "allergens": ["gluten", "dairy", "egg", "nuts"],
  "difficulty": "easy",
  "totalMinutes": 30,
  "searchText": "bacon tortelloni tomatsås pasta",
  "ratingAverage": 2.5,
  "ratingCount": 2
}
```

### Curated `tags` vs `hfTags`

| Array | Purpose |
|-------|---------|
| `tags` | App UI filters and labels. Curated dish-type tags + required `"master"` + derived `protein:*` (see below). |
| `hfTags` | Full HelloFresh provenance tag slugs for search/analytics. Never mixed into curated `tags`. |

### `protein:*` tags (in `tags`)

Derive from **recipe graph base ingredients + pantry** (`ingredients.json` names/tags), not from HF marketing tags alone (HF is inconsistent). Put them on catalog `tags` (not `hfTags`).

| Tag | When |
|-----|------|
| `protein:chicken` | Chicken / kyckling ingredients |
| `protein:turkey` | Turkey / kalkon (prefer over folding into chicken) |
| `protein:pork` | Pork / fläsk / bacon / skinka / prosciutto / pork sausages (korv) |
| `protein:beef` | Beef / nöt* / oxe / rump / cowboy steak / köttfärs |
| `protein:lamb` | Lamb / lamm |
| `protein:shrimp` | Shrimp / räkor / prawn |
| `protein:fish` | Fish / lax / torsk / fisk (not shrimp) |
| `protein:vegetarian` | No animal protein ingredients (desserts, breakfasts, veggie mains) |
| `protein:mixed` | **In addition to** each specific `protein:*` when 2+ distinct animal protein families are present |

\*Careful: Swedish *nötter* (nuts) ≠ *nötkött* (beef). Ignore stocks/bouillon as garnish-level flavorings. Prefer main proteins from master/prep ingredient lists. Do **not** invent protein from the dish name if ingredients disagree. Blandfärs / mixed mince → treat as beef+pork → specific tags + `protein:mixed`.

Keep catalog small: **do not** put nutrition or step-image maps here. Flat `ratingAverage` / `ratingCount` are enough for picker sort/filter; full `ratings` (with `ratings.source`) lives on the master. Catalog `source` is the site slug (required), not a copy of the ratings object.

---

## Master file (`recipes/<masterId>.json`)

### Top-level optional blocks

```json
{
  "masterId": "bacon_tortelloni_tomato",
  "source": "hellofresh",
  "createdAt": 1710000000,
  "basePortions": 4,
  "sharedPrep": [],
  "images": {
    "main": "assets/recipes/bacon_tortelloni_tomato/main.jpg",
    "byNode": {
      "bacon_tortelloni_tomato__chopped_broccoli": "assets/recipes/bacon_tortelloni_tomato/steps/chopped_broccoli.jpg",
      "bacon_tortelloni_tomato": "assets/recipes/bacon_tortelloni_tomato/steps/serve.jpg"
    }
  },
  "nutrition": {
    "basis": "per_portion",
    "servingSizeGrams": 577,
    "perPortion": {
      "energyKcal": 929,
      "energyKj": 3887,
      "fatG": 46.6,
      "saturatedFatG": 21.1,
      "carbsG": 81.8,
      "sugarsG": 20.5,
      "fiberG": 11.7,
      "proteinG": 41.9,
      "saltG": 4.2
    }
  },
  "ratings": {
    "average": 2.5,
    "count": 2,
    "source": "hellofresh"
  },
  "nodes": [ /* unchanged DAG */ ]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `source` | yes | Non-empty site slug. Same value as the catalog entry. Not an enum; `hellofresh` and `ica` are the values in use. Distinct from `ratings.source` and `cooked.source`. |
| `createdAt` | yes | Integer unix seconds when this master was written. Same value as the catalog entry. Not milliseconds. |
| `images` | no | Object; omit entirely if none |
| `images.main` | no | Same role as catalog `image` (prefer keeping both in sync when present) |
| `images.byNode` | no | Map **node id → path**. Keys should be ids in this master (or its `sharedPrep`). Not part of DAG semantics |
| `nutrition` | no | Object; omit if unknown |
| `nutrition.basis` | recommended if nutrition present | `"per_portion"` (HF default) or `"per_recipe"` |
| `nutrition.servingSizeGrams` | no | HF `recipe.servingSize` (grams of one portion) |
| `nutrition.perPortion` | yes if nutrition present | Stable nutrient object (see below) |
| `nutrition.perRecipe` | no | Prefer **omit** and compute `perPortion × basePortions` in UI to avoid drift |
| `ratings` | no | Object; omit entirely if no valid average |
| `ratings.average` | yes if ratings present | Number (HF `recipe.averageRating`). Do not invent. |
| `ratings.count` | no | Number ≥ 0 (HF `recipe.ratingsCount`). May be `0`; still include when average is present. |
| `ratings.source` | recommended if ratings present | `"hellofresh"` when copied from HF; omit or use another label for non-HF |
| `cooked` | no | Object from `cooked.json` when this hfId was cooked. Omit otherwise. See Cooked section. |

### Stable `perPortion` keys

| Key | Unit | HF source name(s) |
|-----|------|-------------------|
| `energyKcal` | kcal | Energi (kcal) |
| `energyKj` | kJ | Energi (kJ) |
| `fatG` | g | Fett |
| `saturatedFatG` | g | varav mättat |
| `carbsG` | g | Kolhydrater |
| `sugarsG` | g | varav socker |
| `fiberG` | g | Kostfiber (often missing) |
| `proteinG` | g | Protein |
| `saltG` | g | Salt |

All nutrient amounts are **numbers**. Unknown nutrients: omit the key (do not invent zeros). Extra keys are allowed but discouraged; validator may warn.

HF nutrition is **per portion** (≥200-sample consistent: kcal + macros + salt always; fiber sometimes). Set `basis: "per_portion"`.

---


---

## Ratings (HelloFresh and others)

Optional consumer ratings for sort/filter and display. **Omit the entire `ratings` object** when there is no valid numeric average — do not invent scores.

| Key | Type | Notes |
|-----|------|-------|
| `average` | number | Mean score (HF scale is typically 1–5). Required if `ratings` present. |
| `count` | number | How many ratings. May be `0`. Prefer including when average exists. |
| `source` | string | Provenance of the **rating**. Use `"hellofresh"` for HF conversions and `"ica"` for ICA. This is `ratings.source`, not the recipe `source` field. |

Catalog mirrors only the numbers as flat fields (`ratingAverage`, `ratingCount`) so the picker can sort without loading masters. Keep them in sync with the master when present.

HF mapping: `recipe.averageRating` → `ratings.average`; `recipe.ratingsCount` → `ratings.count`; `source: "hellofresh"`. See `recipes/docs/hf-to-graph-conversion.md`.

### Personal rating (yesber)

Optional and separate from consumer `ratings`. Master `personalRating` is `{ "score": 7, "outOf": 10 }` (score out of `outOf`). Catalog mirror `personalRating` is the score only (out of 10). Do not overwrite `ratings` or `ratings.source`.



## Cooked (yesber)

Optional. Set only when this recipe's HelloFresh id is listed in `/workspace/recipes/conversion-queue/cooked.json`. Omit the whole object otherwise. Do not invent.

| Key | Type | Notes |
|-----|------|-------|
| `hfId` | string | HelloFresh recipe id that matched `cooked.json` |
| `at` | string | When it was tagged cooked (ISO 8601) |
| `cardNumber` | number | Printed card index when known (e.g. 17) |
| `source` | string | How we know, usually `"photo"` |
| `headline` | string | Card subtitle when known |

Catalog mirrors: `cooked` (boolean), `cookedAt` (string), `cookedCardNumber` (number). Keep in sync with the master. Picker can sort cooked recipes without loading the graph.

## Node inputs (derived ingredients)

Node `inputs` are `{ id, amount, unit }`. A base ingredient (`ingredients.json` id) uses a real amount. An input whose `id` is another dish-local node (a **derived ingredient**) always uses unit `st`. **Each dish-local node output must be consumed exactly 1 st in total** across all its consumers: one consumer at `1 st`, or a split such as `0.7 st` + `0.3 st`. Shopping totals are computed through these amounts, so a double use counts the upstream ingredients twice. Shared prep outputs (`sharedPrep`) and recipe-local preheat nodes with no inputs are exempt (warning only). `validate-recipes.mjs` enforces this via `scripts/check-derived-usage.mjs`. Rules and examples: `recipes/docs/hf-to-graph-conversion.md` §4.2.

## Node optional field

| Field | Required | Notes |
|-------|----------|-------|
| `image` | no | Path string. Prefer **`images.byNode`** on the master so the DAG stays free of media. Use node `image` only if a single node is authored in isolation (e.g. shared prep pack illustration). |

When both `node.image` and `images.byNode[nodeId]` exist, **`images.byNode` wins** (master is source of truth for dish-level media).

---

## What stays out of the graph

- Ingredient icons / allergen icons (HF wrapper `ing_*`, `allergens/`) — not in app schema yet
- Marketing copy, utensils, videos
- Blobs / data URLs

---

## Compatibility

- Optional blocks (images, nutrition, ratings, cooked) may be absent; the validator checks shape only when present.
- `source` (non-empty string) and `createdAt` (integer unix seconds) are required on every master and matching catalog entry. `source` is not limited to `hellofresh` and `ica`.

## Nutrition quality (HelloFresh)

Converters must **omit** `nutrition` when HF data fails the sanity gate in `recipes/docs/hf-to-graph-conversion.md` §6.1 (e.g. servingSize &lt; 80 g, absurd kcal). The UI already hides a missing strip.

