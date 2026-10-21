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

Node `inputs` are `{ id, amount, unit }`. A base ingredient (`ingredients.json` id) uses a real amount. An input whose `id` is another dish-local node (a **derived ingredient**) always uses unit `st`. **Each dish-local node output must be consumed exactly 1 st in total** across all its consumers: one consumer at `1 st`, or a split such as `0.7 st` + `0.3 st`. Shopping totals are computed through these amounts, so a double use counts the upstream ingredients twice. Shared prep outputs (`sharedPrep`) used by several nodes are a warning only. **Resources** (preheated ovens, tag `resource`) are never inputs and are not part of this rule; see *Equipment, heat & resources* below. `validate-recipes.mjs` enforces this via `scripts/check-derived-usage.mjs`. Rules and examples: `recipes/docs/hf-to-graph-conversion.md` §4.2.

## Node tags

Node `tags` is a string array (`[]` when none apply). `master` marks the master node. `no-timer` hides the countdown for tip-only waits (oven preheat). `resource` marks a node that produces a piece of ready equipment rather than food (today: oven preheat nodes); see below. `prep` drives the app's **Preppa först** mode, which runs every prep-tagged node in a Prep phase before cooking. Use `prep` only for cold mise en place (chop, slice, grate, peel, rinse, drain, measure, mix a cold marinade/dressing/sauce/spice mix, cold breading or shaping). Never on heat steps (boil, simmer, fry, roast, bake, toast, melt, warm, preheat oven) or on nodes that consume a cooked output. Rules: `recipes/docs/hf-to-graph-conversion.md` §4.4.

## Equipment, heat & resources

Vocabulary: `data/equipment.json` (types, labels, `kind`, capacity, burner size, aliases). Kinds: `stovetop` (needs a burner and a heat level), `oven`, `ovenware` (1 oven slot each), `bowl`, `tool`. Rules for converters: `recipes/docs/hf-to-graph-conversion.md` §4.6. Checker: `scripts/check-equipment.mjs` (run by `validate-recipes.mjs`).

| Field | Where | Notes |
|-------|-------|-------|
| `rawId` | master top level | Raw recipe stem the master was converted from (`<24-hex>` HelloFresh, `ica-…`, `citygross-R…`, `linas-…`), or `null` when no raw exists (legacy prototypes). Provenance only. |
| `equipment` | node | Array of equipment entries the node uses (below). Omit when none. |
| `heat` | node | Default heat for the node's stovetop vessel: `låg` \| `medellåg` \| `medel` \| `medelhög` \| `hög`. |
| `stepHeat` | node | Per-step override, `{ "<0-based step index>": "<level>" }`, for "sänk till medellåg", "höj till hög". |
| `heatSource` | node | `"inferred"` when the level was guessed from the verb (koka → hög, stek → medelhög, sjud → medellåg); absent = stated in the raw. |
| `oven` | resource node | `{ "temp": 240, "fanTemp": 220 }`: preheat temperature for vanlig ugn and varmluft (°C). `"fanTempSource": "derived"` when the raw gave no varmluft temperature and it was set to temp − 20. `temp: null` + `note` when the raw says "enligt förpackningen". |

Equipment entry:

```json
{ "type": "stekpanna_stor", "ref": "stekpanna_1", "transition": "wipe", "after": "x__toasted_nuts", "sizeSource": "inferred" }
{ "type": "ugn", "after": "x__preheated_oven_240", "slots": 1, "temp": 240, "fanTemp": 220 }
{ "type": "ugn", "after": "x__preheated_oven_200", "slots": 2, "temp": 200, "fanTemp": 180, "fanTempSource": "derived" }
{ "type": "plat", "ref": "plat_1", "shared": true }
```

