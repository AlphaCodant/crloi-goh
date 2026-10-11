/* =====================================================================
   CRLOI Gôh — Géoportail de la cellule renseignement
   Carte, sites, filtres, analyse thématique, légende, recherche,
   fenêtre d'information, table attributaire et frise temporelle.
   Architecture et ergonomie reprises de la carte interactive GestReb.
   ===================================================================== */
import GR from "../gr/gr";
import { api } from "../api";
import { gabarit } from "./gabarit";
import * as K from "./couches";
import { initOutils } from "./outils";
import { initEdition } from "./edition";
import { initImagerie } from "./imagerie";
import { initProspection } from "./prospection";

const ol = window.ol;
const { esc, fmt, $, $$ } = GR;

const ZOOM_POLYGONES = 11;
const ACCUEIL = { centre: [-5.81, 6.15], zoom: 9 }; // centre de la région du Gôh
const JOUR = 864e5;

const stock = {
  get(k, d) {
    try {
      const v = localStorage.getItem(`crloi.carte.${k}`);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`crloi.carte.${k}`, JSON.stringify(v));
    } catch {
      /* stockage indisponible */
    }
  },
};

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const aujourdhui = () => iso(new Date());
const ajouterJours = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * JOUR).toISOString().slice(0, 10);
const ecartJours = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / JOUR);
const dateFr = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");
const majuscule = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const LIB_DOMAINE = { rural: "Domaine rural", foret_classee: "Forêt classée" };
const LIB_SOURCE = { rapport: "Rapport", brq: "BRQ", fiche: "Fiche de renseignement", satellite: "Image satellite", drone: "Drone", saisie: "Saisie" };
const STATUT = Object.fromEntries(K.STATUTS.map((s) => [s.cle, s]));
const STATUT_FICHE = Object.fromEntries(K.STATUTS_FICHE.map((s) => [s.cle, s]));
const CLASSES_ANCIENNETE = [
  { cle: "0", libelle: "Constat de moins de 8 jours", couleur: "#15803d", max: 7 },
  { cle: "1", libelle: "8 à 30 jours", couleur: "#84cc16", max: 30 },
  { cle: "2", libelle: "31 à 90 jours", couleur: "#eab308", max: 90 },
  { cle: "3", libelle: "Plus de 90 jours", couleur: "#dc2626", max: Infinity },
  { cle: "x", libelle: "Aucun constat à cette date", couleur: "#94a3b8" },
];

/**
 * Monte la carte dans `racine`.
 * ctx : { user, date, setDate(iso), departement, setDepartement(v), naviguer(chemin), deconnexion(), siteCible }
 * Renvoie une fonction de démontage.
 */
