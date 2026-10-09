"""Bulletins de relevé quotidien (BRQ) et rapports hebdomadaires."""
from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as M
from .db import get_session
from .routes_sites import Coord, apply_coord, next_code
from .security import current_user, require
from .stats import SAISIES, STATUTS, monday
from . import geo

router = APIRouter(tags=["brq"])
Statut = Literal["actif", "tentative_reprise", "recolonise", "demantele", "tenu"]


class NouveauSite(BaseModel):
    localite: str = Field(min_length=1)
    departement: Literal["Gagnoa", "Oumé"]
    sous_prefecture: str = ""
    coord: Optional[Coord] = None


class VisiteIn(BaseModel):
    site_id: Optional[str] = None
    nouveau_site: Optional[NouveauSite] = None
    unite: str = ""
    constat: Statut
    saisies: dict[str, float] = {}
    interpelles: int = Field(0, ge=0)
    note: str = ""


class BrqIn(BaseModel):
    date: date
    reference: str = ""
    unites: str = ""
    observations: str = ""
    visites: list[VisiteIn] = []


def s_brq(b: M.Brq, visites: list, sites: dict) -> dict:
    return {
        "id": b.id, "date": b.date.isoformat(), "reference": b.reference, "unites": b.unites, "observations": b.observations,
        "visites": [{
            "id": v.id, "site_id": v.site_id, "site_code": sites.get(v.site_id).code if v.site_id in sites else None,
            "site_localite": sites.get(v.site_id).localite if v.site_id in sites else None,
            "unite": v.unite, "constat": v.constat, "constat_label": STATUTS.get(v.constat, v.constat),
            "saisies": v.saisies, "interpelles": v.interpelles, "note": v.note,
        } for v in visites],
    }


async def _write_visites(db: AsyncSession, b: M.Brq, visites: list[VisiteIn], user: dict):
    for vin in visites:
        site_id = vin.site_id
        if not site_id and vin.nouveau_site:
            ns = vin.nouveau_site
            s = M.Site(code=await next_code(db, ns.departement), localite=ns.localite.strip(), departement=ns.departement,
                       sous_prefecture=ns.sous_prefecture, observations=f"Créé depuis le BRQ du {b.date.isoformat()}", created_by=user["id"])
            apply_coord(s, ns.coord)
            if ns.coord is None:
                s.coord_alerte = geo.controle_goh(None, None)
            db.add(s)
            await db.flush()
            site_id = s.id
        if site_id and not (await db.execute(select(M.Site.id).where(M.Site.id == site_id))).scalar_one_or_none():
            raise HTTPException(400, "Site inconnu dans une visite")
        saisies = {k: v for k, v in vin.saisies.items() if k in SAISIES and v}
        v = M.Visite(brq_id=b.id, site_id=site_id, date=b.date, unite=vin.unite or b.unites, constat=vin.constat,
                     saisies=saisies, interpelles=vin.interpelles, note=vin.note)
        db.add(v)
        await db.flush()
        if site_id:
            db.add(M.SiteEvent(site_id=site_id, date=b.date, statut=vin.constat, source="brq", source_id=v.id,
                               note=vin.note or f"BRQ du {b.date.strftime('%d/%m/%Y')}", created_by=user["id"]))


async def _load(db, brq_id) -> M.Brq:
    b = (await db.execute(select(M.Brq).where(M.Brq.id == brq_id))).scalar_one_or_none()
    if not b:
        raise HTTPException(404, "BRQ introuvable")
    return b


async def _serialize(db, brqs: list) -> list:
    ids = [b.id for b in brqs]
    vis = (await db.execute(select(M.Visite).where(M.Visite.brq_id.in_(ids)))).scalars().all() if ids else []
    sids = {v.site_id for v in vis if v.site_id}
    sites = {s.id: s for s in (await db.execute(select(M.Site).where(M.Site.id.in_(sids)))).scalars().all()} if sids else {}
    by = {}
    for v in vis:
        by.setdefault(v.brq_id, []).append(v)
    return [s_brq(b, by.get(b.id, []), sites) for b in brqs]


