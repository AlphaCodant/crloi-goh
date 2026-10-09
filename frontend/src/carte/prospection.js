/* =====================================================================
   CRLOI Gôh — Carte : prospection satellitaire (GEE) et zones suspectes
   Lancer une analyse sur une zone, trier les zones suspectes, les vérifier,
   les regrouper en missions d'éclairage, les transformer en sites.
   ===================================================================== */
import GR from "../gr/gr";
import { api } from "../api";
import * as K from "./couches";
import { formulaire } from "./formulaire";

const ol = window.ol;
const { esc, fmt, $, $$ } = GR;
const J = 864e5;
const ajouter = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * J).toISOString().slice(0, 10);
const dateFr = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");
const aujourdhui = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const STATUTS_CIBLE = [
  { cle: "a_verifier", libelle: "À vérifier", couleur: "#d97706" },
  { cle: "programmee", libelle: "Mission programmée", couleur: "#2563eb" },
  { cle: "confirmee", libelle: "Confirmée", couleur: "#9d174d" },
  { cle: "infirmee", libelle: "Infirmée", couleur: "#64748b" },
  { cle: "ecartee", libelle: "Écartée", couleur: "#94a3b8" },
];
const STATUT_C = Object.fromEntries(STATUTS_CIBLE.map((s) => [s.cle, s]));
const NIVEAUX = { forte: { libelle: "Forte", couleur: "#dc2626" }, moyenne: { libelle: "Moyenne", couleur: "#f97316" }, faible: { libelle: "Faible", couleur: "#eab308" } };
const ORIGINES = { gee: "Détection satellite (GEE)", manuelle: "Photo-interprétation", drone: "Survol drone", renseignement: "Renseignement" };
const STATUTS_SITE = K.STATUTS.filter((s) => s.cle !== "inconnu").map((s) => ({ value: s.cle, label: s.libelle }));

