# html-proto-recipe — Receptplanerare

Static recipe planner (browse, cook timeline, shopping list) served as plain HTML/JS/CSS.

## Local development

```bash
python3 server.py
```

Open **http://localhost:8000** (serves the repository root; caching disabled).

Validate recipe JSON:

```bash
node scripts/validate-recipes.mjs
```

## GitHub Pages

1. Make the repository **public** (required on the free GitHub plan for Pages).
2. Repo **Settings → Pages → Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **`master`**
   - Folder: **`/` (root)**
3. Expected URL: **https://yesber.github.io/html-proto-recipe/**

Deep link example (opens Matlagning for a recipe): `https://yesber.github.io/html-proto-recipe/#cook/bbq_lax_ranch`

The app entry is root `index.html` (title: Receptplanerare). Do not point Pages at `_archive/`.

## Layout

| Path | Role |
|------|------|
| `index.html`, `css/`, `js/`, `data/`, `assets/`, `favicon.ico` | App (Pages entry) |
| `server.py`, `scripts/` | Local serve + tooling |
| `SCHEMA.md`, `NOTES.md`, `CHANGELOG.md` | Docs |
| `_archive/legacy-prototype/` | March 2026 prototype (not served as the app) |

See `NOTES.md` for the JSON data layout and how to add recipes.
