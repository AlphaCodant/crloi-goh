"""Données initiales : compte du chef de cellule et situation du rapport n°1 de la DREF Gôh (octobre 2026).

Le rapport ne donne pas la date de déguerpissement des sites : leur statut initial est daté
du 22/09/2026, début du plan d'action opérationnel. Les visites du 30/09 au 03/10/2026
sont reprises comme BRQ.
"""
import logging
import os
import secrets
from datetime import date

from sqlalchemy import func, select

from . import geo
from . import models as M
from .db import SessionLocal
from .security import hash_password

log = logging.getLogger("seed")
DATE_ETAT_DES_LIEUX = date(2026, 9, 22)
SOURCE_RAPPORT = "Rapport n°1 DREF Gôh (oct. 2026)"

# (réf. rapport, département, sous-préfecture, localité, sys, X, Y, domaine, forêt, UGF, cours d'eau, statut, observation)
SITES = [
    ("T1-1", "Gagnoa", "Sérihio", "Behibrokro", "29", 791330.00, 585582.00, "rural", "", "", "", "demantele", "Tentatives de reprise observées et neutralisées par les patrouilles. Coordonnées à vérifier (point très au sud des autres sites)."),
    ("T1-2", "Gagnoa", "Sérihio", "Behibrokro", "29", 791516.95, 585184.09, "rural", "", "", "", "demantele", "Tentatives de reprise observées et neutralisées par les patrouilles. Coordonnées à vérifier (point très au sud des autres sites)."),
    ("T1-3", "Gagnoa", "Sérihio", "Behibrokro", "29", 804300.10, 652009.44, "rural", "", "", "", "demantele", "Tentatives de reprise observées et neutralisées par les patrouilles."),
    ("T1-4", "Gagnoa", "Sérihio", "Behibrokro", "29", 802699.28, 652032.31, "rural", "", "", "", "demantele", "Tentatives de reprise observées et neutralisées par les patrouilles."),
    ("T1-5", "Gagnoa", "Sérihio", "Zobokro", "29", 803750.10, 651176.71, "rural", "", "", "", "demantele", "Tentatives de reprise observées et neutralisées par les patrouilles."),
    ("T1-6", "Gagnoa", "Sérihio", "Zobokro", "29", 804326.64, 652870.34, "rural", "", "", "", "demantele", "Tentatives de reprise observées et neutralisées par les patrouilles."),
    ("T1-7", "Gagnoa", "Sérihio", "Kouassi-N'Guessankoffikro", "29", 800872.65, 654175.25, "rural", "", "", "", "demantele", "Tentatives de reprise observées et neutralisées par les patrouilles."),
    ("T1-8", "Gagnoa", "Sérihio", "Kangahkro", "29", 803596.64, 651083.73, "rural", "", "", "", "demantele", "Tentatives de reprise observées et neutralisées par les patrouilles."),
    ("T1-9", "Gagnoa", "Sérihio", "N'Guessankoffikro", "29", 800538.71, 653220.65, "rural", "", "", "", "demantele", "Tentatives de reprise observées et neutralisées par les patrouilles."),
    ("T1-10", "Oumé", "Oumé", "Doka", "30", 238747.20, 705256.27, "rural", "", "", "Bandama", "tenu", "Pas de recolonisation ; aucune trace d'activité récente."),
    ("T1-12", "Oumé", "Oumé", "Doka", "30", 238350.05, 705811.29, "rural", "", "", "Bandama", "tenu", "Pas de recolonisation ; aucune trace d'activité récente."),
    ("T1-13", "Oumé", "Oumé", "Dougbafla", "30", 238215.09, 703199.60, "rural", "", "", "Téné", "tenu", "Pas de recolonisation ; aucune trace d'activité récente."),
    ("T1-14", "Oumé", "Oumé", "Dougbafla", "30", 239940.67, 704021.51, "rural", "", "", "Téné", "tenu", "Pas de recolonisation ; aucune trace d'activité récente."),
    ("T1-15", "Oumé", "Oumé", "Kouaméfla", "30", 232523.23, 728305.08, "rural", "", "", "Don (Bon)", "tenu", "Pas de recolonisation ; aucune trace d'activité récente."),
    ("T1-16", "Oumé", "Oumé", "Kouaméfla", "30", 231631.93, 728309.41, "rural", "", "", "Don (Bon)", "tenu", "Pas de recolonisation ; aucune trace d'activité récente."),
    ("T1-17", "Oumé", "Oumé", "Zangué", "30", 238813.20, 706239.42, "rural", "", "", "Téné", "tenu", "Pas de recolonisation ; aucune trace d'activité récente."),
    ("T1-18", "Oumé", "Oumé", "Zangué", "30", 239216.96, 707128.82, "rural", "", "", "Téné", "tenu", "Pas de recolonisation ; aucune trace d'activité récente."),
    ("T1-19", "Oumé", "Oumé", "N'zikro", "30", 239990, 705731, "rural", "", "", "Téné", "tenu", "Pas de recolonisation ; aucune trace d'activité récente."),
    ("T2-1", "Oumé", "", "FC Sangoué", "30", 232374, 691105, "foret_classee", "FC Sangoué", "Sangoué", "", "tenu", "Aucun signe d'activité récente."),
    ("T2-2", "Oumé", "", "FC Sangoué", "30", 232290, 690922, "foret_classee", "FC Sangoué", "Sangoué", "", "tenu", "Aucun signe d'activité récente."),
    ("T2-3", "Oumé", "", "FC Sangoué", "30", 229352, 687513, "foret_classee", "FC Sangoué", "Sangoué", "", "tenu", "Aucun signe d'activité récente."),
    ("T2-4", "Oumé", "", "FC Téné", "30", 228424, 728951, "foret_classee", "FC Téné", "Téné", "Téné", "tenu", "Aucun signe d'activité récente."),
    ("T2-5", "Oumé", "", "FC Doka", "30", 248041, 703498, "foret_classee", "FC Doka", "Laouda", "Bandama", "demantele", "Rive droite du Bandama."),
    ("T2-6", "Oumé", "", "FC Doka", "30", 240544, 704848, "foret_classee", "FC Doka", "Laouda", "Bandama", "demantele", "Site situé sur le lit et les berges du fleuve Bandama."),
]

