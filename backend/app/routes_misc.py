"""Authentification, utilisateurs, fiches de renseignement, cours d'eau, zones, indicateurs."""
from datetime import date, datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import geo
from . import models as M
from . import stats as ST
from .db import get_session
from .routes_sites import Coord, events_map
from .security import ROLES, create_token, current_user, hash_password, require, s_user, verify_password

router = APIRouter()


# ---------- Auth et utilisateurs ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str


@router.post("/auth/login")
async def login(data: LoginIn, db: AsyncSession = Depends(get_session)):
    u = (await db.execute(select(M.User).where(M.User.email == data.email.lower()))).scalar_one_or_none()
    if not u or not u.active or not verify_password(data.password, u.password_hash):
        raise HTTPException(401, "Adresse ou mot de passe incorrect")
    return {"token": create_token(u), "user": s_user(u)}


@router.get("/auth/me")
async def me(user=Depends(current_user)):
    return user


class UserIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2)
    grade: str = ""
    role: Literal["chef", "analyste", "cartographe"]
    password: str = Field(min_length=8)


class PasswordIn(BaseModel):
    ancien: str
    nouveau: str = Field(min_length=8)


@router.get("/users")
async def users(_u=Depends(require()), db: AsyncSession = Depends(get_session)):
    return [s_user(u) for u in (await db.execute(select(M.User).order_by(M.User.full_name))).scalars().all()]


@router.post("/users")
async def create_user(data: UserIn, _u=Depends(require()), db: AsyncSession = Depends(get_session)):
    if (await db.execute(select(M.User).where(M.User.email == data.email.lower()))).scalar_one_or_none():
        raise HTTPException(409, "Un compte existe déjà avec cette adresse")
    u = M.User(email=data.email.lower(), full_name=data.full_name, grade=data.grade, role=data.role, password_hash=hash_password(data.password))
    db.add(u)
    await db.commit()
    return s_user(u)


