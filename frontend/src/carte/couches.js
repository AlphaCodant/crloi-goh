/* =====================================================================
   CRLOI Gôh — Carte : fonds, couches de référence, palettes
   (repris du géoportail GestReb)
   ===================================================================== */
import proj4 from "proj4";

const ol = window.ol;

// Projections UTM utilisées dans le Gôh : 29N (ouest, Sérihio) et 30N (est, Oumé, Gagnoa)
proj4.defs("EPSG:32629", "+proj=utm +zone=29 +datum=WGS84 +units=m +no_defs +type=crs");
proj4.defs("EPSG:32630", "+proj=utm +zone=30 +datum=WGS84 +units=m +no_defs +type=crs");
ol.proj.proj4.register(proj4);

export const rgba = (hex, a) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/* ---------------------------- Fonds ---------------------------------- */
const xyz = (url, attributions, maxZoom = 19) => new ol.source.XYZ({ url, attributions, maxZoom, crossOrigin: "anonymous" });
const ESRI = "© Esri, Maxar, Earthstar Geographics, GIS User Community";
const ESRI_IMG = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
// Tuile d'aperçu centrée sur le Gôh (z9)
const T = { z: 9, x: 247, y: 247 };

export const fonds = [
  {
    id: "satellite",
    nom: "Satellite",
    apercu: `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${T.z}/${T.y}/${T.x}`,
    couches: () => [new ol.layer.Tile({ source: xyz(ESRI_IMG, ESRI, 19) })],
  },
  {
    id: "hybride",
    nom: "Hybride",
    apercu: `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${T.z}/${T.y}/${T.x}`,
    couches: () => [
      new ol.layer.Tile({ source: xyz(ESRI_IMG, ESRI, 19) }),
      new ol.layer.Tile({ source: xyz("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", ESRI, 19) }),
      new ol.layer.Tile({ source: xyz("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", ESRI, 19), opacity: 0.7 }),
    ],
  },
  {
    id: "sentinel",
    nom: "Sentinel-2",
    detail: "Mosaïque sans nuages EOX",
    apercu: `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/${T.z}/${T.y}/${T.x}.jpg`,
    couches: () => [
      new ol.layer.Tile({
        source: xyz(
          "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg",
          'Sentinel-2 cloudless 2023 — <a href="https://s2maps.eu" target="_blank" rel="noopener">s2maps.eu</a> par EOX (données Copernicus Sentinel modifiées)',
          15
        ),
      }),
    ],
  },
  {
    id: "osm",
    nom: "OpenStreetMap",
    apercu: `https://tile.openstreetmap.org/${T.z}/${T.x}/${T.y}.png`,
    couches: () => [new ol.layer.Tile({ source: new ol.source.OSM({ crossOrigin: "anonymous" }) })],
  },
  {
    id: "topo",
    nom: "Topographique",
    apercu: `https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${T.z}/${T.y}/${T.x}`,
    couches: () => [new ol.layer.Tile({ source: xyz("https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", "© Esri", 19) })],
  },
  {
    id: "relief",
    nom: "Relief",
    apercu: `https://a.tile.opentopomap.org/${T.z}/${T.x}/${T.y}.png`,
    couches: () => [new ol.layer.Tile({ source: xyz("https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png", "© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA)", 17) })],
  },
  {
    id: "clair",
    nom: "Clair",
    apercu: `https://a.basemaps.cartocdn.com/light_all/${T.z}/${T.x}/${T.y}.png`,
    couches: () => [new ol.layer.Tile({ source: xyz("https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", "© OpenStreetMap · © CARTO", 20) })],
  },
  { id: "aucun", nom: "Aucun fond", apercu: "", couches: () => [] },
];

/* ------------------------ Couches de référence ----------------------- */
const geojson = new ol.format.GeoJSON({ featureProjection: "EPSG:3857" });
const vecteur = (url) => new ol.source.Vector({ url, format: geojson });

export const statutsForets = [
  { cle: "FC", libelle: "Forêt classée", couleur: "#15803d" },
  { cle: "Agro-Foret", libelle: "Agro-forêt", couleur: "#ca8a04" },
  { cle: "", libelle: "Statut non renseigné", couleur: "#64748b" },
];
const couleurStatutForet = (f) => (statutsForets.find((x) => x.cle === (f.get("statut") || "")) || statutsForets[2]).couleur;

export const sourceForets = new ol.source.Vector({ url: "/geo/forets_classees.geojson", format: geojson });
export const sourceCoursEau = new ol.source.Vector();
export const sourceZones = new ol.source.Vector();

export const INTENSITES = {
  tres_impacte: { libelle: "Très impacté", couleur: "#b91c1c", largeur: 4 },
  impacte: { libelle: "Impacté", couleur: "#ea580c", largeur: 3 },
  faible: { libelle: "Faiblement impacté", couleur: "#0284c7", largeur: 2.5 },
  "": { libelle: "Non évalué", couleur: "#0369a1", largeur: 2 },
};

