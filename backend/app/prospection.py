"""Outils purs (sans GEE) de la prospection : géométrie, score de suspicion, exports GPS.

Repris du module de détection développé pour GestAlert (orpaillage_core.py).
"""
from __future__ import annotations

import math
from typing import Iterable, Optional
from xml.sax.saxutils import escape

R_TERRE_M = 6_371_008.8

PARAMETRES_DEFAUT = {
    "dndvi_min": 0.20,  # perte de végétation minimale (NDVI référence − NDVI récent)
    "bsi_min": 0.05,  # indice de sol nu minimal sur l'image récente
    "surface_min_ha": 0.5,  # surface minimale d'une zone suspecte
    "nuages_max": 60,  # % de nuages maximal par scène (le reste est masqué pixel par pixel)
    "tampon_eau_m": 1000,  # au-delà, la proximité d'un cours d'eau n'apporte plus de points
    "rayon_site_connu_m": 300,  # distance pour rattacher une zone à un site connu
}
NIVEAUX = (("forte", 0.70), ("moyenne", 0.45), ("faible", 0.0))
SURFACE_MAX_ZONE_HA = 750_000  # 7 500 km² : la région du Gôh entière (6 891 km²) passe


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_TERRE_M * math.asin(math.sqrt(a))


def anneaux_exterieurs(g: dict) -> list:
    if g["type"] == "Polygon":
        return [g["coordinates"][0]]
    if g["type"] == "MultiPolygon":
        return [p[0] for p in g["coordinates"]]
    return []


def _aire_anneau_m2(ring: list) -> float:
    if len(ring) < 4:
        return 0.0
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    kx = math.cos(lat0) * math.pi / 180 * R_TERRE_M
    ky = math.pi / 180 * R_TERRE_M
    pts = [(p[0] * kx, p[1] * ky) for p in ring]
    s = sum(pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1] for i in range(len(pts) - 1))
    return abs(s) / 2


def surface_ha(g: dict) -> float:
    if g["type"] == "Polygon":
        tot = _aire_anneau_m2(g["coordinates"][0]) - sum(_aire_anneau_m2(r) for r in g["coordinates"][1:])
    elif g["type"] == "MultiPolygon":
        tot = sum(_aire_anneau_m2(p[0]) - sum(_aire_anneau_m2(r) for r in p[1:]) for p in g["coordinates"])
    else:
        return 0.0
    return round(tot / 10_000, 3)


def centroide(g: dict) -> tuple[float, float]:
    """(lat, lng) : centroïde pondéré des anneaux extérieurs."""
    sx = sy = sa = 0.0
    for ring in anneaux_exterieurs(g):
        a = _aire_anneau_m2(ring) or 1e-9
        n = len(ring) - 1 if len(ring) > 1 and ring[0] == ring[-1] else len(ring)
        cx = sum(p[0] for p in ring[:n]) / max(1, n)
        cy = sum(p[1] for p in ring[:n]) / max(1, n)
        sx, sy, sa = sx + cx * a, sy + cy * a, sa + a
    if not sa:
        raise ValueError("Géométrie vide")
    return sy / sa, sx / sa