# (date, unités, [(réf. site ou ("NOUVEAU", localité, département, S/P), constat, saisies, note)])
BRQS = [
    (date(2026, 9, 30), "DREF / PEF Galébré", [
        ("T1-1", "tentative_reprise", {"motopompes": 2, "tapis": 2, "tuyaux_m": 50}, "Behibrokro site 1 : tentative de recolonisation par des actions isolées. Aucun individu interpellé."),
        ("T1-2", "tentative_reprise", {"motopompes": 2, "tapis": 2, "tuyaux_m": 45}, "Behibrokro site 2 : tentative de recolonisation par des actions isolées. Aucun individu interpellé."),
        (("NOUVEAU", "Kouakoukouassikro", "Gagnoa", "Sérihio"), "tentative_reprise", {"motopompes": 2, "tapis": 2, "tuyaux_m": 43}, "Tentative de recolonisation par des actions isolées. Aucun individu interpellé. Site à géolocaliser."),
        ("T1-8", "tenu", {}, "Site non recolonisé."),
    ]),
    (date(2026, 10, 1), "CUGF Sangoué", [
        ("T2-1", "tenu", {}, "Site non recolonisé."), ("T2-2", "tenu", {}, "Site non recolonisé."), ("T2-3", "tenu", {}, "Site non recolonisé."),
    ]),
    (date(2026, 10, 2), "DREF / CG Gagnoa / CEF Oumé", [
        ("T1-15", "tenu", {}, "Kouaméfla : site non recolonisé."), ("T1-16", "tenu", {}, "Kouaméfla : site non recolonisé."),
        (("NOUVEAU", "Gobia", "Oumé", "Oumé"), "tenu", {}, "Site non recolonisé. Site à géolocaliser."),
    ]),
    (date(2026, 10, 3), "DREF / CG Gagnoa / CEF Oumé ; CEF Guibéroua / PEF Galébré", [
        ("T1-17", "tenu", {}, "Zangué : site non recolonisé."), ("T1-18", "tenu", {}, "Zangué : site non recolonisé."),
        ("T1-13", "tenu", {}, "Dougbafla : site non recolonisé."), ("T1-14", "tenu", {}, "Dougbafla : site non recolonisé."),
        ("T1-9", "tenu", {}, "« N'guessankro » du rapport, rattaché à N'Guessankoffikro (à confirmer) : site non recolonisé."),
    ]),
]