| Key | Notes |
|-----|-------|
| `type` | Id in `equipment.json`. Sizes are part of the type: `kastrull_liten` (1.5 l), `kastrull_medelstor` (2.5 l), `kastrull_stor` (4 l), `stekpanna_liten` (20 cm), `stekpanna_medelstor` (24 cm), `stekpanna_stor` (28 cm), `wok`, `gryta`, `grill`, `plat`, `ugnsform`, `ugnsform_stor`, `springform`, `bakform`, `galler`, `skal_medelstor`, `skal_stor`, `mixer`, `stavmixer`, … The word is **medelstor** (alias: mellanstor). |
| `ref` | Dish-local instance name. The same `ref` on several nodes is the same physical pot/pan/tray, reused in order. Only written when a vessel is used by 2+ nodes. |
| `transition` | State before this use of a reused vessel: `keep` (samma panna, torka inte ur / behåll skyn), `wipe` (torka ur den först), `wash` (diska ur). Absent = `fresh` (first use). |
| `after` | Node id (or array) the equipment waits for. For `ugn` it is the preheat resource. For a reused vessel it is the previous user when no ingredient edge already orders them. This is a **resource ordering**, not a food edge, so it never counts as an input. |
| `shared` | Ovenware used at the same time by several nodes (two things side by side on one plåt). Counted as one oven slot. |
| `hold` | The output stays in the vessel (e.g. "Ställ åt sidan under lock") until its consumer takes it. |
| `offHeat` | A stovetop vessel used off the burner (mash in the pot, toss in the pan). No heat needed. |
| `slots` | **`ugn` entries, required.** Number of oven trays/levels this oven use needs at the same time (each plåt, ugnsform, galler, bakform = 1). Compared against the kitchen profile's `ovenTrays`. |
| `temp` | **`ugn` entries, required.** Temperature for a vanlig ugn (°C) for this use. `null` only when the raw gives none ("enligt förpackningen"). |
| `fanTemp` | **`ugn` entries, required when `temp` is a number.** Varmluft temperature (°C): the raw's value, or temp − 20 when the raw states none. |
| `fanTempSource` | `"derived"` when `fanTemp` was computed (temp − 20) rather than read from the raw. Absent = from the raw. |
| `mode` | Oven mode for this use, e.g. `"grill"` (gratinera med grillfunktion). |
| `sizeSource` | `"inferred"` when the raw named no size and the size was guessed from the content volume. |

**Resources.** An oven preheat node is tagged `resource` and carries `oven`. It is never a node input, never part of the sum-to-1 rule, and is never shown as an ingredient. Every node that bakes or roasts references it via `{ "type": "ugn", "after": "<preheat id>", "slots", "temp", "fanTemp" }`. The oven runs one temperature at a time. Its capacity is **not fixed**: it comes from the kitchen profile below. The burner size follows from the vessel (`equipment.json` → `burner`) and is not stored.

### Kitchen profile (per account)

Recipes describe what they need; the user's kitchen decides how that is cooked. The profile is a per-account setting stored by the app (not in recipe files):

```json
{ "kitchen": { "ovenTrays": 2, "ovenFan": false } }
```

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `ovenTrays` | integer ≥ 1 | 2 | How many plåtar/formar the oven takes at once with an acceptable result. |
| `ovenFan` | boolean | false | true = the user cooks with varmluft. The app then shows `fanTemp`, otherwise `temp`. |

The default lives in `data/equipment.json` → `defaultKitchen` and is what `validate-recipes.mjs` checks against. `node scripts/check-equipment.mjs --trays 1 --fan` checks a different profile. When concurrent oven uses need more than `ovenTrays`, or two different effective temperatures overlap, the app must serialise those uses (later use waits for the earlier one: start later / longer total time). It reports the same situations as `oven-slots` / `oven-temp`.

## Node optional field

| Field | Required | Notes |
|-------|----------|-------|
| `image` | no | Path string. Prefer **`images.byNode`** on the master so the DAG stays free of media. Use node `image` only if a single node is authored in isolation (e.g. shared prep pack illustration). |

When both `node.image` and `images.byNode[nodeId]` exist, **`images.byNode` wins** (master is source of truth for dish-level media).

---

## What stays out of the graph

- Ingredient icons / allergen icons (HF wrapper `ing_*`, `allergens/`) — not in app schema yet
- Marketing copy, videos (utensils now live in node `equipment`, see above)
- Blobs / data URLs

---

## Compatibility

- Optional blocks (images, nutrition, ratings, cooked) may be absent; the validator checks shape only when present.
- `source` (non-empty string) and `createdAt` (integer unix seconds) are required on every master and matching catalog entry. `source` is not limited to `hellofresh` and `ica`.

## Nutrition quality (HelloFresh)

Converters must **omit** `nutrition` when HF data fails the sanity gate in `recipes/docs/hf-to-graph-conversion.md` §6.1 (e.g. servingSize &lt; 80 g, absurd kcal). The UI already hides a missing strip.

