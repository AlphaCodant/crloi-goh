"""Imagerie et prospection : couches GEE, analyses, zones suspectes, missions d'éclairage, images drone."""
from datetime import date, datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from . import gee, geo
from . import models as M
from . import prospection as P
from .db import get_session
from .routes_sites import next_code
from .security import current_user

router = APIRouter()
TAILLE_MAX_IMAGE = 25 * 1024 * 1024
STATUTS_CIBLE = ("a_verifier", "programmee", "confirmee", "infirmee", "ecartee")
StatutCible = Literal["a_verifier", "programmee", "confirmee", "infirmee", "ecartee"]


def _message_gee(e: Exception) -> str:
    """Traduit les erreurs Earth Engine les plus fréquentes en consignes."""
    t = str(e)
    if "earthengine.maps.create" in t or "earthengine.computations.create" in t or "PERMISSION_DENIED" in t.upper():
        return ("Le compte de service n'a pas les droits nécessaires dans le projet Google Cloud. Dans la console Google Cloud → IAM, "
                "donnez-lui les rôles « Earth Engine Resource Writer » et « Service Usage Consumer », puis réessayez dans 2 minutes. "
                f"(détail : {t[:160]})")
    if "too large" in t or "memory" in t.lower():
        return f"Zone trop lourde pour un seul calcul : choisissez une zone plus petite (forêt, zone de travail). (détail : {t[:160]})"
    if "not registered" in t.lower() or "not been used" in t.lower():
        return f"Le projet Google Cloud n'est pas enregistré pour Earth Engine ou l'API n'est pas activée. (détail : {t[:200]})"
    return t


def _maintenant() -> str:
    return datetime.now(timezone.utc).isoformat()


def _trace(obj, user: dict, action: str, note: str = ""):
    obj.historique = (obj.historique or []) + [{"at": _maintenant(), "by": user["full_name"], "action": action, "note": note}]


# ======================================================== GEE : état et couches
@router.get("/gee/etat")
async def gee_etat(_u=Depends(current_user)):
    return {"configure": gee.configure(), "identite": gee.identite(), "produits": {k: v["libelle"] for k, v in gee.PRODUITS.items()}}


@router.post("/gee/verifier")
async def gee_verifier(_u=Depends(current_user)):
    if not gee.configure():
        raise HTTPException(503, "Google Earth Engine n'est pas configuré sur le serveur (variable GEE_SERVICE_ACCOUNT_JSON).")
    try:
        return await run_in_threadpool(gee.verifier)
    except Exception as e:  # noqa: BLE001 — message GEE rendu tel quel à l'utilisateur
        raise HTTPException(502, f"Connexion à Earth Engine impossible : {_message_gee(e)}")


class CoucheIn(BaseModel):
    produit: str
    du: date
    au: date
    ref_du: Optional[date] = None
    ref_au: Optional[date] = None
    nuages: float = Field(60, ge=1, le=100)
    capteur: Literal["auto", "sentinel2", "landsat"] = "auto"


@router.post("/gee/couche")
async def gee_couche(data: CoucheIn, _u=Depends(current_user)):
    if not gee.configure():
        raise HTTPException(503, "Google Earth Engine n'est pas configuré sur le serveur (variable GEE_SERVICE_ACCOUNT_JSON).")
    if data.au <= data.du:
        raise HTTPException(400, "La fin de la période doit être après le début")
    try:
        return await run_in_threadpool(
            gee.couche, data.produit, data.du.isoformat(), data.au.isoformat(),
            data.ref_du.isoformat() if data.ref_du else None, data.ref_au.isoformat() if data.ref_au else None, data.nuages, data.capteur)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Earth Engine : {_message_gee(e)}")