def normaliser_zone(gj: dict) -> dict:
    """Polygon / MultiPolygon à partir d'un GeoJSON (géométrie, Feature ou FeatureCollection)."""
    t = gj.get("type")
    if t in ("Polygon", "MultiPolygon"):
        return {"type": t, "coordinates": gj["coordinates"]}
    if t == "Feature":
        return normaliser_zone(gj.get("geometry") or {})
    if t == "FeatureCollection":
        polys = []
        for f in gj.get("features", []):
            g = (f or {}).get("geometry") or {}
            if g.get("type") == "Polygon":
                polys.append(g["coordinates"])
            elif g.get("type") == "MultiPolygon":
                polys.extend(g["coordinates"])
        if not polys:
            raise ValueError("Aucun polygone dans le fichier")
        return {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1 else {"type": "MultiPolygon", "coordinates": polys}
    raise ValueError("Format non reconnu : Polygon, MultiPolygon, Feature ou FeatureCollection attendu")


def _borne(x: float) -> float:
    return max(0.0, min(1.0, x))


def score_suspicion(dndvi: float, bsi: float, ndti: Optional[float], dist_eau_m: Optional[float], surface: float,
                    tampon_eau_m: float = 1000, site_connu_proche: bool = False) -> float:
    """Score 0-1 : perte de végétation 35 %, sol nu 25 %, eau turbide 10 %, proximité d'un cours d'eau 20 %,
    surface 10 %. Un site connu à proximité ajoute 0,10."""
    s_veg = _borne((dndvi or 0) / 0.5)
    s_nu = _borne(((bsi or 0) + 0.05) / 0.35)
    s_turb = _borne((ndti or 0) / 0.2)
    s_eau = 0.3 if dist_eau_m is None else _borne(1 - max(0.0, dist_eau_m - 100) / max(1.0, tampon_eau_m - 100))
    s_surf = _borne(surface / 5.0)
    score = 0.35 * s_veg + 0.25 * s_nu + 0.10 * s_turb + 0.20 * s_eau + 0.10 * s_surf + (0.10 if site_connu_proche else 0)
    return round(_borne(score), 3)


def niveau(score: Optional[float]) -> str:
    if score is None:
        return "moyenne"
    for nom, seuil in NIVEAUX:
        if score >= seuil:
            return nom
    return "faible"


def site_le_plus_proche(lat: float, lng: float, sites: Iterable) -> tuple[Optional[object], Optional[float]]:
    meilleur, d_min = None, None
    for s in sites:
        if s.lat is None or s.lng is None:
            continue
        d = haversine_m(lat, lng, s.lat, s.lng)
        if d_min is None or d < d_min:
            meilleur, d_min = s, d
    return meilleur, d_min


LIBELLE_STATUT = {"a_verifier": "À vérifier", "programmee": "Mission programmée", "confirmee": "Confirmée (terrain)",
                  "infirmee": "Infirmée (terrain)", "ecartee": "Écartée"}


def vers_gpx(points: list[dict], titre: str) -> str:
    """Points de passage pour GPS (Garmin…) : un point par zone (centroïde)."""
    parts = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<gpx version="1.1" creator="CRLOI Goh" xmlns="http://www.topografix.com/GPX/1/1">',
             f"<metadata><name>{escape(titre)}</name></metadata>"]
    for p in points:
        parts.append(f'<wpt lat="{p["lat"]:.6f}" lon="{p["lng"]:.6f}"><name>{escape(p["code"])}</name>'
                     f"<desc>{escape(p.get('description', ''))}</desc></wpt>")
    parts.append("</gpx>")
    return "".join(parts)


def vers_kml(points: list[dict], titre: str) -> str:
    couleurs = {"forte": "ff1c1cdc", "moyenne": "ff0b9ef5", "faible": "ff16cc84"}
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
             f"<name>{escape(titre)}</name>"]
    for n, c in couleurs.items():
        parts.append(f'<Style id="{n}"><LineStyle><color>{c}</color><width>2</width></LineStyle>'
                     f"<PolyStyle><color>55{c[2:]}</color></PolyStyle></Style>")
    for p in points:
        polys = "".join(
            "<Polygon><outerBoundaryIs><LinearRing><coordinates>" + " ".join(f"{q[0]},{q[1]},0" for q in ring)
            + "</coordinates></LinearRing></outerBoundaryIs></Polygon>"
            for ring in anneaux_exterieurs(p["geometrie"]) if p.get("geometrie")
        )
        parts.append(f"<Placemark><name>{escape(p['code'])}</name><description>{escape(p.get('description', ''))}</description>"
                     f"<styleUrl>#{p.get('niveau', 'moyenne')}</styleUrl><MultiGeometry>"
                     f"<Point><coordinates>{p['lng']},{p['lat']},0</coordinates></Point>{polys}</MultiGeometry></Placemark>")
    parts.append("</Document></kml>")
    return "".join(parts)
