"""Mise à jour des données avec les limites officielles du Gôh (shapefiles de la cellule, octobre 2026).

Appliquée une seule fois par base (marqueur dans la table meta) :
- la zone « Région du Gôh » prend la limite officielle au lieu du rectangle approximatif ;
- les cours d'eau du registre reçoivent leur tracé s'ils n'en ont pas, les cours d'eau absents sont ajoutés ;
- les sites géolocalisés sans sous-préfecture la reçoivent, et le contrôle de position est recalculé.
"""
import logging
import unicodedata

from sqlalchemy import select

from . import geo
from . import models as M
from .db import SessionLocal

log = logging.getLogger(__name__)
MARQUEUR = "limites_goh_2026_10"
ALIAS = {"guerrhy": "guery"}  # nom OSM -> nom du registre


def _cle(nom: str) -> str:
    s = unicodedata.normalize("NFKD", nom or "").encode("ascii", "ignore").decode().lower()
    s = s.split("(")[0].strip()
    return ALIAS.get(s, s)


async def appliquer():
    async with SessionLocal() as db:
        if (await db.execute(select(M.Meta).where(M.Meta.cle == MARQUEUR))).scalar_one_or_none():
            return
        bilan = []

        regions = (await db.execute(select(M.Zone).where(M.Zone.categorie == "region"))).scalars().all()
        for z in regions:
            z.nom, z.geometrie, z.approximative = "Région du Gôh", geo.REGION, False
        if not regions:
            db.add(M.Zone(nom="Région du Gôh", categorie="region", approximative=False, geometrie=geo.REGION))
        bilan.append("limite de la région")

        cours = (await db.execute(select(M.CoursEau))).scalars().all()
        par_cle = {_cle(c.nom): c for c in cours}
        traces, ajoutes = 0, 0
        for nom, trace in geo.COURS_EAU_TRACES.items():
            c = par_cle.get(_cle(nom))
            if c is None:
                db.add(M.CoursEau(nom=nom, type="Rivière", intensite="non_impacte", trace=trace,
                                  commentaire="Ajouté avec les couches de la cellule (tracé OpenStreetMap)."))
                ajoutes += 1
            elif not c.trace:
                c.trace = trace
                traces += 1
        bilan.append(f"{traces} tracé(s) de cours d'eau, {ajoutes} cours d'eau ajouté(s)")

        sites = (await db.execute(select(M.Site).where(M.Site.lat.is_not(None)))).scalars().all()
        sp = 0
        for s in sites:
            s.coord_alerte = geo.controle_goh(s.lat, s.lng)
            lieu = geo.localiser(s.lat, s.lng)
            if not lieu:
                continue
            if not (s.sous_prefecture or "").strip():
                s.sous_prefecture = lieu["sous_prefecture"]
                sp += 1
            if s.departement and s.departement != lieu["departement"]:
                s.coord_alerte = (f"Point situé dans la sous-préfecture de {lieu['sous_prefecture']} "
                                  f"(département de {lieu['departement']}) : vérifier le département ou les coordonnées")
        bilan.append(f"{sp} sous-préfecture(s) de site complétée(s)")

        db.add(M.Meta(cle=MARQUEUR, valeur=" ; ".join(bilan)))
        await db.commit()
        log.info("Limites du Gôh appliquées : %s", " ; ".join(bilan))