# ======================================================== Zones suspectes
def s_cible(c: M.Cible) -> dict:
    return {
        "id": c.id, "code": c.code, "analyse_id": c.analyse_id, "origine": c.origine, "geometrie": c.geometrie,
        "lat": c.lat, "lng": c.lng, "superficie_ha": c.superficie_ha, "score": c.score, "niveau": c.niveau,
        "indices": c.indices or {}, "departement": c.departement, "site_proche_id": c.site_proche_id,
        "site_proche_m": c.site_proche_m, "statut": c.statut, "statut_label": P.LIBELLE_STATUT.get(c.statut, c.statut),
        "site_id": c.site_id, "mission_id": c.mission_id, "note": c.note, "historique": c.historique or [],
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


async def _code_cible(db: AsyncSession, annee: int, deja: int = 0) -> str:
    codes = (await db.execute(select(M.Cible.code).where(M.Cible.code.like(f"ZS-{annee}-%")))).scalars().all()
    n = max([int(c.split("-")[2]) for c in codes if c.split("-")[2].isdigit()] or [0]) + 1 + deja
    return f"ZS-{annee}-{n:04d}"


async def _get_cible(db, cid) -> M.Cible:
    c = (await db.execute(select(M.Cible).where(M.Cible.id == cid))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Zone suspecte introuvable")
    return c


@router.get("/cibles")
async def list_cibles(statut: Optional[str] = None, analyse_id: Optional[str] = None, _u=Depends(current_user),
                      db: AsyncSession = Depends(get_session)):
    q = select(M.Cible).order_by(M.Cible.score.desc().nullslast(), M.Cible.code)
    if statut:
        q = q.where(M.Cible.statut.in_(statut.split(",")))
    if analyse_id:
        q = q.where(M.Cible.analyse_id == analyse_id)
    return [s_cible(c) for c in (await db.execute(q)).scalars().all()]


class CibleIn(BaseModel):
    geometrie: dict
    origine: Literal["manuelle", "drone", "renseignement", "gee"] = "manuelle"
    departement: str = ""
    note: str = ""


@router.post("/cibles")
async def create_cible(data: CibleIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    try:
        g = P.normaliser_zone(data.geometrie)
        lat, lng = P.centroide(g)
    except (ValueError, KeyError, TypeError, IndexError) as e:
        raise HTTPException(400, f"Géométrie invalide : {e}")
    sites = (await db.execute(select(M.Site))).scalars().all()
    proche, d = P.site_le_plus_proche(lat, lng, sites)
    c = M.Cible(code=await _code_cible(db, date.today().year), origine=data.origine, geometrie=g, lat=lat, lng=lng,
                superficie_ha=P.surface_ha(g), score=None, niveau="moyenne", departement=data.departement or (proche.departement if proche else ""),
                site_proche_id=proche.id if proche and d is not None and d < 2000 else None, site_proche_m=round(d) if d is not None else None,
                note=data.note, created_by=user["id"])
    _trace(c, user, "creation", f"Zone dessinée ({data.origine})")
    db.add(c)
    await db.commit()
    return s_cible(c)


class CiblePatch(BaseModel):
    statut: Optional[StatutCible] = None
    note: Optional[str] = None
    niveau: Optional[Literal["forte", "moyenne", "faible"]] = None
    departement: Optional[str] = None
    geometrie: Optional[dict] = None
    commentaire: str = ""


@router.patch("/cibles/{cid}")
async def patch_cible(cid: str, data: CiblePatch, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    c = await _get_cible(db, cid)
    if data.geometrie is not None:
        try:
            g = P.normaliser_zone(data.geometrie)
            c.geometrie, (c.lat, c.lng), c.superficie_ha = g, P.centroide(g), P.surface_ha(g)
        except (ValueError, KeyError, TypeError, IndexError) as e:
            raise HTTPException(400, f"Géométrie invalide : {e}")
    for k in ("note", "niveau", "departement"):
        v = getattr(data, k)
        if v is not None:
            setattr(c, k, v)
    if data.statut and data.statut != c.statut:
        c.statut = data.statut
        _trace(c, user, data.statut, data.commentaire)
    elif data.commentaire:
        _trace(c, user, "note", data.commentaire)
    await db.commit()
    return s_cible(c)


@router.delete("/cibles/{cid}")
async def delete_cible(cid: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    c = await _get_cible(db, cid)
    await db.delete(c)
    await db.commit()
    return {"ok": True}


class ConversionIn(BaseModel):
    localite: str = Field(min_length=1)
    departement: Literal["Gagnoa", "Oumé"]
    sous_prefecture: str = ""
    domaine: Literal["rural", "foret_classee"] = "rural"
    foret: str = ""
    cours_eau: str = ""
    statut: Literal["actif", "tentative_reprise", "recolonise", "demantele", "tenu"] = "actif"
    date_constat: Optional[date] = None
    observations: str = ""


@router.post("/cibles/{cid}/site")
async def cible_vers_site(cid: str, data: ConversionIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    """Une zone suspecte confirmée devient un site du registre (contour = zone détectée)."""
    c = await _get_cible(db, cid)
    if c.site_id:
        raise HTTPException(409, "Cette zone est déjà rattachée à un site")
    s = M.Site(code=await next_code(db, data.departement), localite=data.localite.strip(), departement=data.departement,
               sous_prefecture=data.sous_prefecture, domaine=data.domaine, foret=data.foret, cours_eau=data.cours_eau,
               lat=c.lat, lng=c.lng, coord_saisie={"sys": "wgs", "x": round(c.lng, 6), "y": round(c.lat, 6)},
               coord_alerte=geo.controle_goh(c.lat, c.lng), contour=c.geometrie, superficie_ha=c.superficie_ha,
               observations=data.observations or f"Issu de la zone suspecte {c.code} ({c.origine}).", created_by=user["id"])
    db.add(s)
    await db.flush()
    db.add(M.SiteEvent(site_id=s.id, date=data.date_constat or date.today(), statut=data.statut,
                       source="satellite" if c.origine == "gee" else "saisie", source_id=c.id,
                       note=f"Confirmation de la zone suspecte {c.code}", created_by=user["id"]))
    c.site_id, c.statut = s.id, "confirmee"
    _trace(c, user, "confirmee", f"Enregistrée comme site {s.code}")
    await db.commit()
    return {"site_id": s.id, "code": s.code, "cible": s_cible(c)}


# ======================================================== Analyses (prospection GEE)
class AnalyseIn(BaseModel):
    nom: str = ""
    zone: dict
    zone_nom: str = ""
    ref_du: date
    ref_au: date
    rec_du: date
    rec_au: date
    parametres: dict = {}


def s_analyse(a: M.Analyse) -> dict:
    return {"id": a.id, "nom": a.nom, "zone": a.zone, "zone_nom": a.zone_nom, "ref_du": a.ref_du.isoformat(), "ref_au": a.ref_au.isoformat(),
            "rec_du": a.rec_du.isoformat(), "rec_au": a.rec_au.isoformat(), "parametres": a.parametres, "images": a.images,
            "nb_cibles": a.nb_cibles, "created_at": a.created_at.isoformat() if a.created_at else None}


@router.get("/analyses")
async def list_analyses(_u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    return [s_analyse(a) for a in (await db.execute(select(M.Analyse).order_by(M.Analyse.created_at.desc()))).scalars().all()]


@router.post("/analyses")
async def lancer_analyse(data: AnalyseIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    if not gee.configure():
        raise HTTPException(503, "Google Earth Engine n'est pas configuré sur le serveur (variable GEE_SERVICE_ACCOUNT_JSON).")
    if not (data.ref_du < data.ref_au <= data.rec_du < data.rec_au):
        raise HTTPException(400, "Les périodes doivent se suivre : référence (début < fin) puis période récente")
    try:
        zone = P.normaliser_zone(data.zone)
        surf = P.surface_ha(zone)
    except (ValueError, KeyError, TypeError, IndexError) as e:
        raise HTTPException(400, f"Zone invalide : {e}")
    if surf > P.SURFACE_MAX_ZONE_HA:
        raise HTTPException(400, f"Zone trop grande ({surf / 100:,.0f} km²). Limitez-la à {P.SURFACE_MAX_ZONE_HA / 100:,.0f} km² "
                                 "(une forêt, une sous-préfecture ou une zone dessinée).".replace(",", " "))
    params = {**P.PARAMETRES_DEFAUT, **{k: float(v) for k, v in (data.parametres or {}).items() if k in P.PARAMETRES_DEFAUT}}
    try:
        res = await run_in_threadpool(gee.detecter, zone, (data.ref_du.isoformat(), data.ref_au.isoformat()),
                                      (data.rec_du.isoformat(), data.rec_au.isoformat()), params)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Analyse Earth Engine impossible : {_message_gee(e)}")
    return await enregistrer_analyse(db, user, data, zone, params, res)


async def enregistrer_analyse(db: AsyncSession, user: dict, data: AnalyseIn, zone: dict, params: dict, res: dict) -> dict:
    """Score et enregistre les zones détectées (séparé pour les tests)."""
    a = M.Analyse(nom=data.nom or f"Prospection {data.zone_nom or ''} {date.today().strftime('%d/%m/%Y')}".replace("  ", " "),
                  zone=zone, zone_nom=data.zone_nom, ref_du=data.ref_du, ref_au=data.ref_au, rec_du=data.rec_du, rec_au=data.rec_au,
                  parametres=params, images=res.get("images", {}), created_by=user["id"])
    db.add(a)
    await db.flush()
    sites = (await db.execute(select(M.Site))).scalars().all()
    existantes = (await db.execute(select(M.Cible).where(M.Cible.statut.in_(["a_verifier", "programmee"])))).scalars().all()
    annee = date.today().year
    base = await _code_cible(db, annee)
    n0 = int(base.split("-")[2])
    sorties = []
    for z in res.get("zones", []):
        g = z["geometrie"]
        try:
            lat, lng = P.centroide(g)
        except ValueError:
            continue
        surf = P.surface_ha(g)
        if surf < params["surface_min_ha"]:
            continue
        # Doublon d'une zone encore en cours de vérification : on ne la recrée pas
        if any(P.haversine_m(lat, lng, e.lat, e.lng) < 60 for e in existantes):
            continue
        proche, d = P.site_le_plus_proche(lat, lng, sites)
        ind = z.get("indices", {})
        score = P.score_suspicion(ind.get("dndvi") or 0, ind.get("bsi") or 0, ind.get("ndti"), ind.get("dist_eau_m"), surf,
                                  params["tampon_eau_m"], d is not None and d <= params["rayon_site_connu_m"])
        c = M.Cible(code=f"ZS-{annee}-{n0 + len(sorties):04d}", analyse_id=a.id, origine="gee", geometrie=g, lat=lat, lng=lng,
                    superficie_ha=surf, score=score, niveau=P.niveau(score), indices=ind,
                    departement=proche.departement if proche else "",
                    site_proche_id=proche.id if proche and d is not None and d < 2000 else None,
                    site_proche_m=round(d) if d is not None else None, created_by=user["id"],
                    historique=[{"at": _maintenant(), "by": user["full_name"], "action": "creation", "note": f"Détectée par l'analyse « {a.nom} »"}])
        db.add(c)
        sorties.append(c)
    a.nb_cibles = len(sorties)
    await db.commit()
    return {"analyse": s_analyse(a), "cibles": [s_cible(c) for c in sorted(sorties, key=lambda c: -(c.score or 0))]}


@router.delete("/analyses/{aid}")
async def delete_analyse(aid: str, avec_cibles: bool = False, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    a = (await db.execute(select(M.Analyse).where(M.Analyse.id == aid))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Analyse introuvable")
    if avec_cibles:
        for c in (await db.execute(select(M.Cible).where(M.Cible.analyse_id == aid, M.Cible.statut.in_(["a_verifier", "ecartee"])))).scalars().all():
            await db.delete(c)
    await db.delete(a)
    await db.commit()
    return {"ok": True}


# ======================================================== Missions d'éclairage
class MissionIn(BaseModel):
    titre: str = Field(min_length=2)
    date_prevue: Optional[date] = None
    date_fin: Optional[date] = None
    equipe: str = ""
    moyens: str = ""
    objectif: str = ""
    statut: Literal["planifiee", "en_cours", "terminee", "annulee"] = "planifiee"
    compte_rendu: str = ""
    cibles: Optional[list[str]] = None


async def s_mission(db: AsyncSession, m: M.Mission, avec_cibles: bool = True) -> dict:
    d = {"id": m.id, "code": m.code, "titre": m.titre, "date_prevue": m.date_prevue.isoformat() if m.date_prevue else None,
         "date_fin": m.date_fin.isoformat() if m.date_fin else None, "equipe": m.equipe, "moyens": m.moyens, "objectif": m.objectif,
         "statut": m.statut, "compte_rendu": m.compte_rendu, "created_at": m.created_at.isoformat() if m.created_at else None}
    if avec_cibles:
        cs = (await db.execute(select(M.Cible).where(M.Cible.mission_id == m.id).order_by(M.Cible.code))).scalars().all()
        d["cibles"] = [s_cible(c) for c in cs]
    return d


async def _get_mission(db, mid) -> M.Mission:
    m = (await db.execute(select(M.Mission).where(M.Mission.id == mid))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Mission introuvable")
    return m


async def _rattacher(db: AsyncSession, m: M.Mission, ids: list[str], user: dict):
    actuelles = (await db.execute(select(M.Cible).where(M.Cible.mission_id == m.id))).scalars().all()
    for c in actuelles:
        if c.id not in ids:
            c.mission_id = None
            if c.statut == "programmee":
                c.statut = "a_verifier"
                _trace(c, user, "a_verifier", f"Retirée de la mission {m.code}")
    for cid in ids:
        c = await _get_cible(db, cid)
        if c.mission_id != m.id:
            c.mission_id = m.id
            if c.statut == "a_verifier":
                c.statut = "programmee"
            _trace(c, user, "programmee", f"Ajoutée à la mission {m.code}")


@router.get("/missions")
async def list_missions(_u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    ms = (await db.execute(select(M.Mission).order_by(M.Mission.date_prevue.desc().nullsfirst(), M.Mission.code.desc()))).scalars().all()
    return [await s_mission(db, m) for m in ms]


@router.post("/missions")
async def create_mission(data: MissionIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    y = (data.date_prevue or date.today()).year
    codes = (await db.execute(select(M.Mission.code).where(M.Mission.code.like(f"ECL-{y}-%")))).scalars().all()
    n = max([int(c.split("-")[2]) for c in codes if c.split("-")[2].isdigit()] or [0]) + 1
    m = M.Mission(code=f"ECL-{y}-{n:03d}", created_by=user["id"], **data.model_dump(exclude={"cibles"}))
    db.add(m)
    await db.flush()
    if data.cibles:
        await _rattacher(db, m, data.cibles, user)
    await db.commit()
    return await s_mission(db, m)


@router.get("/missions/{mid}")
async def get_mission(mid: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    return await s_mission(db, await _get_mission(db, mid))


@router.put("/missions/{mid}")
async def put_mission(mid: str, data: MissionIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    m = await _get_mission(db, mid)
    for k, v in data.model_dump(exclude={"cibles"}).items():
        setattr(m, k, v)
    if data.cibles is not None:
        await _rattacher(db, m, data.cibles, user)
    await db.commit()
    return await s_mission(db, m)


@router.delete("/missions/{mid}")
async def delete_mission(mid: str, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    m = await _get_mission(db, mid)
    await _rattacher(db, m, [], user)
    await db.delete(m)
    await db.commit()
    return {"ok": True}


@router.get("/missions/{mid}/{fmt}")
async def export_mission(mid: str, fmt: Literal["gpx", "kml"], _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    m = await _get_mission(db, mid)
    cs = (await db.execute(select(M.Cible).where(M.Cible.mission_id == m.id).order_by(M.Cible.code))).scalars().all()
    pts = [{"code": c.code, "lat": c.lat, "lng": c.lng, "geometrie": c.geometrie, "niveau": c.niveau,
            "description": f"{c.superficie_ha:.1f} ha · score {c.score if c.score is not None else '—'} · {P.LIBELLE_STATUT.get(c.statut, c.statut)}"}
           for c in cs]
    titre = f"{m.code} {m.titre}"
    if fmt == "gpx":
        return Response(P.vers_gpx(pts, titre), media_type="application/gpx+xml",
                        headers={"Content-Disposition": f'attachment; filename="{m.code}.gpx"'})
    return Response(P.vers_kml(pts, titre), media_type="application/vnd.google-earth.kml+xml",
                    headers={"Content-Disposition": f'attachment; filename="{m.code}.kml"'})


# ======================================================== Images drone
def s_image(i: M.ImageDrone) -> dict:
    return {"id": i.id, "site_id": i.site_id, "cible_id": i.cible_id, "date_prise": i.date_prise.isoformat(), "titre": i.titre,
            "crs": i.crs, "emprise": i.emprise, "emprise_wgs84": i.emprise_wgs84, "resolution_cm": i.resolution_cm,
            "largeur": i.largeur, "hauteur": i.hauteur, "mime": i.mime, "taille": i.taille, "fichier_origine": i.fichier_origine,
            "note": i.note, "created_at": i.created_at.isoformat() if i.created_at else None}


@router.get("/images")
async def list_images(site_id: Optional[str] = None, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    q = select(M.ImageDrone).order_by(M.ImageDrone.date_prise.desc())
    if site_id:
        q = q.where(M.ImageDrone.site_id == site_id)
    return [s_image(i) for i in (await db.execute(q)).scalars().all()]


def _liste_nombres(txt: str, n: int) -> list[float]:
    try:
        v = [float(x) for x in txt.replace(";", ",").split(",")]
    except ValueError:
        raise HTTPException(400, "Emprise invalide")
    if len(v) != n:
        raise HTTPException(400, "Emprise invalide")
    return v


@router.post("/images")
async def upload_image(fichier: UploadFile = File(...), date_prise: date = Form(...), crs: str = Form("EPSG:4326"),
                       emprise: str = Form(...), emprise_wgs84: str = Form(...), titre: str = Form(""), site_id: str = Form(""),
                       cible_id: str = Form(""), resolution_cm: Optional[float] = Form(None), largeur: int = Form(0),
                       hauteur: int = Form(0), fichier_origine: str = Form(""), note: str = Form(""),
                       user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    """Reçoit la version web (WebP / PNG / JPEG) d'une orthophoto préparée dans le navigateur, avec son emprise."""
    contenu = await fichier.read()
    if len(contenu) > TAILLE_MAX_IMAGE:
        raise HTTPException(413, "Image trop lourde (25 Mo au plus pour la version web)")
    mime = fichier.content_type or "image/webp"
    if mime not in ("image/webp", "image/png", "image/jpeg"):
        raise HTTPException(400, "Format attendu : WebP, PNG ou JPEG")
    if crs not in ("EPSG:4326", "EPSG:3857", "EPSG:32629", "EPSG:32630"):
        raise HTTPException(400, "Système de coordonnées non pris en charge (WGS84, Web Mercator, UTM 29N ou 30N)")
    e = _liste_nombres(emprise, 4)
    w = _liste_nombres(emprise_wgs84, 4)
    if not (e[0] < e[2] and e[1] < e[3] and w[0] < w[2] and w[1] < w[3]):
        raise HTTPException(400, "Emprise invalide")
    if site_id and not (await db.execute(select(M.Site.id).where(M.Site.id == site_id))).scalar_one_or_none():
        raise HTTPException(400, "Site inconnu")
    i = M.ImageDrone(site_id=site_id or None, cible_id=cible_id or None, date_prise=date_prise, titre=titre, crs=crs, emprise=e,
                     emprise_wgs84=w, resolution_cm=resolution_cm, largeur=largeur, hauteur=hauteur, mime=mime, taille=len(contenu),
                     fichier_origine=fichier_origine, note=note, contenu=contenu, created_by=user["id"])
    db.add(i)
    await db.commit()
    return s_image(i)


class ImagePatch(BaseModel):
    titre: Optional[str] = None
    date_prise: Optional[date] = None
    site_id: Optional[str] = None
    note: Optional[str] = None


@router.patch("/images/{iid}")
async def patch_image(iid: str, data: ImagePatch, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    i = (await db.execute(select(M.ImageDrone).where(M.ImageDrone.id == iid))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Image introuvable")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(i, k, v or None if k == "site_id" else v)
    await db.commit()
    return s_image(i)


@router.delete("/images/{iid}")
async def delete_image(iid: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    i = (await db.execute(select(M.ImageDrone).where(M.ImageDrone.id == iid))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Image introuvable")
    await db.delete(i)
    await db.commit()
    return {"ok": True}


@router.get("/images/{iid}/fichier")
async def image_fichier(iid: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    i = (await db.execute(select(M.ImageDrone).options(undefer(M.ImageDrone.contenu)).where(M.ImageDrone.id == iid))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Image introuvable")
    return Response(i.contenu, media_type=i.mime, headers={"Cache-Control": "private, max-age=86400"})
