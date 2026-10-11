"""Tests sans base de données : conversions de coordonnées et indicateurs."""
from datetime import date
from types import SimpleNamespace as NS

import pytest

from app import geo, stats as ST


def ev(d, statut):
    return NS(date=date.fromisoformat(d), statut=statut)


def test_parse_num_virgule_et_espaces():
    assert geo.parse_num("705 256,5") == 705256.5
    assert geo.parse_num("") is None


def test_utm30_oume_dans_le_goh():
    lat, lng = geo.to_wgs84("30", "238747", "705256")
    assert 6.2 < lat < 6.5 and -5.5 < lng < -5.2
    assert geo.controle_goh(lat, lng) == ""


def test_mauvaise_zone_utm_signalee():
    # Coordonnées de l'ouest (29N) saisies par erreur en 30N : le point tombe hors du Gôh
    lat, lng = geo.to_wgs84("30", "760000", "640000")
    assert "hors de la région" in geo.controle_goh(lat, lng)


def test_site_sans_coordonnees():
    assert "non géolocalisé" in geo.controle_goh(None, None)


def test_systeme_inconnu():
    with pytest.raises(ValueError):
        geo.to_wgs84("31", "1", "2")


def test_surface_polygone():
    # Carré d'environ 0,01° de côté près de Gagnoa : ~1,1 km × 1,1 km ≈ 122 ha
    g = {"type": "Polygon", "coordinates": [[[-5.95, 6.13], [-5.94, 6.13], [-5.94, 6.14], [-5.95, 6.14], [-5.95, 6.13]]]}
    assert 110 < geo.polygon_area_ha(g) < 135


def test_statut_a_une_date():
    evs = [ev("2026-09-22", "demantele"), ev("2026-10-01", "tentative_reprise")]
    assert ST.statut_at(evs, date(2026, 9, 1)) is None
    assert ST.statut_at(evs, date(2026, 9, 30)) == "demantele"
    assert ST.statut_at(evs, date(2026, 10, 1)) == "tentative_reprise"


def test_kpis_neutralisation_et_recolonisation():
    sites = [NS(id=i, superficie_ha=1.0) for i in "abcd"]
    evts = {
        "a": [ev("2026-01-01", "demantele")],
        "b": [ev("2026-01-01", "demantele"), ev("2026-02-01", "recolonise")],
        "c": [ev("2026-01-01", "tenu")],
        "d": [ev("2026-01-01", "actif")],
    }
    visites = [NS(date=date(2026, 5, 20), constat="tentative_reprise", saisies={}, interpelles=0, site_id="a")]
    k = ST.kpis(sites, evts, visites, {date(2026, 5, 30)}, [], date(2026, 6, 1))
    assert k["sites_recenses"] == 4
    assert k["sites_actifs"] == 2          # b recolonisé + d actif
    assert k["taux_neutralisation"] == 0.5
    assert k["recolonisation_eligibles"] == 2 and k["taux_recolonisation_3m"] == 0.5
    assert k["tentatives_reprise_30j"] == 1
    assert k["brq_7j"] == 1


def test_series_hebdomadaires():
    sites = [NS(id="a")]
    evts = {"a": [ev("2026-09-22", "demantele")]}
    visites = [NS(date=date(2026, 9, 30), constat="tenu", saisies={"motopompes": 2, "tuyaux_m": 50}, interpelles=1, site_id="a")]
    s = ST.series(sites, evts, visites, {date(2026, 9, 30)}, date(2026, 9, 22), date(2026, 10, 4))
    assert [w["semaine"] for w in s] == ["2026-09-21", "2026-09-28"]
    assert s[1]["saisies_total"] == 2      # les tuyaux (en mètres) ne sont pas comptés comme objets
    assert s[1]["par_statut"]["demantele"] == 1 and s[1]["jours_brq"] == 1


def test_limites_officielles_goh():
    import json
    from pathlib import Path
    chefs = json.loads((Path(__file__).resolve().parents[2] / "frontend/public/geo/chefs_lieux_goh.geojson").read_text(encoding="utf-8"))
    for f in chefs["features"]:
        lng, lat = f["geometry"]["coordinates"]
        lieu = geo.localiser(lat, lng)
        assert lieu == {"departement": f["properties"]["departement"], "sous_prefecture": f["properties"]["nom"]}, f["properties"]
        assert geo.controle_goh(lat, lng) == ""
    assert geo.localiser(5.35, -4.0) is None                       # Abidjan
    assert "hors" in geo.controle_goh(5.35, -4.0)
    assert sorted(geo.SP_PAR_DEPARTEMENT["Oumé"]) == ["Diégonéfla", "Guépahouo", "Oumé", "Tonla"]
    assert len(geo.SP_PAR_DEPARTEMENT["Gagnoa"]) == 12
    assert geo.controle_goh(6.359485, -5.277629) == ""              # FC Doka, 250 m hors du tracé régional
    assert geo.localiser(6.359485, -5.277629)["departement"] == "Oumé"
    assert "hors" in geo.controle_goh(5.292214, -6.37167)           # Behibrokro (rapport n°1), ~47 km au sud
