"""Parcours complet sur l'API. Nécessite une base PostgreSQL de test :
    TEST_DATABASE_URL=postgresql://user:mdp@localhost:5432/crloi_test pytest
La base est vidée au début du test."""
import os

import pytest

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL non défini")

if URL:
    os.environ["DATABASE_URL"] = URL
    os.environ.setdefault("DB_SSL", "false")
    os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret")
    os.environ["ADMIN_EMAIL"] = "chef@test.ci"
    os.environ["ADMIN_PASSWORD"] = "MotDePasse-Test-1"


@pytest.fixture(scope="module")
def client():
    import asyncio
    from fastapi.testclient import TestClient
    from app.db import Base, engine
    from app.main import app

    async def reset():
        async with engine.begin() as c:
            await c.run_sync(Base.metadata.drop_all)
        await engine.dispose()
    asyncio.run(reset())
    with TestClient(app) as c:
        yield c


def auth(client):
    r = client.post("/api/auth/login", json={"email": "chef@test.ci", "password": "MotDePasse-Test-1"})
    assert r.status_code == 200
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_acces_refuse_sans_jeton(client):
    assert client.get("/api/sites").status_code == 401


def test_mauvais_mot_de_passe(client):
    assert client.post("/api/auth/login", json={"email": "chef@test.ci", "password": "faux"}).status_code == 401


def test_parcours(client):
    h = auth(client)
    sites = client.get("/api/sites", headers=h).json()
    assert len(sites) >= 24                      # sites du rapport n°1 chargés au démarrage

    r = client.post("/api/sites", headers=h, json={
        "localite": "Site test", "departement": "Oumé", "domaine": "rural",
        "coord": {"sys": "30", "x": "238747", "y": "705256"},
        "statut_initial": "actif", "date_statut": "2026-10-01"})
    assert r.status_code == 200, r.text
    site = r.json()
    assert site["code"].startswith("OUM-") and site["statut"] == "actif"

    r = client.post("/api/brq", headers=h, json={
        "date": "2026-10-05", "reference": "BRQ test", "unites": "URLOI", "observations": "",
        "visites": [{"site_id": site["id"], "unite": "URLOI", "constat": "demantele",
                     "saisies": {"motopompes": 1}, "interpelles": 2, "note": ""}]})
    assert r.status_code == 200, r.text

    s = client.get(f"/api/sites/{site['id']}", headers=h).json()
    assert [e["statut"] for e in s["events"]][-1] == "demantele"

    k = client.get("/api/stats", headers=h, params={"at": "2026-10-05"}).json()["kpi"]
    assert k["sites_recenses"] >= 25 and k["brq_7j"] >= 1

    r = client.post("/api/fiches", headers=h, json={
        "date_recu": "2026-10-06", "source_type": "Informateur", "source_code": "INF-01",
        "fiabilite": "B", "credibilite": "2", "departement": "Gagnoa", "localite": "Test",
        "nature": ["Nouveau site"], "description": "Test"})
    assert r.status_code == 200 and r.json()["numero"] == "RENS-2026-001"
