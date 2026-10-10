"""Génère src/gr/icones.woff2 : jeu d'icônes Material Symbols Outlined réduit aux icônes de l'application.

- graisse fixée à 300 (trait fin), sans remplissage, taille optique 20 ;
- ne garde que les icônes dont le nom apparaît dans src/ (≈ 40 Ko au lieu de 3,8 Mo).

À relancer après l'ajout d'une nouvelle icône :
    pip install fonttools brotli
    python scripts/icones.py
"""
import re
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

RACINE = Path(__file__).resolve().parent.parent
SOURCE = RACINE / "node_modules/material-symbols/material-symbols-outlined.woff2"
SORTIE = RACINE / "src/gr/icones.woff2"
LISTE = RACINE / "src/gr/icones.txt"

# Tous les mots qui pourraient être un nom d'icône (le filtre se fait ensuite sur les noms existants)
mots = set()
for f in (RACINE / "src").rglob("*"):
    if f.suffix in {".js", ".jsx"}:
        mots |= set(re.findall(r"\b[a-z][a-z0-9_]{1,40}\b", f.read_text(encoding="utf-8")))

police = TTFont(SOURCE)
police = instancer.instantiateVariableFont(police, {"FILL": 0, "GRAD": 0, "opsz": 20, "wght": 300})
car = {g: chr(c) for c, g in police.getBestCmap().items()}

gardes, icones = set(), []
for lookup in police["GSUB"].table.LookupList.Lookup:
    for st in lookup.SubTable:
        st = st.ExtSubTable if lookup.LookupType == 7 else st
        if not hasattr(st, "ligatures"):
            continue
        for premier in list(st.ligatures):
            restes = []
            for lig in st.ligatures[premier]:
                nom = car.get(premier, "") + "".join(car.get(c, "?") for c in lig.Component)
                if nom in mots:
                    restes.append(lig)
                    gardes.add(lig.LigGlyph)
                    icones.append(nom)
            if restes:
                st.ligatures[premier] = restes
            else:
                del st.ligatures[premier]

opts = subset.Options()
opts.layout_features = ["liga", "rlig", "calt", "ccmp"]
opts.flavor = "woff2"
opts.notdef_outline = True
sous = subset.Subsetter(opts)
sous.populate(text="abcdefghijklmnopqrstuvwxyz0123456789_", glyphs=sorted(gardes))
sous.subset(police)
police.flavor = "woff2"
police.save(SORTIE)
LISTE.write_text("\n".join(sorted(set(icones))) + "\n", encoding="utf-8")
print(f"{len(set(icones))} icônes, {SORTIE.stat().st_size // 1024} Ko -> {SORTIE.relative_to(RACINE)}")
