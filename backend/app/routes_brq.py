"""Bulletins de relevé quotidien (BRQ) et rapports hebdomadaires."""
from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

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


class Agent(BaseModel):
    grade: str = Field("", max_length=64)
    nom: str = Field("", max_length=255)
    structure: str = Field("", max_length=255)


class BrqIn(BaseModel):
    date: date
    reference: str = ""
    unites: str = ""
    observations: str = ""
    departement: Literal["", "Gagnoa", "Oumé"] = ""
    periode_du: Optional[date] = None
    periode_au: Optional[date] = None
    chef_mission: Agent = Agent()
    agents: list[Agent] = Field([], max_length=100)
    signataire_id: Optional[str] = None
    visites: list[VisiteIn] = []

    @model_validator(mode="after")
    def _periode(self):
        if self.periode_du and self.periode_au and self.periode_au < self.periode_du:
            raise ValueError("La fin de la mission précède son début")
        if self.periode_du and not self.periode_au:
            self.periode_au = self.periode_du
        if self.periode_au and not self.periode_du:
            self.periode_du = self.periode_au
        self.agents = [a for a in self.agents if a.nom.strip()]
        return self


def s_media(m: M.BrqMedia) -> dict:
    return {"id": m.id, "brq_id": m.brq_id, "site_id": m.site_id, "type": m.type, "mime": m.mime, "nom_fichier": m.nom_fichier,
            "legende": m.legende, "date_prise": m.date_prise.isoformat() if m.date_prise else None, "largeur": m.largeur,
            "hauteur": m.hauteur, "duree_s": m.duree_s, "taille": m.taille}


def s_signataire(g: M.Signataire) -> dict:
    return {"id": g.id, "nom": g.nom, "fonction": g.fonction, "departement": g.departement, "actif": g.actif}


