"""Outils géographiques : conversion des coordonnées, contrôle d'emprise, surfaces."""
import math
from typing import Optional

from pyproj import Transformer

# Emprise approximative de la Région du Gôh (Gagnoa et Oumé), utilisée pour signaler les erreurs.
GOH_BBOX = {"min_lat": 5.55, "max_lat": 6.75, "min_lng": -6.40, "max_lng": -5.10}

_TO_WGS = {
    "29": Transformer.from_crs(32629, 4326, always_xy=True),
    "30": Transformer.from_crs(32630, 4326, always_xy=True),
}
SYSTEMES = {"wgs": "WGS84 degrés décimaux", "29": "UTM zone 29N", "30": "UTM zone 30N"}


def parse_num(v) -> Optional[float]:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(" ", "").replace(" ", "").replace(",", "."))
    except ValueError:
        return None


def to_wgs84(sys: str, x, y) -> tuple[float, float]:
    """Renvoie (lat, lng). Pour « wgs », x = longitude et y = latitude."""
    xf, yf = parse_num(x), parse_num(y)
    if xf is None or yf is None:
        raise ValueError("Coordonnées manquantes ou illisibles")
    if sys == "wgs":
        lat, lng = yf, xf
    elif sys in _TO_WGS:
        lng, lat = _TO_WGS[sys].transform(xf, yf)
    else:
        raise ValueError(f"Système de coordonnées inconnu : {sys}")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError("Coordonnées hors limites")
    return round(lat, 6), round(lng, 6)


def controle_goh(lat: Optional[float], lng: Optional[float]) -> str:
    """Message d'alerte si le point sort de la région, sinon chaîne vide."""
    if lat is None or lng is None:
        return "Site non géolocalisé"
    b = GOH_BBOX
    if not (b["min_lat"] <= lat <= b["max_lat"] and b["min_lng"] <= lng <= b["max_lng"]):
        return "Point hors de la région du Gôh : vérifier la zone UTM ou une erreur de saisie"
    return ""


def _ring_area_m2(ring) -> float:
    r = 6_371_008.8
    total = 0.0
    for i in range(len(ring) - 1):
        lng1, lat1 = ring[i][0], ring[i][1]
        lng2, lat2 = ring[i + 1][0], ring[i + 1][1]
        total += math.radians(lng2 - lng1) * (2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2)))
    return abs(total * r * r / 2)


def polygon_area_ha(geom: dict) -> float:
    t = geom.get("type")
    if t == "Polygon":
        polys = [geom["coordinates"]]
    elif t == "MultiPolygon":
        polys = geom["coordinates"]
    else:
        raise ValueError("Le contour doit être un Polygon ou un MultiPolygon GeoJSON")
    a = sum(_ring_area_m2(p[0]) - sum(_ring_area_m2(h) for h in p[1:]) for p in polys)
    return round(a / 10_000, 2)


def extract_polygon(geojson: dict) -> dict:
    """Accepte Polygon, MultiPolygon, Feature ou FeatureCollection (premier polygone)."""
    t = geojson.get("type")
    if t == "FeatureCollection":
        for f in geojson.get("features", []):
            g = f.get("geometry") or {}
            if g.get("type") in ("Polygon", "MultiPolygon"):
                return {"type": g["type"], "coordinates": g["coordinates"]}
        raise ValueError("Aucun polygone dans le fichier")
    if t == "Feature":
        return extract_polygon(geojson.get("geometry") or {})
    if t in ("Polygon", "MultiPolygon"):
        return {"type": t, "coordinates": geojson["coordinates"]}
    raise ValueError("GeoJSON de contour non reconnu")
