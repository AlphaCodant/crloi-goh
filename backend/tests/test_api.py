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
    assert len(sites) == 26                      # rapport n°1 (24 géolocalisés + 2 cités) ; liste du 11/10 sans doublon
    par_loc = {}
    for x in sites:
        par_loc.setdefault(x["localite"], set()).add(x["statut"])
    assert par_loc["Zobokro"] == {"tentative_reprise"}   # liste des sites du 11/10/2026
    assert par_loc["N'zikro"] == {"tenu"} and par_loc["FC Doka"] == {"demantele"}
    assert all(x["sous_prefecture"] == "Oumé" for x in sites if x["localite"].startswith("FC "))

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


def _carre(lng, lat, d=0.002):
    return {"type": "Polygon", "coordinates": [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]]}


def test_prospection_missions_images(client, monkeypatch):
    from app import gee

    h = auth(client)
    # GEE non configuré : message clair
    monkeypatch.setattr(gee, "configure", lambda: False)
    r = client.post("/api/gee/couche", headers=h, json={"produit": "ndvi", "du": "2026-01-01", "au": "2026-03-01"})
    assert r.status_code == 503

    # Analyse simulée (le serveur GEE est remplacé par une réponse fixe)
    monkeypatch.setattr(gee, "configure", lambda: True)
    monkeypatch.setattr(gee, "detecter", lambda zone, ref, rec, params: {
        "zones": [
            {"geometrie": _carre(-5.95, 6.13), "indices": {"dndvi": 0.4, "bsi": 0.2, "mndwi": 0.1, "ndti": 0.1, "dist_eau_m": 150}},
            {"geometrie": _carre(-5.90, 6.20, 0.0003), "indices": {"dndvi": 0.3, "bsi": 0.1, "mndwi": 0, "ndti": 0, "dist_eau_m": 900}},
        ],
        "images": {"reference": 12, "recente": 9}})
    r = client.post("/api/analyses", headers=h, json={
        "zone": _carre(-6.0, 6.0, 0.5), "zone_nom": "Test", "ref_du": "2025-01-01", "ref_au": "2025-03-31",
        "rec_du": "2026-01-01", "rec_au": "2026-03-31"})
    assert r.status_code == 200, r.text
    cibles = r.json()["cibles"]
    assert len(cibles) == 1  # la seconde zone (< 0,5 ha) est écartée
    c = cibles[0]
    assert c["code"].startswith("ZS-") and 0 < c["score"] <= 1 and c["superficie_ha"] > 4

    # Zone dessinée à la main
    r = client.post("/api/cibles", headers=h, json={"geometrie": _carre(-5.80, 6.30), "origine": "drone"})
    assert r.status_code == 200 and r.json()["origine"] == "drone"
    manuelle = r.json()["id"]

    # Mission d'éclairage
    r = client.post("/api/missions", headers=h, json={"titre": "Éclairage Sérihio", "date_prevue": "2026-10-20", "cibles": [c["id"], manuelle]})
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["code"].startswith("ECL-2026-") and {x["statut"] for x in m["cibles"]} == {"programmee"}
    gpx = client.get(f"/api/missions/{m['id']}/gpx", headers=h)
    assert gpx.status_code == 200 and "<wpt" in gpx.text and c["code"] in gpx.text
    assert "<Polygon>" in client.get(f"/api/missions/{m['id']}/kml", headers=h).text

    # Résultat terrain : la zone est confirmée et devient un site
    r = client.post(f"/api/cibles/{c['id']}/site", headers=h, json={"localite": "Zone test", "departement": "Gagnoa", "statut": "actif"})
    assert r.status_code == 200, r.text
    site = client.get(f"/api/sites/{r.json()['site_id']}", headers=h).json()
    assert site["contour"] and site["statut"] == "actif"
    r = client.patch(f"/api/cibles/{manuelle}", headers=h, json={"statut": "infirmee", "commentaire": "Champ de manioc"})
    assert r.json()["statut"] == "infirmee" and r.json()["historique"][-1]["note"] == "Champ de manioc"

    # Retirer une zone de la mission puis supprimer la mission
    r = client.put(f"/api/missions/{m['id']}", headers=h, json={"titre": "Éclairage Sérihio", "statut": "terminee", "cibles": [c["id"]]})
    assert len(r.json()["cibles"]) == 1
    assert client.delete(f"/api/missions/{m['id']}", headers=h).status_code == 200

    # Image drone : dépôt, lecture, suppression
    png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")
    r = client.post("/api/images", headers=h, files={"fichier": ("o.png", png, "image/png")}, data={
        "date_prise": "2026-10-05", "crs": "EPSG:32630", "emprise": "238000,705000,238500,705400",
        "emprise_wgs84": "-5.37,6.37,-5.36,6.38", "site_id": site["id"], "titre": "Survol"})
    assert r.status_code == 200, r.text
    img = r.json()
    assert client.get(f"/api/images/{img['id']}/fichier", headers=h).content == png
    assert [i["id"] for i in client.get("/api/images", headers=h, params={"site_id": site["id"]}).json()] == [img["id"]]
    assert client.delete(f"/api/images/{img['id']}", headers=h).status_code == 200