export function references() {
  return [
    {
      id: "forets",
      nom: "Forêts classées",
      detail: "Limites harmonisées du CG Gagnoa (19 forêts)",
      couleur: "#16a34a",
      visible: true,
      opacite: 1,
      legende: statutsForets.map((x) => ({ libelle: x.libelle, couleur: x.couleur })).concat([{ libelle: "Limites à matérialiser", couleur: "#64748b", pointille: true }]),
      couche: () =>
        new ol.layer.Vector({
          source: sourceForets,
          zIndex: 2,
          declutter: true,
          style: (f, res) => {
            const c = couleurStatutForet(f);
            const ok = f.get("limites") === "Ok";
            return new ol.style.Style({
              fill: new ol.style.Fill({ color: rgba(c, 0.08) }),
              stroke: new ol.style.Stroke({ color: c, width: ok ? 1.8 : 2.2, lineDash: ok ? undefined : [8, 6] }),
              text:
                res < 400
                  ? new ol.style.Text({
                      text: `FC ${f.get("nom")}`,
                      font: "600 12px 'Inter Variable', Inter, sans-serif",
                      fill: new ol.style.Fill({ color: "#052e16" }),
                      stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.9)", width: 3 }),
                      overflow: true,
                    })
                  : undefined,
            });
          },
        }),
    },
    {
      id: "cours-eau",
      nom: "Cours d'eau",
      detail: "Tracés et niveau d'impact",
      couleur: "#0284c7",
      ligne: true,
      visible: true,
      opacite: 1,
      legende: Object.entries(INTENSITES)
        .filter(([k]) => k)
        .map(([, v]) => ({ libelle: v.libelle, couleur: v.couleur, ligne: true })),
      couche: () =>
        new ol.layer.Vector({
          source: sourceCoursEau,
          zIndex: 5,
          declutter: true,
          style: (f, res) => {
            const i = INTENSITES[f.get("intensite") || ""] || INTENSITES[""];
            return [
              new ol.style.Style({ stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.85)", width: i.largeur + 3 }) }),
              new ol.style.Style({
                stroke: new ol.style.Stroke({ color: i.couleur, width: i.largeur }),
                text:
                  res < 120
                    ? new ol.style.Text({
                        text: f.get("nom"),
                        placement: "line",
                        font: "italic 600 12px 'Inter Variable', Inter, sans-serif",
                        fill: new ol.style.Fill({ color: "#0c4a6e" }),
                        stroke: new ol.style.Stroke({ color: "#fff", width: 3 }),
                      })
                    : undefined,
              }),
            ];
          },
        }),
    },
    {
      id: "limite-cg",
      nom: "Limite du CG Gagnoa",
      detail: "Centre de Gestion SODEFOR",
      couleur: "#7c3aed",
      ligne: true,
      visible: true,
      opacite: 1,
      couche: () =>
        new ol.layer.Vector({
          source: vecteur("/geo/cg_gagnoa_limite.geojson"),
          zIndex: 3,
          style: [
            new ol.style.Style({ stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.8)", width: 5 }) }),
            new ol.style.Style({ stroke: new ol.style.Stroke({ color: "#7c3aed", width: 2.2, lineDash: [10, 6] }) }),
          ],
        }),
    },
    {
      id: "zones",
      nom: "Zones de travail",
      detail: "Emprises définies par la cellule",
      couleur: "#be185d",
      ligne: true,
      visible: false,
      opacite: 1,
      couche: () =>
        new ol.layer.Vector({
          source: sourceZones,
          zIndex: 3,
          style: (f) =>
            new ol.style.Style({
              stroke: new ol.style.Stroke({ color: "#be185d", width: 2, lineDash: f.get("approximative") ? [4, 6] : undefined }),
              text: new ol.style.Text({
                text: f.get("nom"),
                font: "600 12px 'Inter Variable', Inter, sans-serif",
                fill: new ol.style.Fill({ color: "#831843" }),
                stroke: new ol.style.Stroke({ color: "#fff", width: 3 }),
                overflow: true,
              }),
            }),
        }),
    },
    {
      id: "ci",
      nom: "Côte d'Ivoire",
      detail: "Limite nationale",
      couleur: "#334155",
      ligne: true,
      visible: false,
      opacite: 1,
      couche: () =>
        new ol.layer.Vector({
          source: vecteur("/geo/cote_ivoire.geojson"),
          zIndex: 1,
          style: new ol.style.Style({ stroke: new ol.style.Stroke({ color: "#334155", width: 1.5 }) }),
        }),
    },
  ];
}

/* ------------------------ Palettes thématiques ----------------------- */
export const palette = ["#15803d", "#2563eb", "#d97706", "#9333ea", "#0891b2", "#dc2626", "#65a30d", "#db2777", "#0f766e", "#a16207", "#4338ca", "#be123c", "#047857", "#7c2d12", "#1d4ed8", "#86198f"];

export const STATUTS = [
  { cle: "actif", libelle: "Actif", couleur: "#dc2626" },
  { cle: "recolonise", libelle: "Recolonisé", couleur: "#9d174d" },
  { cle: "tentative_reprise", libelle: "Tentative de reprise", couleur: "#ea580c" },
  { cle: "demantele", libelle: "Démantelé", couleur: "#2563eb" },
  { cle: "tenu", libelle: "Tenu (non recolonisé)", couleur: "#15803d" },
  { cle: "inconnu", libelle: "Pas encore recensé", couleur: "#94a3b8" },
];

export const STATUTS_FICHE = [
  { cle: "a_verifier", libelle: "À vérifier", couleur: "#d97706" },
  { cle: "en_cours", libelle: "Vérification en cours", couleur: "#2563eb" },
  { cle: "confirmee", libelle: "Confirmée", couleur: "#dc2626" },
  { cle: "infirmee", libelle: "Infirmée", couleur: "#64748b" },
  { cle: "exploitee", libelle: "Exploitée", couleur: "#15803d" },
];

export const couleursSequentielles = ["#fde68a", "#fbbf24", "#f97316", "#dc2626", "#7f1d1d"];