@router.get("/brq")
async def list_brq(du: Optional[date] = None, au: Optional[date] = None, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    q = select(M.Brq).order_by(M.Brq.date.desc())
    if du:
        q = q.where(M.Brq.date >= du)
    if au:
        q = q.where(M.Brq.date <= au)
    return await _serialize(db, (await db.execute(q.limit(500))).scalars().all())


@router.get("/brq/{brq_id}")
async def get_brq(brq_id: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    return (await _serialize(db, [await _load(db, brq_id)]))[0]


@router.post("/brq")
async def create_brq(data: BrqIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    b = M.Brq(date=data.date, reference=data.reference, unites=data.unites, observations=data.observations, created_by=user["id"])
    db.add(b)
    await db.flush()
    await _write_visites(db, b, data.visites, user)
    await db.commit()
    return (await _serialize(db, [b]))[0]


@router.put("/brq/{brq_id}")
async def update_brq(brq_id: str, data: BrqIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    b = await _load(db, brq_id)
    old = (await db.execute(select(M.Visite.id).where(M.Visite.brq_id == b.id))).scalars().all()
    if old:
        await db.execute(delete(M.SiteEvent).where(M.SiteEvent.source == "brq", M.SiteEvent.source_id.in_(old)))
        await db.execute(delete(M.Visite).where(M.Visite.id.in_(old)))
    b.date, b.reference, b.unites, b.observations = data.date, data.reference, data.unites, data.observations
    await _write_visites(db, b, data.visites, user)
    await db.commit()
    return (await _serialize(db, [b]))[0]


@router.delete("/brq/{brq_id}")
async def delete_brq(brq_id: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    b = await _load(db, brq_id)
    old = (await db.execute(select(M.Visite.id).where(M.Visite.brq_id == b.id))).scalars().all()
    if old:
        await db.execute(delete(M.SiteEvent).where(M.SiteEvent.source == "brq", M.SiteEvent.source_id.in_(old)))
    await db.delete(b)
    await db.commit()
    return {"ok": True}


# ---------- Rapports hebdomadaires ----------
class HebdoIn(BaseModel):
    synthese: str = ""
    difficultes: str = ""
    recommandations: str = ""


def s_hebdo(h: M.RapportHebdo) -> dict:
    return {"id": h.id, "semaine_debut": h.semaine_debut.isoformat(), "synthese": h.synthese, "difficultes": h.difficultes,
            "recommandations": h.recommandations, "valide": h.valide,
            "date_validation": h.date_validation.isoformat() if h.date_validation else None}


@router.get("/hebdo")
async def list_hebdo(_u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    rows = (await db.execute(select(M.RapportHebdo).order_by(M.RapportHebdo.semaine_debut.desc()))).scalars().all()
    return [s_hebdo(h) for h in rows]


@router.put("/hebdo/{semaine}")
async def upsert_hebdo(semaine: date, data: HebdoIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    lundi = monday(semaine)
    h = (await db.execute(select(M.RapportHebdo).where(M.RapportHebdo.semaine_debut == lundi))).scalar_one_or_none()
    if h and h.valide:
        raise HTTPException(409, "Ce rapport est validé : demandez au chef de cellule de le rouvrir")
    if not h:
        h = M.RapportHebdo(semaine_debut=lundi, created_by=user["id"])
        db.add(h)
    h.synthese, h.difficultes, h.recommandations = data.synthese, data.difficultes, data.recommandations
    await db.commit()
    return s_hebdo(h)


@router.post("/hebdo/{semaine}/validation")
async def validate_hebdo(semaine: date, valide: bool = True, _u=Depends(require()), db: AsyncSession = Depends(get_session)):
    h = (await db.execute(select(M.RapportHebdo).where(M.RapportHebdo.semaine_debut == monday(semaine)))).scalar_one_or_none()
    if not h:
        raise HTTPException(404, "Aucun rapport pour cette semaine")
    h.valide = valide
    h.date_validation = date.today() if valide else None
    await db.commit()
    return s_hebdo(h)


@router.get("/hebdo/{semaine}/donnees")
async def hebdo_data(semaine: date, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    """Ce que les BRQ de la semaine contiennent, pour rédiger le rapport."""
    lundi = monday(semaine)
    dimanche = lundi + timedelta(days=6)
    brqs = (await db.execute(select(M.Brq).where(M.Brq.date >= lundi, M.Brq.date <= dimanche).order_by(M.Brq.date))).scalars().all()
    data = await _serialize(db, brqs)
    return {"semaine_debut": lundi.isoformat(), "semaine_fin": dimanche.isoformat(), "brq": data}
