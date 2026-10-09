"""Google Earth Engine : couches d'imagerie (Sentinel-2 / Landsat, indices) et prospection des zones suspectes.

Identification par compte de service Google, au choix :
- GEE_SERVICE_ACCOUNT_JSON : contenu complet du fichier de clé JSON (Render : variable d'environnement) ;
- GEE_PRIVATE_KEY_FILE : chemin du fichier de clé (poste local).
GEE_PROJECT est facultatif (à défaut : project_id de la clé). La clé ne doit jamais être versionnée.

Méthode de prospection (Sentinel-2 niveau 2A, 10 m) — reprise du module GestAlert :
1. composites médians sans nuages sur une période de référence et une période récente ;
2. indices NDVI (végétation), BSI (sol nu), MNDWI (eau), NDTI (turbidité) ;
3. pixels candidats : forte perte de végétation ET sol nu ou bassin d'eau turbide sur l'image récente,
   hors bâti (ESA WorldCover) et hors eau permanente (JRC) ;
4. regroupement des pixels en polygones, surface minimale, indices moyens et distance à l'eau.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Optional

_init_ok = False
_verrou = threading.Lock()
_cache_couches: dict = {}  # clé -> (expiration, résultat)

# Emprise de travail : région du Gôh avec une marge (les couches sont découpées sur cette emprise).
EMPRISE_GOH = [-6.55, 5.45, -4.95, 6.85]  # ouest, sud, est, nord


def _cle() -> Optional[dict]:
    brut = os.environ.get("GEE_SERVICE_ACCOUNT_JSON", "").strip()
    if brut:
        return json.loads(brut)
    chemin = os.environ.get("GEE_PRIVATE_KEY_FILE")
    if chemin and os.path.isfile(chemin):
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    return None


def configure() -> bool:
    try:
        k = _cle()
    except (ValueError, OSError):
        return False
    return bool(k and k.get("type") == "service_account" and k.get("private_key") and k.get("client_email"))


def identite() -> Optional[dict]:
    """Compte et projet utilisés, sans aucun secret."""
    if not configure():
        return None
    k = _cle()
    return {"compte": k["client_email"], "projet": os.environ.get("GEE_PROJECT") or k.get("project_id")}


def _init():
    global _init_ok
    if _init_ok:
        return
    with _verrou:
        if _init_ok:
            return
        import ee
        from google.oauth2 import service_account

        k = _cle()
        if not k:
            raise RuntimeError("Google Earth Engine n'est pas configuré : ajoutez la variable GEE_SERVICE_ACCOUNT_JSON sur le serveur.")
        creds = service_account.Credentials.from_service_account_info(
            k, scopes=["https://www.googleapis.com/auth/earthengine", "https://www.googleapis.com/auth/cloud-platform"])
        ee.Initialize(creds, project=os.environ.get("GEE_PROJECT") or k.get("project_id"))
        _init_ok = True


def verifier() -> dict:
    """Test de connexion : nombre de scènes Sentinel-2 récentes sur Gagnoa."""
    _init()
    import ee

    pt = ee.Geometry.Point([-5.95, 6.13])
    n = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(pt).filterDate(
        ee.Date(int(time.time() * 1000)).advance(-60, "day"), ee.Date(int(time.time() * 1000))).size().getInfo()
    return {"ok": True, "scenes_sentinel2_60j_gagnoa": n, **(identite() or {})}


# ------------------------------------------------------------------ composites
def _s2(ee, region, du: str, au: str, nuages: float):
    col = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(region).filterDate(du, au)
           .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", nuages)))

    def masque(img):
        scl = img.select("SCL")
        ok = scl.neq(3).And(scl.neq(8)).And(scl.neq(9)).And(scl.neq(10)).And(scl.neq(11))
        return img.select(["B2", "B3", "B4", "B8", "B11", "B12"], ["bleu", "vert", "rouge", "pir", "swir1", "swir2"]).updateMask(ok).divide(10000)

    return col.map(masque).median(), col


def _landsat(ee, region, du: str, au: str, nuages: float):
    def prep(img):
        qa = img.select("QA_PIXEL")
        ok = qa.bitwiseAnd(1 << 3).eq(0).And(qa.bitwiseAnd(1 << 4).eq(0))
        opt = img.select(["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7"], ["bleu", "vert", "rouge", "pir", "swir1", "swir2"])
        return opt.multiply(0.0000275).add(-0.2).updateMask(ok)

    def prep7(img):
        qa = img.select("QA_PIXEL")
        ok = qa.bitwiseAnd(1 << 3).eq(0).And(qa.bitwiseAnd(1 << 4).eq(0))
        opt = img.select(["SR_B1", "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B7"], ["bleu", "vert", "rouge", "pir", "swir1", "swir2"])
        return opt.multiply(0.0000275).add(-0.2).updateMask(ok)

    l89 = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2").merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
    l89 = l89.filterBounds(region).filterDate(du, au).filter(ee.Filter.lt("CLOUD_COVER", nuages)).map(prep)
    l57 = ee.ImageCollection("LANDSAT/LE07/C02/T1_L2").merge(ee.ImageCollection("LANDSAT/LT05/C02/T1_L2"))
    l57 = l57.filterBounds(region).filterDate(du, au).filter(ee.Filter.lt("CLOUD_COVER", nuages)).map(prep7)
    col = l89.merge(l57)
    return col.median(), col


def _composite(ee, region, du: str, au: str, nuages: float, capteur: str):
    if capteur == "auto":
        capteur = "landsat" if au < "2019-01-01" else "sentinel2"
    img, col = (_landsat if capteur == "landsat" else _s2)(ee, region, du, au, nuages)
    return img, col, capteur


def _indices(img):
    ndvi = img.normalizedDifference(["pir", "rouge"]).rename("ndvi")
    bsi = img.expression("((S + R) - (N + B)) / ((S + R) + (N + B))",
                         {"S": img.select("swir1"), "R": img.select("rouge"), "N": img.select("pir"), "B": img.select("bleu")}).rename("bsi")
    mndwi = img.normalizedDifference(["vert", "swir1"]).rename("mndwi")
    ndti = img.normalizedDifference(["rouge", "vert"]).rename("ndti")
    return ndvi.addBands([bsi, mndwi, ndti])


# ------------------------------------------------------------------ couches d'imagerie
PRODUITS = {
    "couleurs": {"libelle": "Couleurs naturelles", "bandes": ["rouge", "vert", "bleu"], "min": 0, "max": 0.3, "gamma": 1.3},
    "fausses_couleurs": {"libelle": "Fausses couleurs (végétation en rouge)", "bandes": ["pir", "rouge", "vert"], "min": 0, "max": 0.45},
    "swir": {"libelle": "Infrarouge court (sols remaniés, eau)", "bandes": ["swir1", "pir", "rouge"], "min": 0, "max": 0.45},
    "ndvi": {"libelle": "NDVI — végétation", "indice": "ndvi", "min": -0.1, "max": 0.85,
             "palette": ["7f3b08", "b35806", "e08214", "fdb863", "fee0b6", "d9f0a3", "addd8e", "78c679", "31a354", "006837"]},
    "bsi": {"libelle": "BSI — sol nu", "indice": "bsi", "min": -0.3, "max": 0.3,
            "palette": ["1a9850", "91cf60", "d9ef8b", "fee08b", "fc8d59", "d73027"]},
    "mndwi": {"libelle": "MNDWI — eau et bassins", "indice": "mndwi", "min": -0.5, "max": 0.5,
              "palette": ["f7fbff", "c6dbef", "6baed6", "2171b5", "08306b"]},
    "ndti": {"libelle": "NDTI — turbidité de l'eau", "indice": "ndti", "min": -0.2, "max": 0.25,
             "palette": ["0570b0", "74a9cf", "fef0d9", "fc8d59", "b30000"], "eau_seulement": True},
    "dndvi": {"libelle": "Perte de végétation (NDVI référence − récent)", "difference": True, "min": 0.1, "max": 0.5,
              "palette": ["ffffb2", "fecc5c", "fd8d3c", "f03b20", "bd0026"]},
}


def couche(produit: str, du: str, au: str, ref_du: Optional[str] = None, ref_au: Optional[str] = None,
           nuages: float = 60, capteur: str = "auto") -> dict:
    """Renvoie l'URL de tuiles XYZ d'un composite GEE et sa légende."""
    if produit not in PRODUITS:
        raise ValueError("Produit inconnu")
    p = PRODUITS[produit]
    if p.get("difference") and not (ref_du and ref_au):
        raise ValueError("La perte de végétation demande une période de référence")
    cle = json.dumps([produit, du, au, ref_du, ref_au, nuages, capteur])
    deja = _cache_couches.get(cle)
    if deja and deja[0] > time.time():
        return deja[1]
    _init()
    import ee

    region = ee.Geometry.Rectangle(EMPRISE_GOH)
    img, col, capt = _composite(ee, region, du, au, nuages, capteur)
    n = col.size().getInfo()
    if not n:
        raise RuntimeError("Aucune image exploitable sur cette période (nuages). Élargissez la période ou le seuil de nuages.")
    vis = {"min": p["min"], "max": p["max"]}
    if "bandes" in p:
        image = img.select(p["bandes"])
        vis["bands"] = p["bandes"]
        if p.get("gamma"):
            vis["gamma"] = p["gamma"]
    elif p.get("difference"):
        ref, col_ref, _ = _composite(ee, region, ref_du, ref_au, nuages, capt)
        if not col_ref.size().getInfo():
            raise RuntimeError("Aucune image exploitable sur la période de référence.")
        d = _indices(ref).select("ndvi").subtract(_indices(img).select("ndvi"))
        image = d.updateMask(d.gte(p["min"]))
        vis["palette"] = p["palette"]
    else:
        ind = _indices(img).select(p["indice"])
        if p.get("eau_seulement"):
            ind = ind.updateMask(_indices(img).select("mndwi").gt(0))
        image = ind
        vis["palette"] = p["palette"]
    m = image.clip(region).getMapId(vis)
    res = {
        "url": m["tile_fetcher"].url_format,
        "produit": produit,
        "libelle": p["libelle"],
        "capteur": "Landsat 5-9 (30 m)" if capt == "landsat" else "Sentinel-2 (10 m)",
        "images": n,
        "du": du,
        "au": au,
        "legende": {"min": p["min"], "max": p["max"], "palette": ["#" + c for c in p.get("palette", [])]},
    }
    _cache_couches[cle] = (time.time() + 4 * 3600, res)
    return res


# ------------------------------------------------------------------ prospection
def detecter(zone: dict, ref: tuple[str, str], recent: tuple[str, str], params: dict, max_zones: int = 400) -> dict:
    """Zones candidates (géométrie GeoJSON + indices moyens) et nombre de scènes utilisées."""
    _init()
    import ee

    aoi = ee.Geometry(zone)
    nuages = float(params.get("nuages_max", 60))
    ref_img, ref_col = _s2(ee, aoi, ref[0], ref[1], nuages)
    rec_img, rec_col = _s2(ee, aoi, recent[0], recent[1], nuages)
    n_ref, n_rec = ref_col.size().getInfo(), rec_col.size().getInfo()
    if not n_ref or not n_rec:
        raise RuntimeError(f"Pas assez d'images Sentinel-2 exploitables (référence : {n_ref}, récente : {n_rec}). "
                           "Élargissez les périodes ou augmentez le seuil de nuages.")
    i_ref, i_rec = _indices(ref_img.clip(aoi)), _indices(rec_img.clip(aoi))
    dndvi = i_ref.select("ndvi").subtract(i_rec.select("ndvi")).rename("dndvi")
    perte = dndvi.gte(float(params.get("dndvi_min", 0.2)))
    vegetalise = i_ref.select("ndvi").gte(0.4)
    nu = i_rec.select("bsi").gte(float(params.get("bsi_min", 0.05)))
    bassin = i_rec.select("mndwi").gt(0).And(i_rec.select("ndti").gt(0))
    non_bati = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map").neq(50)
    gsw = ee.Image("JRC/GSW1_4/GlobalSurfaceWater")
    non_eau_perm = gsw.select("occurrence").unmask(0).lt(80)
    cand = perte.And(vegetalise).And(nu.Or(bassin)).And(non_bati).And(non_eau_perm).selfMask()
    px_min = max(1, int(round(float(params.get("surface_min_ha", 0.5)) * 100)))
    # Le comptage ne doit aller que jusqu'au seuil : un maxSize de 1024 oblige Earth Engine à charger
    # des voisinages de plus de 2 000 pixels de côté (erreur « Output of image computation is too large »).
    taille_max = int(min(1024, max(64, px_min * 2)))
    cand = cand.updateMask(cand.connectedPixelCount(maxSize=taille_max, eightConnected=True).gte(px_min))
    eau = gsw.select("max_extent").unmask(0).gt(0).Or(i_rec.select("mndwi").gt(0.2))
    # Distance à l'eau calculée à 30 m sur un voisinage de 64 pixels (≈ 2 km, au-delà le score ne change plus) :
    # un voisinage de 512 pixels à 10 m dépasse la mémoire autorisée par Earth Engine.
    eau30 = eau.reproject(crs="EPSG:32630", scale=30)
    dist = eau30.fastDistanceTransform(64).sqrt().multiply(30).rename("dist_eau_m")
    pile = dndvi.addBands(i_rec.select(["bsi", "mndwi", "ndti"])).addBands(dist)

    def vectoriser(echelle: int, morceaux: int):
        # Une seule passe : la première bande (zone candidate) délimite les polygones,
        # les bandes suivantes sont moyennées dans chaque polygone.
        return cand.rename("zone").addBands(pile).reduceToVectors(
            geometry=aoi, scale=echelle, crs="EPSG:32630", geometryType="polygon", eightConnected=True,
            labelProperty="zone", reducer=ee.Reducer.mean().forEach(["dndvi", "bsi", "mndwi", "ndti", "dist_eau_m"]),
            maxPixels=1e13, tileScale=morceaux,
        ).limit(max_zones).getInfo()

    try:
        stats = vectoriser(10, 16)
    except Exception as e:  # noqa: BLE001
        if "too large" not in str(e) and "memory" not in str(e).lower() and "timed out" not in str(e).lower():
            raise
        # Zone très étendue : on repasse à 20 m (polygones un peu moins fins, même détection)
        stats = vectoriser(20, 16)

    def r(v, nd=3):
        return None if v is None else round(float(v), nd)

    zones = []
    for f in stats.get("features", []):
        p = f.get("properties", {})
        zones.append({"geometrie": f["geometry"], "indices": {"dndvi": r(p.get("dndvi")), "bsi": r(p.get("bsi")), "mndwi": r(p.get("mndwi")),
                                                              "ndti": r(p.get("ndti")), "dist_eau_m": r(p.get("dist_eau_m"), 0)}})
    return {"zones": zones, "images": {"reference": n_ref, "recente": n_rec, "source": "Sentinel-2 SR (10 m)"}}