def test_cours_eau_zones_fiches_crud(client):
    h = auth(client)
    r = client.post("/api/cours-eau", headers=h, json={"nom": "Rivière test", "intensite": "impacte", "longueur_km": 12})
    ce = r.json()
    assert client.put(f"/api/cours-eau/{ce['id']}/trace", headers=h, json={"type": "LineString", "coordinates": [[-5.9, 6.1], [-5.8, 6.2]]}).status_code == 200
    assert client.patch(f"/api/cours-eau/{ce['id']}", headers=h, json={"nom": "Rivière test", "intensite": "faible"}).json()["intensite"] == "faible"
    assert client.delete(f"/api/cours-eau/{ce['id']}", headers=h).status_code == 200
    z = client.post("/api/zones", headers=h, json={"nom": "Secteur A", "geometrie": _carre(-5.9, 6.1, 0.1)}).json()
    assert client.delete(f"/api/zones/{z['id']}", headers=h).status_code == 200
    f = client.post("/api/fiches", headers=h, json={"date_recu": "2026-10-07", "source_type": "Informateur", "departement": "Oumé",
                                                    "localite": "X", "nature": ["Nouveau site"], "description": "A"}).json()
    r = client.put(f"/api/fiches/{f['id']}", headers=h, json={"date_recu": "2026-10-07", "source_type": "Informateur", "departement": "Oumé",
                                                              "localite": "Y", "nature": ["Nouveau site"], "description": "B",
                                                              "coord": {"sys": "wgs", "x": "-5.4", "y": "6.4"}})
    assert r.json()["localite"] == "Y" and r.json()["lat"] == 6.4
    assert client.delete(f"/api/fiches/{f['id']}", headers=h).status_code == 200


def test_brq_mission_signature_medias(client):
    h = auth(client)
    site = client.get("/api/sites", headers=h).json()[0]
    png = (b"\x89PNG\r\n\x1a\n" + b"0" * 64)
    r = client.post("/api/signataires", headers=h, data={"nom": "Cdt Test", "fonction": "Président du Comité Départemental",
                                                         "departement": "Gagnoa"}, files={"fichier": ("sig.png", png, "image/png")})
    assert r.status_code == 200, r.text
    sig = r.json()
    assert client.post("/api/signataires", headers=h, data={"nom": "X"},
                       files={"fichier": ("sig.pdf", b"%PDF", "application/pdf")}).status_code == 400

    corps = {"date": "2026-10-08", "departement": "Gagnoa", "periode_du": "2026-10-06", "periode_au": "2026-10-07",
             "chef_mission": {"grade": "Lieutenant", "nom": "Chef Test", "structure": "SODEFOR"},
             "agents": [{"grade": "Sergent", "nom": "Agent Un", "structure": "Gendarmerie"}, {"grade": "", "nom": " ", "structure": ""}],
             "signataire_id": sig["id"],
             "visites": [{"site_id": site["id"], "constat": "tenu"}]}
    assert client.post("/api/brq", headers=h, json={**corps, "periode_du": "2026-10-09"}).status_code == 422
    r = client.post("/api/brq", headers=h, json=corps)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["periode_du"] == "2026-10-06" and b["periode_au"] == "2026-10-07"
    assert b["chef_mission"]["nom"] == "Chef Test" and len(b["agents"]) == 1
    assert b["signataire"]["nom"] == "Cdt Test"

    jpg = b"\xff\xd8\xff" + b"1" * 200
    r = client.post(f"/api/brq/{b['id']}/medias", headers=h, data={"legende": "Fosse", "site_id": site["id"], "date_prise": "2026-10-06"},
                    files={"fichier": ("p.jpg", jpg, "image/jpeg")})
    assert r.status_code == 200, r.text
    photo = r.json()
    r = client.post(f"/api/brq/{b['id']}/medias", headers=h, data={"duree_s": "12.5"},
                    files={"fichier": ("v.mp4", b"\x00\x00\x00\x18ftypmp42", "video/mp4"), "miniature": ("m.jpg", jpg, "image/jpeg")})
    assert r.status_code == 200 and r.json()["type"] == "video"
    video = r.json()
    assert client.post(f"/api/brq/{b['id']}/medias", headers=h, files={"fichier": ("a.txt", b"x", "text/plain")}).status_code == 400

    assert client.get(f"/api/medias/{photo['id']}/fichier", headers=h).content == jpg
    assert client.get(f"/api/medias/{video['id']}/miniature", headers=h).content == jpg
    assert client.get(f"/api/signataires/{sig['id']}/signature", headers=h).content == png
    assert client.patch(f"/api/medias/{photo['id']}", headers=h, json={"legende": "Fosse rebouchée"}).json()["legende"] == "Fosse rebouchée"

    b = client.get(f"/api/brq/{b['id']}", headers=h).json()
    assert [m["type"] for m in b["medias"]] == ["photo", "video"] or len(b["medias"]) == 2

    # Modifier le BRQ ne touche pas aux médias ; retirer le signataire garde la signature des BRQ existants
    r = client.put(f"/api/brq/{b['id']}", headers=h, json={**corps, "agents": []})
    assert r.status_code == 200 and len(r.json()["medias"]) == 2 and r.json()["agents"] == []
    assert client.delete(f"/api/signataires/{sig['id']}", headers=h).status_code == 200
    assert all(g["id"] != sig["id"] for g in client.get("/api/signataires", headers=h).json())
    assert client.get(f"/api/brq/{b['id']}", headers=h).json()["signataire"]["nom"] == "Cdt Test"

    assert client.delete(f"/api/medias/{photo['id']}", headers=h).status_code == 200
    assert client.delete(f"/api/brq/{b['id']}", headers=h).status_code == 200
    assert client.get(f"/api/medias/{video['id']}/fichier", headers=h).status_code == 404
