"""Application de la cellule renseignement du CRLOI Gôh."""
from dotenv import load_dotenv

load_dotenv()

import logging  # noqa: E402
import os  # noqa: E402

from fastapi import APIRouter, FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pathlib import Path  # noqa: E402

from sqlalchemy import text  # noqa: E402
from .db import DB_SCHEMA, Base, engine  # noqa: E402
from . import routes_brq, routes_imagerie, routes_misc, routes_sites  # noqa: E402
from .seed import seed  # noqa: E402
from . import maj_goh  # noqa: E402

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="CRLOI Gôh – Cellule renseignement")

api = APIRouter(prefix="/api")
api.include_router(routes_misc.router)
api.include_router(routes_sites.router)
api.include_router(routes_brq.router)
api.include_router(routes_imagerie.router)


@api.get("/")
async def root():
    return {"app": "CRLOI Gôh renseignement", "status": "ok"}


app.include_router(api)

_origins = [o.strip().rstrip("/") for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins or ["*"], allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{DB_SCHEMA}"'))
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Colonnes ajoutées après la création des tables (create_all ne modifie pas une table existante)
        for sql in MIGRATIONS:
            await conn.execute(text(sql))
    await seed()
    await maj_goh.appliquer()
    await maj_goh.traces_actualises()


MIGRATIONS = [
    "ALTER TABLE brq ADD COLUMN IF NOT EXISTS departement VARCHAR(32) NOT NULL DEFAULT ''",
    "ALTER TABLE brq ADD COLUMN IF NOT EXISTS periode_du DATE",
    "ALTER TABLE brq ADD COLUMN IF NOT EXISTS periode_au DATE",
    "ALTER TABLE brq ADD COLUMN IF NOT EXISTS chef_mission JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE brq ADD COLUMN IF NOT EXISTS agents JSONB NOT NULL DEFAULT '[]'::jsonb",
    "ALTER TABLE brq ADD COLUMN IF NOT EXISTS signataire_id VARCHAR REFERENCES signataires(id) ON DELETE SET NULL",
]


# Interface web (pages statiques reprises de GestReb) servie par la même application.
# Montée en dernier pour ne pas masquer /api.
WEB_DIR = Path(os.environ.get("WEB_DIR", Path(__file__).resolve().parents[2] / "web"))
if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
