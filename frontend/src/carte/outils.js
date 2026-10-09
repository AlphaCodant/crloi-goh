/* =====================================================================
   CRLOI Gôh — Carte : outils (mesures, sélection spatiale, annotations,
   requêteur attributaire, géolocalisation, exports et impression).
   Repris des outils de la carte GestReb.
   ===================================================================== */
import GR from "../gr/gr";
import * as K from "./couches";

const ol = window.ol;
const { esc, fmt, $, $$ } = GR;

export function initOutils(C, { racine, ecoute, signal }) {
  const E = C.etat;
  const map = C.map;
  const view = map.getView();

  /* ----------------------- Couche de dessin -------------------------- */
  const sourceDessin = new ol.source.Vector();
  const styleDessin = (f) => {
    const type = f.getGeometry().getType();
    const mesure = f.get("mesure");
    const couleur = mesure ? "#0f4c3a" : "#7c3aed";
    const styles = [
      new ol.style.Style({
        fill: new ol.style.Fill({ color: mesure ? "rgba(22,163,74,0.15)" : "rgba(124,58,237,0.15)" }),
        stroke: new ol.style.Stroke({ color: couleur, width: 2.5, lineDash: mesure ? [8, 6] : undefined }),
        image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: couleur }), stroke: new ol.style.Stroke({ color: "#fff", width: 2 }) }),
      }),
    ];
    if (f.get("libelle") && type === "Point") {
      styles.push(
        new ol.style.Style({
          text: new ol.style.Text({
            text: f.get("libelle"),
            offsetY: -16,
            font: "600 12px 'Inter Variable', Inter, sans-serif",
            fill: new ol.style.Fill({ color: "#4c1d95" }),
            stroke: new ol.style.Stroke({ color: "#fff", width: 3 }),
          }),
        })
      );
    }
    return styles;
  };
  map.addLayer(new ol.layer.Vector({ source: sourceDessin, style: styleDessin, zIndex: 30 }));

  const sourceReperes = new ol.source.Vector();
  map.addLayer(
    new ol.layer.Vector({
      source: sourceReperes,
      zIndex: 31,
      style: (f) =>
        new ol.style.Style({
          image: new ol.style.Icon({
            src: `data:image/svg+xml;utf8,${encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 0C7 0 0 7 0 16c0 12 16 24 16 24s16-12 16-24C32 7 25 0 16 0z" fill="#7c3aed"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>'
            )}`,
            anchor: [0.5, 1],
          }),
          text: f.get("libelle")
            ? new ol.style.Text({
                text: f.get("libelle"),
                offsetY: -48,
                font: "700 12px 'Inter Variable', Inter, sans-serif",
                fill: new ol.style.Fill({ color: "#111827" }),
                stroke: new ol.style.Stroke({ color: "#fff", width: 3 }),
              })
            : undefined,
        }),
    })
  );
  C.placerRepere = (coord, libelle) => {
    sourceReperes.clear();
    sourceReperes.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coord), libelle }));
  };

  /* ----------------------- Gestion de l'outil actif ------------------ */
  let outil = null;
  let interactions = [];
  C.outilActif = () => outil;

  const AIDES = {
    info: "Cliquez sur un site pour afficher ses informations",
    distance: "Cliquez pour tracer, double-cliquez pour terminer la mesure",
    surface: "Cliquez pour tracer la zone, double-cliquez pour terminer",
    "selection-rect": "Tracez un rectangle (cliquer-glisser) — Maj pour ajouter à la sélection",
    "selection-poly": "Tracez un polygone de sélection, double-cliquez pour terminer",
    "dessin-point": "Cliquez pour placer un repère annoté",
    "dessin-ligne": "Cliquez pour tracer, double-cliquez pour terminer",
    "dessin-poly": "Cliquez pour tracer la zone, double-cliquez pour terminer",
  };

  function arreterOutil() {
    interactions.forEach((i) => map.removeInteraction(i));
    interactions = [];
    outil = null;
    map.getInteractions().forEach((i) => i instanceof ol.interaction.DragPan && i.setActive(true));
    $$("[data-outil]", racine).forEach((b) => b.classList.remove("active"));
    $("#aide-outil", racine)?.classList.remove("show");
    if (map.getTargetElement()) map.getTargetElement().style.cursor = "";
  }

  function activerOutil(nom) {
    const etaitActif = outil === nom;
    arreterOutil();
    if (etaitActif) return;
    outil = nom;
    $(`[data-outil="${nom}"]`, racine)?.classList.add("active");
    $("#aide-outil-texte", racine).textContent = AIDES[nom] || "";
    $("#aide-outil", racine).classList.add("show");
    C.fermerPopup();
    if (nom === "distance" || nom === "surface") mesurer(nom === "surface" ? "Polygon" : "LineString");
    if (nom === "selection-rect") selectionRectangle();
    if (nom === "selection-poly") selectionPolygone();
    if (nom.startsWith("dessin-")) dessiner({ "dessin-point": "Point", "dessin-ligne": "LineString", "dessin-poly": "Polygon" }[nom]);
  }
  ecoute(racine, "click", (e) => {
    const b = e.target.closest("[data-outil]");
    if (b) activerOutil(b.dataset.outil);
  });
  ecoute($("#aide-outil-stop", racine), "click", arreterOutil);
  ecoute(document, "keydown", (e) => {
    if (e.key === "Escape" && outil && !document.querySelector(".modal.open")) arreterOutil();
  });

  /* ----------------------------- Mesures ----------------------------- */
  const formatLongueur = (g) => {
    const l = ol.sphere.getLength(g);
    return l >= 1000 ? `${fmt.n(l / 1000, 2)} km` : `${fmt.n(l, 1)} m`;
  };
  const formatSurface = (g) => {
    const a = ol.sphere.getArea(g);
    return `${fmt.n(a / 10000, 2)} ha${a >= 1e6 ? ` · ${fmt.n(a / 1e6, 2)} km²` : ""}`;
  };

  function mesurer(type) {
    const draw = new ol.interaction.Draw({
      source: sourceDessin,
      type,
      style: new ol.style.Style({
        fill: new ol.style.Fill({ color: "rgba(255,255,255,0.25)" }),
        stroke: new ol.style.Stroke({ color: "#0f4c3a", width: 2, lineDash: [8, 6] }),
        image: new ol.style.Circle({ radius: 5, stroke: new ol.style.Stroke({ color: "#0f4c3a" }), fill: new ol.style.Fill({ color: "#fff" }) }),
      }),
    });
    let el;
    let ov;
    let suivi;
    draw.on("drawstart", (evt) => {
      el = document.createElement("div");
      el.className = "measure-tooltip";
      ov = new ol.Overlay({ element: el, offset: [0, -14], positioning: "bottom-center", stopEvent: false });
      map.addOverlay(ov);
      suivi = evt.feature.getGeometry().on("change", (e) => {
        const g = e.target;
        el.textContent = type === "Polygon" ? formatSurface(g) : formatLongueur(g);
        ov.setPosition(type === "Polygon" ? g.getInteriorPoint().getCoordinates() : g.getLastCoordinate());
      });
    });
    draw.on("drawend", (evt) => {
      evt.feature.set("mesure", true);
      el.classList.add("static");
      evt.feature.set("overlay", ov);
      ol.Observable.unByKey(suivi);
      const g = evt.feature.getGeometry();
      GR.toast(`Mesure : ${type === "Polygon" ? `${formatSurface(g)} — périmètre ${formatLongueur(new ol.geom.LineString(g.getCoordinates()[0]))}` : formatLongueur(g)}`, "info");
    });
    map.addInteraction(draw);
    interactions.push(draw);
  }

  /* ------------------------ Sélection spatiale ----------------------- */
  function selectionnerDans(test, ajouter) {
    const ids = C.featuresVisibles()
      .filter((f) => test(f.getGeometry()))
      .map((f) => f.getId());
    C.selectionner(ids, { ajouter });
    GR.toast(`${ids.length} site(s) sélectionné(s)`, ids.length ? "success" : "info");
    if (ids.length) C.ouvrirTable(true);
  }
  function selectionRectangle() {
    const box = new ol.interaction.DragBox({ condition: ol.events.condition.always });
    box.on("boxend", (e) => {
      const ext = box.getGeometry().getExtent();
      selectionnerDans((g) => g.intersectsExtent(ext), e.mapBrowserEvent?.originalEvent?.shiftKey);
    });
    map.addInteraction(box);
    interactions.push(box);
    map.getInteractions().forEach((i) => i instanceof ol.interaction.DragPan && i.setActive(false));
  }
  function selectionPolygone() {
    const draw = new ol.interaction.Draw({ type: "Polygon" });
    draw.on("drawend", (e) => {
      const poly = e.feature.getGeometry();
      selectionnerDans((g) => {
        if (!g.intersectsExtent(poly.getExtent())) return false;
        if (g.getType() === "Point") return poly.intersectsCoordinate(g.getCoordinates());
        const pts = g.getType() === "MultiPolygon" ? g.getInteriorPoints().getCoordinates() : [g.getInteriorPoint().getCoordinates()];
        if (pts.some((p) => poly.intersectsCoordinate(p))) return true;
        const coords = g.getType() === "MultiPolygon" ? g.getCoordinates().flat(2) : g.getCoordinates().flat(1);
        return coords.some((c) => poly.intersectsCoordinate(c));
      }, false);
    });
    map.addInteraction(draw);
    interactions.push(draw);
  }

  /* --------------------------- Annotations --------------------------- */
  function dessiner(type) {
    const draw = new ol.interaction.Draw({ source: sourceDessin, type });
    draw.on("drawend", async (e) => {
      if (type !== "Point") return;
      const libelle = await GR.confirm({
        titre: "Annotation",
        message: "Texte à afficher à côté du repère (facultatif) :",
        ok: "Ajouter",
        saisie: { label: "Libellé", placeholder: "Ex. point de rassemblement, piste d'accès…" },
      });
      if (libelle === null) setTimeout(() => sourceDessin.removeFeature(e.feature), 0);
      else e.feature.set("libelle", libelle);
    });
    map.addInteraction(draw);
    interactions.push(draw);
    const modify = new ol.interaction.Modify({ source: sourceDessin });
    map.addInteraction(modify);
    interactions.push(modify);
  }

  function effacerDessins() {
    sourceDessin.getFeatures().forEach((f) => f.get("overlay") && map.removeOverlay(f.get("overlay")));
    sourceDessin.clear();
    sourceReperes.clear();
    GR.toast("Mesures et annotations effacées", "info");
  }

  /* ------------------------- Géolocalisation ------------------------- */
  const geoloc = new ol.Geolocation({ projection: view.getProjection(), trackingOptions: { enableHighAccuracy: true } });
  const sourcePosition = new ol.source.Vector();
  map.addLayer(new ol.layer.Vector({ source: sourcePosition, zIndex: 32 }));
  geoloc.on("change:position", () => {
    const c = geoloc.getPosition();
    if (!c) return;
    const precision = geoloc.getAccuracyGeometry();
    sourcePosition.clear();
    if (precision) sourcePosition.addFeature(new ol.Feature({ geometry: precision }));
    const pt = new ol.Feature({ geometry: new ol.geom.Point(c) });
    pt.setStyle(new ol.style.Style({ image: new ol.style.Circle({ radius: 8, fill: new ol.style.Fill({ color: "#2563eb" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }) }) }));
    sourcePosition.addFeature(pt);
    view.animate({ center: c, zoom: Math.max(view.getZoom(), 15), duration: 600 });
    geoloc.setTracking(false);
  });
  geoloc.on("error", () => GR.toast("Position indisponible (autorisation refusée ou signal GPS absent).", "warning"));

  /* ------------------------ Aller à (coordonnées) -------------------- */
  let systemeAller = "dd";
  ecoute($("#aller-systeme", racine), "click", (e) => {
    const b = e.target.closest("[data-s]");
    if (!b) return;
    systemeAller = b.dataset.s;
    $$("#aller-systeme button", racine).forEach((x) => x.classList.toggle("active", x === b));
    $$("#modal-aller .form-grid[data-s]", racine).forEach((g) => g.classList.toggle("hidden", (g.dataset.s === "dd") !== (systemeAller === "dd")));
  });
  const nombre = (s) => Number(String(s).trim().replace(/\s/g, "").replace(",", "."));
  ecoute($("#aller-ok", racine), "click", () => {
    let coord;
    if (systemeAller === "dd") {
      const lat = nombre($("#aller-lat", racine).value);
      const lon = nombre($("#aller-lon", racine).value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return GR.toast("Coordonnées invalides", "error");
      coord = ol.proj.fromLonLat([lon, lat]);
    } else {
      const x = nombre($("#aller-x", racine).value);
      const y = nombre($("#aller-y", racine).value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return GR.toast("Coordonnées invalides", "error");
      coord = ol.proj.transform([x, y], systemeAller === "29" ? "EPSG:32629" : "EPSG:32630", "EPSG:3857");
    }
    view.animate({ center: coord, zoom: Math.max(view.getZoom(), 15), duration: 700 });
    if ($("#aller-marqueur", racine).checked) C.placerRepere(coord, C.formaterCoord(coord));
    GR.modal.close("modal-aller");
    return undefined;
  });

  /* ----------------------- Capture de la carte ----------------------- */
  function capturer() {
    return new Promise((resolve, reject) => {
      map.once("rendercomplete", () => {
        try {
          const taille = map.getSize();
          const ratio = window.devicePixelRatio || 1;
          const canvas = document.createElement("canvas");
          canvas.width = taille[0] * ratio;
          canvas.height = taille[1] * ratio;
          const c2 = canvas.getContext("2d");
          c2.fillStyle = "#ffffff";
          c2.fillRect(0, 0, canvas.width, canvas.height);
          map.getViewport().querySelectorAll(".ol-layer canvas, canvas.ol-layer").forEach((c) => {
            if (c.width <= 0) return;
            const op = c.parentNode.style.opacity || c.style.opacity;
            c2.globalAlpha = op === "" ? 1 : Number(op);
            const m = c.style.transform && c.style.transform.match(/^matrix\(([^(]*)\)$/);
            if (m) {
              const t = m[1].split(",").map(Number);
              c2.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
            } else c2.setTransform(1, 0, 0, 1, 0, 0);
            c2.drawImage(c, 0, 0);
          });
          c2.globalAlpha = 1;
          c2.setTransform(1, 0, 0, 1, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch (e) {
          reject(e);
        }
      });
      map.renderSync();
    });
  }
  const jour = () => new Date().toISOString().slice(0, 10);

  async function exporterPng() {
    try {
      const url = await capturer();
      const a = document.createElement("a");
      a.href = url;
      a.download = `carte_crloi_goh_${E.date}.png`;
      a.click();
    } catch {
      GR.toast("Export impossible avec ce fond de carte (restriction du fournisseur). Essayez « Satellite » ou « OpenStreetMap ».", "error", 7000);
    }
  }

  async function imprimer() {
    let image;
    try {
      image = await capturer();
    } catch {
      GR.toast("Impression impossible avec ce fond de carte. Essayez un autre fond.", "error");
      return;
    }
    const titre = await GR.confirm({
      titre: "Imprimer la carte",
      message: "Titre de la carte :",
      ok: "Imprimer",
      saisie: { label: "Titre", placeholder: `Situation des sites d'orpaillage au ${E.date.split("-").reverse().join("/")}` },
    });
    if (titre === null) return;
    const w = window.open("", "_blank");
    if (!w) {
      GR.toast("Autorisez l'ouverture des fenêtres pour imprimer.", "warning");
      return;
    }
    const legende = $("#legende-corps", racine).innerHTML;
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(titre || "Carte CRLOI Gôh")}</title>
      <style>@page{size:A4 landscape;margin:10mm}body{background:#fff;margin:0;font-family:Inter,system-ui,sans-serif;color:#0f172a}
      .entete{display:flex;align-items:center;gap:10px;border-bottom:2px solid #0f4c3a;padding-bottom:4mm;margin-bottom:4mm}
      .entete img{width:12mm;height:12mm}.entete h1{font-size:16pt;margin:0}
      .feuille{display:grid;grid-template-columns:1fr 62mm;gap:6mm;height:178mm}
      .carte{border:1px solid #94a3b8;width:100%;height:100%;object-fit:contain}
      .cote{font-size:9pt;display:flex;flex-direction:column;gap:4mm}.cote h4{font-size:9pt;margin:2mm 0}
      .nord{font-size:22pt;text-align:center}.legend-item{display:flex;gap:6px;align-items:center;padding:1px 0}
      .legend-item i{width:12px;height:12px;border:1px solid #0003;border-radius:2px;display:inline-block}.legend-item i.line{height:0;border:0;border-top:2.5px solid}
      .legend-item .n{margin-left:auto;color:#64748b}.pied{font-size:8pt;color:#64748b;margin-top:3mm}.mi{display:none}</style></head><body>
      <div class="entete"><img src="${location.origin}/img/crloi.svg"><div><h1>${esc(titre || "Situation des sites d'orpaillage")}</h1>
      <div style="font-size:9pt;color:#475569">CRLOI Gôh — Cellule renseignement · situation au ${esc(E.date.split("-").reverse().join("/"))} · éditée le ${new Date().toLocaleDateString("fr-FR")} · DIFFUSION RESTREINTE</div></div></div>
      <div class="feuille"><img class="carte" src="${image}"><div class="cote"><div class="nord">▲<div style="font-size:9pt;font-weight:700">N</div></div>
      <div><strong>Échelle :</strong> ${esc($("#echelle", racine).innerText)}</div><div><strong>Légende</strong>${legende}</div>
      <div><strong>Sites :</strong> ${esc($("#nb-sites", racine).textContent)}</div></div></div>
      <div class="pied">Sources : base CRLOI Gôh ; forêts classées : SODEFOR CG Gagnoa ; fonds © contributeurs respectifs. WGS 84 / Pseudo-Mercator.</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`);
    w.document.close();
  }

  ecoute(racine, "click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    const a = b.dataset.action;
    if (a === "position") geoloc.setTracking(true);
    if (a === "aller-a") GR.modal.open("modal-aller");
    if (a === "export-png") exporterPng();
    if (a === "imprimer") imprimer();
    if (a === "effacer-dessins") effacerDessins();
  });

  /* ------------------------- Exports de la table --------------------- */
  const COLS_EXPORT = [
    { cle: "code", titre: "Code" },
    { cle: "localite", titre: "Localité" },
    { cle: "departement", titre: "Département" },
    { cle: "sous_prefecture", titre: "Sous-préfecture" },
    { cle: "domaine", titre: "Domaine", valeur: (l) => (l.domaine === "foret_classee" ? "Forêt classée" : "Domaine rural") },
    { cle: "foret", titre: "Forêt classée" },
    { cle: "cours_eau", titre: "Cours d'eau" },
    { cle: "statut_libelle", titre: `Statut à la date` },
    { cle: "dernier_constat", titre: "Dernier constat" },
    { cle: "superficie_ha", titre: "Superficie (ha)" },
    { cle: "priorite", titre: "Priorité" },
    { cle: "lat", titre: "Latitude" },
    { cle: "lng", titre: "Longitude" },
    { cle: "coord_alerte", titre: "Alerte coordonnées" },
  ];
  ecoute(racine, "click", async (e) => {
    const b = e.target.closest("[data-export]");
    if (!b) return;
    $("#menu-export", racine).classList.remove("open");
    const lignes = C.lignesTable();
    if (!lignes.length) return GR.toast("Aucun site à exporter", "warning");
    const nom = `sites_crloi_goh_${E.date}`;
    const type = b.dataset.export;
    if (type === "csv") GR.exportCsv(`${nom}.csv`, lignes, COLS_EXPORT);
    if (type === "xlsx") await GR.exportXlsx(`${nom}.xlsx`, { nom: "Sites", lignes, colonnes: COLS_EXPORT });
    if (type === "geojson" || type === "kml") {
      const feats = lignes.map((l) => {
        const f = l.f.clone();
        f.setId(l.id);
        f.set("statut_date", E.date);
        return f;
      });
      if (type === "geojson") {
        const txt = new ol.format.GeoJSON().writeFeatures(feats, { featureProjection: "EPSG:3857", dataProjection: "EPSG:4326", decimals: 7 });
        GR.telecharger(`${nom}.geojson`, txt, "application/geo+json");
      } else {
        feats.forEach((f) => {
          f.set("name", `${f.get("code")} ${f.get("localite")}`);
          const c = C.couleurDe(f);
          f.setStyle(
            new ol.style.Style({
              fill: new ol.style.Fill({ color: K.rgba(c, 0.5) }),
              stroke: new ol.style.Stroke({ color: "#ffffff", width: 1.5 }),
              image: new ol.style.Circle({ radius: 7, fill: new ol.style.Fill({ color: c }), stroke: new ol.style.Stroke({ color: "#fff", width: 2 }) }),
            })
          );
        });
        const txt = new ol.format.KML({ extractStyles: true }).writeFeatures(feats, { featureProjection: "EPSG:3857", dataProjection: "EPSG:4326" });
        GR.telecharger(`${nom}.kml`, txt, "application/vnd.google-earth.kml+xml");
      }
    }
    GR.toast(`${lignes.length} site(s) exporté(s)`);
    return undefined;
  });

  /* ------------------------ Requêteur attributaire ------------------- */
  const CHAMPS = [
    { code: "code", libelle: "Code du site", type: "text" },
    { code: "localite", libelle: "Localité", type: "text" },
    { code: "departement", libelle: "Département", type: "text" },
    { code: "sous_prefecture", libelle: "Sous-préfecture", type: "text" },
    { code: "foret", libelle: "Forêt classée", type: "text" },
    { code: "cours_eau", libelle: "Cours d'eau", type: "text" },
    { code: "statut", libelle: "Statut (à la date)", type: "enum" },
    { code: "priorite", libelle: "Priorité", type: "text" },
    { code: "superficie_ha", libelle: "Superficie (ha)", type: "number" },
    { code: "nb_constats", libelle: "Nombre de constats", type: "number" },
    { code: "jours_depuis_constat", libelle: "Jours depuis le dernier constat", type: "number" },
    { code: "observations", libelle: "Observations", type: "text" },
    { code: "coord_alerte", libelle: "Alerte de coordonnées", type: "text" },
  ];
  const OPERATEURS = [
    { code: "eq", libelle: "est égal à", types: ["text", "number", "enum"] },
    { code: "neq", libelle: "est différent de", types: ["text", "number", "enum"] },
    { code: "contains", libelle: "contient", types: ["text"] },
    { code: "ncontains", libelle: "ne contient pas", types: ["text"] },
    { code: "gt", libelle: "est supérieur à", types: ["number"] },
    { code: "lt", libelle: "est inférieur à", types: ["number"] },
    { code: "between", libelle: "est compris entre", types: ["number"] },
    { code: "in", libelle: "fait partie de", types: ["text", "enum"] },
    { code: "empty", libelle: "est vide", types: ["text", "number"] },
    { code: "nempty", libelle: "est renseigné", types: ["text", "number"] },
  ];
  const STATUT_PAR_LIBELLE = Object.fromEntries(K.STATUTS.map((s) => [s.libelle.toLowerCase(), s.cle]));
  const norm = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

  C.testerCritere = (p, c) => {
    const champ = CHAMPS.find((x) => x.code === c.champ);
    let v = p[c.champ];
    if (c.op === "empty") return v === null || v === undefined || String(v).trim() === "";
    if (c.op === "nempty") return !(v === null || v === undefined || String(v).trim() === "");
    if (champ.type === "number") {
      const n = Number(v);
      const a = Number(String(c.valeur).replace(",", "."));
      const b = Number(String(c.valeur2).replace(",", "."));
      if (v === null || v === undefined || Number.isNaN(n)) return c.op === "neq";
      if (c.op === "eq") return n === a;
      if (c.op === "neq") return n !== a;
      if (c.op === "gt") return n > a;
      if (c.op === "lt") return n < a;
      if (c.op === "between") return n >= Math.min(a, b) && n <= Math.max(a, b);
      return false;
    }
    const conv = (x) => (champ.type === "enum" ? STATUT_PAR_LIBELLE[norm(x)] || norm(x) : norm(x));
    v = norm(v);
    if (c.op === "in") return String(c.valeur).split(",").map(conv).includes(v);
    const val = conv(c.valeur);
    if (c.op === "eq") return v === val;
    if (c.op === "neq") return v !== val;
    if (c.op === "contains") return v.includes(val);
    if (c.op === "ncontains") return !v.includes(val);
    return false;
  };

  const conteneur = $("#criteres", racine);
  function valeursSuggerees(champ) {
    if (champ === "statut") return K.STATUTS.map((s) => s.libelle);
    if (champ === "priorite") return ["haute", "normale"];
    if (champ === "departement") return ["Gagnoa", "Oumé"];
    if (["sous_prefecture", "foret", "cours_eau", "localite"].includes(champ)) return [...new Set(E.sites.map((s) => s[champ]).filter(Boolean))].sort();
    return [];
  }
  function ligneCritere(c = {}) {
    const champ = CHAMPS.find((x) => x.code === c.champ) || CHAMPS[0];
    const ops = OPERATEURS.filter((o) => o.types.includes(champ.type));
    const op = ops.find((o) => o.code === c.op) || ops[0];
    const div = document.createElement("div");
    div.className = "criterion";
    div.innerHTML = `
      <select class="select sm" data-champ>${CHAMPS.map((x) => `<option value="${x.code}" ${x.code === champ.code ? "selected" : ""}>${esc(x.libelle)}</option>`).join("")}</select>
      <select class="select sm" data-op>${ops.map((o) => `<option value="${o.code}" ${o.code === op.code ? "selected" : ""}>${esc(o.libelle)}</option>`).join("")}</select>
      <button class="btn btn-ghost btn-icon btn-sm del" title="Supprimer le critère"><span class="mi">close</span></button>
      <div class="val"></div>`;
    conteneur.appendChild(div);
    majValeur(div, c.valeur, c.valeur2);
    return div;
  }
  function majValeur(div, v = "", v2 = "") {
    const champ = CHAMPS.find((x) => x.code === div.querySelector("[data-champ]").value);
    const op = div.querySelector("[data-op]").value;
    const zone = div.querySelector(".val");
    if (op === "empty" || op === "nempty") {
      zone.innerHTML = "";
      return;
    }
    const sugg = valeursSuggerees(champ.code);
    const listeId = `crloi-sugg-${champ.code}`;
    document.getElementById(listeId)?.remove();
    if (sugg.length) {
      const dl = document.createElement("datalist");
      dl.id = listeId;
      dl.innerHTML = sugg.map((s) => `<option value="${esc(s)}">`).join("");
      racine.appendChild(dl);
    }
    const type = champ.type === "number" && op !== "in" ? "number" : "text";
    const ph = op === "in" ? "valeurs séparées par des virgules" : champ.type === "number" ? "valeur" : "texte";
    zone.innerHTML =
      `<input class="input sm" data-v type="${type}" step="any" placeholder="${ph}" value="${esc(v)}" ${sugg.length ? `list="${listeId}"` : ""}>` +
      (op === "between" ? `<input class="input sm" data-v2 type="number" step="any" placeholder="et" value="${esc(v2)}">` : "");
  }
  C.initRequeteur = () => {
    conteneur.innerHTML = "";
    ligneCritere({ champ: "statut" });
  };
  ecoute(conteneur, "change", (e) => {
    const div = e.target.closest(".criterion");
    if (!div) return;
    if (e.target.matches("[data-champ]")) {
      const nouveau = ligneCritere({ champ: e.target.value });
      div.replaceWith(nouveau);
    } else if (e.target.matches("[data-op]")) majValeur(div, div.querySelector("[data-v]")?.value || "");
  });
  ecoute(conteneur, "click", (e) => {
    if (e.target.closest(".del")) {
      e.target.closest(".criterion").remove();
      if (!conteneur.children.length) ligneCritere();
    }
  });
  ecoute(conteneur, "keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input")) $("#lancer-requete", racine).click();
  });
  ecoute($("#ajout-critere", racine), "click", () => ligneCritere());
  ecoute($("#mode-requete", racine), "click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    E.mode = b.dataset.mode;
    $$("#mode-requete button", racine).forEach((x) => x.classList.toggle("active", x === b));
  });
  function lireCriteres() {
    return $$(".criterion", conteneur)
      .map((d) => ({
        champ: d.querySelector("[data-champ]").value,
        op: d.querySelector("[data-op]").value,
        valeur: d.querySelector("[data-v]")?.value ?? "",
        valeur2: d.querySelector("[data-v2]")?.value ?? "",
      }))
      .filter((c) => ["empty", "nempty"].includes(c.op) || String(c.valeur).trim() !== "");
  }
  ecoute($("#lancer-requete", racine), "click", () => {
    E.criteres = lireCriteres();
    if (!E.criteres.length) return GR.toast("Renseignez au moins un critère", "warning");
    E.requeteActive = true;
    C.appliquerFiltres({ ajuster: true });
    const n = C.featuresVisibles().length;
    $("#requete-resultat", racine).innerHTML = `<div class="alert ${n ? "success" : "warning"}"><span class="mi">${n ? "task_alt" : "search_off"}</span>
      <div><strong>${n} site(s)</strong> correspondent à la requête.${n ? ' <a href="#" data-voir-table>Voir la table</a>' : ""}</div></div>`;
    const badge = $("#nb-filtres", racine);
    badge.textContent = Number(badge.textContent || 0) + 1;
    badge.classList.remove("hidden");
    return undefined;
  });
  ecoute($("#requete-resultat", racine), "click", (e) => {
    if (e.target.closest("[data-voir-table]")) {
      e.preventDefault();
      C.ouvrirTable(true);
    }
  });
  C.viderRequete = () => {
    E.criteres = [];
    E.requeteActive = false;
    C.initRequeteur();
    $("#requete-resultat", racine).innerHTML = "";
  };
  ecoute($("#effacer-requete", racine), "click", () => {
    const etaitActive = E.requeteActive;
    C.viderRequete();
    if (etaitActive) C.appliquerFiltres({ ajuster: true });
  });

  return () => {
    arreterOutil();
    geoloc.setTracking(false);
    if (signal.aborted) sourceDessin.clear();
  };
}
