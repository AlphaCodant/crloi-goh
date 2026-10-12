"""Modèle de données de la cellule renseignement du CRLOI Gôh."""
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, deferred, mapped_column

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
    departement: Mapped[str] = mapped_column(String(32), default="")
    periode_du: Mapped[date | None] = mapped_column(Date, nullable=True)
    periode_au: Mapped[date | None] = mapped_column(Date, nullable=True)
    chef_mission: Mapped[dict] = mapped_column(JSONB, default=dict)  # {"grade", "nom", "structure"}
    agents: Mapped[list] = mapped_column(JSONB, default=list)  # [{"grade", "nom", "structure"}]
    signataire_id: Mapped[str | None] = mapped_column(String, ForeignKey("signataires.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)


class Signataire(Base):
    """Responsable d'un Comité Départemental et sa signature numérisée (image), réutilisable d'un BRQ à l'autre."""
    __tablename__ = "signataires"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    nom: Mapped[str] = mapped_column(String(255))
    fonction: Mapped[str] = mapped_column(String(255), default="")
    departement: Mapped[str] = mapped_column(String(32), default="")
    mime: Mapped[str] = mapped_column(String(32), default="image/png")
    contenu: Mapped[bytes] = deferred(mapped_column(LargeBinary))
    actif: Mapped[bool] = mapped_column(Boolean, default=True)  # retiré de la liste sans effacer les BRQ déjà signés
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)


class BrqMedia(Base):
    """Photo ou vidéo jointe à un BRQ (éventuellement rattachée à un site visité)."""
    __tablename__ = "brq_medias"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    brq_id: Mapped[str] = mapped_column(String, ForeignKey("brq.id", ondelete="CASCADE"), index=True)
    site_id: Mapped[str | None] = mapped_column(String, ForeignKey("sites.id", ondelete="SET NULL"), nullable=True)
    type: Mapped[str] = mapped_column(String(8))  # photo | video
    mime: Mapped[str] = mapped_column(String(64))
    nom_fichier: Mapped[str] = mapped_column(String(255), default="")
    legende: Mapped[str] = mapped_column(Text, default="")
    date_prise: Mapped[date | None] = mapped_column(Date, nullable=True)
    largeur: Mapped[int] = mapped_column(Integer, default=0)
    hauteur: Mapped[int] = mapped_column(Integer, default=0)
    duree_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    taille: Mapped[int] = mapped_column(Integer, default=0)
    miniature: Mapped[bytes | None] = deferred(mapped_column(LargeBinary, nullable=True))
    contenu: Mapped[bytes] = deferred(mapped_column(LargeBinary))
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


class QualiteEau(Base):
    """Mesure hebdomadaire de la qualité de l'eau d'un cours d'eau (une par cours d'eau, point de prélèvement et semaine)."""
    __tablename__ = "qualite_eau"
    __table_args__ = (UniqueConstraint("cours_eau_id", "semaine", "point", name="uq_qualite_eau_semaine"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    cours_eau_id: Mapped[str] = mapped_column(String, ForeignKey("cours_eau.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)          # date du prélèvement
    semaine: Mapped[date] = mapped_column(Date, index=True)       # lundi de la semaine ISO
    point: Mapped[str] = mapped_column(String(128), default="")   # lieu de prélèvement
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    coord_saisie: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    turbidite: Mapped[float | None] = mapped_column(Float, nullable=True)  # NTU
    mercure: Mapped[float | None] = mapped_column(Float, nullable=True)    # µg/L
    cyanure: Mapped[float | None] = mapped_column(Float, nullable=True)    # mg/L
    autres: Mapped[list] = mapped_column(JSONB, default=list)            # [{parametre, valeur, unite}]
    observations: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)


class Zone(Base):
    """Limites (région, départements, forêts classées, zones I et II) importées en GeoJSON."""
    __tablename__ = "zones"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    nom: Mapped[str] = mapped_column(String(128))
    categorie: Mapped[str] = mapped_column(String(32))  # region | departement | sous_prefecture | foret | zone_ops
    geometrie: Mapped[dict] = mapped_column(JSONB)
    approximative: Mapped[bool] = mapped_column(Boolean, default=False)


class Analyse(Base):
    """Une prospection satellitaire (GEE) lancée sur une zone et deux périodes."""
    __tablename__ = "analyses"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    nom: Mapped[str] = mapped_column(String(255))
    zone: Mapped[dict] = mapped_column(JSONB)  # GeoJSON (Polygon / MultiPolygon)
    zone_nom: Mapped[str] = mapped_column(String(255), default="")
    ref_du: Mapped[date] = mapped_column(Date)
    ref_au: Mapped[date] = mapped_column(Date)
    rec_du: Mapped[date] = mapped_column(Date)
    rec_au: Mapped[date] = mapped_column(Date)
    parametres: Mapped[dict] = mapped_column(JSONB, default=dict)
    images: Mapped[dict] = mapped_column(JSONB, default=dict)  # nombre de scènes utilisées
    nb_cibles: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)


class Cible(Base):
    """Zone suspecte : détectée par GEE ou dessinée à la main (photo-interprétation, drone, renseignement)."""
    __tablename__ = "cibles"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)  # ZS-2026-0001
    analyse_id: Mapped[str | None] = mapped_column(String, ForeignKey("analyses.id", ondelete="SET NULL"), nullable=True, index=True)
    origine: Mapped[str] = mapped_column(String(32), default="gee")  # gee | manuelle | drone | renseignement
    geometrie: Mapped[dict] = mapped_column(JSONB)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    superficie_ha: Mapped[float] = mapped_column(Float, default=0)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    niveau: Mapped[str] = mapped_column(String(16), default="moyenne")  # forte | moyenne | faible
    indices: Mapped[dict] = mapped_column(JSONB, default=dict)
    departement: Mapped[str] = mapped_column(String(64), default="")
    site_proche_id: Mapped[str | None] = mapped_column(String, nullable=True)
    site_proche_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    statut: Mapped[str] = mapped_column(String(32), default="a_verifier", index=True)  # a_verifier | programmee | confirmee | infirmee | ecartee
    site_id: Mapped[str | None] = mapped_column(String, ForeignKey("sites.id", ondelete="SET NULL"), nullable=True)
    mission_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    historique: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)


class Mission(Base):
    """Mission d'éclairage : vérification sur le terrain d'un ensemble de zones suspectes."""
    __tablename__ = "missions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)  # ECL-2026-001
    titre: Mapped[str] = mapped_column(String(255))
    date_prevue: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_fin: Mapped[date | None] = mapped_column(Date, nullable=True)
    equipe: Mapped[str] = mapped_column(Text, default="")
    moyens: Mapped[str] = mapped_column(Text, default="")  # véhicules, drone, GPS…
    objectif: Mapped[str] = mapped_column(Text, default="")
    statut: Mapped[str] = mapped_column(String(32), default="planifiee", index=True)  # planifiee | en_cours | terminee | annulee
    compte_rendu: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)


