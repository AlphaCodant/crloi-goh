"""Sites d'orpaillage : registre, statuts datés, contours, import."""
import csv
import io
import json
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import geo
from . import models as M
from .db import get_session
from .security import current_user, require
from .stats import STATUTS

router = APIRouter(prefix="/sites", tags=["sites"])
Statut = Literal["actif", "tentative_reprise", "recolonise", "demantele", "tenu"]


class Coord(BaseModel):
    sys: Literal["wgs", "29", "30"] = "wgs"
    x: str | float
    y: str | float


class SiteIn(BaseModel):
    localite: str = Field(min_length=1)
    departement: Literal["Gagnoa", "Oumé"]
    sous_prefecture: str = ""
    domaine: Literal["rural", "foret_classee"] = "rural"
    foret: str = ""
    ugf: str = ""
    cours_eau: str = ""
    coord: Optional[Coord] = None
    superficie_ha: Optional[float] = None
    priorite: Literal["haute", "normale"] = "normale"
    observations: str = ""
    statut_initial: Optional[Statut] = None
    date_statut: Optional[date] = None


class SitePatch(BaseModel):
    localite: Optional[str] = None
    sous_prefecture: Optional[str] = None
    domaine: Optional[Literal["rural", "foret_classee"]] = None
    foret: Optional[str] = None
    ugf: Optional[str] = None
    cours_eau: Optional[str] = None
    coord: Optional[Coord] = None
    superficie_ha: Optional[float] = None
    priorite: Optional[Literal["haute", "normale"]] = None
    observations: Optional[str] = None


class EventIn(BaseModel):
    date: date
    statut: Statut
    note: str = ""
    source: Literal["saisie", "rapport", "satellite", "drone", "fiche"] = "saisie"


def s_event(e: M.SiteEvent) -> dict:
    return {"id": e.id, "date": e.date.isoformat(), "statut": e.statut, "statut_label": STATUTS.get(e.statut, e.statut),
            "source": e.source, "source_id": e.source_id, "note": e.note}


def s_site(s: M.Site, events: list | None = None) -> dict:
    d = {
        "id": s.id, "code": s.code, "localite": s.localite, "departement": s.departement,
        "sous_prefecture": s.sous_prefecture, "domaine": s.domaine, "foret": s.foret, "ugf": s.ugf,
        "cours_eau": s.cours_eau, "lat": s.lat, "lng": s.lng, "coord_saisie": s.coord_saisie,
        "coord_alerte": s.coord_alerte, "contour": s.contour, "superficie_ha": s.superficie_ha,
        "priorite": s.priorite, "observations": s.observations,
    }
    if events is not None:
        d["events"] = [s_event(e) for e in events]
        d["statut"] = events[-1].statut if events else None
        d["statut_label"] = STATUTS.get(d["statut"], "Non renseigné") if events else "Non renseigné"
    return d


async def next_code(db: AsyncSession, departement: str) -> str:
    prefix = "GAG" if departement == "Gagnoa" else "OUM"
    codes = (await db.execute(select(M.Site.code).where(M.Site.code.like(prefix + "-%")))).scalars().all()
    nums = [int(c.split("-")[1]) for c in codes if c.split("-")[1].isdigit()]
    return f"{prefix}-{(max(nums) if nums else 0) + 1:03d}"


def apply_coord(site: M.Site, coord: Optional[Coord]):
    if coord is None:
        return
    try:
        lat, lng = geo.to_wgs84(coord.sys, coord.x, coord.y)
    except ValueError as e:
        raise HTTPException(400, str(e))
    site.lat, site.lng = lat, lng
    site.coord_saisie = {"sys": coord.sys, "x": geo.parse_num(coord.x), "y": geo.parse_num(coord.y)}
    site.coord_alerte = geo.controle_goh(lat, lng)
    lieu = geo.localiser(lat, lng)
    if lieu:
        if not (site.sous_prefecture or "").strip():
            site.sous_prefecture = lieu["sous_prefecture"]
        if site.departement and site.departement != lieu["departement"]:
            site.coord_alerte = (f"Point situé dans la sous-préfecture de {lieu['sous_prefecture']} "
                                 f"(département de {lieu['departement']}) : vérifier le département ou les coordonnées")


