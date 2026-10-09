/* =====================================================================
   CRLOI GÔH — Géoportail : fonds de carte, couches de référence, palettes
   (repris de GestReb)
   ===================================================================== */
(function () {
  'use strict';
  const C = (window.CARTE = window.CARTE || {});

  // Projections UTM 29N / 30N (définies dans crloi.js) enregistrées auprès d'OpenLayers
  if (window.proj4) ol.proj.proj4.register(proj4);

  /* ---------------------------- Fonds ---------------------------------- */
  const xyz = (url, attributions, maxZoom = 19) =>
    new ol.source.XYZ({ url, attributions, maxZoom, crossOrigin: 'anonymous' });

  const ESRI = '© Esri, Maxar, Earthstar Geographics, GIS User Community';
  C.fonds = [
    {
      id: 'satellite',
      nom: 'Satellite',
      apercu: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/9/247/251',
      couches: () => [
        new ol.layer.Tile({ source: xyz('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', ESRI, 19) }),
      ],
    },
    {
      id: 'hybride',
      nom: 'Hybride',
      apercu: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/9/247/251',
      couches: () => [
        new ol.layer.Tile({ source: xyz('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', ESRI, 19) }),
        new ol.layer.Tile({
          source: xyz('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', ESRI, 19),
        }),
        new ol.layer.Tile({
          source: xyz('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', ESRI, 19),
          opacity: 0.7,
        }),
      ],
    },
    {
      id: 'osm',
      nom: 'OpenStreetMap',
      apercu: 'https://tile.openstreetmap.org/9/247/251.png',
      couches: () => [new ol.layer.Tile({ source: new ol.source.OSM({ crossOrigin: 'anonymous' }) })],
    },
    {
      id: 'topo',
      nom: 'Topographique',
      apercu: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/9/247/251',
      couches: () => [
        new ol.layer.Tile({ source: xyz('https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', '© Esri', 19) }),
      ],
    },
    {
      id: 'relief',
      nom: 'Relief',
      apercu: 'https://a.tile.opentopomap.org/9/247/251.png',
      couches: () => [
        new ol.layer.Tile({
          source: xyz('https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png', '© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA)', 17),
        }),
      ],
    },
    {
      id: 'clair',
      nom: 'Clair',
      apercu: 'https://a.basemaps.cartocdn.com/light_all/9/247/251.png',
      couches: () => [
        new ol.layer.Tile({ source: xyz('https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', '© OpenStreetMap · © CARTO', 20) }),
      ],
    },
    {
      id: 'sombre',
      nom: 'Sombre',
      apercu: 'https://a.basemaps.cartocdn.com/dark_all/9/247/251.png',
      couches: () => [
        new ol.layer.Tile({ source: xyz('https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', '© OpenStreetMap · © CARTO', 20) }),
      ],
    },
    {
      id: 'aucun',
      nom: 'Aucun fond',
      apercu: '',
      couches: () => [],
    },
  ];

  /* ------------------------ Couches de référence ----------------------- */
  const geojson = new ol.format.GeoJSON({ featureProjection: 'EPSG:3857' });
  const vecteur = (url) => new ol.source.Vector({ url, format: geojson });
  /** Couleurs des forêts classées selon leur statut (couche harmonisée du CG). */
  C.statutsForets = [
    { cle: 'FC', libelle: 'Forêt classée', couleur: '#15803d' },
    { cle: 'Agro-Foret', libelle: 'Agro-forêt', couleur: '#ca8a04' },
    { cle: '', libelle: 'Statut non renseigné', couleur: '#64748b' },
  ];
  const couleurStatut = (f) => (C.statutsForets.find((x) => x.cle === (f.get('statut') || '')) || C.statutsForets[2]).couleur;
  const sourceForets = new ol.source.Vector({ url: '/geo/forets_classees.geojson', format: geojson });
  C.sourceForets = sourceForets;

  C.references = [
    {
      id: 'forets',
      nom: 'Forêts classées',
      detail: 'Limites harmonisées du CG Gagnoa (19 forêts)',
      couleur: '#16a34a',
      visible: true,
      opacite: 1,
      legende: C.statutsForets.map((x) => ({ libelle: x.libelle, couleur: x.couleur })).concat([
        { libelle: 'Limites à matérialiser', couleur: '#64748b', pointille: true },
      ]),
      couche: () =>
        new ol.layer.Vector({
          source: sourceForets,
          zIndex: 2,
          declutter: true,
          style: (f, res) => {
            const c = couleurStatut(f);
            const limitesOk = f.get('limites') === 'Ok';
            return new ol.style.Style({
              fill: new ol.style.Fill({ color: C.rgba(c, 0.1) }),
              stroke: new ol.style.Stroke({ color: c, width: limitesOk ? 1.8 : 2.2, lineDash: limitesOk ? undefined : [8, 6] }),
              text:
                res < 400
                  ? new ol.style.Text({
                      text: `FC ${f.get('nom')}`,
                      font: '600 12px Inter, sans-serif',
                      fill: new ol.style.Fill({ color: '#052e16' }),
                      stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.9)', width: 3 }),
                      overflow: true,
                    })
                  : undefined,
            });
          },
        }),
    },
    {
      id: 'limite-cg',
      nom: 'Limite du CG Gagnoa',
      detail: 'Région du Gôh (Gagnoa, Oumé…)',
      couleur: '#7c3aed',
      ligne: true,
      visible: true,
      opacite: 1,
      couche: () =>
        new ol.layer.Vector({
          source: vecteur('/geo/cg_gagnoa_limite.geojson'),
          zIndex: 3,
          style: [
            new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.8)', width: 5 }) }),
            new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#7c3aed', width: 2.2, lineDash: [10, 6] }) }),
          ],
        }),
    },
    {
      id: 'ci',
      nom: "Côte d'Ivoire",
      detail: 'Limite nationale',
      couleur: '#334155',
      ligne: true,
      visible: false,
      opacite: 1,
      couche: () =>
        new ol.layer.Vector({
          source: vecteur('/geo/cote_ivoire.geojson'),
          zIndex: 1,
          style: new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#334155', width: 1.5 }) }),
        }),
    },
  ];

  /* ------------------------ Palettes thématiques ----------------------- */
  C.palette = [
    '#15803d', '#2563eb', '#d97706', '#9333ea', '#0891b2', '#dc2626', '#65a30d', '#db2777',
    '#0f766e', '#a16207', '#4338ca', '#be123c', '#047857', '#7c2d12', '#1d4ed8', '#86198f',
  ];

  C.couleursSequentielles = ['#d9f99d', '#a3e635', '#65a30d', '#3f6212', '#1a2e05'];

  /** Classes d'ancienneté du dernier constat (jours). */
  C.classesAnciennete = [
    { cle: 'a7', libelle: 'Moins de 7 jours', couleur: '#15803d', max: 7 },
    { cle: 'a30', libelle: '7 à 30 jours', couleur: '#84cc16', max: 30 },
    { cle: 'a90', libelle: '30 à 90 jours', couleur: '#eab308', max: 90 },
    { cle: 'a999', libelle: 'Plus de 90 jours', couleur: '#dc2626', max: Infinity },
  ];

  /** Convertit #rrggbb + opacité en rgba(). */
  C.rgba = (hex, a) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
})();
