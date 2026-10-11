# Conversion des shapefiles de la cellule (Shapes/*.shp, UTM 30N) en GeoJSON WGS84 pour la carte et l API.
# pip install pyshp shapely pyproj ; lancer depuis le dossier Shapes.
import shapefile, json, warnings
warnings.filterwarnings("ignore")
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform, unary_union, linemerge
T = Transformer.from_crs(32630, 4326, always_xy=True).transform
def lit(f):
    r = shapefile.Reader(f, encoding="utf-8")
    return [(transform(T, shape(s.__geo_interface__)), rec.as_dict()) for s, rec in zip(r.shapes(), r.records())]
def r6(g, tol):
    g = g.simplify(tol, preserve_topology=True) if tol else g
    j = json.loads(json.dumps(mapping(g)))
    def rd(c):
        return [rd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 6), round(c[1], 6)]
    j["coordinates"] = rd(j["coordinates"]); return j
def fc(feats): return {"type": "FeatureCollection", "features": feats}
P = "/home/claude/crloi-app/frontend/public/geo/"
TOL = 0.00008
sp = lit("Departements_goh.shp")
reg = lit("Region_goh.shp")[0][0].buffer(0)
spf = [{"type": "Feature", "properties": {"nom": a["ADM3_FR"], "departement": a["ADM2_FR"], "pcode": a["ADM3_PCODE"]}, "geometry": r6(g.buffer(0), TOL)} for g, a in sp]
deps = {}
for g, a in sp: deps.setdefault(a["ADM2_FR"], []).append(g.buffer(0))
depf = [{"type": "Feature", "properties": {"nom": d}, "geometry": r6(unary_union(gs).buffer(0), TOL)} for d, gs in deps.items()]
regf = [{"type": "Feature", "properties": {"nom": "Gôh"}, "geometry": r6(reg, TOL)}]
locf = [{"type": "Feature", "properties": {"nom": a["ADM3_FR"], "departement": a["ADM2_FR"], "rang": "département" if a["ADM3_FR"] in ("Gagnoa", "Oumé") else "sous-préfecture"}, "geometry": r6(g, 0)} for g, a in lit("localit#U00e9s_goh.shp")]
par = {}
for g, a in lit("Cours d'eau.shp"): par.setdefault(a["name"], []).append(g)
cef = []
for n, gs in par.items():
    u = unary_union(gs)
    m = linemerge(u) if u.geom_type == "MultiLineString" else u
    cef.append({"type": "Feature", "properties": {"nom": n}, "geometry": r6(m, 0.00003)})
for nom, feats in [("region_goh", regf), ("departements_goh", depf), ("sous_prefectures_goh", spf), ("chefs_lieux_goh", locf), ("cours_eau_goh", cef)]:
    json.dump(fc(feats), open(P + nom + ".geojson", "w"), ensure_ascii=False, separators=(",", ":"))
json.dump({"region": regf[0]["geometry"],
           "sous_prefectures": [{"nom": f["properties"]["nom"], "departement": f["properties"]["departement"], "geometrie": f["geometry"]} for f in spf],
           "cours_eau": [{"nom": f["properties"]["nom"], "trace": f["geometry"]} for f in cef]},
          open("/home/claude/crloi-app/backend/app/data/goh.json", "w"), ensure_ascii=False, separators=(",", ":"))
from pyproj import Geod
G = Geod(ellps="WGS84")
print("région km²", round(abs(G.geometry_area_perimeter(reg)[0]) / 1e6))
for f in depf: print("dép", f["properties"]["nom"], round(abs(G.geometry_area_perimeter(shape(f["geometry"]))[0]) / 1e6), "km²")
for f in cef: print("cours d'eau", f["properties"]["nom"], f["geometry"]["type"], round(G.geometry_length(shape(f["geometry"])) / 1000, 1), "km")
print("emprise", [round(x, 3) for x in reg.bounds])
