"""Mise à jour des données avec les limites officielles du Gôh (shapefiles de la cellule, octobre 2026).

Appliquée une seule fois par base (marqueur dans la table meta) :
- la zone « Région du Gôh » prend la limite officielle au lieu du rectangle approximatif ;
- les cours d'eau du registre reçoivent leur tracé s'ils n'en ont pas, les cours d'eau absents sont ajoutés ;
- les sites géolocalisés sans sous-préfecture la reçoivent, et le contrôle de position est recalculé.
"""
import hashlib
import json
import logging
import unicodedata

from sqlalchemy import select

from . import geo
from . import models as M
from .db import SessionLocal

log = logging.getLogger(__name__)
MARQUEUR = "limites_goh_2026_10"
ALIAS = {"guerrhy": "guery", "bon": "don"}  # nom OSM -> nom du registre


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
            if c is None and geo.COURS_EAU[nom].get("type") != "rivière":
                continue  # les ruisseaux restent dans la couche de référence, pas dans le registre
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


MARQUEUR_V2 = "cours_eau_osm_2026_10_11"


def _empreinte(trace) -> str:
    return hashlib.sha1(json.dumps(trace, sort_keys=True).encode()).hexdigest()


async def traces_actualises():
    """Remplace les tracés importés le 11/10 matin (couche de la cellule) par l'extrait OSM du 11/10/2026.
    Un tracé dessiné ou modifié dans l'application n'est pas touché."""
    async with SessionLocal() as db:
        if (await db.execute(select(M.Meta).where(M.Meta.cle == MARQUEUR_V2))).scalar_one_or_none():
            return
        anciens = set(geo.EMPREINTES_TRACES_V1.values())
        cours = (await db.execute(select(M.CoursEau))).scalars().all()
        par_cle = {_cle(c.nom): c for c in cours}
        n = 0
        for nom, trace in geo.COURS_EAU_TRACES.items():
            c = par_cle.get(_cle(nom))
            if c is not None and (not c.trace or _empreinte(c.trace) in anciens):
                c.trace = trace
                n += 1
        db.add(M.Meta(cle=MARQUEUR_V2, valeur=f"{n} tracé(s) actualisé(s)"))
        await db.commit()
        log.info("Tracés des cours d'eau actualisés (OSM 11/10/2026) : %d", n)


MARQUEUR_SITES = "sites_liste_2026_10_11"
DATE_LISTE = __import__("datetime").date(2026, 10, 11)
OBS_SERIHIO = ("Pas de recolonisation, mais des tentatives de reprise d'activités observées "
               "et neutralisées par les patrouilles.")
OBS_OUME = "Pas de recolonisation ; aucune trace d'activité récente observée à ce jour."
OBS_FC = "Site ne présentant aucun signe d'activité récente."
# Liste transmise par la cellule le 11/10/2026.
# (sys, X, Y, département, localité, domaine, forêt, UGF, statut ou None = inchangé, observation)
LISTE_SITES = (
    [("29", x, y, "Gagnoa", loc, "rural", "", "", "tentative_reprise", OBS_SERIHIO) for loc, x, y in [
        ("Behibrokro", 791330.00, 585582.00), ("Behibrokro", 791516.95, 585184.09),
        ("Behibrokro", 804300.10, 652009.44), ("Behibrokro", 802699.28, 652032.31),
        ("Zobokro", 803750.10, 651176.71), ("Zobokro", 804326.64, 652870.34),
        ("Kouassi-N'Guessankoffikro", 800872.65, 654175.25), ("Kangahkro", 803596.64, 651083.73),
        ("N'Guessankoffikro", 800538.71, 653220.65)]]
    + [("30", x, y, "Oumé", loc, "rural", "", "", "tenu", OBS_OUME) for loc, x, y in [
        ("Doka", 238747.20, 705256.27), ("Doka", 238350.05, 705811.29),
        ("Dougbafla", 238215.09, 703199.60), ("Dougbafla", 239940.67, 704021.51),
        ("Kouaméfla", 232523.23, 728305.08), ("Kouaméfla", 231631.93, 728309.41),
        ("Zangué", 238813.20, 706239.42), ("Zangué", 239216.96, 707128.82),
        ("N'zikro", 239990, 705731)]]
    + [("30", 232374, 691105, "Oumé", "FC Sangoué", "foret_classee", "FC Sangoué", "Sangoué", "tenu", OBS_FC),
       ("30", 232290, 690922, "Oumé", "FC Sangoué", "foret_classee", "FC Sangoué", "Sangoué", "tenu", OBS_FC),
       ("30", 229352, 687513, "Oumé", "FC Sangoué", "foret_classee", "FC Sangoué", "Sangoué", "tenu", OBS_FC),
       ("30", 228424, 728951, "Oumé", "FC Téné", "foret_classee", "FC Téné", "Téné", "tenu", OBS_FC),
       ("30", 248041, 703498, "Oumé", "FC Doka", "foret_classee", "FC Doka", "Laouda", None, "Rive droite du Bandama."),
       ("30", 240544, 704848, "Oumé", "FC Doka", "foret_classee", "FC Doka", "Laouda", None,
        "Site situé sur le lit et les berges du fleuve Bandama.")]
)