@router.post("/users/{user_id}/active")
async def set_active(user_id: str, active: bool, me_=Depends(require()), db: AsyncSession = Depends(get_session)):
    if user_id == me_["id"]:
        raise HTTPException(400, "Vous ne pouvez pas désactiver votre propre compte")
    u = (await db.execute(select(M.User).where(M.User.id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "Compte introuvable")
    u.active = active
    await db.commit()
    return s_user(u)


@router.post("/auth/password")
async def change_password(data: PasswordIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    u = (await db.execute(select(M.User).where(M.User.id == user["id"]))).scalar_one()
    if not verify_password(data.ancien, u.password_hash):
        raise HTTPException(400, "Ancien mot de passe incorrect")
    u.password_hash = hash_password(data.nouveau)
    await db.commit()
    return {"ok": True}


@router.get("/referentiels")
async def referentiels(_u=Depends(current_user)):
    return {"statuts": ST.STATUTS, "saisies": ST.SAISIES, "roles": ROLES, "systemes": geo.SYSTEMES, "goh_bbox": geo.GOH_BBOX,
            "fiche_statuts": FICHE_STATUTS}


# ---------- Fiches de renseignement ----------
FICHE_STATUTS = {"a_verifier": "À vérifier", "en_cours": "Vérification en cours", "confirmee": "Confirmée",
                 "infirmee": "Infirmée", "exploitee": "Exploitée"}


class FicheIn(BaseModel):
    date_recu: date
    heure_recu: str = ""
    date_faits: Optional[date] = None
    priorite: Literal["routine", "importante", "urgente"] = "routine"
    source_type: str = Field(min_length=1)
    source_code: str = Field("", max_length=30)
    fiabilite: Literal["A", "B", "C", "D", "E", "F"] = "F"
    credibilite: Literal["1", "2", "3", "4", "5", "6"] = "6"
    departement: Literal["Gagnoa", "Oumé"]
    sous_prefecture: str = ""
    localite: str = Field(min_length=1)
    foret: str = ""
    cours_eau: str = ""
    coord: Optional[Coord] = None
    nature: list[str] = Field(min_length=1)
    equipements: list[str] = []
    personnes: Optional[int] = Field(None, ge=0)
    superficie_ha: Optional[float] = Field(None, ge=0)
    description: str = Field(min_length=1)
    suite: str = ""
    site_id: Optional[str] = None


class FicheStatutIn(BaseModel):
    statut: Literal["a_verifier", "en_cours", "confirmee", "infirmee", "exploitee"]
    note: str = ""
    site_id: Optional[str] = None


def s_fiche(f: M.FicheRens) -> dict:
    return {
        "id": f.id, "numero": f.numero, "date_recu": f.date_recu.isoformat(), "heure_recu": f.heure_recu,
        "date_faits": f.date_faits.isoformat() if f.date_faits else None, "priorite": f.priorite,
        "source_type": f.source_type, "source_code": f.source_code, "fiabilite": f.fiabilite, "credibilite": f.credibilite,
        "cotation": f.fiabilite + f.credibilite, "departement": f.departement, "sous_prefecture": f.sous_prefecture,
        "localite": f.localite, "foret": f.foret, "cours_eau": f.cours_eau, "lat": f.lat, "lng": f.lng,
        "coord_saisie": f.coord_saisie, "coord_alerte": geo.controle_goh(f.lat, f.lng) if f.lat is not None else "",
        "nature": f.nature, "equipements": f.equipements, "personnes": f.personnes, "superficie_ha": f.superficie_ha,
        "description": f.description, "suite": f.suite, "statut": f.statut, "statut_label": FICHE_STATUTS.get(f.statut, f.statut),
        "site_id": f.site_id, "historique": f.historique or [], "created_at": f.created_at.isoformat() if f.created_at else None,
    }


@router.get("/fiches")
async def list_fiches(_u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    rows = (await db.execute(select(M.FicheRens).order_by(M.FicheRens.date_recu.desc(), M.FicheRens.numero.desc()))).scalars().all()
    return [s_fiche(f) for f in rows]


@router.post("/fiches")
async def create_fiche(data: FicheIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    y = data.date_recu.year
    nums = (await db.execute(select(M.FicheRens.numero).where(M.FicheRens.numero.like(f"RENS-{y}-%")))).scalars().all()
    n = max([int(x.split("-")[2]) for x in nums if x.split("-")[2].isdigit()] or [0]) + 1
    f = M.FicheRens(numero=f"RENS-{y}-{n:03d}", created_by=user["id"],
                    **data.model_dump(exclude={"coord"}),
                    historique=[{"at": datetime.now(timezone.utc).isoformat(), "by": user["full_name"], "statut": "a_verifier", "note": "Fiche créée"}])
    if data.coord:
        try:
            f.lat, f.lng = geo.to_wgs84(data.coord.sys, data.coord.x, data.coord.y)
        except ValueError as e:
            raise HTTPException(400, str(e))
        f.coord_saisie = {"sys": data.coord.sys, "x": geo.parse_num(data.coord.x), "y": geo.parse_num(data.coord.y)}
    db.add(f)
    await db.commit()
    return s_fiche(f)


@router.post("/fiches/{fiche_id}/statut")
async def fiche_statut(fiche_id: str, data: FicheStatutIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    f = (await db.execute(select(M.FicheRens).where(M.FicheRens.id == fiche_id))).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Fiche introuvable")
    f.statut = data.statut
    if data.site_id is not None:
        f.site_id = data.site_id or None
    f.historique = (f.historique or []) + [{"at": datetime.now(timezone.utc).isoformat(), "by": user["full_name"],
                                            "statut": data.statut, "note": data.note}]
    await db.commit()
    return s_fiche(f)


# ---------- Cours d'eau et zones ----------
@router.get("/cours-eau")
async def cours_eau(_u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    rows = (await db.execute(select(M.CoursEau).order_by(M.CoursEau.bassin, M.CoursEau.nom))).scalars().all()
    return [{"id": c.id, "nom": c.nom, "bassin": c.bassin, "type": c.type, "localites": c.localites, "longueur_km": c.longueur_km,
             "lineaire_impacte_km": c.lineaire_impacte_km, "intensite": c.intensite, "commentaire": c.commentaire, "trace": c.trace} for c in rows]


@router.put("/cours-eau/{ce_id}/trace")
async def set_trace(ce_id: str, geojson: dict, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    c = (await db.execute(select(M.CoursEau).where(M.CoursEau.id == ce_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Cours d'eau introuvable")
    g = geojson
    if g.get("type") == "FeatureCollection":
        lines = [f["geometry"] for f in g.get("features", []) if (f.get("geometry") or {}).get("type") in ("LineString", "MultiLineString")]
        coords = []
        for ln in lines:
            coords.extend([ln["coordinates"]] if ln["type"] == "LineString" else ln["coordinates"])
        if not coords:
            raise HTTPException(400, "Aucune ligne dans le fichier")
        g = {"type": "MultiLineString", "coordinates": coords}
    elif g.get("type") == "Feature":
        g = g.get("geometry") or {}
    if g.get("type") not in ("LineString", "MultiLineString"):
        raise HTTPException(400, "Le tracé doit être une ligne GeoJSON")
    c.trace = {"type": g["type"], "coordinates": g["coordinates"]}
    await db.commit()
    return {"ok": True}


@router.get("/zones")
async def zones(_u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    rows = (await db.execute(select(M.Zone))).scalars().all()
    return [{"id": z.id, "nom": z.nom, "categorie": z.categorie, "geometrie": z.geometrie, "approximative": z.approximative} for z in rows]


# ---------- Indicateurs ----------
async def _stats_inputs(db: AsyncSession, departement: Optional[str]):
    q = select(M.Site)
    if departement:
        q = q.where(M.Site.departement == departement)
    sites = (await db.execute(q)).scalars().all()
    ev = await events_map(db, [s.id for s in sites])
    vq = select(M.Visite)
    if departement:
        vq = vq.where(M.Visite.site_id.in_([s.id for s in sites]))
    visites = (await db.execute(vq)).scalars().all()
    brq_dates = set((await db.execute(select(M.Brq.date))).scalars().all())
    ce = (await db.execute(select(M.CoursEau))).scalars().all()
    return sites, ev, visites, brq_dates, ce


@router.get("/stats")
async def stats(at: Optional[date] = None, departement: Optional[str] = None, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    d = at or date.today()
    sites, ev, visites, brq_dates, ce = await _stats_inputs(db, departement)
    all_dates = [e.date for evs in ev.values() for e in evs] + [v.date for v in visites]
    start = min(all_dates) if all_dates else d
    return {
        "kpi": ST.kpis(sites, ev, visites, brq_dates, ce, d),
        "series": ST.series(sites, ev, visites, brq_dates, start, max(date.today(), d, start)),
        "periode": {"debut": start.isoformat(), "fin": d.isoformat()},
        "statuts": ST.STATUTS,
        "saisies": ST.SAISIES,
    }
