# Recipe app — scalable JSON layout

Refactored so the app can grow to thousands of recipes without importing JS recipe modules at startup.

## Run

```bash
# from html-proto-recipe/
python3 server.py          # serves repo root on http://localhost:8000
node scripts/validate-recipes.mjs
```

Open http://localhost:8000 — catalog loads first; selecting a dish fetches that master (+ shared prep) as JSON.

## Data layout

| Path | Purpose |
|------|---------|
| `data/catalog.json` | Small list of masters for the picker / shopping UI |
| `data/ingredients.json` | Base pantry ingredients + category tags only |
| `data/units.json` | Units |
| `data/prep/<packId>.json` | Shared prep graphs (canonical ids) |
| `data/recipes/<masterId>.json` | One master + its dish-local nodes; `sharedPrep` lists pack ids |

Legacy `js/data/recipes/*.js` RecipeBuilder modules are **not** imported by the runtime. `RecipeBuilder` remains in `js/models/recipe.js` as an optional authoring helper.

## IDs

- **Shared prep** — short canonical ids (`egg_wash`, `pirog_dough`, `preheated_oven_220`).
- **Dish-local prep** — `<masterId>__<step>` (e.g. `spaghetti_bolognese__chopped_onion` vs `spinach_feta_piroger__chopped_onion`) so amounts can differ without collisions.
- **Master** — id equals filename stem and catalog `id`, tagged `"master"`, has `basePortions`.

## Portion scaling

`scale = desiredPortions / recipe.basePortions` (no more hardcoded `/4`). Catalog and each master JSON carry `basePortions`.

## Add a new recipe

1. Create `data/recipes/my_dish.json`:
   ```json
   {
     "masterId": "my_dish",
     "basePortions": 4,
     "sharedPrep": ["egg_wash"],
     "nodes": [
       { "id": "my_dish__chopped_onion", "name": "Hacka Lök", "outputName": "Hackad lök",
         "inputs": [{ "id": "onion", "amount": 1, "unit": "st" }],
         "steps": ["Hacka {{onion}}."], "duration": 2, "tags": ["prep"] },
       { "id": "my_dish", "name": "My Dish", "outputName": "My Dish",
         "inputs": [{ "id": "my_dish__chopped_onion", "amount": 1, "unit": "st" }],
         "steps": ["Servera {{my_dish__chopped_onion}}."], "duration": 1, "tags": ["master"] }
     ]
   }
   ```
2. Add a catalog entry in `data/catalog.json` (`id`, `name`, `basePortions`, optional `tags`, `cuisine`, `allergens`, `difficulty`, `totalMinutes`, `searchText`, `image`).
3. Reuse shared packs under `data/prep/` when prep is identical; otherwise keep nodes local with namespaced ids.
4. Add any new base ingredients to `data/ingredients.json`.
5. Run `node scripts/validate-recipes.mjs`.


## Images & nutrition (optional)

See **`SCHEMA.md`** for the full optional extension. Summary:

- **Catalog** `image`: `null` or path relative to app root (thumbnail only).
- **Master** optional `images.main` + `images.byNode` (node id → path); optional `nutrition` with `basis` + `perPortion` (stable keys like `energyKcal`, `fatG`, …).
- Paths only — no blobs. Assets live under `assets/recipes/<masterId>/` when present.
- All new fields are optional; existing masters stay valid without them.
- Matlagning shows optional `images.main` hero + `nutrition.perPortion` strip (scaled by currentPortions/basePortions). Catalog thumbs and step/`byNode` images are not wired yet.

## Code entry points

- `js/main.js` — async bootstrap, catalog + lazy load
- `js/data/loader.js` — `loadStaticData()`, `RecipeRepository`
- `js/core/recipe-graph.js` — `Map`-based graph
- `js/models/scheduler.js` — Map lookups (no hot-path `array.find`)
- Shopping / ingredient lists use **base** ingredients only; recipe outputs are not pantry items

## Migrated masters

- `spaghetti_bolognese`
- `chicken_bulgur_mediterranean`
- `piroger_ham_broccoli`
- `spinach_feta_piroger`
- `basil_chicken_root_mash`

Shared prep extracted: `preheated_oven_220`, `egg_wash`, `pirog_dough` (includes `warmed_milk_oil`).
