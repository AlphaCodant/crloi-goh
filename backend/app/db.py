"""Connexion PostgreSQL (SQLAlchemy asynchrone + asyncpg)."""
import os
import ssl

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


def _database_url() -> str:
    url = os.environ["DATABASE_URL"]
    # Render fournit « postgresql://… » : on force le pilote asyncpg et on retire « sslmode ».
    if url.startswith(("postgres://", "postgresql://")):
        url = "postgresql+asyncpg://" + url.split("://", 1)[1]
    if "sslmode=" in url:
        base, _, query = url.partition("?")
        kept = [q for q in query.split("&") if q and not q.startswith("sslmode=")]
        url = base + ("?" + "&".join(kept) if kept else "")
    return url


_connect_args = {}
if os.environ.get("DB_SSL", "true").lower() not in ("0", "false", "no", "off"):
    _ctx = ssl.create_default_context()
    _ctx.check_hostname = False
    _ctx.verify_mode = ssl.CERT_NONE
    _connect_args = {"ssl": _ctx}

engine = create_async_engine(_database_url(), pool_pre_ping=True, pool_size=5, max_overflow=5, connect_args=_connect_args)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_session():
    async with SessionLocal() as session:
        yield session
