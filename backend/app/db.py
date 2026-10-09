"""Connexion PostgreSQL (SQLAlchemy asynchrone + asyncpg)."""
import os
import ssl

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


def _database_url() -> str:
    raw = os.environ.get("DATABASE_URL", "")
    # Tolère les copier-coller : espaces, retours à la ligne, guillemets, commande « psql … » entière.
    url = raw.strip().strip("'\"").strip()
    if url.startswith("psql "):
        url = url[5:].strip().strip("'\"").strip()
    url = "".join(url.split())
    if not url.startswith(("postgres://", "postgresql://", "postgresql+asyncpg://")):
        # On décrit le problème sans jamais afficher la valeur (elle contient le mot de passe).
        debut = url.split(":", 1)[0][:20] if url else "(vide)"
        raise RuntimeError(
            "DATABASE_URL invalide : elle doit commencer par postgresql:// "
            f"(valeur reçue commençant par « {debut} »). Copiez l'« Internal Database URL » "
            "de la base Render, onglet Connect.")
    # Render fournit « postgresql://… » : on force le pilote asyncpg et on retire « sslmode ».
    if url.startswith(("postgres://", "postgresql://")):
        url = "postgresql+asyncpg://" + url.split("://", 1)[1]
    if "sslmode=" in url:
        base, _, query = url.partition("?")
        kept = [q for q in query.split("&") if q and not q.startswith("sslmode=")]
        url = base + ("?" + "&".join(kept) if kept else "")
    return url


# Schéma PostgreSQL dédié : les tables du CRLOI restent séparées de celles d'autres applications
# hébergées dans la même base (ex. GestReb).
DB_SCHEMA = os.environ.get("DB_SCHEMA", "crloi").strip() or "public"
if not DB_SCHEMA.replace("_", "").isalnum():
    raise RuntimeError("DB_SCHEMA ne doit contenir que des lettres, chiffres et _")

_connect_args = {"server_settings": {"search_path": DB_SCHEMA}}
if os.environ.get("DB_SSL", "true").lower() not in ("0", "false", "no", "off"):
    _ctx = ssl.create_default_context()
    _ctx.check_hostname = False
    _ctx.verify_mode = ssl.CERT_NONE
    _connect_args["ssl"] = _ctx

engine = create_async_engine(_database_url(), pool_pre_ping=True, pool_size=5, max_overflow=5, connect_args=_connect_args)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_session():
    async with SessionLocal() as session:
        yield session
