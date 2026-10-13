#!/usr/bin/env python3
"""Regenerate data/spice-blends.json from the blend playground (spice-mix/play.py).

Usage: python3 tools/build-spice-blends.py [path/to/play.py]
Default source: /workspace/spice-mix/play.py

play.py keys spices in ASCII (vitlok, ingefara); DISPLAY maps them to Swedish
names for the UI. INGREDIENT maps them to data/ingredients.json ids so a
"Blanda kryddmix" step and the shopping list can use real ingredients.

Each blend in play.py carries `id` (= the mix ingredient's `blendId` in
data/ingredients.json) and `display` (Swedish name). Optional `bag` = grams in a
store bag (e.g. CityGross Tacokrydda 28 g) and `gramsPerTsk` (default 2.5).
The script fails if a spice has no ingredient mapping, a blend has no id, or a
mix ingredient (blendId) in ingredients.json has no blend.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/workspace/spice-mix/play.py")
OUT = ROOT / "data" / "spice-blends.json"

DISPLAY = {
    "paprika": "Paprika",
    "vitlok": "Vitlöksgranulat",
    "lok": "Lökgranulat",
    "oregano": "Oregano",
    "basilika": "Basilika",
    "timjan": "Timjan",
    "persilja": "Persilja",
    "salvia": "Salvia",
    "ingefara": "Ingefära",
    "koriander": "Koriander",
    "spiskummin": "Spiskummin",
    "cayenne": "Cayennepeppar",
    "chiliflakes": "Chiliflakes",
    "senap": "Senapsfrö",
    "chili": "Chilipeppar",
    "salt": "Salt",
    "peppar": "Svartpeppar",
    "citronskal": "Torkat citronskal",
    "rosmarin": "Rosmarin",
    "rokt_paprika": "Rökt paprika",
    "gurkmeja": "Gurkmeja",
    "kanel": "Kanel",
    "kardemumma": "Kardemumma",
    "farinsocker": "Farinsocker",
    "nejlika": "Kryddnejlika",
    "muskot": "Muskot",
    "kryddpeppar": "Kryddpeppar",
    "hasselnot": "Hasselnötter",
    "sesam": "Sesamfrön",
    "sumak": "Sumak",
}

# play.py spice key -> ingredient id in data/ingredients.json
INGREDIENT = {
    "paprika": "paprika_powder", "vitlok": "garlic_powder", "lok": "onion_powder",
    "oregano": "dried_oregano", "basilika": "dried_basil", "timjan": "dried_thyme",
    "persilja": "dried_parsley", "salvia": "dried_sage", "ingefara": "ground_ginger",
    "koriander": "ground_coriander", "spiskummin": "cumin", "cayenne": "cayenne",
    "chiliflakes": "chili_flakes", "senap": "mustard_seed", "chili": "chili_powder",
    "salt": "salt", "peppar": "pepper", "citronskal": "dried_lemon_peel",
    "rosmarin": "dried_rosemary", "rokt_paprika": "smoked_paprika", "gurkmeja": "turmeric",
    "kanel": "cinnamon", "kardemumma": "cardamom", "farinsocker": "brown_sugar",
    "nejlika": "cloves", "muskot": "nutmeg", "kryddpeppar": "allspice",
    "hasselnot": "hazelnuts", "sesam": "sesame_seeds", "sumak": "sumac",
}


def load(path):
    spec = importlib.util.spec_from_file_location("spice_play", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # play.py only runs report() under __main__
    return mod


def main():
    mod = load(SRC)
    ingredients = json.loads((ROOT / "data" / "ingredients.json").read_text(encoding="utf-8"))["ingredients"]
    errors = []
    used = sorted({s for b in mod.BLENDS.values() for s in b["spices"]})
    spices = []
    for key in used:
        entry = {"id": key, "name": DISPLAY.get(key, key), "ingredientId": INGREDIENT.get(key)}
        if key not in INGREDIENT:
            errors.append(f"spice '{key}' has no INGREDIENT mapping")
        elif INGREDIENT[key] not in ingredients:
            errors.append(f"spice '{key}' maps to unknown ingredient '{INGREDIENT[key]}'")
        jar = getattr(mod, "JARS", {}).get(key)
        if jar:
            grams, _count, note = jar
            entry["jarGrams"] = grams
            if note:
                note = re.sub(r",?\s*verified:.*$", "", note, flags=re.I).strip(" ,")
                note = re.sub(r"\bmalen\b", "mald", note)
            if note:
                entry["jarNote"] = note
        spices.append(entry)
    spices.sort(key=lambda s: s["name"].lower())
    mix_ids = {ing.get("blendId"): iid for iid, ing in ingredients.items() if ing.get("blendId")}
    blends = []
    for name, b in mod.BLENDS.items():
        bid = b.get("id")
        if not bid:
            errors.append(f"blend '{name}' has no id")
            continue
        if bid not in mix_ids:
            print(f"note: blend '{name}' is shelf-only (no recipe ingredient uses it)")
        entry = {
            "id": bid,
            "name": b.get("display") or name,
            "brand": name if (b.get("display") and b["display"] != name) else None,
            "ingredientId": mix_ids.get(bid),
            "packetGrams": b["packet"],
            "spices": {k: v for k, v in b["spices"].items() if v > 0},
        }
        for opt in ("bag", "gramsPerTsk"):
            if b.get(opt):
                entry[opt] = b[opt]
        blends.append({k: v for k, v in entry.items() if v is not None})
    have = {b["id"] for b in blends}
    for bid, iid in mix_ids.items():
        if bid not in have:
            errors.append(f"mix ingredient '{iid}' (blendId '{bid}') has no blend in play.py")
    if errors:
        sys.exit("build-spice-blends: \n  " + "\n  ".join(errors))
    data = {
        "source": "spice-mix/play.py",
        "spices": spices,
        "blends": blends,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(spices)} spices, {len(blends)} blends")


if __name__ == "__main__":
    main()
