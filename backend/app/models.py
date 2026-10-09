"""Modèle de données de la cellule renseignement du CRLOI Gôh."""
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    full_name: Mapped[str] = mapped_column(String(255))
    grade: Mapped[str] = mapped_column(String(64), default="")
    role: Mapped[str] = mapped_column(String(32))  # chef | analyste | cartographe
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Site(Base):
    """Site d'orpaillage illégal (point obligatoire si connu, contour facultatif)."""
    __tablename__ = "sites"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    localite: Mapped[str] = mapped_column(String(255))
    departement: Mapped[str] = mapped_column(String(64), index=True)  # Gagnoa | Oumé
    sous_prefecture: Mapped[str] = mapped_column(String(128), default="")
    domaine: Mapped[str] = mapped_column(String(32), default="rural")  # rural | foret_classee
    foret: Mapped[str] = mapped_column(String(128), default="")
    ugf: Mapped[str] = mapped_column(String(128), default="")
    cours_eau: Mapped[str] = mapped_column(String(128), default="")
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    coord_saisie: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # {sys, x, y} tels que saisis
    coord_alerte: Mapped[str] = mapped_column(Text, default="")
    contour: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # GeoJSON Polygon / MultiPolygon
    superficie_ha: Mapped[float | None] = mapped_column(Float, nullable=True)
    priorite: Mapped[str] = mapped_column(String(16), default="normale")  # haute | normale
    observations: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)


class SiteEvent(Base):
    """Statut d'un site à une date : c'est ce qui alimente la barre temporelle."""
    __tablename__ = "site_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    site_id: Mapped[str] = mapped_column(String, ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    statut: Mapped[str] = mapped_column(String(32))  # actif | demantele | tenu | tentative_reprise | recolonise
    source: Mapped[str] = mapped_column(String(32))  # rapport | brq | fiche | satellite | drone | saisie
    source_id: Mapped[str | None] = mapped_column(String, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)


class Brq(Base):
    """Bulletin de relevé quotidien."""
    __tablename__ = "brq"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    date: Mapped[date] = mapped_column(Date, index=True)
    reference: Mapped[str] = mapped_column(String(64), default="")
    unites: Mapped[str] = mapped_column(String(255), default="")
    observations: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)


class Visite(Base):
    """Un site visité dans un BRQ : constat, saisies, interpellations."""
    __tablename__ = "visites"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    brq_id: Mapped[str] = mapped_column(String, ForeignKey("brq.id", ondelete="CASCADE"), index=True)
    site_id: Mapped[str | None] = mapped_column(String, ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    unite: Mapped[str] = mapped_column(String(255), default="")
    constat: Mapped[str] = mapped_column(String(32))  # mêmes valeurs que SiteEvent.statut
    saisies: Mapped[dict] = mapped_column(JSONB, default=dict)  # {"motopompes": 2, "tuyaux_m": 50, ...}
    interpelles: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str] = mapped_column(Text, default="")


class RapportHebdo(Base):
    __tablename__ = "rapports_hebdo"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    semaine_debut: Mapped[date] = mapped_column(Date, unique=True, index=True)  # lundi
    synthese: Mapped[str] = mapped_column(Text, default="")
    difficultes: Mapped[str] = mapped_column(Text, default="")
    recommandations: Mapped[str] = mapped_column(Text, default="")
    valide: Mapped[bool] = mapped_column(Boolean, default=False)
    date_validation: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)


class FicheRens(Base):
    """Fiche de renseignement (même structure que le registre déjà utilisé)."""
    __tablename__ = "fiches_rens"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    numero: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    date_recu: Mapped[date] = mapped_column(Date, index=True)
    heure_recu: Mapped[str] = mapped_column(String(8), default="")
    date_faits: Mapped[date | None] = mapped_column(Date, nullable=True)
    priorite: Mapped[str] = mapped_column(String(16), default="routine")
    source_type: Mapped[str] = mapped_column(String(64))
    source_code: Mapped[str] = mapped_column(String(32), default="")
    fiabilite: Mapped[str] = mapped_column(String(1), default="F")
    credibilite: Mapped[str] = mapped_column(String(1), default="6")
    departement: Mapped[str] = mapped_column(String(64))
    sous_prefecture: Mapped[str] = mapped_column(String(128), default="")
    localite: Mapped[str] = mapped_column(String(255))
    foret: Mapped[str] = mapped_column(String(128), default="")
    cours_eau: Mapped[str] = mapped_column(String(128), default="")
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    coord_saisie: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    nature: Mapped[list] = mapped_column(JSONB, default=list)
    equipements: Mapped[list] = mapped_column(JSONB, default=list)
    personnes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    superficie_ha: Mapped[float | None] = mapped_column(Float, nullable=True)
    description: Mapped[str] = mapped_column(Text)
    suite: Mapped[str] = mapped_column(String(128), default="")
    statut: Mapped[str] = mapped_column(String(32), default="a_verifier", index=True)
    site_id: Mapped[str | None] = mapped_column(String, ForeignKey("sites.id", ondelete="SET NULL"), nullable=True)
    historique: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)


class CoursEau(Base):
    __tablename__ = "cours_eau"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    nom: Mapped[str] = mapped_column(String(128))
    bassin: Mapped[str] = mapped_column(String(64), default="")
    type: Mapped[str] = mapped_column(String(64), default="")
    localites: Mapped[str] = mapped_column(Text, default="")
    longueur_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    lineaire_impacte_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    intensite: Mapped[str] = mapped_column(String(32), default="non_impacte")  # tres_impacte | impacte | faible | non_impacte
    commentaire: Mapped[str] = mapped_column(Text, default="")
    trace: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # GeoJSON LineString / MultiLineString


class Zone(Base):
    """Limites (région, départements, forêts classées, zones I et II) importées en GeoJSON."""
    __tablename__ = "zones"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    nom: Mapped[str] = mapped_column(String(128))
    categorie: Mapped[str] = mapped_column(String(32))  # region | departement | sous_prefecture | foret | zone_ops
    geometrie: Mapped[dict] = mapped_column(JSONB)
    approximative: Mapped[bool] = mapped_column(Boolean, default=False)