export function initCarte(racine, ctx) {
  const abandon = new AbortController();
  const signal = abandon.signal;
  const minuteries = new Set();
  const ecoute = (cible, type, fn, opts = {}) => cible.addEventListener(type, fn, { ...opts, signal });

  racine.innerHTML = gabarit({ user: ctx.user });
  document.body.classList.add("geo");

  const C = {};

  /* ============================ État ================================= */
  const E = (C.etat = {
    date: ctx.date || aujourdhui(),
    filtres: {
      departements: ctx.departement ? [ctx.departement] : ["Gagnoa", "Oumé"],
      statuts: [],
      domaines: [],
      forets: [],
      sp: [],
      cours: [],
      priorites: [],
    },
    criteres: [],
    mode: "ET",
    requeteActive: false,
    theme: stock.get("theme", "statut"),
    opacite: stock.get("opacite", 0.65),
    etiquettes: stock.get("etiquettes", true),
    contours: true,
    regroupement: stock.get("regroupement", true),
    categories: new Map(),
    masquees: new Set(),
    selection: new Set(),
    survol: null,
    sites: [],
    fiches: [],
    borneMin: aujourdhui(),
  });

  /* ============================ Carte ================================ */
  const view = new ol.View({ center: ol.proj.fromLonLat(ACCUEIL.centre), zoom: ACCUEIL.zoom, minZoom: 5, maxZoom: 20 });
  const groupeFond = new ol.layer.Group({ layers: [], zIndex: 0 });
  const map = (C.map = new ol.Map({
    target: $("#map", racine),
    view,
    layers: [groupeFond],
    controls: [new ol.control.Attribution({ collapsible: true, collapsed: true })],
  }));
  map.addControl(new ol.control.ScaleLine({ units: "metric", target: $("#echelle", racine), minWidth: 80 }));
  map.addControl(
    new ol.control.OverviewMap({
      collapsed: stock.get("situation-repliee", false),
      layers: [new ol.layer.Tile({ source: new ol.source.OSM() })],
      tipLabel: "Carte de situation",
      label: "«",
      collapseLabel: "»",
    })
  );

  /* ------------------------ Fonds de carte --------------------------- */
  function choisirFond(id) {
    const def = K.fonds.find((f) => f.id === id) || K.fonds[0];
    groupeFond.setLayers(new ol.Collection(def.couches()));
    $$(".basemap", racine).forEach((b) => b.classList.toggle("active", b.dataset.id === def.id));
    stock.set("fond", def.id);
  }
  $("#fonds", racine).innerHTML = K.fonds
    .map(
      (f) => `<button class="basemap" data-id="${f.id}" title="${esc(f.detail || f.nom)}">${
        f.apercu ? `<img src="${f.apercu}" alt="" loading="lazy">` : '<div class="thumb" style="display:grid;place-items:center"><span class="mi muted">layers_clear</span></div>'
      }<span>${esc(f.nom)}</span></button>`
    )
    .join("");
  ecoute($("#fonds", racine), "click", (e) => {
    const b = e.target.closest(".basemap");
    if (b) choisirFond(b.dataset.id);
  });
  choisirFond(stock.get("fond", "satellite"));

  /* ---------------------- Couches de référence ----------------------- */
  const refs = {};
  const etatRefs = stock.get("references", {});
  K.references().forEach((def) => {
    const couche = def.couche();
    couche.setVisible(etatRefs[def.id]?.visible ?? def.visible);
    couche.setOpacity(etatRefs[def.id]?.opacite ?? def.opacite);
    map.addLayer(couche);
    refs[def.id] = { def, couche };
  });

  /* ----------------------------- Sites ------------------------------- */
  const formatGeo = new ol.format.GeoJSON({ dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
  const tousLesSites = new Map(); // id -> feature (créée une fois)
  const sourceSites = (C.sourceSites = new ol.source.Vector());
  const coucheSites = (C.coucheSites = new ol.layer.Vector({ source: sourceSites, style: styleSite, zIndex: 10 }));
  const sourceCentroides = new ol.source.Vector();
  const coucheGroupes = new ol.layer.Vector({
    source: new ol.source.Cluster({ distance: 38, minDistance: 14, source: sourceCentroides }),
    style: styleGroupe,
    zIndex: 11,
    maxZoom: ZOOM_POLYGONES,
  });
  const coucheChaleur = new ol.layer.Heatmap({
    source: sourceCentroides,
    blur: 24,
    radius: 16,
    weight: (f) => (["actif", "recolonise"].includes(f.parcelle?.get("statut")) ? 1 : f.parcelle?.get("statut") === "tentative_reprise" ? 0.6 : 0.15),
    visible: false,
    zIndex: 9,
  });
  const coucheEtiquettes = new ol.layer.Vector({ source: sourceSites, style: styleEtiquette, declutter: true, zIndex: 12, minZoom: 11.5 });
  map.addLayer(coucheChaleur);
  map.addLayer(coucheSites);
  map.addLayer(coucheGroupes);
  map.addLayer(coucheEtiquettes);

  // Fiches de renseignement géolocalisées
  const sourceFiches = new ol.source.Vector();
  const coucheFiches = new ol.layer.Vector({
    source: sourceFiches,
    zIndex: 13,
    style: (f) =>
      new ol.style.Style({
        image: new ol.style.RegularShape({
          points: 4,
          radius: 9,
          angle: Math.PI / 4,
          fill: new ol.style.Fill({ color: (STATUT_FICHE[f.get("statut")] || K.STATUTS_FICHE[0]).couleur }),
          stroke: new ol.style.Stroke({ color: "#fff", width: 2 }),
        }),
      }),
  });
  coucheFiches.setVisible(stock.get("fiches-visibles", true));
  map.addLayer(coucheFiches);

  const definitionSites = { id: "sites", nom: "Sites d'orpaillage", detail: "Points et contours · statut à la date", couleur: "#dc2626", couche: coucheSites };
  const definitionFiches = { id: "fiches", nom: "Fiches de renseignement", detail: "Informations géolocalisées", couleur: "#d97706", couche: coucheFiches, point: true };

  function appliquerRegroupement() {
    coucheSites.setMinZoom(E.regroupement ? ZOOM_POLYGONES - 0.5 : -Infinity);
    coucheGroupes.setVisible(E.regroupement && coucheSites.getVisible());
  }

  /* ----------------------- Statut à une date -------------------------- */
  function etatA(site, d) {
    let dernier = null;
    for (const e of site.events || []) {
      if (e.date <= d) dernier = e;
      else break;
    }
    return dernier;
  }

  function majProprietesDate() {
    tousLesSites.forEach((f) => {
      const e = etatA(f.site, E.date);
      f.set("statut", e ? e.statut : "inconnu", true);
      f.set("dernier_constat", e ? e.date : null, true);
      f.set("jours_depuis_constat", e ? ecartJours(e.date, E.date) : null, true);
      f.set("nb_constats", (f.site.events || []).filter((x) => x.date <= E.date).length, true);
    });
  }

  function creerFeature(s) {
    let geom = null;
    if (s.contour) {
      try {
        geom = formatGeo.readGeometry(s.contour);
      } catch {
        geom = null;
      }
    }
    if (!geom && s.lat != null && s.lng != null) geom = new ol.geom.Point(ol.proj.fromLonLat([s.lng, s.lat]));
    if (!geom) return null;
    const f = new ol.Feature({
      geometry: geom,
      code: s.code,
      localite: s.localite,
      departement: s.departement,
      sous_prefecture: s.sous_prefecture || "",
      domaine: s.domaine,
      foret: s.foret || "",
      ugf: s.ugf || "",
      cours_eau: s.cours_eau || "",
      superficie_ha: s.superficie_ha,
      priorite: s.priorite,
      observations: s.observations || "",
      coord_alerte: s.coord_alerte || "",
      lat: s.lat,
      lng: s.lng,
    });
    f.setId(s.id);
    f.site = s;
    return f;
  }

  /* --------------------------- Thèmes -------------------------------- */
  const cleCasse = (s) => String(s ?? "").trim().toLowerCase();
  function cle(f) {
    const p = f.getProperties();
    switch (E.theme) {
      case "statut":
        return p.statut || "inconnu";
      case "departement":
      case "sous_prefecture":
      case "foret":
      case "cours_eau":
        return cleCasse(p[E.theme]) || "—";
      case "domaine":
        return p.domaine || "—";
      case "priorite":
        return p.priorite || "—";
      case "anciennete": {
        if (p.jours_depuis_constat == null) return "x";
        return CLASSES_ANCIENNETE.find((c) => c.max !== undefined && p.jours_depuis_constat <= c.max).cle;
      }
      default:
        return "tout";
    }
  }

  function calculerTheme() {
    const feats = sourceSites.getFeatures();
    const cats = new Map();
    feats.forEach((f) => {
      const k = cle(f);
      const c = cats.get(k) || { cle: k, n: 0, sup: 0, exemples: new Map() };
      c.n += 1;
      c.sup += Number(f.get("superficie_ha")) || 0;
      const brut = String(f.get(E.theme) ?? "").trim();
      c.exemples.set(brut, (c.exemples.get(brut) || 0) + 1);
      cats.set(k, c);
    });
    let liste;
    const vide = (k) => ({ cle: k, n: 0, sup: 0 });
    if (E.theme === "statut") {
      liste = K.STATUTS.map((s) => ({ ...(cats.get(s.cle) || vide(s.cle)), libelle: s.libelle, couleur: s.couleur })).filter((c) => c.n || c.cle !== "inconnu");
    } else if (E.theme === "anciennete") {
      liste = CLASSES_ANCIENNETE.map((c) => ({ ...(cats.get(c.cle) || vide(c.cle)), libelle: c.libelle, couleur: c.couleur }));
    } else if (E.theme === "domaine") {
      liste = [
        { ...(cats.get("rural") || vide("rural")), libelle: "Domaine rural", couleur: "#d97706" },
        { ...(cats.get("foret_classee") || vide("foret_classee")), libelle: "Forêt classée", couleur: "#15803d" },
      ];
    } else if (E.theme === "priorite") {
      liste = [
        { ...(cats.get("haute") || vide("haute")), libelle: "Priorité haute", couleur: "#dc2626" },
        { ...(cats.get("normale") || vide("normale")), libelle: "Priorité normale", couleur: "#64748b" },
      ];
    } else if (E.theme === "unique") {
      liste = [{ ...(cats.get("tout") || vide("tout")), libelle: "Sites", couleur: "#dc2626" }];
    } else {
      liste = [...cats.values()]
        .sort((a, b) => b.n - a.n || a.cle.localeCompare(b.cle))
        .map((c, i) => {
          const libelle = [...c.exemples.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
          return { ...c, libelle: c.cle === "—" ? "Non renseigné" : majuscule(libelle), couleur: c.cle === "—" ? "#94a3b8" : K.palette[i % K.palette.length] };
        });
    }
    E.categories = new Map(liste.map((c) => [c.cle, c]));
    stylesCache.clear();
  }

  const estVisible = (f) => !E.masquees.has(cle(f));
  C.estVisible = estVisible;
  C.couleurDe = (f) => E.categories.get(cle(f))?.couleur || "#dc2626";

  /* ---------------------------- Styles ------------------------------- */
  const stylesCache = new Map();
  const styleSelection = new ol.style.Style({
    stroke: new ol.style.Stroke({ color: "#facc15", width: 4 }),
    image: new ol.style.Circle({ radius: 12, stroke: new ol.style.Stroke({ color: "#facc15", width: 4 }) }),
    zIndex: 20,
  });
  const styleSurvol = new ol.style.Style({
    fill: new ol.style.Fill({ color: "rgba(255,255,255,0.25)" }),
    stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }),
    image: new ol.style.Circle({ radius: 11, stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }) }),
    zIndex: 19,
  });
  const styleAlerte = new ol.style.Style({
    image: new ol.style.Circle({ radius: 13, stroke: new ol.style.Stroke({ color: "#dc2626", width: 2, lineDash: [4, 3] }) }),
  });

  function styleSite(f) {
    if (!estVisible(f)) return null;
    const couleur = C.couleurDe(f);
    const point = f.getGeometry().getType() === "Point";
    const k = `${couleur}|${E.opacite}|${E.contours}|${point}`;
    let base = stylesCache.get(k);
    if (!base) {
      base = point
        ? new ol.style.Style({
            image: new ol.style.Circle({ radius: 8, fill: new ol.style.Fill({ color: couleur }), stroke: new ol.style.Stroke({ color: "#ffffff", width: 2.2 }) }),
          })
        : new ol.style.Style({
            fill: new ol.style.Fill({ color: K.rgba(couleur, E.opacite) }),
            stroke: new ol.style.Stroke({ color: E.contours ? "#ffffff" : K.rgba(couleur, 0.9), width: E.contours ? 1.6 : 1 }),
          });
      stylesCache.set(k, base);
    }
    const id = f.getId();
    const styles = [base];
    if (f.get("coord_alerte")) styles.push(styleAlerte);
    if (E.survol === id) styles.push(styleSurvol);
    if (E.selection.has(id)) styles.push(styleSelection);
    return styles;
  }

  function styleEtiquette(f, res) {
    if (!E.etiquettes || !estVisible(f) || res > 60) return null;
    const point = f.getGeometry().getType() === "Point";
    return new ol.style.Style({
      geometry: point ? undefined : (feat) => (feat.getGeometry().getType() === "MultiPolygon" ? feat.getGeometry().getInteriorPoints() : feat.getGeometry().getInteriorPoint()),
      text: new ol.style.Text({
        text: String(f.get("code") || ""),
        font: "700 11.5px 'Century Gothic', 'Jost Variable', sans-serif",
        offsetY: point ? -17 : 0,
        fill: new ol.style.Fill({ color: "#0f172a" }),
        stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.95)", width: 3.5 }),
      }),
    });
  }

  const stylesGroupes = new Map();
  function styleGroupe(f) {
    const membres = f.get("features");
    const n = membres.length;
    if (n === 1) {
      const c = C.couleurDe(membres[0].parcelle);
      return new ol.style.Style({ image: new ol.style.Circle({ radius: 7, fill: new ol.style.Fill({ color: c }), stroke: new ol.style.Stroke({ color: "#fff", width: 2 }) }) });
    }
    // Couleur du groupe : rouge si un site est actif ou recolonisé, orange si une tentative de reprise
    const statuts = membres.map((m) => m.parcelle.get("statut"));
    const actif = statuts.some((x) => x === "actif" || x === "recolonise") ? "r" : statuts.includes("tentative_reprise") ? "o" : "";
    const k = `${n}|${actif}`;
    let s = stylesGroupes.get(k);
    if (!s) {
      const r = Math.min(30, 12 + Math.sqrt(n) * 2.6);
      const c = actif === "r" ? "#b91c1c" : actif === "o" ? "#ea580c" : "#15803d";
      s = [
        new ol.style.Style({ image: new ol.style.Circle({ radius: r + 5, fill: new ol.style.Fill({ color: K.rgba(c, 0.25) }) }) }),
        new ol.style.Style({
          image: new ol.style.Circle({ radius: r, fill: new ol.style.Fill({ color: c }), stroke: new ol.style.Stroke({ color: "#fff", width: 2 }) }),
          text: new ol.style.Text({ text: String(n), font: "700 12px 'Century Gothic', 'Jost Variable', sans-serif", fill: new ol.style.Fill({ color: "#fff" }) }),
        }),
      ];
      stylesGroupes.set(k, s);
    }
    return s;
  }

  function construireCentroides() {
    const pts = sourceSites
      .getFeatures()
      .filter(estVisible)
      .map((f) => {
        const g = f.getGeometry();
        const t = g.getType();
        const c = t === "Point" ? g.getCoordinates() : t === "MultiPolygon" ? g.getInteriorPoints().getPoint(0).getCoordinates() : g.getInteriorPoint().getCoordinates();
        const pt = new ol.Feature({ geometry: new ol.geom.Point(c.slice(0, 2)) });
        pt.parcelle = f;
        return pt;
      });
    sourceCentroides.clear();
    sourceCentroides.addFeatures(pts);
  }

  function rafraichirStyles() {
    coucheSites.changed();
    coucheEtiquettes.changed();
    construireCentroides();
  }
  C.rafraichirStyles = rafraichirStyles;

  /* ---------------------------- Légende ------------------------------ */
  const LIBELLES_THEME = {
    statut: "Statut au",
    departement: "Département",
    sous_prefecture: "Sous-préfecture",
    domaine: "Domaine",
    foret: "Forêt classée",
    cours_eau: "Cours d'eau",
    priorite: "Priorité",
    anciennete: "Dernier constat",
    unique: "Sites",
  };

  function majLegende() {
    $("#legende-titre", racine).textContent = E.theme === "statut" ? `Statut au ${dateFr(E.date)}` : `Légende — ${LIBELLES_THEME[E.theme]}`;
    const items = [...E.categories.values()]
      .map(
        (c) => `<div class="legend-item toggle ${E.masquees.has(c.cle) ? "off" : ""}" data-cle="${esc(c.cle)}" title="Cliquer pour masquer / afficher">
          <i style="background:${c.couleur};border-color:${c.couleur};border-radius:50%"></i><span>${esc(c.libelle)}</span><span class="n">${c.n}</span></div>`
      )
      .join("");
    const fiches = coucheFiches.getVisible() && sourceFiches.getFeatures().length
      ? `<h4>Fiches de renseignement</h4>${K.STATUTS_FICHE.map(
          (s) => `<div class="legend-item"><i style="background:${s.couleur};border-color:${s.couleur};transform:rotate(45deg) scale(.8)"></i><span>${esc(s.libelle)}</span><span class="n">${sourceFiches.getFeatures().filter((f) => f.get("statut") === s.cle).length}</span></div>`
        ).join("")}`
      : "";
    const refsVisibles = Object.values(refs)
      .filter((r) => r.couche.getVisible())
      .map((r) =>
        r.def.legende
          ? `<div class="legend-item"><strong style="font-size:11.5px">${esc(r.def.nom)}</strong></div>${r.def.legende
              .map(
                (l) => `<div class="legend-item" style="padding-left:6px"><i class="${l.ligne ? "line" : ""}" style="${
                  l.ligne ? `border-top-color:${l.couleur}` : `background:${l.pointille ? "transparent" : K.rgba(l.couleur, 0.15)};border:1.5px ${l.pointille ? "dashed" : "solid"} ${l.couleur}`
                }"></i><span>${esc(l.libelle)}</span></div>`
              )
              .join("")}`
          : `<div class="legend-item"><i class="${r.def.ligne ? "line" : ""}" style="${
              r.def.ligne ? `border-top-color:${r.def.couleur}` : `background:${K.rgba(r.def.couleur, 0.15)};border-color:${r.def.couleur}`
            }"></i><span>${esc(r.def.nom)}</span></div>`
      )
      .join("");
    const alerte = sourceSites.getFeatures().some((f) => f.get("coord_alerte"))
      ? '<div class="legend-item"><i style="border:2px dashed #dc2626;border-radius:50%;background:transparent"></i><span>Coordonnées à vérifier</span></div>'
      : "";
    $("#legende-corps", racine).innerHTML = `${items || '<div class="muted">Aucun site</div>'}${alerte}${fiches}${refsVisibles ? `<h4>Couches de référence</h4>${refsVisibles}` : ""}`;
  }
  ecoute($("#legende-corps", racine), "click", (e) => {
    const it = e.target.closest(".legend-item.toggle");
    if (!it) return;
    const k = it.dataset.cle;
    if (E.masquees.has(k)) E.masquees.delete(k);
    else E.masquees.add(k);
    rafraichirStyles();
    majLegende();
    majResume();
    C.majTable?.();
  });
  ecoute($("#legende-tete", racine), "click", () => {
    $("#legende", racine).classList.toggle("collapsed");
    stock.set("legende-repliee", $("#legende", racine).classList.contains("collapsed"));
  });
  if (stock.get("legende-repliee", false)) $("#legende", racine).classList.add("collapsed");

  /* ---------------------- Liste des couches -------------------------- */
  function majListeCouches() {
    const lignes = [definitionSites, definitionFiches, ...(C.couchesSupplementaires || []), ...Object.values(refs).map((r) => ({ ...r.def, couche: r.couche }))];
    $("#liste-couches", racine).innerHTML = lignes
      .map(
        (d) => `<div class="layer" data-id="${d.id}">
          <div class="layer-row">
            <input type="checkbox" class="check" data-vis ${d.couche.getVisible() ? "checked" : ""} aria-label="Afficher ${esc(d.nom)}">
            <i class="swatch" style="${d.ligne ? `border-color:${d.couleur};background:transparent` : d.point ? `border-color:${d.couleur};background:${d.couleur};transform:rotate(45deg) scale(.75)` : `border-color:${d.couleur};background:${K.rgba(d.couleur, 0.25)}`}"></i>
            <span class="name">${esc(d.nom)}<small>${esc(d.detail || "")}</small></span>
            <button class="btn btn-ghost btn-icon btn-sm" data-zoom title="Zoomer sur la couche"><span class="mi">zoom_in_map</span></button>
            <button class="btn btn-ghost btn-icon btn-sm" data-plus title="Options"><span class="mi">tune</span></button>
          </div>
          <div class="layer-extra"><label class="label">Opacité</label><input type="range" min="0" max="100" value="${Math.round(d.couche.getOpacity() * 100)}" data-op></div>
        </div>`
      )
      .join("");
  }
  const coucheDe = (id) =>
    id === "sites" ? coucheSites : id === "fiches" ? coucheFiches : refs[id]?.couche || (C.couchesSupplementaires || []).find((d) => d.id === id)?.couche;
  function sauverRefs() {
    stock.set("references", Object.fromEntries(Object.entries(refs).map(([id, r]) => [id, { visible: r.couche.getVisible(), opacite: r.couche.getOpacity() }])));
    stock.set("fiches-visibles", coucheFiches.getVisible());
  }
  ecoute($("#liste-couches", racine), "change", (e) => {
    const bloc = e.target.closest(".layer");
    if (!bloc || !e.target.matches("[data-vis]")) return;
    coucheDe(bloc.dataset.id).setVisible(e.target.checked);
    if (bloc.dataset.id === "sites") {
      coucheEtiquettes.setVisible(e.target.checked);
      appliquerRegroupement();
    }
    sauverRefs();
    majLegende();
  });
  ecoute($("#liste-couches", racine), "input", (e) => {
    const bloc = e.target.closest(".layer");
    if (!bloc || !e.target.matches("[data-op]")) return;
    coucheDe(bloc.dataset.id).setOpacity(Number(e.target.value) / 100);
    if (bloc.dataset.id === "sites") coucheEtiquettes.setOpacity(Number(e.target.value) / 100);
    sauverRefs();
  });
  ecoute($("#liste-couches", racine), "click", (e) => {
    const bloc = e.target.closest(".layer");
    if (!bloc) return;
    if (e.target.closest("[data-plus]")) bloc.classList.toggle("open");
    if (e.target.closest("[data-zoom]")) {
      const sup = (C.couchesSupplementaires || []).find((d) => d.id === bloc.dataset.id);
      const ext = sup?.etendue ? sup.etendue() : coucheDe(bloc.dataset.id).getSource().getExtent();
      if (ext && Number.isFinite(ext[0])) view.fit(ext, { padding: [60, 60, 60, 60], duration: 600, maxZoom: 16 });
      else GR.toast("Cette couche ne contient encore aucun objet", "info");
    }
  });

  /* ------------------------ Panneau & onglets ------------------------ */
  ecoute($(".panel-tabs", racine), "click", (e) => {
    const b = e.target.closest("button[data-pane]");
    if (!b) return;
    $$(".panel-tabs button", racine).forEach((x) => x.classList.toggle("active", x === b));
    $$(".panel-pane", racine).forEach((p) => p.classList.toggle("active", p.dataset.pane === b.dataset.pane));
    if (b.dataset.pane === "analyse") majMiniGraphe();
  });
  function basculerPanneau(force) {
    const ferme = force !== undefined ? !force : !document.body.classList.contains("panel-closed");
    document.body.classList.toggle("panel-closed", ferme);
    $("#bascule-panneau .mi", racine).textContent = ferme ? "menu" : "menu_open";
    stock.set("panneau-ferme", ferme);
    minuteries.add(setTimeout(() => map.updateSize(), 240));
  }
  ecoute($("#bascule-panneau", racine), "click", () => basculerPanneau());
  if (stock.get("panneau-ferme", window.innerWidth < 900)) basculerPanneau(false);

  /* ----------------------------- Filtres ----------------------------- */
  const ms = {};
  function lireFiltresUI() {
    const f = E.filtres;
    f.departements = $$("#f-departements input:checked", racine).map((i) => i.value);
    ["statuts", "domaines", "forets", "sp", "cours", "priorites"].forEach((k) => (f[k] = ms[k]?.values() || []));
    f.supMin = $("#f-supmin", racine).value;
    f.supMax = $("#f-supmax", racine).value;
    const n =
      (f.departements.length < 2 ? 1 : 0) +
      ["statuts", "domaines", "forets", "sp", "cours", "priorites"].filter((k) => f[k].length).length +
      (f.supMin || f.supMax ? 1 : 0) +
      (E.requeteActive ? 1 : 0);
    $("#nb-filtres", racine).textContent = n;
    $("#nb-filtres", racine).classList.toggle("hidden", !n);
    ctx.setDepartement?.(f.departements.length === 1 ? f.departements[0] : "");
  }
  const reappliquer = GR.debounce(() => {
    lireFiltresUI();
    appliquerFiltres();
  }, 250);
  ecoute($("#f-departements", racine), "change", (e) => {
    e.target.closest(".chip")?.classList.toggle("on", e.target.checked);
    reappliquer();
  });
  ["#f-supmin", "#f-supmax"].forEach((s) => ecoute($(s, racine), "input", reappliquer));
  if (ctx.departement) {
    $$("#f-departements input", racine).forEach((i) => {
      i.checked = i.value === ctx.departement;
      i.closest(".chip").classList.toggle("on", i.checked);
    });
  }

  function optionsDistinctes(cleProp) {
    const n = new Map();
    E.sites.forEach((s) => {
      const v = String(s[cleProp] || "").trim();
      if (v) n.set(v, (n.get(v) || 0) + 1);
    });
    return [...n.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr")).map(([v, c]) => ({ value: v, label: v, n: c }));
  }

  function construireFiltres() {
    ms.statuts = new GR.MultiSelect($("#f-statuts", racine), {
      options: K.STATUTS.map((s) => ({ value: s.cle, label: s.libelle, color: s.couleur })),
      placeholder: "Tous les statuts",
      onChange: reappliquer,
      recherche: false,
    });
    ms.domaines = new GR.MultiSelect($("#f-domaines", racine), {
      options: [
        { value: "rural", label: "Domaine rural" },
        { value: "foret_classee", label: "Forêt classée" },
      ],
      placeholder: "Tous les domaines",
      onChange: reappliquer,
      recherche: false,
    });
    ms.forets = new GR.MultiSelect($("#f-forets", racine), { options: optionsDistinctes("foret"), placeholder: "Toutes les forêts", onChange: reappliquer });
    ms.sp = new GR.MultiSelect($("#f-sp", racine), { options: optionsDistinctes("sous_prefecture"), placeholder: "Toutes les sous-préfectures", onChange: reappliquer });
    ms.cours = new GR.MultiSelect($("#f-cours", racine), { options: optionsDistinctes("cours_eau"), placeholder: "Tous les cours d'eau", onChange: reappliquer });
    ms.priorites = new GR.MultiSelect($("#f-priorites", racine), {
      options: [
        { value: "haute", label: "Haute" },
        { value: "normale", label: "Normale" },
      ],
      placeholder: "Toutes",
      onChange: reappliquer,
      recherche: false,
    });
  }

  function passeFiltres(f) {
    const F = E.filtres;
    const p = f.getProperties();
    if (!F.departements.includes(p.departement)) return false;
    if (F.statuts.length && !F.statuts.includes(p.statut)) return false;
    if (F.domaines.length && !F.domaines.includes(p.domaine)) return false;
    if (F.forets.length && !F.forets.includes(p.foret)) return false;
    if (F.sp.length && !F.sp.includes(p.sous_prefecture)) return false;
    if (F.cours.length && !F.cours.includes(p.cours_eau)) return false;
    if (F.priorites.length && !F.priorites.includes(p.priorite)) return false;
    const sup = Number(p.superficie_ha);
    if (F.supMin !== "" && F.supMin !== undefined && !(sup >= Number(F.supMin))) return false;
    if (F.supMax !== "" && F.supMax !== undefined && !(sup <= Number(F.supMax))) return false;
    if (E.requeteActive && E.criteres.length) {
      const res = E.criteres.map((c) => C.testerCritere(p, c));
      if (E.mode === "ET" ? !res.every(Boolean) : !res.some(Boolean)) return false;
    }
    return true;
  }

  function appliquerFiltres({ ajuster = false } = {}) {
    majProprietesDate();
    const garder = [...tousLesSites.values()].filter(passeFiltres);
    sourceSites.clear(true);
    sourceSites.addFeatures(garder);
    E.selection = new Set([...E.selection].filter((id) => sourceSites.getFeatureById(id)));
    calculerTheme();
    rafraichirStyles();
    majLegende();
    majResume();
    C.majTable?.();
    $("#nb-sites", racine).textContent = `${garder.length} site${garder.length > 1 ? "s" : ""}`;
    if (ajuster && garder.length) ajusterEmprise();
  }
  C.appliquerFiltres = appliquerFiltres;

  function ajusterEmprise(features) {
    const feats = features || sourceSites.getFeatures().filter(estVisible);
    if (!feats.length) return;
    const ext = ol.extent.createEmpty();
    feats.forEach((f) => ol.extent.extend(ext, f.getGeometry().getExtent()));
    view.fit(ext, { padding: [80, 80, 140, 60], duration: 700, maxZoom: 15 });
  }
  C.ajusterEmprise = ajusterEmprise;

  /* --------------------------- Chargement ---------------------------- */
  async function charger() {
    $("#chargement", racine).classList.add("show");
    try {
      const [sites, fiches, cours, zones] = await Promise.all([
        api("/sites"),
        api("/fiches").catch(() => []),
        api("/cours-eau").catch(() => []),
        api("/zones").catch(() => []),
      ]);
      if (signal.aborted) return;
      E.sites = sites;
      E.fiches = fiches;
      tousLesSites.clear();
      sites.forEach((s) => {
        const f = creerFeature(s);
        if (f) tousLesSites.set(s.id, f);
      });
      const sansCoord = sites.filter((s) => s.lat == null && !s.contour);
      if (sansCoord.length) {
        const a = $("#sans-coord", racine);
        a.classList.remove("hidden");
        a.lastElementChild.innerHTML = `<span><strong>${sansCoord.length} site(s) sans coordonnées</strong> ne sont pas sur la carte : ${sansCoord
          .slice(0, 6)
          .map((s) => esc(`${s.code} ${s.localite}`))
          .join(", ")}${sansCoord.length > 6 ? "…" : ""}. <a href="/sites" data-lien="/sites">Compléter dans le registre</a></span>`;
      }
      // Fiches
      sourceFiches.clear();
      sourceFiches.addFeatures(
        fiches
          .filter((x) => x.lat != null && x.lng != null)
          .map((x) => {
            const f = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([x.lng, x.lat])), ...x, fiche: true });
            f.setId(`fiche-${x.id}`);
            return f;
          })
      );
      // Cours d'eau et zones
      K.sourceCoursEau.clear();
      cours.forEach((c) => {
        if (!c.trace) return;
        const f = new ol.Feature({ geometry: formatGeo.readGeometry(c.trace), ...c, cours: true });
        f.setId(`ce-${c.id}`);
        K.sourceCoursEau.addFeature(f);
      });
      E.coursEau = cours;
      K.sourceZones.clear();
      zones.forEach((z) => {
        if (!z.geometrie) return;
        const f = new ol.Feature({ geometry: formatGeo.readGeometry(z.geometrie), ...z, zone: true });
        f.setId(`zone-${z.id}`);
        K.sourceZones.addFeature(f);
      });
      // Frise
      const dates = sites.flatMap((s) => (s.events || []).map((e) => e.date));
      E.borneMin = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : ajouterJours(aujourdhui(), -30);
      E.datesEvenements = [...new Set(dates)].sort();
      if (!E.chargeUneFois) {
        construireFiltres();
        C.initRequeteur?.();
      } else {
        ms.forets?.setOptions(optionsDistinctes("foret"));
        ms.sp?.setOptions(optionsDistinctes("sous_prefecture"));
        ms.cours?.setOptions(optionsDistinctes("cours_eau"));
      }
      majFrise();
      appliquerFiltres();
      C.apresChargement?.();
      if (E.chargeUneFois) return;
      E.chargeUneFois = true;
      if (ctx.siteCible && tousLesSites.get(ctx.siteCible)) {
        const f = tousLesSites.get(ctx.siteCible);
        if (sourceSites.getFeatureById(ctx.siteCible)) {
          C.selectionner([ctx.siteCible], { zoom: true });
          minuteries.add(setTimeout(() => afficherPopup([f], centreDe(f)), 800));
        }
      } else if (!lireVueUrl()) ajusterEmprise();
    } catch (e) {
      if (!signal.aborted) GR.toast(e.message || "Chargement impossible", "error");
    } finally {
      $("#chargement", racine)?.classList.remove("show");
    }
  }
  C.recharger = charger;
  C.formatGeo = formatGeo;
  C.tousLesSites = tousLesSites;
  C.sourceFiches = sourceFiches;
  C.coucheFiches = coucheFiches;
  C.refs = refs;
  C.majLegende = () => majLegende();
  C.majListeCouches = () => majListeCouches();
  C.centreDe = (f) => centreDe(f);

  const centreDe = (f) => {
    const g = f.getGeometry();
    return g.getType() === "Point" ? g.getCoordinates() : ol.extent.getCenter(g.getExtent());
  };

  /* ----------------------------- Résumé ------------------------------ */
  const featuresVisibles = () => sourceSites.getFeatures().filter(estVisible);
  C.featuresVisibles = featuresVisibles;

  function majResume() {
    const feats = featuresVisibles();
    const connus = feats.filter((f) => f.get("statut") !== "inconnu");
    const actifs = connus.filter((f) => ["actif", "recolonise"].includes(f.get("statut"))).length;
    const sup = feats.reduce((s, f) => s + (Number(f.get("superficie_ha")) || 0), 0);
    const r = $("#resume", racine);
    $("#resume-date", racine).textContent = dateFr(E.date);
    r.querySelector('[data-k="n"]').textContent = fmt.n(feats.length);
    r.querySelector('[data-k="actifs"]').textContent = fmt.n(actifs);
    r.querySelector('[data-k="taux"]').textContent = connus.length ? fmt.pct(((connus.length - actifs) / connus.length) * 100, 0) : "—";
    r.querySelector('[data-k="sup"]').textContent = sup ? fmt.ha(sup, 1) : "—";
    if ($('.panel-pane[data-pane="analyse"]', racine).classList.contains("active")) majMiniGraphe();
  }

  function majMiniGraphe() {
    const cats = [...E.categories.values()].filter((c) => !E.masquees.has(c.cle) && c.n > 0);
    GR.chart("mini-graphe", {
      chart: { type: "donut", height: 260, toolbar: { show: false } },
      series: cats.map((c) => c.n),
      labels: cats.map((c) => c.libelle),
      colors: cats.map((c) => c.couleur),
      legend: { position: "bottom", fontSize: "11px" },
      dataLabels: { enabled: true, formatter: (v) => `${Math.round(v)} %` },
      tooltip: { y: { formatter: (v) => `${v} site(s)` } },
      plotOptions: { pie: { donut: { size: "58%", labels: { show: true, total: { show: true, label: "Sites", formatter: (w) => fmt.n(w.globals.seriesTotals.reduce((a, b) => a + b, 0)) } } } } },
      stroke: { width: 1 },
    });
  }

  /* -------------------------- Analyse UI ----------------------------- */
  $("#theme", racine).value = E.theme;
  $("#opacite", racine).value = Math.round(E.opacite * 100);
  $("#opacite-val", racine).textContent = `${Math.round(E.opacite * 100)} %`;
  $("#etiquettes", racine).checked = E.etiquettes;
  $("#regroupement", racine).checked = E.regroupement;
  ecoute($("#theme", racine), "change", (e) => {
    E.theme = e.target.value;
    E.masquees.clear();
    stock.set("theme", E.theme);
    calculerTheme();
    rafraichirStyles();
    majLegende();
    majResume();
    majMiniGraphe();
  });
  ecoute($("#opacite", racine), "input", (e) => {
    E.opacite = Number(e.target.value) / 100;
    $("#opacite-val", racine).textContent = `${e.target.value} %`;
    stock.set("opacite", E.opacite);
    stylesCache.clear();
    coucheSites.changed();
  });
  ecoute($("#etiquettes", racine), "change", (e) => {
    E.etiquettes = e.target.checked;
    stock.set("etiquettes", E.etiquettes);
    coucheEtiquettes.changed();
  });
  ecoute($("#contours", racine), "change", (e) => {
    E.contours = e.target.checked;
    stylesCache.clear();
    coucheSites.changed();
  });
  ecoute($("#regroupement", racine), "change", (e) => {
    E.regroupement = e.target.checked;
    stock.set("regroupement", E.regroupement);
    appliquerRegroupement();
  });
  ecoute($("#chaleur", racine), "change", (e) => coucheChaleur.setVisible(e.target.checked));

  /* --------------------------- Sélection ----------------------------- */
  C.selectionner = function selectionner(ids, { ajouter = false, zoom = false, basculer = false } = {}) {
    if (!ajouter && !basculer) E.selection.clear();
    ids.forEach((id) => {
      if (basculer && E.selection.has(id)) E.selection.delete(id);
      else E.selection.add(id);
    });
    coucheSites.changed();
    if (zoom && ids.length) ajusterEmprise(ids.map((id) => sourceSites.getFeatureById(id)).filter(Boolean));
    C.majTable?.({ defiler: true });
  };

  /* ------------------------ Frise temporelle ------------------------- */
  const curseur = $("#frise-curseur", racine);
  let lecture = null;
  function majFrise() {
    const fin = aujourdhui() > E.date ? aujourdhui() : E.date;
    const total = Math.max(1, ecartJours(E.borneMin, fin));
    curseur.max = total;
    curseur.value = Math.max(0, Math.min(total, ecartJours(E.borneMin, E.date)));
    $("#frise-min", racine).textContent = dateFr(E.borneMin);
    $("#frise-max", racine).textContent = dateFr(fin);
    $("#frise-ticks", racine).innerHTML = (E.datesEvenements || [])
      .map((d) => `<i style="left:${(ecartJours(E.borneMin, d) / total) * 100}%" title="${dateFr(d)}"></i>`)
      .join("");
    majTexteFrise();
  }
  function majTexteFrise() {
    $("#frise-date", racine).textContent = dateFr(E.date);
    const j = ecartJours(E.date, aujourdhui());
    const evts = E.sites.reduce((n, s) => n + (s.events || []).filter((e) => e.date === E.date).length, 0);
    $("#frise-info", racine).textContent = `${j === 0 ? "aujourd'hui" : j > 0 ? `il y a ${j} jour${j > 1 ? "s" : ""}` : `dans ${-j} jour(s)`}${evts ? ` · ${evts} constat(s) ce jour` : ""}`;
  }
  function changerDate(d, { depuisCurseur = false } = {}) {
    if (d < E.borneMin) d = E.borneMin;
    if (d > aujourdhui()) d = aujourdhui();
    E.date = d;
    if (!depuisCurseur) curseur.value = ecartJours(E.borneMin, d);
    majTexteFrise();
    appliquerFiltres();
    ctx.setDate?.(d);
    C.apresChangementDate?.(d);
    if (popupListe.length && (popupListe[popupIndex].site || popupListe[popupIndex].get("fiche"))) popupEl.innerHTML = contenuPopup(popupListe[popupIndex]);
  }
  C.changerDate = changerDate;
  ecoute(curseur, "input", () => changerDate(ajouterJours(E.borneMin, Number(curseur.value)), { depuisCurseur: true }));
  function arreterLecture() {
    if (lecture) clearInterval(lecture);
    lecture = null;
    $(".tb-play .mi", racine).textContent = "play_arrow";
  }
  ecoute($("#frise", racine), "click", (e) => {
    const b = e.target.closest("[data-temps]");
    if (!b) return;
    const a = b.dataset.temps;
    if (a !== "lecture") arreterLecture();
    if (a === "debut") changerDate(E.borneMin);
    if (a === "aujourdhui") changerDate(aujourdhui());
    if (a === "-7" || a === "+7") changerDate(ajouterJours(E.date, Number(a)));
    if (a === "lecture") {
      if (lecture) return arreterLecture();
      if (E.date >= aujourdhui()) changerDate(E.borneMin);
      $(".tb-play .mi", racine).textContent = "pause";
      lecture = setInterval(() => {
        if (E.date >= aujourdhui()) return arreterLecture();
        changerDate(ajouterJours(E.date, 3));
      }, 450);
    }
    return undefined;
  });

  /* ---------------------- Fenêtre d'information ---------------------- */
  const popupEl = $("#popup", racine);
  const popup = new ol.Overlay({ element: popupEl, positioning: "bottom-center", offset: [0, -10], autoPan: { animation: { duration: 250 }, margin: 60 }, stopEvent: true });
  map.addOverlay(popup);
  let popupListe = [];
  let popupIndex = 0;

  const badgeStatut = (s) => {
    const d = STATUT[s] || STATUT.inconnu;
    return `<span class="badge" style="background:${K.rgba(d.couleur, 0.14)};color:${d.couleur};border-color:${K.rgba(d.couleur, 0.35)}">${esc(d.libelle)}</span>`;
  };

  function contenuPopup(f) {
    if (f.get("fiche")) return contenuPopupFiche(f);
    const p = f.getProperties();
    const s = f.site;
    const cs = s.coord_saisie;
    const evts = (s.events || []).slice(-6).reverse();
    return `
      <div class="popup-head">
        <span class="mi" style="color:${C.couleurDe(f)}">location_on</span>
        <div><h3>${esc(p.code)} · ${esc(p.localite)}</h3><small>${esc(p.departement)}${p.sous_prefecture ? ` · S/P ${esc(p.sous_prefecture)}` : ""}</small></div>
        ${popupListe.length > 1 ? `<span class="popup-nav"><button data-pp="-1" title="Précédent"><span class="mi mi-sm">chevron_left</span></button>${popupIndex + 1}/${popupListe.length}<button data-pp="1" title="Suivant"><span class="mi mi-sm">chevron_right</span></button></span>` : ""}
        <button data-fermer-popup title="Fermer"><span class="mi mi-sm">close</span></button>
      </div>
      <div class="popup-body" style="max-height:340px;overflow:auto">
        <div class="row mb-2" style="justify-content:space-between"><span class="muted" style="font-size:12px">Au ${dateFr(E.date)}</span>${badgeStatut(p.statut)}</div>
        ${p.coord_alerte ? `<div class="alert warning mb-2" style="font-size:12px"><span class="mi mi-sm">wrong_location</span><span>${esc(p.coord_alerte)}</span></div>` : ""}
        <dl class="dl">
          <dt>Domaine</dt><dd>${esc(LIB_DOMAINE[p.domaine] || "—")}${p.foret ? ` · FC ${esc(p.foret)}` : ""}</dd>
          ${p.cours_eau ? `<dt>Cours d'eau</dt><dd>${esc(p.cours_eau)}</dd>` : ""}
          <dt>Superficie</dt><dd>${p.superficie_ha ? fmt.ha(p.superficie_ha) : "—"}</dd>
          <dt>Priorité</dt><dd>${p.priorite === "haute" ? '<span class="badge red">Haute</span>' : "Normale"}</dd>
          ${p.lat != null ? `<dt>Coordonnées</dt><dd class="num">${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}</dd>` : ""}
          ${cs && cs.sys !== "wgs" ? `<dt>UTM ${esc(cs.sys)}N saisi</dt><dd class="num">X ${fmt.n(cs.x)} · Y ${fmt.n(cs.y)}</dd>` : ""}
        </dl>
        ${
          evts.length
            ? `<h4 style="font-size:12px;margin:12px 0 6px">Historique des constats</h4><div class="historique">${evts
                .map(
                  (e) => `<button class="hist ${e.date > E.date ? "futur" : ""}" data-date="${e.date}" title="Afficher la carte à cette date">
                    <i style="background:${(STATUT[e.statut] || STATUT.inconnu).couleur}"></i><span class="num">${dateFr(e.date)}</span><strong>${esc(e.statut_label || STATUT[e.statut]?.libelle || e.statut)}</strong><small>${esc(LIB_SOURCE[e.source] || e.source)}</small></button>`
                )
                .join("")}</div>`
            : '<p class="muted mt-3" style="font-size:12px">Aucun constat enregistré.</p>'
        }
        ${p.observations ? `<div class="alert info mt-3" style="font-size:12px"><span class="mi mi-sm">notes</span><span>${esc(p.observations)}</span></div>` : ""}
      </div>
      <div class="popup-actions">
        <button class="btn btn-sm btn-primary" data-pa="fiche"><span class="mi">description</span>Fiche du site</button>
        <button class="btn btn-sm" data-pa="zoom"><span class="mi">zoom_in</span>Zoomer</button>
        <button class="btn btn-sm" data-pa="selection"><span class="mi">${E.selection.has(f.getId()) ? "deselect" : "check_box_outline_blank"}</span>${E.selection.has(f.getId()) ? "Retirer" : "Sélectionner"}</button>
        ${p.lat != null ? `<a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}" title="Itinéraire"><span class="mi">directions</span></a>` : ""}
      </div>
      ${C.barreEditionSite ? C.barreEditionSite(f) : ""}`;
  }

  function contenuPopupFiche(f) {
    const p = f.getProperties();
    const st = STATUT_FICHE[p.statut] || K.STATUTS_FICHE[0];
    return `
      <div class="popup-head">
        <span class="mi" style="color:${st.couleur}">policy</span>
        <div><h3>${esc(p.numero)}</h3><small>Reçue le ${dateFr(p.date_recu)} · cotation ${esc(p.cotation)}</small></div>
        ${popupListe.length > 1 ? `<span class="popup-nav"><button data-pp="-1"><span class="mi mi-sm">chevron_left</span></button>${popupIndex + 1}/${popupListe.length}<button data-pp="1"><span class="mi mi-sm">chevron_right</span></button></span>` : ""}
        <button data-fermer-popup title="Fermer"><span class="mi mi-sm">close</span></button>
      </div>
      <div class="popup-body" style="max-height:320px;overflow:auto">
        <div class="row mb-2" style="justify-content:space-between"><span class="badge" style="background:${K.rgba(st.couleur, 0.14)};color:${st.couleur}">${esc(st.libelle)}</span>${
          p.priorite === "urgente" ? '<span class="badge red">Urgente</span>' : p.priorite === "importante" ? '<span class="badge amber">Importante</span>' : ""
        }</div>
        <dl class="dl">
          <dt>Localité</dt><dd>${esc(p.localite)} (${esc(p.departement)})</dd>
          <dt>Nature</dt><dd>${esc((p.nature || []).join(", "))}</dd>
          ${p.personnes != null ? `<dt>Personnes</dt><dd>${fmt.n(p.personnes)}</dd>` : ""}
          ${(p.equipements || []).length ? `<dt>Équipements</dt><dd>${esc(p.equipements.join(", "))}</dd>` : ""}
          <dt>Source</dt><dd>${esc(p.source_type)}${p.source_code ? ` · ${esc(p.source_code)}` : ""}</dd>
        </dl>
        <p class="mt-3" style="font-size:12.5px">${esc(p.description)}</p>
      </div>
      <div class="popup-actions"><button class="btn btn-sm btn-primary" data-pa="voir-fiche"><span class="mi">open_in_new</span>Ouvrir / modifier</button>
        <button class="btn btn-sm" data-pe="fiche-deplacer"><span class="mi">open_with</span>Déplacer le point</button></div>`;
  }

  function afficherPopup(feats, coord) {
    popupListe = feats;
    popupIndex = 0;
    popupEl.style.display = "block";
    popupEl.innerHTML = contenuPopup(feats[0]);
    popup.setPosition(coord);
  }
  C.afficherPopup = afficherPopup;
  C.popup = popup;
  C.popupEl = popupEl;
  C.ouvrirPopupHtml = (html, coord, feats = []) => {
    popupListe = feats;
    popupIndex = 0;
    popupEl.style.display = "block";
    popupEl.innerHTML = html;
    popup.setPosition(coord);
  };
  function fermerPopup() {
    popup.setPosition(undefined);
    popupEl.style.display = "none";
    popupListe = [];
  }
  C.fermerPopup = fermerPopup;
  ecoute(popupEl, "click", (e) => {
    if (e.target.closest("[data-fermer-popup]")) return fermerPopup();
    const nav = e.target.closest("[data-pp]");
    if (nav) {
      popupIndex = (popupIndex + Number(nav.dataset.pp) + popupListe.length) % popupListe.length;
      popupEl.innerHTML = contenuPopup(popupListe[popupIndex]);
      return undefined;
    }
    const h = e.target.closest("[data-date]");
    if (h) {
      arreterLecture();
      changerDate(h.dataset.date);
      return undefined;
    }
    const pe = e.target.closest("[data-pe]");
    if (pe) {
      C.actionEdition?.(pe.dataset.pe, popupListe[popupIndex], pe);
      return undefined;
    }
    const a = e.target.closest("[data-pa]");
    if (!a) return undefined;
    const f = popupListe[popupIndex];
    if (a.dataset.pa === "fiche") ctx.naviguer(`/sites?site=${encodeURIComponent(f.getId())}`);
    if (a.dataset.pa === "voir-fiche") ctx.naviguer(`/renseignement?fiche=${encodeURIComponent(f.get("id"))}`);
    if (a.dataset.pa === "zoom") ajusterEmprise([f]);
    if (a.dataset.pa === "selection") {
      C.selectionner([f.getId()], { basculer: true });
      popupEl.innerHTML = contenuPopup(f);
    }
    return undefined;
  });

  /* ------------------------ Interactions carte ----------------------- */
  const infobulle = document.createElement("div");
  infobulle.className = "map-tooltip";
  const overlayInfobulle = new ol.Overlay({ element: infobulle, offset: [14, 0], positioning: "center-left" });
  map.addOverlay(overlayInfobulle);
  const couchesCliquables = (l) => l === coucheSites || l === coucheGroupes || l === coucheFiches;

  map.on("pointermove", (evt) => {
    $("#coord", racine).textContent = formaterCoord(evt.coordinate);
    if (evt.dragging || C.outilActif?.()) return;
    let trouve = null;
    let couche = null;
    map.forEachFeatureAtPixel(
      evt.pixel,
      (f, l) => {
        trouve = f;
        couche = l;
        return true;
      },
      { layerFilter: couchesCliquables, hitTolerance: 3 }
    );
    map.getTargetElement().style.cursor = trouve ? "pointer" : "";
    const id = trouve && couche === coucheSites ? trouve.getId() : null;
    if (id !== E.survol) {
      E.survol = id;
      coucheSites.changed();
    }
    if (trouve) {
      if (couche === coucheGroupes) {
        const m = trouve.get("features");
        infobulle.textContent = m.length > 1 ? `${m.length} sites — cliquer pour zoomer` : `${m[0].parcelle.get("code")} · ${m[0].parcelle.get("localite")}`;
      } else if (couche === coucheFiches) infobulle.textContent = `${trouve.get("numero")} · ${trouve.get("localite")}`;
      else infobulle.textContent = `${trouve.get("code")} · ${trouve.get("localite")} · ${STATUT[trouve.get("statut")]?.libelle || ""}`;
      overlayInfobulle.setPosition(evt.coordinate);
    } else overlayInfobulle.setPosition(undefined);
  });
  ecoute(map.getViewport(), "mouseleave", () => {
    overlayInfobulle.setPosition(undefined);
    if (E.survol !== null) {
      E.survol = null;
      coucheSites.changed();
    }
  });

  map.on("singleclick", (evt) => {
    if (C.editionActive || (C.outilActif?.() && C.outilActif() !== "info")) return;
    const feats = [];
    let groupe = null;
    map.forEachFeatureAtPixel(
      evt.pixel,
      (f, l) => {
        if (l === coucheGroupes) groupe = f;
        else if (!feats.includes(f)) feats.push(f);
      },
      { layerFilter: couchesCliquables, hitTolerance: 4 }
    );
    if (groupe && !feats.length) {
      const membres = groupe.get("features");
      if (membres.length === 1) return afficherPopup([membres[0].parcelle], evt.coordinate);
      const ext = ol.extent.boundingExtent(membres.map((m) => m.getGeometry().getCoordinates()));
      view.fit(ext, { duration: 500, padding: [90, 90, 160, 90], maxZoom: 14 });
      return undefined;
    }
    if (feats.length) {
      const multi = evt.originalEvent.ctrlKey || evt.originalEvent.metaKey || evt.originalEvent.shiftKey;
      if (multi && !feats[0].get("fiche")) C.selectionner([feats[0].getId()], { basculer: true });
      else afficherPopup(feats, evt.coordinate);
      return undefined;
    }
    if (C.clicSupplementaire?.(evt)) return undefined;
    let foret = null;
    let riviere = null;
    if (refs["cours-eau"]?.couche.getVisible()) map.forEachFeatureAtPixel(evt.pixel, (f) => (riviere = f), { layerFilter: (l) => l === refs["cours-eau"].couche, hitTolerance: 4 });
    if (!riviere && refs.forets?.couche.getVisible()) map.forEachFeatureAtPixel(evt.pixel, (f) => (foret = f), { layerFilter: (l) => l === refs.forets.couche });
    if (riviere) afficherPopupRiviere(riviere, evt.coordinate);
    else if (foret) afficherPopupForet(foret, evt.coordinate);
    else fermerPopup();
    return undefined;
  });

  function afficherPopupForet(f, coord) {
    const p = f.getProperties();
    const oui = (v) => (v ? `<span class="badge ${v === "Oui" || v === "Ok" ? "green" : v === "Non" ? "red" : "amber"}">${esc(v)}</span>` : "—");
    const nomF = String(p.nom || "").toLowerCase();
    const sitesFc = [...tousLesSites.values()].filter((x) => String(x.get("foret") || "").toLowerCase().includes(nomF));
    const actifs = sitesFc.filter((x) => ["actif", "recolonise"].includes(x.get("statut"))).length;
    popupListe = [];
    popupEl.style.display = "block";
    popupEl.innerHTML = `
      <div class="popup-head">
        <span class="mi">forest</span>
        <div><h3>Forêt classée de ${esc(p.nom)}</h3><small>${p.code ? `Code ${esc(p.code)} · ` : ""}UGF ${esc(p.ugf || "non renseignée")}</small></div>
        <button data-fermer-popup title="Fermer"><span class="mi mi-sm">close</span></button>
      </div>
      <div class="popup-body" style="max-height:320px;overflow:auto">
        <dl class="dl">
          <dt>Sites d'orpaillage</dt><dd>${sitesFc.length ? `<strong>${sitesFc.length}</strong> recensé(s) · ${actifs ? `<span class="badge red">${actifs} actif(s)</span>` : '<span class="badge green">aucun actif</span>'}` : "aucun recensé"}</dd>
          <dt>Statut</dt><dd>${esc(p.statut || "—")}${p.categorie ? ` · catégorie ${esc(p.categorie)}` : ""}</dd>
          <dt>Sup. cartographique</dt><dd>${fmt.ha(p.sup_carto, 0)}</dd>
          <dt>Sup. calculée</dt><dd>${fmt.ha(ol.sphere.getArea(f.getGeometry()) / 10000, 0)}</dd>
          <dt>Limites</dt><dd>${oui(p.limites)}</dd>
          <dt>Plan d'aménagement</dt><dd>${oui(p.plan_amenagement)}</dd>
          <dt>Concession</dt><dd>${oui(p.concession)}${p.concessionnaire ? ` · ${esc(p.concessionnaire)}` : ""}</dd>
        </dl>
        ${p.observation ? `<div class="alert info mt-3" style="font-size:12px"><span class="mi mi-sm">info</span><span>${esc(p.observation)}</span></div>` : ""}
      </div>
      <div class="popup-actions"><button class="btn btn-sm" data-pf="zoom"><span class="mi">zoom_in_map</span>Zoomer sur la forêt</button>${
        sitesFc.length ? '<button class="btn btn-sm btn-primary" data-pf="sites"><span class="mi">location_on</span>Sélectionner ses sites</button>' : ""
      }</div>`;
    popupEl.querySelector('[data-pf="zoom"]').addEventListener("click", () => view.fit(f.getGeometry().getExtent(), { padding: [60, 60, 60, 60], duration: 700 }));
    popupEl.querySelector('[data-pf="sites"]')?.addEventListener("click", () => {
      C.selectionner(sitesFc.filter((x) => sourceSites.getFeatureById(x.getId())).map((x) => x.getId()), { zoom: true });
      C.ouvrirTable(true);
    });
    popup.setPosition(coord);
  }

  function afficherPopupRiviere(f, coord) {
    const p = f.getProperties();
    const i = K.INTENSITES[p.intensite || ""] || K.INTENSITES[""];
    popupListe = [];
    popupEl.style.display = "block";
    popupEl.innerHTML = `
      <div class="popup-head"><span class="mi" style="color:${i.couleur}">water</span><div><h3>${esc(p.nom)}</h3><small>${esc(p.type || "Cours d'eau")}${p.bassin ? ` · bassin ${esc(p.bassin)}` : ""}</small></div>
        <button data-fermer-popup title="Fermer"><span class="mi mi-sm">close</span></button></div>
      <div class="popup-body"><dl class="dl">
        <dt>Impact</dt><dd><span class="badge" style="background:${K.rgba(i.couleur, 0.14)};color:${i.couleur}">${esc(i.libelle)}</span></dd>
        <dt>Longueur dans le Gôh</dt><dd>${p.longueur_km ? `${fmt.n(p.longueur_km, 2)} km` : "—"}</dd>
        ${p.localites ? `<dt>Localités</dt><dd>${esc(p.localites)}</dd>` : ""}
        ${p.commentaire ? `<dt>Commentaire</dt><dd>${esc(p.commentaire)}</dd>` : ""}
      </dl></div>
      <div class="popup-actions"><button class="btn btn-sm" data-pe="cours-modifier"><span class="mi">edit</span>Modifier</button>
        <button class="btn btn-sm" data-pe="cours-retracer"><span class="mi">timeline</span>Retracer</button>
        <button class="btn btn-sm btn-soft-danger" data-pe="cours-effacer"><span class="mi">delete</span>Effacer le tracé</button></div>`;
    popupListe = [f];
    popupIndex = 0;
    popup.setPosition(coord);
  }

  /* ------------------------ Coordonnées & URL ------------------------ */
  const dms = (v, pos, neg) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = ((a - d - m / 60) * 3600).toFixed(1);
    return `${d}°${String(m).padStart(2, "0")}′${s.padStart(4, "0")}″${v >= 0 ? pos : neg}`;
  };
  function formaterCoord(c3857) {
    const sys = $("#systeme-coord", racine).value;
    const [lon, lat] = ol.proj.toLonLat(c3857);
    if (sys === "dms") return `${dms(lat, "N", "S")}  ${dms(lon, "E", "O")}`;
    if (sys === "utm29" || sys === "utm30") {
      const [x, y] = ol.proj.transform(c3857, "EPSG:3857", sys === "utm29" ? "EPSG:32629" : "EPSG:32630");
      return `X ${fmt.n(x)} m · Y ${fmt.n(y)} m`;
    }
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
  C.formaterCoord = formaterCoord;
  $("#systeme-coord", racine).value = stock.get("systeme-coord", "dd");
  ecoute($("#systeme-coord", racine), "change", (e) => stock.set("systeme-coord", e.target.value));

  function ecrireVueUrl() {
    if (signal.aborted || location.pathname !== "/carte") return;
    const [lon, lat] = ol.proj.toLonLat(view.getCenter());
    const z = view.getZoom();
    $("#niveau-zoom", racine).textContent = z.toFixed(1);
    history.replaceState(history.state, "", `/carte#${z.toFixed(2)}/${lat.toFixed(5)}/${lon.toFixed(5)}`);
  }
  function lireVueUrl() {
    const m = location.hash.match(/^#([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/);
    if (!m) return false;
    view.setZoom(Number(m[1]));
    view.setCenter(ol.proj.fromLonLat([Number(m[3]), Number(m[2])]));
    return true;
  }
  map.on("moveend", GR.debounce(ecrireVueUrl, 200));
  map.on("moveend", () => {
    if ($("#table-emprise", racine)?.checked) C.majTable?.();
  });

  /* ------------------------ Boutons de contrôle ---------------------- */
  ecoute(racine, "click", async (e) => {
    const lien = e.target.closest("[data-lien]");
    if (lien) {
      e.preventDefault();
      ctx.naviguer(lien.dataset.lien);
      return;
    }
    if (e.target.closest("[data-deconnexion]")) {
      e.preventDefault();
      ctx.deconnexion();
      return;
    }
    const b = e.target.closest("[data-action]");
    if (!b) return;
    const a = b.dataset.action;
    if (a === "zoom-plus") view.animate({ zoom: view.getZoom() + 1, duration: 220 });
    if (a === "zoom-moins") view.animate({ zoom: view.getZoom() - 1, duration: 220 });
    if (a === "emprise") ajusterEmprise();
    if (a === "accueil") view.animate({ center: ol.proj.fromLonLat(ACCUEIL.centre), zoom: ACCUEIL.zoom, duration: 600 });
    if (a === "plein-ecran") {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.();
    }
    if (a === "partager") {
      try {
        await navigator.clipboard.writeText(location.href);
        GR.toast("Lien de la vue copié dans le presse-papiers");
      } catch {
        GR.toast("Copie impossible : copiez l'adresse de la barre du navigateur.", "warning");
      }
    }
  });
  ecoute(document, "fullscreenchange", () => {
    const btn = $('[data-action="plein-ecran"] .mi', racine);
    if (btn) btn.textContent = document.fullscreenElement ? "fullscreen_exit" : "fullscreen";
    minuteries.add(setTimeout(() => map.updateSize(), 100));
  });

  ecoute($("#reinitialiser", racine), "click", () => {
    $$("#f-departements input", racine).forEach((i) => {
      i.checked = true;
      i.closest(".chip").classList.add("on");
    });
    Object.values(ms).forEach((m) => m.set([]));
    ["#f-supmin", "#f-supmax"].forEach((s) => ($(s, racine).value = ""));
    E.masquees.clear();
    E.selection.clear();
    E.requeteActive = false;
    C.viderRequete?.();
    lireFiltresUI();
    fermerPopup();
    appliquerFiltres({ ajuster: true });
  });

  /* ---------------------------- Recherche ---------------------------- */
  const champRecherche = $("#recherche", racine);
  const zoneResultats = $("#resultats-recherche", racine);
  let resultats = [];
  let indexClavier = -1;
  const sansAccent = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  function rendreResultats(sites, lieux, chargementLieux) {
    const q = sansAccent(champRecherche.value.trim());
    const forets = q ? K.sourceForets.getFeatures().filter((f) => sansAccent(`${f.get("nom")} ${f.get("code") || ""}`).includes(q)).slice(0, 4) : [];
    const rivieres = q ? (E.coursEau || []).filter((c) => sansAccent(c.nom).includes(q)).slice(0, 4) : [];
    resultats = [
      ...sites.map((f) => ({ type: "site", f })),
      ...forets.map((f) => ({ type: "foret", f })),
      ...rivieres.map((c) => ({ type: "riviere", c })),
      ...lieux.map((l) => ({ type: "lieu", l })),
    ];
    indexClavier = -1;
    let i = 0;
    const bloc = (titre, items, rendu) => (items.length ? `<div class="sr-group">${titre}</div>${items.map((x) => rendu(x, i++)).join("")}` : "");
    const html =
      bloc("Sites", sites, (f, k) => `<button data-i="${k}"><span class="mi" style="color:${C.couleurDe(f)}">location_on</span><span><strong>${esc(f.get("code"))} · ${esc(f.get("localite"))}</strong><small>${esc(STATUT[f.get("statut")]?.libelle || "")} · ${esc(f.get("departement"))}${f.get("foret") ? ` · FC ${esc(f.get("foret"))}` : ""}</small></span></button>`) +
      bloc("Forêts classées", forets, (f, k) => `<button data-i="${k}"><span class="mi" style="color:#15803d">forest</span><span><strong>FC ${esc(f.get("nom"))}</strong><small>${fmt.ha(f.get("sup_carto"), 0)}</small></span></button>`) +
      bloc("Cours d'eau", rivieres, (c, k) => `<button data-i="${k}"><span class="mi" style="color:#0284c7">water</span><span><strong>${esc(c.nom)}</strong><small>${c.trace ? "tracé disponible" : "tracé non saisi"} · ${esc((K.INTENSITES[c.intensite || ""] || K.INTENSITES[""]).libelle)}</small></span></button>`) +
      (lieux.length
        ? bloc("Lieux", lieux, (l, k) => `<button data-i="${k}"><span class="mi muted">place</span><span>${esc(l.display_name.split(",").slice(0, 2).join(","))}<small>${esc(l.display_name.split(",").slice(2, 5).join(","))}</small></span></button>`)
        : chargementLieux
          ? '<div class="sr-group">Lieux</div><div class="muted" style="padding:8px 12px"><span class="spinner" style="width:12px;height:12px"></span> Recherche…</div>'
          : "");
    zoneResultats.innerHTML = html || '<div class="muted" style="padding:12px">Aucun résultat</div>';
    zoneResultats.classList.add("open");
  }

  let ctrlLieux;
  const rechercherLieux = GR.debounce(async (q, sites) => {
    ctrlLieux?.abort();
    ctrlLieux = new AbortController();
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=ci&accept-language=fr&q=${encodeURIComponent(q)}`, { signal: ctrlLieux.signal });
      const lieux = await r.json();
      if (champRecherche.value.trim() === q) rendreResultats(sites, lieux, false);
    } catch {
      if (!signal.aborted && champRecherche.value.trim() === q) rendreResultats(sites, [], false);
    }
  }, 450);

  ecoute(champRecherche, "input", () => {
    const q = sansAccent(champRecherche.value.trim());
    if (!q) return zoneResultats.classList.remove("open");
    const sites = [...tousLesSites.values()]
      .filter((f) => ["code", "localite", "foret", "cours_eau", "sous_prefecture"].some((k) => sansAccent(f.get(k)).includes(q)))
      .sort((a, b) => String(a.get("code")).localeCompare(String(b.get("code")), "fr", { numeric: true }))
      .slice(0, 8);
    rendreResultats(sites, [], q.length >= 3);
    if (q.length >= 3) rechercherLieux(champRecherche.value.trim(), sites);
    return undefined;
  });
  function choisirResultat(i) {
    const r = resultats[i];
    if (!r) return;
    zoneResultats.classList.remove("open");
    if (r.type === "site") {
      champRecherche.value = `${r.f.get("code")} ${r.f.get("localite")}`;
      if (!sourceSites.getFeatureById(r.f.getId())) {
        GR.toast("Ce site est masqué par les filtres en cours : filtres réinitialisés.", "info");
        $("#reinitialiser", racine).click();
      }
      C.selectionner([r.f.getId()], { zoom: true });
      minuteries.add(setTimeout(() => afficherPopup([r.f], centreDe(r.f)), 750));
    } else if (r.type === "foret") {
      champRecherche.value = `FC ${r.f.get("nom")}`;
      view.fit(r.f.getGeometry().getExtent(), { padding: [60, 60, 60, 60], duration: 700 });
      minuteries.add(setTimeout(() => afficherPopupForet(r.f, r.f.getGeometry().getInteriorPoint().getCoordinates().slice(0, 2)), 750));
    } else if (r.type === "riviere") {
      champRecherche.value = r.c.nom;
      const f = K.sourceCoursEau.getFeatures().find((x) => x.get("id") === r.c.id);
      if (f) view.fit(f.getGeometry().getExtent(), { padding: [60, 60, 60, 60], duration: 700 });
      else GR.toast(`Le tracé du ${r.c.nom} n'est pas encore saisi.`, "info");
    } else {
      const bb = r.l.boundingbox?.map(Number);
      if (bb) view.fit(ol.proj.transformExtent([bb[2], bb[0], bb[3], bb[1]], "EPSG:4326", "EPSG:3857"), { duration: 700, maxZoom: 15 });
      else view.animate({ center: ol.proj.fromLonLat([Number(r.l.lon), Number(r.l.lat)]), zoom: 14, duration: 700 });
      C.placerRepere?.(ol.proj.fromLonLat([Number(r.l.lon), Number(r.l.lat)]), r.l.display_name.split(",")[0]);
    }
  }
  ecoute(zoneResultats, "click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (b) choisirResultat(Number(b.dataset.i));
  });
  ecoute(champRecherche, "keydown", (e) => {
    const boutons = $$("button[data-i]", zoneResultats);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      indexClavier = Math.max(0, Math.min(boutons.length - 1, indexClavier + (e.key === "ArrowDown" ? 1 : -1)));
      boutons.forEach((b, i) => b.classList.toggle("focus", i === indexClavier));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choisirResultat(indexClavier >= 0 ? Number(boutons[indexClavier].dataset.i) : 0);
    } else if (e.key === "Escape") zoneResultats.classList.remove("open");
  });
  ecoute(document, "click", (e) => {
    if (!e.target.closest(".geo-search")) zoneResultats.classList.remove("open");
  });
  ecoute(document, "keydown", (e) => {
    if (e.key === "/" && !e.target.closest("input, textarea, select")) {
      e.preventDefault();
      champRecherche.focus();
    }
  });

  /* ------------------------- Table attributaire ---------------------- */
  const COLONNES = [
    { cle: "code", titre: "Code", rendu: (l) => `<span class="row"><i style="width:10px;height:10px;border-radius:50%;background:${C.couleurDe(l.f)}"></i><strong>${esc(l.code)}</strong></span>` },
    { cle: "localite", titre: "Localité" },
    { cle: "departement", titre: "Département" },
    { cle: "sous_prefecture", titre: "Sous-préfecture" },
    { cle: "domaine", titre: "Domaine", rendu: (l) => esc(l.domaine === "foret_classee" ? `FC ${l.foret || ""}` : "Rural") },
    { cle: "cours_eau", titre: "Cours d'eau" },
    { cle: "statut", titre: "Statut", rendu: (l) => badgeStatut(l.statut), tri: (l) => K.STATUTS.findIndex((s) => s.cle === l.statut) },
    { cle: "dernier_constat", titre: "Dernier constat", rendu: (l) => dateFr(l.dernier_constat) },
    { cle: "superficie_ha", titre: "Superficie (ha)", num: true, rendu: (l) => (l.superficie_ha ? fmt.n(l.superficie_ha, 2) : "—") },
    { cle: "priorite", titre: "Priorité", rendu: (l) => (l.priorite === "haute" ? '<span class="badge red">Haute</span>' : "Normale") },
    { cle: "coord_alerte", titre: "", trier: false, rendu: (l) => (l.coord_alerte ? `<span class="mi mi-sm" style="color:var(--danger)" title="${esc(l.coord_alerte)}">wrong_location</span>` : "") },
    { cle: "actions", titre: "", trier: false, rendu: (l) => `<button class="btn btn-ghost btn-sm btn-icon" data-fiche-site="${esc(l.id)}" title="Fiche du site"><span class="mi">description</span></button>` },
  ];

  function lignesTable() {
    let feats = featuresVisibles();
    if ($("#table-emprise", racine).checked) {
      const ext = view.calculateExtent(map.getSize());
      feats = feats.filter((f) => ol.extent.intersects(ext, f.getGeometry().getExtent()));
    }
    if ($("#table-selectionnees", racine).checked) feats = feats.filter((f) => E.selection.has(f.getId()));
    const q = sansAccent($("#table-recherche", racine).value.trim());
    if (q) feats = feats.filter((f) => ["code", "localite", "departement", "sous_prefecture", "foret", "cours_eau"].some((k) => sansAccent(f.get(k)).includes(q)));
    return feats.map((f) => ({ ...f.getProperties(), id: f.getId(), f, geometry: undefined, statut_libelle: STATUT[f.get("statut")]?.libelle }));
  }
  C.lignesTable = lignesTable;

  const table = GR.table($("#table-sites", racine), {
    colonnes: COLONNES,
    lignes: [],
    compact: true,
    tri: "code",
    vide: "Aucun site pour ces critères",
    estSelectionnee: (l) => E.selection.has(l.id),
    onClick: (l, tr, e) => {
      const multi = e.ctrlKey || e.metaKey || e.shiftKey;
      C.selectionner([l.id], { basculer: multi, zoom: !multi });
    },
    pied: (lignes) =>
      `<td colspan="8">${lignes.length} site(s) · ${lignes.filter((l) => ["actif", "recolonise"].includes(l.statut)).length} actif(s)</td><td class="num">${fmt.n(
        lignes.reduce((s, l) => s + (Number(l.superficie_ha) || 0), 0),
        2
      )}</td><td colspan="3"></td>`,
  });

  C.majTable = function majTable({ defiler = false } = {}) {
    if (!document.body.classList.contains("drawer-open")) {
      $("#table-compte", racine).textContent = featuresVisibles().length;
      majCompteSelection();
      return;
    }
    const lignes = lignesTable();
    table.maj(lignes);
    $("#table-compte", racine).textContent = lignes.length;
    majCompteSelection();
    if (defiler) $("#table-sites tr.selected", racine)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  function majCompteSelection() {
    const n = E.selection.size;
    $("#table-selection", racine).textContent = `${n} sélectionné${n > 1 ? "s" : ""}`;
    $("#table-selection", racine).classList.toggle("hidden", !n);
  }
  ecoute($("#table-sites", racine), "click", (e) => {
    const b = e.target.closest("[data-fiche-site]");
    if (b) ctx.naviguer(`/sites?site=${encodeURIComponent(b.dataset.ficheSite)}`);
  });
  ecoute($("#table-recherche", racine), "input", GR.debounce(() => C.majTable(), 200));
  ["#table-emprise", "#table-selectionnees"].forEach((s) => ecoute($(s, racine), "change", () => C.majTable()));
  ecoute($("#table-vider-selection", racine), "click", () => C.selectionner([]));

  function ouvrirTable(ouvrir = !document.body.classList.contains("drawer-open")) {
    document.body.classList.toggle("drawer-open", ouvrir);
    if (!ouvrir) document.body.classList.remove("drawer-max");
    minuteries.add(setTimeout(() => map.updateSize(), 240));
    C.majTable();
  }
  C.ouvrirTable = ouvrirTable;
  ecoute($("#ouvrir-table", racine), "click", () => ouvrirTable(true));
  ecoute($("#table-fermer", racine), "click", () => ouvrirTable(false));
  ecoute($("#table-agrandir", racine), "click", () => {
    document.body.classList.toggle("drawer-max");
    $("#table-agrandir .mi", racine).textContent = document.body.classList.contains("drawer-max") ? "close_fullscreen" : "open_in_full";
    minuteries.add(setTimeout(() => map.updateSize(), 240));
  });

  /* ------------------------------ Outils ----------------------------- */
  const arreterOutils = initOutils(C, { racine, ecoute, signal });
  const arreterEdition = initEdition(C, { racine, ecoute, signal, ctx });
  const arreterImagerie = initImagerie(C, { racine, ecoute, signal });
  const arreterProspection = initProspection(C, { racine, ecoute, signal, ctx });

  /* ------------------------------ Init ------------------------------- */
  appliquerRegroupement();
  majListeCouches();
  lireFiltresUI();
  K.sourceForets.once?.("featuresloadend", () => !signal.aborted && majLegende());
  charger();

  return function demonter() {
    abandon.abort();
    arreterLecture();
    minuteries.forEach(clearTimeout);
    arreterOutils?.();
    arreterEdition?.();
    arreterImagerie?.();
    arreterProspection?.();
    Object.keys(GR.charts).forEach((id) => {
      if (id === "mini-graphe") {
        GR.charts[id].destroy();
        delete GR.charts[id];
      }
    });
    map.setTarget(null);
    document.body.classList.remove("geo", "panel-closed", "drawer-open", "drawer-max", "nav-open");
    racine.innerHTML = "";
  };
}