class ImageDrone(Base):
    """Orthophoto drone (version web) géoréférencée, rattachée à un site et datée."""
    __tablename__ = "images_drone"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    site_id: Mapped[str | None] = mapped_column(String, ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True)
    cible_id: Mapped[str | None] = mapped_column(String, ForeignKey("cibles.id", ondelete="SET NULL"), nullable=True)
    date_prise: Mapped[date] = mapped_column(Date, index=True)
    titre: Mapped[str] = mapped_column(String(255), default="")
    crs: Mapped[str] = mapped_column(String(32), default="EPSG:4326")
    emprise: Mapped[list] = mapped_column(JSONB)  # [minx, miny, maxx, maxy] dans `crs`
    emprise_wgs84: Mapped[list] = mapped_column(JSONB)  # [ouest, sud, est, nord]
    resolution_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    largeur: Mapped[int] = mapped_column(Integer, default=0)
    hauteur: Mapped[int] = mapped_column(Integer, default=0)
    mime: Mapped[str] = mapped_column(String(32), default="image/webp")
    taille: Mapped[int] = mapped_column(Integer, default=0)
    fichier_origine: Mapped[str] = mapped_column(String(255), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    contenu: Mapped[bytes] = deferred(mapped_column(LargeBinary))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)


class Meta(Base):
    """Marqueurs techniques (mises à jour de données déjà appliquées)."""
    __tablename__ = "meta"
    cle: Mapped[str] = mapped_column(String(64), primary_key=True)
    valeur: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