export function initProspection(C, { racine, ecoute, ctx }) {
  const map = C.map;
  const view = map.getView();
  const E = C.etat;
  const pane = $("#pane-prospection", racine);
  const fmtGeo = () => C.formatGeo;
  let cibles = [];
  let analyses = [];
  let geeOk = false;
  const filtres = { statuts: new Set(["a_verifier", "programmee"]), niveau: "", analyse: "" };
  const cochees = new Set();
  let zoneDessinee = null;

  /* ============================ Couche ================================ */
  const source = new ol.source.Vector();
  const styleCache = new Map();
  const couche = new ol.layer.Vector({
    source,
    zIndex: 14,
    style: (f, res) => {
      const c = f.get("cible");
      const st = STATUT_C[c.statut] || STATUT_C.a_verifier;
      const actif = ["a_verifier", "programmee"].includes(c.statut);
      const coul = actif ? (NIVEAUX[c.niveau] || NIVEAUX.moyenne).couleur : st.couleur;
      const k = `${coul}|${c.statut}|${cochees.has(c.id)}|${res < 30 ? c.code : ""}`;
      let s = styleCache.get(k);
      if (!s) {
        s = [
          new ol.style.Style({
            fill: new ol.style.Fill({ color: K.rgba(coul, actif ? 0.35 : 0.15) }),
            stroke: new ol.style.Stroke({ color: c.statut === "programmee" ? "#2563eb" : coul, width: cochees.has(c.id) ? 4 : 2.2, lineDash: c.statut === "programmee" ? [6, 4] : undefined }),
            text:
              res < 30
                ? new ol.style.Text({ text: c.code, font: "700 11px 'Inter Variable', Inter, sans-serif", fill: new ol.style.Fill({ color: "#7c2d12" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }), overflow: true })
                : undefined,
          }),
          // Repère visible à petite échelle (les zones font souvent moins d'un hectare)
          new ol.style.Style({
            geometry: (feat) => new ol.geom.Point(ol.proj.fromLonLat([feat.get("cible").lng, feat.get("cible").lat])),
            image: new ol.style.RegularShape({ points: 3, radius: res > 20 ? 8 : 0.1, fill: new ol.style.Fill({ color: coul }), stroke: new ol.style.Stroke({ color: "#fff", width: 1.5 }) }),
          }),
        ];
        styleCache.set(k, s);
      }
      return s;
    },
  });
  map.addLayer(couche);
  C.couchesSupplementaires = [
    ...(C.couchesSupplementaires || []),
    { id: "cibles", nom: "Zones suspectes", detail: "Prospection satellite et signalements", couleur: "#f97316", couche },
  ];
  C.majListeCouches();

  /* ============================ Panneau =============================== */
  const fin0 = E.date || aujourdhui();
  pane.innerHTML = `
    <div class="panel-section">
      <h3><span class="mi mi-sm">radar</span>Lancer une prospection</h3>
      <div id="pro-etat" class="mb-2"></div>
      <div class="stack" style="gap:10px">
        <div class="field"><label>Zone à analyser</label><select class="select sm" id="pro-zone"></select>
          <div class="row mt-1"><button class="btn btn-ghost btn-sm hidden" id="pro-dessiner"><span class="mi">draw</span>Dessiner la zone</button><span class="muted" id="pro-surface" style="font-size:12px"></span></div></div>
        <div class="field"><label>Période récente</label><div class="row"><input class="input sm" type="date" id="pro-rec-du" value="${ajouter(fin0, -120)}"><span class="muted">au</span><input class="input sm" type="date" id="pro-rec-au" value="${fin0}"></div></div>
        <div class="field"><label>Période de référence <span class="muted" style="font-weight:500">même saison, un an plus tôt</span></label><div class="row"><input class="input sm" type="date" id="pro-ref-du" value="${ajouter(fin0, -485)}"><span class="muted">au</span><input class="input sm" type="date" id="pro-ref-au" value="${ajouter(fin0, -365)}"></div></div>
        <details class="avance"><summary>Seuils de détection</summary>
          <div class="form-grid mt-2">
            <div class="field"><label>Perte de NDVI min.</label><input class="input sm" type="number" step="0.05" id="pro-dndvi" value="0.2"></div>
            <div class="field"><label>Sol nu (BSI) min.</label><input class="input sm" type="number" step="0.01" id="pro-bsi" value="0.05"></div>
            <div class="field"><label>Surface min. (ha)</label><input class="input sm" type="number" step="0.1" id="pro-surf" value="0.5"></div>
            <div class="field"><label>Nuages max. (%)</label><input class="input sm" type="number" step="5" id="pro-nuages" value="60"></div>
          </div>
        </details>
        <button class="btn btn-primary btn-sm" id="pro-lancer"><span class="mi">play_arrow</span>Lancer l'analyse</button>
        <p class="muted" style="font-size:11.5px">Sentinel-2 (10 m) : perte de végétation entre les deux périodes, sol mis à nu ou bassins d'eau turbide, hors bâti et eau permanente. Chaque zone reçoit un score (végétation 35 %, sol nu 25 %, turbidité 10 %, proximité d'un cours d'eau 20 %, surface 10 %).</p>
      </div>
    </div>

    <div class="panel-section">
      <h3><span class="mi mi-sm">report</span>Zones suspectes <span class="badge" id="pro-nb">0</span></h3>
      <div class="chips mb-2" id="pro-statuts">${STATUTS_CIBLE.map((s) => `<label class="chip ${filtres.statuts.has(s.cle) ? "on" : ""}"><input type="checkbox" value="${s.cle}" ${filtres.statuts.has(s.cle) ? "checked" : ""}>${esc(s.libelle)}</label>`).join("")}</div>
      <div class="row mb-2"><select class="select sm" id="pro-niveau"><option value="">Tous niveaux</option><option value="forte">Suspicion forte</option><option value="moyenne">Moyenne</option><option value="faible">Faible</option></select>
        <select class="select sm" id="pro-analyse"><option value="">Toutes origines</option></select></div>
      <div class="row-wrap mb-2">
        <label class="switch" style="font-size:12px"><input type="checkbox" id="pro-tout">Tout cocher</label>
        <button class="btn btn-sm btn-primary" id="pro-mission" disabled><span class="mi">assignment_add</span>Mission d'éclairage</button>
        <button class="btn btn-sm" id="pro-ecarter" disabled title="Écarter les zones cochées"><span class="mi">block</span>Écarter</button>
        <button class="btn btn-sm btn-ghost" data-prospection="dessiner-cible" title="Signaler une zone"><span class="mi">add</span>Signaler</button>
      </div>
      <div id="pro-liste" class="cible-liste"></div>
    </div>

    <div class="panel-section">
      <h3><span class="mi mi-sm">history</span>Analyses précédentes</h3>
      <div id="pro-analyses"></div>
    </div>`;

  /* ----------------------- Zones disponibles -------------------------- */
  function optionsZones() {
    const sel = $("#pro-zone", pane);
    const cur = sel.value;
    const fcs = K.sourceForets.getFeatures().map((f) => f.get("nom")).filter(Boolean).sort();
    const zs = K.sourceZones.getFeatures();
    sel.innerHTML = `<option value="vue">Emprise visible de la carte</option><option value="dessin">Zone dessinée…</option>
      ${zs.length ? `<optgroup label="Zones de travail">${zs.map((z) => `<option value="zone:${esc(z.get("id"))}">${esc(z.get("nom"))}</option>`).join("")}</optgroup>` : ""}
      ${fcs.length ? `<optgroup label="Forêts classées">${fcs.map((n) => `<option value="fc:${esc(n)}">FC ${esc(n)}</option>`).join("")}</optgroup>` : ""}`;
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
    majZone();
  }
  function geometrieZone() {
    const v = $("#pro-zone", pane).value;
    if (v === "vue") {
      const ext = view.calculateExtent(map.getSize());
      return { geom: ol.geom.Polygon.fromExtent(ext), nom: "emprise visible" };
    }
    if (v === "dessin") return zoneDessinee ? { geom: zoneDessinee, nom: "zone dessinée" } : null;
    if (v.startsWith("zone:")) {
      const f = K.sourceZones.getFeatures().find((z) => z.get("id") === v.slice(5));
      return f ? { geom: f.getGeometry(), nom: f.get("nom") } : null;
    }
    if (v.startsWith("fc:")) {
      const f = K.sourceForets.getFeatures().find((z) => z.get("nom") === v.slice(3));
      return f ? { geom: f.getGeometry(), nom: `FC ${f.get("nom")}` } : null;
    }
    return null;
  }
  function majZone() {
    const v = $("#pro-zone", pane).value;
    $("#pro-dessiner", pane).classList.toggle("hidden", v !== "dessin");
    const z = geometrieZone();
    $("#pro-surface", pane).textContent = z ? `${fmt.n(ol.sphere.getArea(z.geom) / 1e6, 0)} km²` : v === "dessin" ? "Dessinez la zone sur la carte" : "";
  }
  ecoute($("#pro-zone", pane), "change", () => {
    majZone();
    const z = geometrieZone();
    if (z && $("#pro-zone", pane).value !== "vue") view.fit(z.geom.getExtent(), { padding: [60, 60, 160, 60], duration: 500 });
  });
  map.on("moveend", () => $("#pro-zone", pane)?.value === "vue" && majZone());
  ecoute($("#pro-dessiner", pane), "click", () => {
    C.editer({
      type: "Polygon",
      mode: "dessiner",
      texte: "Zone à analyser : cliquez les sommets, double-cliquez pour fermer",
      enregistrer: async (gj, g) => {
        zoneDessinee = g.clone();
        majZone();
        $('.panel-tabs [data-pane="prospection"]', racine).click();
      },
    });
  });
  C.prospecterZone = (f) => {
    $('.panel-tabs [data-pane="prospection"]', racine).click();
    if (document.body.classList.contains("panel-closed")) $("#bascule-panneau", racine).click();
    optionsZones();
    $("#pro-zone", pane).value = `zone:${f.get("id")}`;
    majZone();
  };

  /* ----------------------------- État GEE ----------------------------- */
  async function majEtat() {
    try {
      geeOk = (await api("/gee/etat")).configure;
    } catch {
      geeOk = false;
    }
    $("#pro-etat", pane).innerHTML = geeOk
      ? ""
      : '<div class="alert warning" style="font-size:12px"><span class="mi mi-sm">key_off</span><span>Earth Engine n\'est pas encore relié au serveur : la prospection automatique sera disponible dès que la clé sera ajoutée. Vous pouvez déjà signaler des zones à la main.</span></div>';
    $("#pro-lancer", pane).disabled = !geeOk;
  }

  /* --------------------------- Lancement ------------------------------ */
  ecoute($("#pro-lancer", pane), "click", async (e) => {
    const b = e.currentTarget;
    const z = geometrieZone();
    if (!z) return GR.toast("Choisissez ou dessinez la zone à analyser", "warning");
    const km2 = ol.sphere.getArea(z.geom) / 1e6;
    if (km2 > 6000) return GR.toast(`Zone trop grande (${fmt.n(km2)} km²) : 6 000 km² au plus. Zoomez ou choisissez une forêt.`, "warning", 7000);
    const corps = {
      zone: fmtGeo().writeGeometryObject(z.geom, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857", decimals: 6 }),
      zone_nom: z.nom,
      ref_du: $("#pro-ref-du", pane).value,
      ref_au: $("#pro-ref-au", pane).value,
      rec_du: $("#pro-rec-du", pane).value,
      rec_au: $("#pro-rec-au", pane).value,
      parametres: {
        dndvi_min: Number($("#pro-dndvi", pane).value),
        bsi_min: Number($("#pro-bsi", pane).value),
        surface_min_ha: Number($("#pro-surf", pane).value),
        nuages_max: Number($("#pro-nuages", pane).value),
      },
    };
    b.disabled = true;
    b.innerHTML = `<span class="spinner" style="width:14px;height:14px"></span>Analyse en cours (${fmt.n(km2)} km²)…`;
    try {
      const r = await api("/analyses", { method: "POST", body: corps });
      GR.toast(`${r.cibles.length} nouvelle(s) zone(s) suspecte(s) détectée(s) — ${r.analyse.images.reference} et ${r.analyse.images.recente} scène(s) utilisées`, r.cibles.length ? "success" : "info", 7000);
      filtres.analyse = r.analyse.id;
      filtres.statuts = new Set(["a_verifier", "programmee"]);
      await charger();
      if (r.cibles.length) ajuster(r.cibles);
    } catch (x) {
      GR.toast(x.message, "error", 10000);
    } finally {
      b.disabled = !geeOk;
      b.innerHTML = '<span class="mi">play_arrow</span>Lancer l\'analyse';
    }
    return undefined;
  });

  /* --------------------------- Chargement ----------------------------- */
  let cibleUrl = new URLSearchParams(location.search).get("cible");
  async function charger() {
    try {
      [cibles, analyses] = await Promise.all([api("/cibles"), api("/analyses")]);
    } catch {
      return;
    }
    if (cibleUrl) {
      const c = cibles.find((x) => x.id === cibleUrl);
      if (c) filtres.statuts.add(c.statut);
    }
    rendre();
    if (cibleUrl) {
      const f = source.getFeatureById(`cible-${cibleUrl}`);
      cibleUrl = null;
      if (f) {
        const c = f.get("cible");
        ajuster([c]);
        setTimeout(() => afficherPopup(f, ol.proj.fromLonLat([c.lng, c.lat])), 700);
      }
    }
  }
  C.rechargerCibles = charger;

  const visibles = () =>
    cibles.filter(
      (c) =>
        filtres.statuts.has(c.statut) &&
        (!filtres.niveau || c.niveau === filtres.niveau) &&
        (!filtres.analyse || (filtres.analyse === "_main" ? c.origine !== "gee" : c.analyse_id === filtres.analyse))
    );

  function rendre() {
    const sel = $("#pro-analyse", pane);
    sel.innerHTML = `<option value="">Toutes origines</option><option value="_main">Signalements (hors GEE)</option>${analyses
      .map((a) => `<option value="${a.id}">${esc(a.nom)} (${a.nb_cibles})</option>`)
      .join("")}`;
    sel.value = filtres.analyse;
    const v = visibles();
    [...cochees].forEach((id) => !v.some((c) => c.id === id) && cochees.delete(id));
    source.clear();
    source.addFeatures(
      v.map((c) => {
        const f = new ol.Feature({ geometry: fmtGeo().readGeometry(c.geometrie, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }), cible: c });
        f.setId(`cible-${c.id}`);
        return f;
      })
    );
    styleCache.clear();
    $("#pro-nb", pane).textContent = v.length;
    const aVerifier = cibles.filter((c) => c.statut === "a_verifier").length;
    $("#nb-cibles", racine).textContent = aVerifier;
    $("#nb-cibles", racine).classList.toggle("hidden", !aVerifier);
    $("#pro-liste", pane).innerHTML = v.length
      ? v
          .map((c) => {
            const n = NIVEAUX[c.niveau] || NIVEAUX.moyenne;
            const st = STATUT_C[c.statut];
            return `<div class="cible-ligne ${cochees.has(c.id) ? "on" : ""}" data-cible="${c.id}">
              <input type="checkbox" ${cochees.has(c.id) ? "checked" : ""} aria-label="Cocher ${esc(c.code)}">
              <i style="background:${n.couleur}"></i>
              <span class="cl-code">${esc(c.code)}<small>${fmt.ha(c.superficie_ha, 1)}${c.score !== null ? ` · score ${fmt.n(c.score * 100, 0)}` : ` · ${esc(ORIGINES[c.origine] || c.origine)}`}</small></span>
              <span class="badge" style="background:${K.rgba(st.couleur, 0.14)};color:${st.couleur}">${esc(st.libelle)}</span>
            </div>`;
          })
          .join("")
      : '<div class="muted" style="font-size:12.5px;padding:6px 0">Aucune zone pour ces filtres.</div>';
    $("#pro-analyses", pane).innerHTML = analyses.length
      ? analyses
          .map(
            (a) => `<div class="analyse-ligne" data-analyse="${a.id}"><div><strong>${esc(a.nom)}</strong><small>${dateFr(a.ref_du)} – ${dateFr(a.ref_au)} → ${dateFr(a.rec_du)} – ${dateFr(a.rec_au)} · ${a.nb_cibles} zone(s)</small></div>
              <button class="btn btn-ghost btn-icon btn-sm" data-an="voir" title="Afficher la zone analysée"><span class="mi">crop_free</span></button>
              <button class="btn btn-ghost btn-icon btn-sm" data-an="comparer" title="Images avant / après"><span class="mi">compare</span></button>
              <button class="btn btn-ghost btn-icon btn-sm" data-an="supprimer" title="Supprimer"><span class="mi" style="color:var(--danger)">delete</span></button></div>`
          )
          .join("")
      : '<div class="muted" style="font-size:12.5px">Aucune analyse lancée.</div>';
    majBoutons();
  }

  function majBoutons() {
    $("#pro-mission", pane).disabled = !cochees.size;
    $("#pro-ecarter", pane).disabled = !cochees.size;
    $("#pro-mission", pane).innerHTML = `<span class="mi">assignment_add</span>Mission d'éclairage${cochees.size ? ` (${cochees.size})` : ""}`;
    $("#pro-tout", pane).checked = cochees.size && cochees.size === visibles().length;
  }

  function ajuster(liste) {
    const ext = ol.extent.createEmpty();
    liste.forEach((c) => ol.extent.extend(ext, fmtGeo().readGeometry(c.geometrie, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }).getExtent()));
    if (Number.isFinite(ext[0])) view.fit(ext, { padding: [80, 80, 160, 80], duration: 600, maxZoom: 16 });
  }

  /* ------------------------- Interactions liste ------------------------ */
  ecoute($("#pro-statuts", pane), "change", (e) => {
    e.target.closest(".chip").classList.toggle("on", e.target.checked);
    filtres.statuts = new Set($$("#pro-statuts input:checked", pane).map((i) => i.value));
    rendre();
  });
  ecoute($("#pro-niveau", pane), "change", (e) => {
    filtres.niveau = e.target.value;
    rendre();
  });
  ecoute($("#pro-analyse", pane), "change", (e) => {
    filtres.analyse = e.target.value;
    rendre();
  });
  ecoute($("#pro-tout", pane), "change", (e) => {
    cochees.clear();
    if (e.target.checked) visibles().forEach((c) => cochees.add(c.id));
    rendre();
  });
  ecoute($("#pro-liste", pane), "click", (e) => {
    const l = e.target.closest("[data-cible]");
    if (!l) return;
    const c = cibles.find((x) => x.id === l.dataset.cible);
    if (e.target.matches("input[type=checkbox]")) {
      if (e.target.checked) cochees.add(c.id);
      else cochees.delete(c.id);
      l.classList.toggle("on", e.target.checked);
      styleCache.clear();
      couche.changed();
      majBoutons();
      return;
    }
    const f = source.getFeatureById(`cible-${c.id}`);
    ajuster([c]);
    if (f) setTimeout(() => afficherPopup(f, ol.proj.fromLonLat([c.lng, c.lat])), 650);
  });
  ecoute($("#pro-analyses", pane), "click", async (e) => {
    const b = e.target.closest("[data-an]");
    if (!b) return;
    const a = analyses.find((x) => x.id === b.closest("[data-analyse]").dataset.analyse);
    if (b.dataset.an === "voir") {
      const g = fmtGeo().readGeometry(a.zone, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
      C.placerRepere?.(ol.extent.getCenter(g.getExtent()), a.nom);
      view.fit(g.getExtent(), { padding: [60, 60, 160, 60], duration: 600 });
      filtres.analyse = a.id;
      rendre();
    }
    if (b.dataset.an === "comparer") C.comparerPeriodes?.({ avant: [a.ref_du, a.ref_au], apres: [a.rec_du, a.rec_au] });
    if (b.dataset.an === "supprimer") {
      const v = await formulaire({
        titre: "Supprimer l'analyse ?",
        icone: "delete",
        champs: [{ nom: "avec", libelle: "Supprimer aussi ses zones non traitées (à vérifier ou écartées)", type: "checkbox", valeur: true, pleine: true }],
        ok: "Supprimer",
        danger: true,
      });
      if (!v) return;
      await api(`/analyses/${a.id}`, { method: "DELETE", params: { avec_cibles: v.avec } });
      if (filtres.analyse === a.id) filtres.analyse = "";
      await charger();
      GR.toast("Analyse supprimée");
    }
  });

  /* ------------------------------ Popup -------------------------------- */
  function contenu(c) {
    const n = NIVEAUX[c.niveau] || NIVEAUX.moyenne;
    const st = STATUT_C[c.statut];
    const ind = c.indices || {};
    const site = c.site_proche_id ? E.sites.find((s) => s.id === c.site_proche_id) : null;
    const lien = c.site_id ? E.sites.find((s) => s.id === c.site_id) : null;
    const ligne = (lib, v, aide) => (v === null || v === undefined ? "" : `<dt title="${esc(aide)}">${lib}</dt><dd class="num">${v}</dd>`);
    return `
      <div class="popup-head"><span class="mi" style="color:${n.couleur}">report</span>
        <div><h3>Zone suspecte ${esc(c.code)}</h3><small>${esc(ORIGINES[c.origine] || c.origine)} · ${fmt.ha(c.superficie_ha, 2)}</small></div>
        <button data-fermer-popup title="Fermer"><span class="mi mi-sm">close</span></button></div>
      <div class="popup-body" style="max-height:340px;overflow:auto">
        <div class="row mb-2" style="justify-content:space-between"><span class="badge" style="background:${K.rgba(st.couleur, 0.14)};color:${st.couleur}">${esc(st.libelle)}</span>
          ${c.score !== null ? `<span class="muted" style="font-size:12px">Suspicion <strong style="color:${n.couleur}">${esc(n.libelle.toLowerCase())}</strong></span>` : ""}</div>
        ${c.score !== null ? `<div class="progress-label"><span>Score</span><strong>${fmt.n(c.score * 100, 0)} / 100</strong></div><div class="progress ${c.score < 0.45 ? "amber" : "red"}"><span style="width:${c.score * 100}%"></span></div>` : ""}
        <dl class="dl mt-3">
          ${ligne("Perte de NDVI", ind.dndvi !== undefined && ind.dndvi !== null ? fmt.n(ind.dndvi, 2) : null, "NDVI avant − NDVI après : plus c'est élevé, plus la végétation a disparu")}
          ${ligne("Sol nu (BSI)", ind.bsi !== undefined && ind.bsi !== null ? fmt.n(ind.bsi, 2) : null, "Indice de sol nu sur l'image récente")}
          ${ligne("Turbidité (NDTI)", ind.ndti !== undefined && ind.ndti !== null ? fmt.n(ind.ndti, 2) : null, "Eau chargée en sédiments")}
          ${ligne("Distance à l'eau", ind.dist_eau_m !== undefined && ind.dist_eau_m !== null ? `${fmt.n(ind.dist_eau_m)} m` : null, "Distance au cours d'eau ou plan d'eau le plus proche")}
          <dt>Coordonnées</dt><dd class="num">${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</dd>
          ${site ? `<dt>Site connu proche</dt><dd>${esc(site.code)} · ${fmt.n(c.site_proche_m)} m</dd>` : ""}
          ${lien ? `<dt>Site enregistré</dt><dd><strong>${esc(lien.code)}</strong> ${esc(lien.localite)}</dd>` : ""}
        </dl>
        ${c.note ? `<div class="alert info mt-3" style="font-size:12px"><span class="mi mi-sm">notes</span><span>${esc(c.note)}</span></div>` : ""}
        ${(c.historique || []).length ? `<h4 style="font-size:12px;margin:12px 0 4px">Suivi</h4>${c.historique.slice(-4).reverse().map((h) => `<div class="muted" style="font-size:11.5px">${dateFr(h.at.slice(0, 10))} · ${esc(h.by)} — ${esc(STATUT_C[h.action]?.libelle || h.action)}${h.note ? ` : ${esc(h.note)}` : ""}</div>`).join("")}` : ""}
      </div>
      <div class="popup-actions">
        <button class="btn btn-sm btn-primary" data-pc="avant-apres"><span class="mi">compare</span>Avant / après</button>
        ${c.site_id ? "" : '<button class="btn btn-sm" data-pc="confirmer"><span class="mi">add_location_alt</span>Confirmer → site</button>'}
        <button class="btn btn-sm" data-pc="mission"><span class="mi">assignment_add</span>Mission</button>
      </div>
      <div class="popup-actions edition">
        ${c.statut !== "infirmee" ? '<button class="btn btn-sm btn-ghost" data-pc="infirmer"><span class="mi">cancel</span>Infirmer</button>' : ""}
        ${c.statut !== "ecartee" ? '<button class="btn btn-sm btn-ghost" data-pc="ecarter"><span class="mi">block</span>Écarter</button>' : ""}
        ${c.statut !== "a_verifier" ? '<button class="btn btn-sm btn-ghost" data-pc="reverifier"><span class="mi">undo</span>À vérifier</button>' : ""}
        <button class="btn btn-sm btn-ghost" data-pc="note"><span class="mi">edit_note</span>Note</button>
        <button class="btn btn-sm btn-ghost" data-pc="contour"><span class="mi">edit_road</span>Contour</button>
        <button class="btn btn-sm btn-ghost danger" data-pc="supprimer" title="Supprimer"><span class="mi">delete</span></button>
      </div>`;
  }
  let enCours = null;
  function afficherPopup(f, coord) {
    enCours = f.get("cible");
    C.ouvrirPopupHtml(contenu(enCours), coord, []);
  }

  const clicPrecedent = C.clicSupplementaire;
  C.clicSupplementaire = (evt) => {
    if (couche.getVisible()) {
      let f = null;
      map.forEachFeatureAtPixel(evt.pixel, (x) => (f = x), { layerFilter: (l) => l === couche, hitTolerance: 4 });
      if (f) {
        afficherPopup(f, evt.coordinate);
        return true;
      }
    }
    return clicPrecedent?.(evt) || false;
  };
  // Les zones suspectes passent avant les sites dans l'ordre des clics quand elles sont dessus
  map.on("pointermove", (evt) => {
    if (evt.dragging || C.editionActive) return;
    if (map.hasFeatureAtPixel(evt.pixel, { layerFilter: (l) => l === couche, hitTolerance: 4 })) map.getTargetElement().style.cursor = "pointer";
  });

  async function changerStatut(c, statut, demander) {
    let commentaire = "";
    if (demander) {
      const v = await formulaire({
        titre: `${STATUT_C[statut].libelle} — ${c.code}`,
        icone: "fact_check",
        champs: [{ nom: "commentaire", libelle: "Observation (constat de terrain, raison…)", type: "textarea", pleine: true, requis: statut === "infirmee" }],
        ok: "Enregistrer",
      });
      if (!v) return null;
      commentaire = v.commentaire;
    }
    const r = await api(`/cibles/${c.id}`, { method: "PATCH", body: { statut, commentaire } });
    await charger();
    return r;
  }

  async function confirmer(c) {
    const lieu = (() => {
      const fc = K.sourceForets.getFeaturesAtCoordinate(ol.proj.fromLonLat([c.lng, c.lat]))[0];
      const proche = c.site_proche_id ? E.sites.find((s) => s.id === c.site_proche_id) : null;
      return { foret: fc?.get("nom") || "", departement: c.departement || proche?.departement || "Gagnoa", sp: proche?.sous_prefecture || "" };
    })();
    await formulaire({
      titre: `Enregistrer ${c.code} comme site`,
      icone: "add_location_alt",
      intro: "La zone devient un site du registre : son contour est repris, et le constat daté alimente la carte et le tableau de bord.",
      large: true,
      champs: [
        { nom: "localite", libelle: "Localité / village", requis: true },
        { nom: "departement", libelle: "Département", type: "select", options: ["Gagnoa", "Oumé"], valeur: lieu.departement },
        { nom: "sous_prefecture", libelle: "Sous-préfecture", valeur: lieu.sp },
        { nom: "domaine", libelle: "Domaine", type: "select", options: [{ value: "rural", label: "Domaine rural" }, { value: "foret_classee", label: "Forêt classée" }], valeur: lieu.foret ? "foret_classee" : "rural" },
        { nom: "foret", libelle: "Forêt classée", valeur: lieu.foret, visibleSi: { champ: "domaine", valeurs: ["foret_classee"] } },
        { nom: "cours_eau", libelle: "Cours d'eau", valeur: "", liste: (E.coursEau || []).map((x) => x.nom) },
        { nom: "statut", libelle: "Statut constaté", type: "select", options: STATUTS_SITE, valeur: "actif" },
        { nom: "date_constat", libelle: "Date du constat", type: "date", valeur: aujourdhui(), max: aujourdhui() },
        { nom: "observations", libelle: "Observations", type: "textarea", pleine: true, valeur: c.note || "" },
      ],
      ok: "Créer le site",
      valider: async (v) => {
        const r = await api(`/cibles/${c.id}/site`, { method: "POST", body: v });
        C.fermerPopup();
        GR.toast(`Site ${r.code} créé à partir de ${c.code}`);
        await Promise.all([C.recharger(), charger()]);
        return null;
      },
    });
  }

  async function ajouterAMission(ids) {
    let missions = [];
    try {
      missions = (await api("/missions")).filter((m) => ["planifiee", "en_cours"].includes(m.statut));
    } catch {
      /* liste vide */
    }
    const v = await formulaire({
      titre: `Mission d'éclairage — ${ids.length} zone(s)`,
      icone: "assignment_add",
      champs: [
        { nom: "mission", libelle: "Mission", type: "select", options: [{ value: "__nouvelle", label: "+ Nouvelle mission" }, ...missions.map((m) => ({ value: m.id, label: `${m.code} · ${m.titre}` }))], pleine: true },
        { nom: "titre", libelle: "Intitulé", valeur: `Éclairage — ${dateFr(aujourdhui())}`, visibleSi: { champ: "mission", valeurs: ["__nouvelle"] }, pleine: true },
        { nom: "date_prevue", libelle: "Date prévue", type: "date", valeur: ajouter(aujourdhui(), 3), visibleSi: { champ: "mission", valeurs: ["__nouvelle"] } },
        { nom: "equipe", libelle: "Équipe", placeholder: "Ex. URLOI + 2 agents SODEFOR", visibleSi: { champ: "mission", valeurs: ["__nouvelle"] } },
        { nom: "moyens", libelle: "Moyens", placeholder: "Véhicule, drone, GPS…", visibleSi: { champ: "mission", valeurs: ["__nouvelle"] }, pleine: true },
        { nom: "objectif", libelle: "Objectif", type: "textarea", valeur: "Vérifier au sol les zones suspectes détectées par satellite et documenter (photos, coordonnées, activité constatée).", visibleSi: { champ: "mission", valeurs: ["__nouvelle"] }, pleine: true },
      ],
      ok: "Valider",
      valider: async (x) => {
        let m;
        if (x.mission === "__nouvelle") {
          if (!x.titre) return "Indiquez l'intitulé de la mission";
          m = await api("/missions", { method: "POST", body: { titre: x.titre, date_prevue: x.date_prevue || null, equipe: x.equipe, moyens: x.moyens, objectif: x.objectif, cibles: ids } });
        } else {
          const ex = missions.find((y) => y.id === x.mission);
          m = await api(`/missions/${ex.id}`, {
            method: "PUT",
            body: { ...ex, cibles: [...new Set([...(ex.cibles || []).map((y) => y.id), ...ids])] },
          });
        }
        cochees.clear();
        await charger();
        C.fermerPopup();
        GR.toast(`${ids.length} zone(s) ajoutée(s) à ${m.code}`);
        setTimeout(async () => {
          if (await GR.confirm({ titre: `Mission ${m.code}`, message: "Ouvrir la fiche de la mission (équipe, export GPS, compte rendu) ?", ok: "Ouvrir la mission" })) ctx.naviguer(`/missions?mission=${m.id}`);
        }, 300);
        return null;
      },
    });
    return v;
  }

  ecoute(C.popupEl, "click", async (e) => {
    const b = e.target.closest("[data-pc]");
    if (!b || !enCours) return;
    const c = enCours;
    try {
      switch (b.dataset.pc) {
        case "avant-apres": {
          const a = analyses.find((x) => x.id === c.analyse_id);
          const fin = aujourdhui();
          C.fermerPopup();
          await C.comparerPeriodes?.(a ? { avant: [a.ref_du, a.ref_au], apres: [a.rec_du, a.rec_au] } : { avant: [ajouter(fin, -485), ajouter(fin, -365)], apres: [ajouter(fin, -120), fin] });
          view.animate({ center: ol.proj.fromLonLat([c.lng, c.lat]), zoom: Math.max(view.getZoom(), 16), duration: 500 });
          break;
        }
        case "confirmer":
          await confirmer(c);
          break;
        case "mission":
          await ajouterAMission([c.id]);
          break;
        case "infirmer":
          if (await changerStatut(c, "infirmee", true)) C.fermerPopup();
          break;
        case "ecarter":
          if (await changerStatut(c, "ecartee", true)) C.fermerPopup();
          break;
        case "reverifier":
          await changerStatut(c, "a_verifier", false);
          C.fermerPopup();
          break;
        case "note": {
          const v = await formulaire({ titre: `Note — ${c.code}`, icone: "edit_note", champs: [{ nom: "note", libelle: "Note", type: "textarea", pleine: true, valeur: c.note }] });
          if (v) {
            await api(`/cibles/${c.id}`, { method: "PATCH", body: { note: v.note } });
            await charger();
            C.fermerPopup();
          }
          break;
        }
        case "contour":
          C.editer({
            type: "Polygon",
            mode: "modifier",
            geometrie: fmtGeo().readGeometry(c.geometrie, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }),
            texte: `Contour de ${c.code} : glissez les sommets puis enregistrez`,
            enregistrer: async (gj) => {
              await api(`/cibles/${c.id}`, { method: "PATCH", body: { geometrie: gj, commentaire: "Contour ajusté" } });
              await charger();
              GR.toast("Contour enregistré");
            },
          });
          break;
        case "supprimer":
          if (await GR.confirm({ titre: `Supprimer ${esc(c.code)} ?`, message: "La zone suspecte et son suivi seront supprimés.", ok: "Supprimer", danger: true })) {
            await api(`/cibles/${c.id}`, { method: "DELETE" });
            C.fermerPopup();
            await charger();
          }
          break;
        default:
      }
    } catch (x) {
      GR.toast(x.message, "error");
    }
  });

  ecoute($("#pro-mission", pane), "click", () => cochees.size && ajouterAMission([...cochees]));
  ecoute($("#pro-ecarter", pane), "click", async () => {
    if (!(await GR.confirm({ titre: `Écarter ${cochees.size} zone(s) ?`, message: "Elles resteront consultables avec le filtre « Écartée ».", ok: "Écarter" }))) return;
    for (const id of cochees) await api(`/cibles/${id}`, { method: "PATCH", body: { statut: "ecartee", commentaire: "Écartée depuis la liste" } });
    cochees.clear();
    await charger();
  });

  /* ------------------- Signalement manuel d'une zone -------------------- */
  ecoute(racine, "click", (e) => {
    if (!e.target.closest('[data-prospection="dessiner-cible"]')) return;
    C.editer({
      type: "Polygon",
      mode: "dessiner",
      texte: "Zone suspecte : dessinez son contour (sol remanié, bassins, campement…), double-cliquez pour fermer",
      enregistrer: async (gj) => {
        const v = await formulaire({
          titre: "Signaler une zone suspecte",
          icone: "report",
          champs: [
            { nom: "origine", libelle: "Origine", type: "select", options: [{ value: "manuelle", label: "Photo-interprétation" }, { value: "drone", label: "Survol drone" }, { value: "renseignement", label: "Renseignement" }] },
            { nom: "departement", libelle: "Département", type: "select", options: ["", "Gagnoa", "Oumé"] },
            { nom: "note", libelle: "Note", type: "textarea", pleine: true },
          ],
          ok: "Enregistrer la zone",
        });
        if (!v) return false;
        const c = await api("/cibles", { method: "POST", body: { ...v, geometrie: gj } });
        filtres.statuts.add("a_verifier");
        await charger();
        GR.toast(`Zone ${c.code} enregistrée`);
        return true;
      },
    });
  });

  /* ------------------------------ Init --------------------------------- */
  K.sourceForets.on("featuresloadend", optionsZones);
  const apres = C.apresChargement;
  C.apresChargement = () => {
    apres?.();
    optionsZones();
  };
  optionsZones();
  majEtat();
  charger();
  if (new URLSearchParams(location.search).get("onglet") === "prospection") setTimeout(() => $('.panel-tabs [data-pane="prospection"]', racine)?.click(), 0);

  return () => {};
}