COURS_EAU = [
    ("Bandama", "Bandama", "Fleuve", "S/P Oumé (Gobia, Kouaméfla, Simonkro, Kimoukro, Doka)", 62.04, "tres_impacte", "Très impacté par l'orpaillage dans les localités riveraines : Kouaméfla, Gobia, Kimoukro, Doka."),
    ("Téné", "Bandama", "Rivière, affluent du Bandama", "S/P Guépahouo, S/P Oumé", 50.46, "tres_impacte", "Très impacté à N'zikro, Zangué et Dougbafla."),
    ("Don (Bon)", "Bandama", "Ruisseau, affluent de la Téné", "S/P Oumé (Kouaméfla)", 22.44, "impacte", "Impacté à Goda."),
    ("Boubo", "Boubo", "Fleuve côtier", "Oumé-Diégonéfla", 37.98, "faible", "Faiblement impacté par les activités du département de Hiré."),
    ("Davo", "Sassandra", "Rivière, affluent du Sassandra", "Gagnoa", 106.32, "non_impacte", ""),
    ("Guéry", "Sassandra", "Ruisseau, affluent de la Davo", "Villages et quartiers de Gagnoa", 30.37, "non_impacte", ""),
    ("Lac Delbo", "Sassandra", "Lac artificiel (eau potable)", "Gagnoa", None, "non_impacte", "Superficie : 75,34 ha."),
]


async def seed():
    async with SessionLocal() as db:
        if not (await db.execute(select(func.count()).select_from(M.User))).scalar():
            email = os.environ.get("ADMIN_EMAIL", "chef.renseignement@crloi-goh.ci").lower()
            pwd = os.environ.get("ADMIN_PASSWORD") or secrets.token_urlsafe(12)
            db.add(M.User(email=email, full_name=os.environ.get("ADMIN_NAME", "Chef de la cellule renseignement"),
                          grade=os.environ.get("ADMIN_GRADE", "Lieutenant"), role="chef", password_hash=hash_password(pwd)))
            await db.commit()
            if not os.environ.get("ADMIN_PASSWORD"):
                log.warning("Compte créé : %s / mot de passe : %s (à changer)", email, pwd)

        if (await db.execute(select(func.count()).select_from(M.Site))).scalar():
            return

        refs = {}
        counters = {"Gagnoa": 0, "Oumé": 0}
        for ref, dep, sp, loc, sys, x, y, dom, foret, ugf, ce, statut, obs in SITES:
            counters[dep] += 1
            lat, lng = geo.to_wgs84(sys, x, y)
            s = M.Site(code=f"{'GAG' if dep == 'Gagnoa' else 'OUM'}-{counters[dep]:03d}", localite=loc, departement=dep,
                       sous_prefecture=sp, domaine=dom, foret=foret, ugf=ugf, cours_eau=ce, lat=lat, lng=lng,
                       coord_saisie={"sys": sys, "x": x, "y": y, "ref_rapport": ref}, coord_alerte=geo.controle_goh(lat, lng),
                       observations=f"{obs} (réf. {ref} du rapport n°1)")
            db.add(s)
            await db.flush()
            refs[ref] = s
            db.add(M.SiteEvent(site_id=s.id, date=DATE_ETAT_DES_LIEUX, statut=statut, source="rapport",
                               note=f"État des lieux — {SOURCE_RAPPORT}. Date de déguerpissement non précisée dans le rapport."))

        for d, unites, visites in BRQS:
            b = M.Brq(date=d, unites=unites, reference=f"Repris du {SOURCE_RAPPORT}")
            db.add(b)
            await db.flush()
            for target, constat, saisies, note in visites:
                if isinstance(target, tuple):
                    _, loc, dep, sp = target
                    counters[dep] += 1
                    s = M.Site(code=f"{'GAG' if dep == 'Gagnoa' else 'OUM'}-{counters[dep]:03d}", localite=loc, departement=dep,
                               sous_prefecture=sp, coord_alerte=geo.controle_goh(None, None),
                               observations=f"Cité dans le {SOURCE_RAPPORT} sans coordonnées.")
                    db.add(s)
                    await db.flush()
                else:
                    s = refs[target]
                v = M.Visite(brq_id=b.id, site_id=s.id, date=d, unite=unites, constat=constat, saisies=saisies, interpelles=0, note=note)
                db.add(v)
                await db.flush()
                db.add(M.SiteEvent(site_id=s.id, date=d, statut=constat, source="brq", source_id=v.id, note=note))

        for nom, bassin, typ, loc, km, intensite, com in COURS_EAU:
            db.add(M.CoursEau(nom=nom, bassin=bassin, type=typ, localites=loc, longueur_km=km, intensite=intensite, commentaire=com))

        db.add(M.Zone(nom="Région du Gôh", categorie="region", approximative=False, geometrie=geo.REGION))
        await db.commit()
        log.info("Données du rapport n°1 chargées : %d sites", len(refs))