def _meme_point(saisie, sys, x, y) -> bool:
    try:
        return (str(saisie.get("sys")) == sys and abs(float(saisie.get("x")) - x) < 1
                and abs(float(saisie.get("y")) - y) < 1)
    except (AttributeError, TypeError, ValueError):
        return False


async def sites_liste():
    """Applique la liste des sites du 11/10/2026 : met à jour les sites existants (repérés par leurs
    coordonnées saisies), ajoute un événement quand le statut change, crée les sites manquants."""
    from .routes_sites import next_code

    async with SessionLocal() as db:
        if (await db.execute(select(M.Meta).where(M.Meta.cle == MARQUEUR_SITES))).scalar_one_or_none():
            return
        sites = (await db.execute(select(M.Site))).scalars().all()
        maj = crees = evts = 0
        for sys, x, y, dep, loc, dom, foret, ugf, statut, obs in LISTE_SITES:
            s = next((s for s in sites if _meme_point(s.coord_saisie, sys, x, y)), None)
            lat, lng = geo.to_wgs84(sys, x, y)
            lieu = geo.localiser(lat, lng) or {}
            sp = lieu.get("sous_prefecture", "")
            note = f"Liste des sites du 11/10/2026 : {obs}"
            if s is None:
                s = M.Site(code=await next_code(db, dep), localite=loc, departement=dep, sous_prefecture=sp,
                           domaine=dom, foret=foret, ugf=ugf, lat=lat, lng=lng,
                           coord_saisie={"sys": sys, "x": x, "y": y}, coord_alerte=geo.controle_goh(lat, lng),
                           observations=obs)
                db.add(s)
                await db.flush()
                sites.append(s)
                db.add(M.SiteEvent(site_id=s.id, date=DATE_LISTE, statut=statut or "tenu", source="rapport", note=note))
                crees += 1
                evts += 1
                continue
            s.localite, s.departement, s.domaine, s.foret, s.ugf = loc, dep, dom, foret, ugf
            if sp:
                s.sous_prefecture = sp
            if obs not in (s.observations or ""):
                ancien = (s.observations or "").strip()
                s.observations = f"{ancien}\n{note}" if ancien else obs
            maj += 1
            if statut:
                dernier = (await db.execute(select(M.SiteEvent).where(M.SiteEvent.site_id == s.id)
                                            .order_by(M.SiteEvent.date.desc(), M.SiteEvent.created_at.desc())
                                            .limit(1))).scalar_one_or_none()
                if dernier is None or dernier.statut != statut:
                    db.add(M.SiteEvent(site_id=s.id, date=DATE_LISTE, statut=statut, source="rapport", note=note))
                    evts += 1
        bilan = f"{maj} site(s) mis à jour, {crees} créé(s), {evts} changement(s) de statut"
        db.add(M.Meta(cle=MARQUEUR_SITES, valeur=bilan))
        await db.commit()
        log.info("Liste des sites du 11/10/2026 appliquée : %s", bilan)
