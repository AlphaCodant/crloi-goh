"""Suivi hebdomadaire de la qualité de l'eau des cours d'eau (turbidité, mercure, cyanure, autres paramètres)."""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import geo
from . import models as M
from .db import get_session
from .routes_sites import Coord
from .security import current_user

router = APIRouter()

# Seuils de référence (indicatifs, eau de boisson) : au-delà, la mesure est signalée en dépassement.
SEUILS = {
    "turbidite": {"libelle": "Turbidité", "unite": "NTU", "seuil": 5.0,
                  "source": "OMS – seuil d'acceptabilité de l'eau de boisson (5 NTU)"},
    "mercure": {"libelle": "Mercure", "unite": "µg/L", "seuil": 6.0,
                "source": "OMS – valeur guide pour le mercure inorganique (6 µg/L)"},
    "cyanure": {"libelle": "Cyanure", "unite": "mg/L", "seuil": 0.07,
                "source": "OMS – ancienne valeur guide (0,07 mg/L), couramment retenue comme référence"},
}


def lundi(d: date) -> date:
    return d - timedelta(days=d.weekday())


def evaluer(m) -> dict:
    """Statut d'une mesure : depassement si un paramètre dépasse son seuil, conforme sinon."""
    depassements = [k for k, s in SEUILS.items() if getattr(m, k) is not None and getattr(m, k) > s["seuil"]]
    mesures = [k for k in SEUILS if getattr(m, k) is not None]
    return {"statut": "depassement" if depassements else ("conforme" if mesures else "autre"), "depassements": depassements}


class Autre(BaseModel):
    parametre: str = Field(min_length=1, max_length=64)
    valeur: float
    unite: str = Field("", max_length=24)


class QualiteIn(BaseModel):
    cours_eau_id: str
    date: date
    point: str = Field("", max_length=128)
    coord: Optional[Coord] = None
    turbidite: Optional[float] = Field(None, ge=0)
    mercure: Optional[float] = Field(None, ge=0)
    cyanure: Optional[float] = Field(None, ge=0)
    autres: list[Autre] = []
    observations: str = ""

    @field_validator("date")
    @classmethod
    def pas_future(cls, v):
        if v > date.today() + timedelta(days=1):
            raise ValueError("La date du prélèvement ne peut pas être dans le futur")
        return v

    @model_validator(mode="after")
    def une_mesure(self):
        if self.turbidite is None and self.mercure is None and self.cyanure is None and not self.autres:
            raise ValueError("Renseignez au moins un paramètre (turbidité, mercure, cyanure ou autre)")
        return self


def s_mesure(m: M.QualiteEau, nom: str = "") -> dict:
    return {"id": m.id, "cours_eau_id": m.cours_eau_id, "cours_eau": nom, "date": m.date.isoformat(), "semaine": m.semaine.isoformat(),
            "point": m.point, "lat": m.lat, "lng": m.lng, "coord_saisie": m.coord_saisie, "turbidite": m.turbidite, "mercure": m.mercure,
            "cyanure": m.cyanure, "autres": m.autres or [], "observations": m.observations, **evaluer(m)}


async def _appliquer(m: M.QualiteEau, data: QualiteIn, db: AsyncSession):
    c = (await db.execute(select(M.CoursEau).where(M.CoursEau.id == data.cours_eau_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Cours d'eau introuvable")
    sem = lundi(data.date)
    point = data.point.strip()
    doublon = (await db.execute(select(M.QualiteEau.id).where(M.QualiteEau.cours_eau_id == c.id, M.QualiteEau.semaine == sem,
                                                              M.QualiteEau.point == point, M.QualiteEau.id != (m.id or "")))).first()
    if doublon:
        raise HTTPException(409, f"Une mesure existe déjà pour {c.nom}{' (' + point + ')' if point else ''} la semaine du {sem.strftime('%d/%m/%Y')} : modifiez-la plutôt.")
    m.cours_eau_id, m.date, m.semaine, m.point = c.id, data.date, sem, point
    m.turbidite, m.mercure, m.cyanure = data.turbidite, data.mercure, data.cyanure
    m.autres = [a.model_dump() for a in data.autres]
    m.observations = data.observations
    if data.coord is not None:
        try:
            m.lat, m.lng = geo.to_wgs84(data.coord.sys, data.coord.x, data.coord.y)
        except ValueError as e:
            raise HTTPException(400, str(e))
        m.coord_saisie = {"sys": data.coord.sys, "x": geo.parse_num(data.coord.x), "y": geo.parse_num(data.coord.y)}
    else:
        m.lat = m.lng = m.coord_saisie = None
    return c


@router.get("/qualite-eau/seuils")
async def seuils(_u=Depends(current_user)):
    return SEUILS


@router.get("/qualite-eau")
async def liste(cours_eau_id: Optional[str] = None, du: Optional[date] = None, au: Optional[date] = None,
                _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    q = select(M.QualiteEau, M.CoursEau.nom).join(M.CoursEau, M.CoursEau.id == M.QualiteEau.cours_eau_id)
    if cours_eau_id:
        q = q.where(M.QualiteEau.cours_eau_id == cours_eau_id)
    if du:
        q = q.where(M.QualiteEau.date >= du)
    if au:
        q = q.where(M.QualiteEau.date <= au)
    rows = (await db.execute(q.order_by(M.QualiteEau.semaine.desc(), M.CoursEau.nom, M.QualiteEau.point))).all()
    return [s_mesure(m, nom) for m, nom in rows]


@router.post("/qualite-eau")
async def creer(data: QualiteIn, user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    m = M.QualiteEau(created_by=user["id"])
    c = await _appliquer(m, data, db)
    db.add(m)
    await db.commit()
    return s_mesure(m, c.nom)


@router.put("/qualite-eau/{mid}")
async def modifier(mid: str, data: QualiteIn, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    m = (await db.execute(select(M.QualiteEau).where(M.QualiteEau.id == mid))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Mesure introuvable")
    c = await _appliquer(m, data, db)
    await db.commit()
    return s_mesure(m, c.nom)


@router.delete("/qualite-eau/{mid}")
async def supprimer(mid: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    m = (await db.execute(select(M.QualiteEau).where(M.QualiteEau.id == mid))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Mesure introuvable")
    await db.delete(m)
    await db.commit()
    return {"ok": True}