async def events_map(db: AsyncSession, site_ids: Optional[list] = None) -> dict:
    q = select(M.SiteEvent).order_by(M.SiteEvent.date, M.SiteEvent.created_at)
    if site_ids is not None:
        q = q.where(M.SiteEvent.site_id.in_(site_ids))
    out: dict = {}
    for e in (await db.execute(q)).scalars().all():
        out.setdefault(e.site_id, []).append(e)
    return out


@router.get("")
async def list_sites(departement: Optional[str] = None, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    q = select(M.Site).order_by(M.Site.code)
    if departement:
        q = q.where(M.Site.departement == departement)
    sites = (await db.execute(q)).scalars().all()
    ev = await events_map(db, [s.id for s in sites])
    return [s_site(s, ev.get(s.id, [])) for s in sites]


@router.get("/{site_id}")
async def get_site(site_id: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    s = await _get(db, site_id)
    ev = await events_map(db, [s.id])
    d = s_site(s, ev.get(s.id, []))
    vis = (await db.execute(select(M.Visite).where(M.Visite.site_id == s.id).order_by(M.Visite.date.desc()))).scalars().all()
    d["visites"] = [{"id": v.id, "brq_id": v.brq_id, "date": v.date.isoformat(), "unite": v.unite, "constat": v.constat,
                     "saisies": v.saisies, "interpelles": v.interpelles, "note": v.note} for v in vis]
    return d


async def _get(db, site_id) -> M.Site:
    s = (await db.execute(select(M.Site).where(M.Site.id == site_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Site introuvable")
    return s


@router.post("")
async def create_site(data: SiteIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    s = M.Site(code=await next_code(db, data.departement), localite=data.localite.strip(), departement=data.departement,
               sous_prefecture=data.sous_prefecture, domaine=data.domaine, foret=data.foret, ugf=data.ugf,
               cours_eau=data.cours_eau, superficie_ha=data.superficie_ha, priorite=data.priorite,
               observations=data.observations, created_by=user["id"])
    apply_coord(s, data.coord)
    if data.coord is None:
        s.coord_alerte = geo.controle_goh(None, None)
    db.add(s)
    await db.flush()
    if data.statut_initial:
        db.add(M.SiteEvent(site_id=s.id, date=data.date_statut or date.today(), statut=data.statut_initial,
                           source="saisie", note="Statut à l'enregistrement du site", created_by=user["id"]))
    await db.commit()
    ev = await events_map(db, [s.id])
    return s_site(s, ev.get(s.id, []))


@router.patch("/{site_id}")
async def patch_site(site_id: str, data: SitePatch, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    s = await _get(db, site_id)
    for k, v in data.model_dump(exclude_unset=True, exclude={"coord"}).items():
        setattr(s, k, v)
    if "coord" in data.model_fields_set:
        apply_coord(s, data.coord)
    await db.commit()
    ev = await events_map(db, [s.id])
    return s_site(s, ev.get(s.id, []))


@router.delete("/{site_id}")
async def delete_site(site_id: str, _u=Depends(require()), db: AsyncSession = Depends(get_session)):
    s = await _get(db, site_id)
    await db.delete(s)
    await db.commit()
    return {"ok": True}


@router.post("/{site_id}/events")
async def add_event(site_id: str, data: EventIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    await _get(db, site_id)
    e = M.SiteEvent(site_id=site_id, date=data.date, statut=data.statut, source=data.source, note=data.note, created_by=user["id"])
    db.add(e)
    await db.commit()
    return s_event(e)


@router.delete("/{site_id}/events/{event_id}")
async def del_event(site_id: str, event_id: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    e = (await db.execute(select(M.SiteEvent).where(M.SiteEvent.id == event_id, M.SiteEvent.site_id == site_id))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Statut introuvable")
    if e.source == "brq":
        raise HTTPException(400, "Ce statut vient d'un BRQ : modifiez ou supprimez la visite dans le BRQ")
    await db.delete(e)
    await db.commit()
    return {"ok": True}


@router.put("/{site_id}/contour")
async def set_contour(site_id: str, geojson: dict, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    s = await _get(db, site_id)
    try:
        poly = geo.extract_polygon(geojson)
        area = geo.polygon_area_ha(poly)
    except (ValueError, KeyError, TypeError, IndexError) as e:
        raise HTTPException(400, f"Contour invalide : {e}")
    s.contour, s.superficie_ha = poly, area
    await db.commit()
    return {"ok": True, "superficie_ha": area}


@router.delete("/{site_id}/contour")
async def del_contour(site_id: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    s = await _get(db, site_id)
    s.contour = None
    await db.commit()
    return {"ok": True}


# ---------- Import CSV ----------
_ALIASES = {
    "localite": ("localite", "localité", "village", "site", "nom"),
    "departement": ("departement", "département", "dept"),
    "sous_prefecture": ("sous_prefecture", "sous-prefecture", "sous préfecture", "sous prefecture", "s/p", "sp"),
    "x": ("x", "est", "longitude", "lng", "lon"),
    "y": ("y", "nord", "latitude", "lat"),
    "foret": ("foret", "forêt", "foret classee", "forêt classée", "fc"),
    "cours_eau": ("cours_eau", "cours d'eau", "riviere", "rivière"),
    "statut": ("statut", "etat", "état"),
    "observations": ("observations", "observation", "remarque", "remarques"),
}


def _pick(row: dict, key: str) -> str:
    low = {str(k).strip().lower(): v for k, v in row.items() if k is not None}
    for a in _ALIASES[key]:
        if a in low and str(low[a]).strip():
            return str(low[a]).strip()
    return ""


@router.post("/import")
async def import_sites(file: UploadFile = File(...), sys: Literal["wgs", "29", "30"] = "wgs",
                       date_statut: Optional[date] = None, statut: Optional[Statut] = None,
                       user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    """CSV (séparateur ; ou ,) ou GeoJSON de points. Le système de coordonnées s'applique à tout le fichier."""
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    rows = []
    if (file.filename or "").lower().endswith((".geojson", ".json")):
        data = json.loads(raw)
        for f in data.get("features", []):
            g = f.get("geometry") or {}
            if g.get("type") != "Point":
                continue
            p = dict(f.get("properties") or {})
            p["x"], p["y"] = g["coordinates"][0], g["coordinates"][1]
            rows.append(p)
        sys = "wgs"
    else:
        delim = ";" if raw[:2000].count(";") > raw[:2000].count(",") else ","
        rows = list(csv.DictReader(io.StringIO(raw), delimiter=delim))
    created, errors = 0, []
    for i, r in enumerate(rows, 2):
        loc, dep = _pick(r, "localite"), _pick(r, "departement") or ""
        dep = "Oumé" if dep.lower().startswith("oum") else "Gagnoa" if dep.lower().startswith("gag") else ""
        if not loc or not dep:
            errors.append(f"Ligne {i} : localité ou département (Gagnoa / Oumé) manquant")
            continue
        s = M.Site(code=await next_code(db, dep), localite=loc, departement=dep, sous_prefecture=_pick(r, "sous_prefecture"),
                   foret=_pick(r, "foret"), domaine="foret_classee" if _pick(r, "foret") else "rural",
                   cours_eau=_pick(r, "cours_eau"), observations=_pick(r, "observations"), created_by=user["id"])
        x, y = _pick(r, "x"), _pick(r, "y")
        if x and y:
            try:
                apply_coord(s, Coord(sys=sys, x=x, y=y))
            except HTTPException as e:
                errors.append(f"Ligne {i} : {e.detail}")
                s.coord_alerte = "Coordonnées illisibles à l'import"
        else:
            s.coord_alerte = geo.controle_goh(None, None)
        db.add(s)
        await db.flush()
        st = _pick(r, "statut").lower().replace(" ", "_")
        st = st if st in STATUTS else statut
        if st:
            db.add(M.SiteEvent(site_id=s.id, date=date_statut or date.today(), statut=st, source="rapport",
                               note=f"Import {file.filename}", created_by=user["id"]))
        created += 1
    await db.commit()
    return {"importes": created, "erreurs": errors[:50]}