def s_brq(b: M.Brq, visites: list, sites: dict, medias: list = (), signataires: dict = None) -> dict:
    sig = (signataires or {}).get(b.signataire_id)
    return {
        "id": b.id, "date": b.date.isoformat(), "reference": b.reference, "unites": b.unites, "observations": b.observations,
        "departement": b.departement or "",
        "periode_du": b.periode_du.isoformat() if b.periode_du else None,
        "periode_au": b.periode_au.isoformat() if b.periode_au else None,
        "chef_mission": b.chef_mission or {}, "agents": b.agents or [],
        "signataire_id": b.signataire_id, "signataire": s_signataire(sig) if sig else None,
        "medias": [s_media(m) for m in medias],
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
    meds = (await db.execute(select(M.BrqMedia).where(M.BrqMedia.brq_id.in_(ids))
                             .order_by(M.BrqMedia.date_prise, M.BrqMedia.created_at))).scalars().all() if ids else []
    mby = {}
    for m in meds:
        mby.setdefault(m.brq_id, []).append(m)
    gids = {b.signataire_id for b in brqs if b.signataire_id}
    sigs = {g.id: g for g in (await db.execute(select(M.Signataire).where(M.Signataire.id.in_(gids)))).scalars().all()} if gids else {}
    return [s_brq(b, by.get(b.id, []), sites, mby.get(b.id, []), sigs) for b in brqs]


def _champs(b: M.Brq, data: BrqIn):
    b.date, b.reference, b.unites, b.observations = data.date, data.reference, data.unites, data.observations
    b.departement, b.periode_du, b.periode_au = data.departement, data.periode_du, data.periode_au
    b.chef_mission = data.chef_mission.model_dump()
    b.agents = [a.model_dump() for a in data.agents]
    b.signataire_id = data.signataire_id or None


async def _verifier_signataire(db, sid: Optional[str]):
    if sid and not (await db.execute(select(M.Signataire.id).where(M.Signataire.id == sid))).scalar_one_or_none():
        raise HTTPException(400, "Signataire inconnu")


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
    await _verifier_signataire(db, data.signataire_id)
    b = M.Brq(created_by=user["id"])
    _champs(b, data)
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
    await _verifier_signataire(db, data.signataire_id)
    _champs(b, data)
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


# ---------- Signataires (responsables des Comités Départementaux) ----------
SIGNATURE_MAX = 1_000_000
MIMES_SIGNATURE = ("image/png", "image/jpeg", "image/webp")


@router.get("/signataires")
async def list_signataires(tous: bool = False, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    q = select(M.Signataire).order_by(M.Signataire.departement, M.Signataire.nom)
    if not tous:
        q = q.where(M.Signataire.actif.is_(True))
    return [s_signataire(g) for g in (await db.execute(q)).scalars().all()]


@router.post("/signataires")
async def create_signataire(fichier: UploadFile = File(...), nom: str = Form(...), fonction: str = Form(""),
                            departement: str = Form(""), user=Depends(require()), db: AsyncSession = Depends(get_session)):
    contenu = await fichier.read()
    if fichier.content_type not in MIMES_SIGNATURE:
        raise HTTPException(400, "Signature attendue en PNG (fond transparent de préférence), JPEG ou WebP")
    if len(contenu) > SIGNATURE_MAX:
        raise HTTPException(413, "Image de signature trop lourde (1 Mo au plus)")
    if not nom.strip():
        raise HTTPException(400, "Indiquez le nom du signataire")
    if departement not in ("", "Gagnoa", "Oumé"):
        raise HTTPException(400, "Département inconnu")
    g = M.Signataire(nom=nom.strip(), fonction=fonction.strip(), departement=departement, mime=fichier.content_type,
                     contenu=contenu, created_by=user["id"])
    db.add(g)
    await db.commit()
    return s_signataire(g)


@router.delete("/signataires/{gid}")
async def retirer_signataire(gid: str, _u=Depends(require()), db: AsyncSession = Depends(get_session)):
    """Retire le signataire de la liste ; les BRQ déjà signés gardent leur signature."""
    g = (await db.execute(select(M.Signataire).where(M.Signataire.id == gid))).scalar_one_or_none()
    if not g:
        raise HTTPException(404, "Signataire introuvable")
    g.actif = False
    await db.commit()
    return {"ok": True}


@router.get("/signataires/{gid}/signature")
async def signature_image(gid: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    g = (await db.execute(select(M.Signataire).options(undefer(M.Signataire.contenu)).where(M.Signataire.id == gid))).scalar_one_or_none()
    if not g:
        raise HTTPException(404, "Signataire introuvable")
    return Response(g.contenu, media_type=g.mime, headers={"Cache-Control": "private, max-age=3600"})


# ---------- Photos et vidéos des BRQ ----------
PHOTO_MAX = 8 * 1024 * 1024
VIDEO_MAX = 50 * 1024 * 1024
MINIATURE_MAX = 300 * 1024


async def _media(db, mid: str, *charger) -> M.BrqMedia:
    q = select(M.BrqMedia).where(M.BrqMedia.id == mid)
    if charger:
        q = q.options(*[undefer(c) for c in charger])
    m = (await db.execute(q)).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Fichier introuvable")
    return m


@router.post("/brq/{brq_id}/medias")
async def upload_media(brq_id: str, fichier: UploadFile = File(...), miniature: Optional[UploadFile] = File(None),
                       legende: str = Form(""), site_id: str = Form(""), date_prise: Optional[date] = Form(None),
                       largeur: int = Form(0), hauteur: int = Form(0), duree_s: Optional[float] = Form(None),
                       nom_fichier: str = Form(""), user=Depends(current_user), db: AsyncSession = Depends(get_session)):
    await _load(db, brq_id)
    mime = (fichier.content_type or "").lower()
    if mime.startswith("image/"):
        type_, limite = "photo", PHOTO_MAX
        if mime not in ("image/jpeg", "image/png", "image/webp"):
            raise HTTPException(400, "Photo attendue en JPEG, PNG ou WebP")
    elif mime.startswith("video/"):
        type_, limite = "video", VIDEO_MAX
        if mime not in ("video/mp4", "video/webm", "video/quicktime"):
            raise HTTPException(400, "Vidéo attendue en MP4, WebM ou MOV")
    else:
        raise HTTPException(400, "Seules les photos et les vidéos sont acceptées")
    contenu = await fichier.read()
    if len(contenu) > limite:
        raise HTTPException(413, f"{'Photo' if type_ == 'photo' else 'Vidéo'} trop lourde ({limite // (1024 * 1024)} Mo au plus)")
    mini = await miniature.read() if miniature else None
    if mini and len(mini) > MINIATURE_MAX:
        mini = None
    if site_id and not (await db.execute(select(M.Site.id).where(M.Site.id == site_id))).scalar_one_or_none():
        raise HTTPException(400, "Site inconnu")
    m = M.BrqMedia(brq_id=brq_id, site_id=site_id or None, type=type_, mime=mime, nom_fichier=(nom_fichier or fichier.filename or "")[:255],
                   legende=legende, date_prise=date_prise, largeur=largeur, hauteur=hauteur, duree_s=duree_s, taille=len(contenu),
                   miniature=mini, contenu=contenu, created_by=user["id"])
    db.add(m)
    await db.commit()
    return s_media(m)


class MediaPatch(BaseModel):
    legende: Optional[str] = None
    site_id: Optional[str] = None
    date_prise: Optional[date] = None


@router.patch("/medias/{mid}")
async def patch_media(mid: str, data: MediaPatch, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    m = await _media(db, mid)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(m, k, (v or None) if k == "site_id" else v)
    await db.commit()
    return s_media(m)


@router.delete("/medias/{mid}")
async def delete_media(mid: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    m = await _media(db, mid)
    await db.delete(m)
    await db.commit()
    return {"ok": True}


@router.get("/medias/{mid}/fichier")
async def media_fichier(mid: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    m = await _media(db, mid, M.BrqMedia.contenu)
    return Response(m.contenu, media_type=m.mime, headers={"Cache-Control": "private, max-age=86400"})


@router.get("/medias/{mid}/miniature")
async def media_miniature(mid: str, _u=Depends(current_user), db: AsyncSession = Depends(get_session)):
    m = await _media(db, mid, M.BrqMedia.miniature)
    if m.miniature:
        return Response(m.miniature, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})
    if m.type == "photo":
        m = await _media(db, mid, M.BrqMedia.contenu)
        return Response(m.contenu, media_type=m.mime, headers={"Cache-Control": "private, max-age=86400"})
    raise HTTPException(404, "Pas de miniature")


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
