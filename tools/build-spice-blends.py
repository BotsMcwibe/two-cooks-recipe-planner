#!/usr/bin/env python3
"""Regenerate data/spice-blends.json from the blend playground (spice-mix/play.py).

Usage: python3 tools/build-spice-blends.py [path/to/play.py]
Default source: /workspace/spice-mix/play.py

play.py keys spices in ASCII (vitlok, ingefara); DISPLAY maps them to Swedish
names for the UI. Unknown keys fall back to the key itself.
"""
import importlib.util
import json
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
}


def load(path):
    spec = importlib.util.spec_from_file_location("spice_play", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # play.py only runs report() under __main__
    return mod


def main():
    mod = load(SRC)
    used = sorted({s for b in mod.BLENDS.values() for s in b["spices"]})
    spices = []
    for key in used:
        entry = {"id": key, "name": DISPLAY.get(key, key)}
        jar = getattr(mod, "JARS", {}).get(key)
        if jar:
            grams, _count, note = jar
            entry["jarGrams"] = grams
            if note:
                entry["jarNote"] = note
        spices.append(entry)
    spices.sort(key=lambda s: s["name"].lower())
    blends = [
        {
            "name": name,
            "packetGrams": b["packet"],
            "spices": {k: v for k, v in b["spices"].items() if v > 0},
        }
        for name, b in mod.BLENDS.items()
    ]
    data = {
        "source": "spice-mix/play.py",
        "note": "Hemgjorda gissningar, inte HelloFreshs egna recept. Gram per påse.",
        "spices": spices,
        "blends": blends,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(spices)} spices, {len(blends)} blends")


if __name__ == "__main__":
    main()
