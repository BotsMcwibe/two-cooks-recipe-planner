## 2026-10-11 — Flow graph: Preppa först phases

- With Preppa först on, the flow graph puts the prep phase in the first column(s) and cooking after, with "Prep · N min" / "Tillagning · N min" captions and a dashed divider (replaces the separate prep/cook time strip)
- Prep phase = `prep`-tagged nodes whose inputs are all prep too (`js/utils/prep-phase.js`); prep-tagged nodes that need cooked input (e.g. "Skiva kyckling") stay in the cook phase and keep a small prep pill
- "Gör så här" lists the whole prep phase first when the toggle is on, so the current step, done/active nodes and auto-scroll follow that order
- Done edges use the source cook's colour with 2 kockar; re-layout when a ✓ makes a card taller

## 2026-10-11 — Cook page: flow graph replaces the Gantt

- Matlagning shows a left-to-right dependency graph (`js/views/flow-graph.js`) instead of the Gantt: columns by depth (steg 1 … klart), curved edges, master node highlighted, names wrap (never truncated), sentence-case names
- Progress: nodes fill green with ✓ when all their steps are checked, the node with the current step gets a thick outline, partial nodes show a thin progress bar; the graph scrolls horizontally to keep the active node in view (mobile too)
- Click a node to jump to its step group; 2 kockar adds P1/P2 badges (P2 violet), Preppa först adds prep badges and the prep/cook time strip
- Header time still uses the scheduler makespan
- Step text: no stray space before punctuation (`Vitlöksklyfta.`); step group titles in sentence case
- Hero photo frame hidden on the cook page and in Översikt when the recipe photo fails to load
- `gantt-chart.js` is no longer imported (kept for reference)

## 2026-10-01 — GitHub Pages: app at repository root

### Changed
- Promoted app from `src/` to repository root (`index.html`, `css/`, `js/`, `data/`, `assets/`, `favicon.ico`) so GitHub Pages can serve `/`
- Archived March prototype (`index.html`, `shopping-list.html`, root `css/`, `js/`) to `_archive/legacy-prototype/`
- `server.py` and scripts now use repo-root paths (not `src/`)

## 2026-10-01 — Översikt ingredient images + layout

- Näringsvärde full width above Ingredienser/Skafferi (50/50 columns)
- Circular ingredient thumbs from HF scrape via `scripts/backfill-ingredient-images.mjs`
- Optional `image` on `ingredients.json`; exposed on Ingredient model

## 2026-10-01 — Matlagning / overview UI bugfixes

### Fixed
- Hide Näringsvärde entirely when nutrition data is missing (modal + cooking)
- Removed Översikt button from Matlagning chrome (modal opens from browse cards only)
- Preserve scroll position when toggling Preppa först / 2 kockar (no jump to current step)
- Grayscale `images.byNode` section photos when that group has no startable steps
- Stable images: browse shopping checkboxes sync in place; cooking step photos soft-patched / adopted across re-renders (no flicker)

## 2026-10-01 — UI polish: compact shopping, modal layout, gantt on Matlagning

### Changed
- Inköpslista "Att handla" denser (smaller category headers + ingredient rows)
- Header tabs: Recept | Matlagning | Inköpslista (removed Översikt + Tidsplan tabs)
- Översikt modal: Tillaga inline with title; Näringsvärde + Ingredienser left, Skafferi right; removed step preview + footer CTAs
- Flödesdiagram (gantt) moved to top of Matlagning; prep-first / 2-cooks still update it
- Compact Översikt control kept on Matlagning chrome

# Changelog

## 2026-09-30 — Matlagning hero image + nutrition strip

### Added
- Matlagning view: optional hero from `images.main` (hidden when missing)
- Compact nutrition strip from `nutrition.perPortion` (kcal, protein/fett/kolhydrater; fiber/salt if present), scaled by `currentPortions / basePortions`
- `RecipeRepository.loadMaster` returns `images` + `nutrition` for the UI

### Unchanged
- No catalog thumbnails; no step/`byNode` images in UI
- Existing masters without images/nutrition still work


## 2026-09-30 — Optional images + nutrition schema

### Added
- `SCHEMA.md` — optional recipe/catalog image paths + `nutrition.perPortion` shape (lazy-load friendly)
- Validator accepts optional `catalog.image`, master `images` / `nutrition`, node `image`

### Docs
- `NOTES.md` summary pointer to SCHEMA.md
- `/workspace/recipes/docs/hf-to-graph-conversion.md` — images + nutrition moved from DROP to KEEP (paths only; no asset migration yet)


## 2026-09-30 — JSON catalog + lazy-load refactor

### Added
- `src/data/` JSON layout: `catalog.json`, `ingredients.json`, `units.json`, `prep/*.json`, `recipes/<masterId>.json`
- `src/js/data/loader.js` — static catalog load + `RecipeRepository` lazy master graphs
- Map-based `RecipeGraph` and Map lookups in `Scheduler`
- `basePortions` on masters/catalog; scale = desired / basePortions
- `scripts/validate-recipes.mjs` — unique ids, refs, units, DAG, master tags, basePortions
- `NOTES.md` — layout and how to add recipes

### Changed
- Runtime no longer imports `src/js/data/recipes/*.js` RecipeBuilder modules
- `python3 server.py` serves `src/` on port 8000
- Shopping / ingredient UI uses pantry ingredients only (not recipe outputs)
- Dish-local prep ids namespaced as `<masterId>__<step>`; fixed `chopped_onion` collision

### Migrated masters
spaghetti_bolognese, chicken_bulgur_mediterranean, piroger_ham_broccoli, spinach_feta_piroger, basil_chicken_root_mash

### Shared prep packs
preheated_oven_220, egg_wash, pirog_dough (with warmed_milk_oil)

## 2026-10-01 — HelloFresh-inspired browse → översikt → matlagning
- Browse grid replaces top recipe dropdown (search + data-driven filter chips).
- Översikt preview modal with ingredients, nutrition, Tillaga / Tidsplan CTAs.
- Matlagning rich page: hero, meta, sidebar ingredients/nutrition, step photos + timers.
- Former Översikt (gantt) renamed Tidsplan; gantt/precook kept.
