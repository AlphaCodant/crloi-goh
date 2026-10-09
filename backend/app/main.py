"""Application de la cellule renseignement du CRLOI Gôh."""
from dotenv import load_dotenv

load_dotenv()

import logging  # noqa: E402
import os  # noqa: E402

from fastapi import APIRouter, FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from sqlalchemy import text  # noqa: E402
from .db import DB_SCHEMA, Base, engine  # noqa: E402
from . import routes_brq, routes_misc, routes_sites  # noqa: E402
from .seed import seed  # noqa: E402

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="CRLOI Gôh – Cellule renseignement")

api = APIRouter(prefix="/api")
api.include_router(routes_misc.router)
api.include_router(routes_sites.router)
api.include_router(routes_brq.router)


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
    await seed()
