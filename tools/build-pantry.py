#!/usr/bin/env python3
"""Regenerate data/pantry.json for Skafferiet (#skafferi).

Source of truth: tools/pantry-items.json (curated shelf-stable staples with a
store package size + product URL, checked 2026-10-13). This script adds, for
each recipe in data/catalog.json, which of those staples it uses, so the page
can show which recipes the pantry covers.
Usage: python3 tools/build-pantry.py
"""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
src = json.loads((ROOT / "tools" / "pantry-items.json").read_text())
ids = {i["id"] for i in src["items"]}
catalog = json.loads((ROOT / "data" / "catalog.json").read_text())
recipes = []
for c in catalog:
    f = ROOT / "data" / "recipes" / f"{c['id']}.json"
    if not f.exists():
        continue
    r = json.loads(f.read_text())
    produced = {n["id"] for n in r.get("nodes", [])}
    used = sorted({i["id"] for n in r.get("nodes", []) for i in n.get("inputs", [])
                   if i["id"] in ids and i["id"] not in produced})
    if used:
        recipes.append({"id": c["id"], "name": c["name"], "pantry": used})
used_any = {p for r in recipes for p in r["pantry"]}
missing = ids - used_any
if missing:
    raise SystemExit(f"pantry items used by no recipe: {sorted(missing)}")
recipes.sort(key=lambda r: r["name"].lower())
# Tile image: the ingredient's own image, else a close look-alike, else none (letter tile)
ING = json.loads((ROOT / "data" / "ingredients.json").read_text())["ingredients"]
LOOKALIKE = {"rigatoni": "pasta", "long_grain_rice": "rice", "mie_noodles": "noodles",
             "udon_noodles": "noodles", "naan_bread": "flatbread", "ready_daal": "red_lentils",
             "chicken_bouillon": "vegetable_bouillon", "fish_sauce": "soy_sauce",
             "hoisin_sauce": "bbq_sauce", "sambal_oelek": "sweet_chili_sauce",
             "paneng_red_curry": "yellow_curry_paste", "asian_wok_sauce": "umami_sauce",
             "sesame_oil": "oil", "vinegar_spirit": "white_wine_vinegar",
             "wholegrain_mustard": "mustard"}
def image_for(iid):
    for cand in (iid, LOOKALIKE.get(iid)):
        img = cand and ING.get(cand, {}).get("image")
        if img and (ROOT / img).exists():
            return img
    return None
items = []
for i in src["items"]:
    i = dict(i)
    img = image_for(i["id"])
    if img:
        i["image"] = img
    items.append(i)
out = {"items": items, "recipes": recipes}
(ROOT / "data" / "pantry.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
print(f"{len(src['items'])} varor, {len(recipes)} recept -> data/pantry.json")
