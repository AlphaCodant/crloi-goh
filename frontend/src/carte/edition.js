/* =====================================================================
   CRLOI Gôh — Carte : édition (ajouter, modifier, déplacer, dessiner, importer, supprimer)
   Sites, contours, constats, fiches, cours d'eau et zones de travail.
   ===================================================================== */
import GR from "../gr/gr";
import { api } from "../api";
import * as K from "./couches";
import { formulaire } from "./formulaire";
import { PARAMETRES, PARAM, depasse } from "../eau";
import { lundi } from "../tableau/calculs";

const ol = window.ol;
const { esc, fmt, $ } = GR;
const STATUTS = K.STATUTS.filter((s) => s.cle !== "inconnu").map((s) => ({ value: s.cle, label: s.libelle }));
const aujourdhui = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function initEdition(C, { racine, ecoute }) {
  const map = C.map;
  const view = map.getView();
  const E = C.etat;
  const geoJson = () => C.formatGeo;

  /* ------------------------ Couche et barre d'édition ----------------- */
  const sourceTemp = new ol.source.Vector();
  const coucheTemp = new ol.layer.Vector({
    source: sourceTemp,
    zIndex: 40,
    style: new ol.style.Style({
      fill: new ol.style.Fill({ color: "rgba(250,204,21,0.25)" }),
      stroke: new ol.style.Stroke({ color: "#f59e0b", width: 3, lineDash: [10, 6] }),
      image: new ol.style.Circle({ radius: 9, fill: new ol.style.Fill({ color: "#f59e0b" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }) }),
    }),
  });
  map.addLayer(coucheTemp);

  const barre = document.createElement("div");
  barre.className = "edit-bar";
  barre.innerHTML = `<span class="mi">edit_location_alt</span><span class="eb-texte"></span>
    <button type="button" class="btn btn-sm" data-eb="annuler"><span class="mi">close</span>Annuler</button>
    <button type="button" class="btn btn-sm btn-primary" data-eb="ok"><span class="mi">check</span>Enregistrer</button>`;
  $("#map", racine).appendChild(barre);

  let session = null;

  function finSession() {
    if (!session) return;
    session.interactions.forEach((i) => map.removeInteraction(i));
    session.cles?.forEach((k) => ol.Observable.unByKey(k));
    sourceTemp.clear();
    barre.classList.remove("show");
    C.editionActive = false;
    session = null;
  }

  /**
   * Lance une session d'édition de géométrie.
   * mode : "dessiner" (nouvelle géométrie), "modifier" (sommets), "deplacer" (point : glisser ou cliquer)
   */
  function editer({ type, mode, geometrie, texte, enregistrer }) {
    finSession();
    C.arreterOutil?.();
    C.fermerPopup();
    C.editionActive = true;
    session = { interactions: [], cles: [], enregistrer, type };
    barre.querySelector(".eb-texte").textContent = texte;
    barre.classList.add("show");
    barre.querySelector('[data-eb="ok"]').disabled = !geometrie;
    let feature = null;
    if (geometrie) {
      feature = new ol.Feature(geometrie.clone());
      sourceTemp.addFeature(feature);
    }
    const activerModification = () => {
      const mod = new ol.interaction.Modify({ source: sourceTemp });
      map.addInteraction(mod);
      session.interactions.push(mod);
      if (type === "Point") {
        const tr = new ol.interaction.Translate({ layers: [coucheTemp] });
        map.addInteraction(tr);
        session.interactions.push(tr);
      }
    };
    if (mode === "dessiner") {
      const draw = new ol.interaction.Draw({ source: sourceTemp, type });
      draw.on("drawend", () => {
        map.removeInteraction(draw);
        barre.querySelector('[data-eb="ok"]').disabled = false;
        barre.querySelector(".eb-texte").textContent = "Ajustez si besoin (glisser les sommets), puis enregistrez";
        setTimeout(activerModification, 0);
      });
      map.addInteraction(draw);
      session.interactions.push(draw);
      const snap = new ol.interaction.Snap({ source: C.sourceSites });
      map.addInteraction(snap);
      session.interactions.push(snap);
    } else {
      activerModification();
      if (mode === "deplacer") {
        // Un clic place aussi le point
        session.cles.push(
          map.on("singleclick", (evt) => {
            if (!feature) {
              feature = new ol.Feature(new ol.geom.Point(evt.coordinate));
              sourceTemp.addFeature(feature);
            } else feature.getGeometry().setCoordinates(evt.coordinate);
            barre.querySelector('[data-eb="ok"]').disabled = false;
          })
        );
      }
    }
  }

  C.editer = editer;

  ecoute(barre, "click", async (e) => {
    const b = e.target.closest("[data-eb]");
    if (!b || !session) return;
    if (b.dataset.eb === "annuler") return finSession();
    const f = sourceTemp.getFeatures()[sourceTemp.getFeatures().length - 1];
    if (!f) return GR.toast("Tracez d'abord la géométrie", "warning");
    const g = geoJson().writeGeometryObject(f.getGeometry(), { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857", decimals: 7 });
    b.disabled = true;
    try {
      const fini = await session.enregistrer(g, f.getGeometry());
      if (fini !== false) finSession();
    } catch (x) {
      GR.toast(x.message, "error");
    } finally {
      b.disabled = false;
    }
    return undefined;
  });
  ecoute(document, "keydown", (e) => {
    if (e.key === "Escape" && session && !document.querySelector(".modal.open")) finSession();
  });

  /* ----------------------------- Aides -------------------------------- */
  const listeDistincte = (cle) => [...new Set(E.sites.map((s) => s[cle]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const nomsForets = () => [...new Set(K.sourceForets.getFeatures().map((f) => f.get("nom")).filter(Boolean))].sort();
  function contexteLieu(coord3857) {
    const fc = K.sourceForets.getFeaturesAtCoordinate(coord3857)[0];
    const [lng, lat] = ol.proj.toLonLat(coord3857);
    let proche = null;
    let d = Infinity;
    E.sites.forEach((s) => {
      if (s.lat == null) return;
      const x = (s.lat - lat) ** 2 + (s.lng - lng) ** 2;
      if (x < d) {
        d = x;
        proche = s;
      }
    });
    const adm = K.lieuAdministratif(coord3857);
    return { foret: fc?.get("nom") || "", departement: adm?.departement || proche?.departement || "Gagnoa", sous_prefecture: adm?.sous_prefecture || proche?.sous_prefecture || "" };
  }
  const recharger = async (msg) => {
    if (msg) GR.toast(msg);
    await C.recharger();
  };

  /* ---------------------------- Sites --------------------------------- */
  function champsSite(s, defaut = {}) {
    const v = { ...defaut, ...(s || {}) };
    const cs = v.coord_saisie || {};
    return [
      { nom: "localite", libelle: "Localité / village", requis: true, valeur: v.localite || "" },
      { nom: "departement", libelle: "Département", type: "select", options: ["Gagnoa", "Oumé"], valeur: v.departement || "Gagnoa" },
      { nom: "sous_prefecture", libelle: "Sous-préfecture", valeur: v.sous_prefecture || "", liste: [...new Set([...K.nomsSousPrefectures(), ...listeDistincte("sous_prefecture")])] },
      { nom: "domaine", libelle: "Domaine", type: "select", options: [{ value: "rural", label: "Domaine rural" }, { value: "foret_classee", label: "Forêt classée" }], valeur: v.domaine || (v.foret ? "foret_classee" : "rural") },
      { nom: "foret", libelle: "Forêt classée", valeur: v.foret || "", liste: nomsForets(), visibleSi: { champ: "domaine", valeurs: ["foret_classee"] } },
      { nom: "cours_eau", libelle: "Cours d'eau concerné", valeur: v.cours_eau || "", liste: (E.coursEau || []).map((c) => c.nom) },
      { nom: "priorite", libelle: "Priorité", type: "select", options: [{ value: "normale", label: "Normale" }, { value: "haute", label: "Haute" }], valeur: v.priorite || "normale" },
      { nom: "superficie_ha", libelle: "Superficie (ha)", type: "number", step: "0.01", min: 0, valeur: v.superficie_ha ?? "", aide: v.contour ? "calculée depuis le contour" : "" },
      { nom: "sys", libelle: "Coordonnées", type: "select", options: [{ value: "wgs", label: "WGS84 (degrés décimaux)" }, { value: "29", label: "UTM 29N (Sérihio…)" }, { value: "30", label: "UTM 30N (Oumé, Gagnoa…)" }], valeur: cs.sys || "wgs" },
      { nom: "x", libelle: "Longitude / X", valeur: cs.x ?? (v.lng != null ? Number(v.lng).toFixed(6) : ""), placeholder: "-5.9512 ou 238747" },
      { nom: "y", libelle: "Latitude / Y", valeur: cs.y ?? (v.lat != null ? Number(v.lat).toFixed(6) : ""), placeholder: "6.1305 ou 705256" },
      { nom: "observations", libelle: "Observations", type: "textarea", pleine: true, valeur: v.observations || "" },
    ];
  }
  const corpsSite = (v) => ({
    localite: v.localite,
    departement: v.departement,
    sous_prefecture: v.sous_prefecture,
    domaine: v.domaine,
    foret: v.domaine === "foret_classee" ? v.foret : "",
    cours_eau: v.cours_eau,
    priorite: v.priorite,
    superficie_ha: v.superficie_ha,
    observations: v.observations,
    coord: v.x !== "" && v.y !== "" ? { sys: v.sys, x: String(v.x), y: String(v.y) } : null,
  });

  async function nouveauSite(coord3857) {
    const [lng, lat] = coord3857 ? ol.proj.toLonLat(coord3857) : [null, null];
    const lieu = coord3857 ? contexteLieu(coord3857) : {};
    const champs = champsSite(null, { ...lieu, lat, lng, domaine: lieu.foret ? "foret_classee" : "rural" });
    champs.push(
      { nom: "statut_initial", libelle: "Statut constaté", type: "select", options: STATUTS, valeur: "actif" },
      { nom: "date_statut", libelle: "Date du constat", type: "date", valeur: E.date || aujourdhui(), max: aujourdhui() }
    );
    const v = await formulaire({
      titre: "Nouveau site d'orpaillage",
      icone: "add_location_alt",
      large: true,
      intro: coord3857 ? `Point placé en ${lat.toFixed(5)}, ${lng.toFixed(5)}${lieu.foret ? ` — dans la forêt classée de ${esc(lieu.foret)}` : ""}.` : "",
      champs,
      ok: "Créer le site",
      valider: async (x) => {
        const s = await api("/sites", { method: "POST", body: { ...corpsSite(x), statut_initial: x.statut_initial, date_statut: x.date_statut } });
        GR.toast(`Site ${s.code} créé`);
        await C.recharger();
        const f = C.tousLesSites.get(s.id);
        if (f && C.sourceSites.getFeatureById(s.id)) setTimeout(() => C.afficherPopup([f], C.centreDe(f)), 300);
        return null;
      },
    });
    return v;
  }

  async function modifierSite(s) {
    await formulaire({
      titre: `Modifier ${s.code}`,
      icone: "edit",
      large: true,
      champs: champsSite(s),
      valider: async (x) => {
        const corps = corpsSite(x);
        if (!corps.coord) delete corps.coord;
        await api(`/sites/${s.id}`, { method: "PATCH", body: corps });
        await recharger(`${s.code} modifié`);
        return null;
      },
    });
  }

  async function constat(s) {
    await formulaire({
      titre: `Nouveau constat — ${s.code}`,
      icone: "fact_check",
      intro: "Constat hors BRQ (image satellite, survol drone, information confirmée…). Les visites de terrain se saisissent dans les BRQ.",
      champs: [
        { nom: "date", libelle: "Date", type: "date", valeur: E.date || aujourdhui(), max: aujourdhui(), requis: true },
        { nom: "statut", libelle: "Statut", type: "select", options: STATUTS, valeur: "actif" },
        { nom: "source", libelle: "Source", type: "select", options: [{ value: "satellite", label: "Image satellite" }, { value: "drone", label: "Drone" }, { value: "fiche", label: "Fiche de renseignement" }, { value: "saisie", label: "Autre" }], valeur: "drone" },
        { nom: "note", libelle: "Note", type: "textarea", pleine: true },
      ],
      ok: "Ajouter le constat",
      valider: async (x) => {
        await api(`/sites/${s.id}/events`, { method: "POST", body: x });
        await recharger("Constat ajouté");
        return null;
      },
    });
  }

  async function retirerConstat(s, eventId) {
    const ok = await GR.confirm({ titre: "Retirer ce constat ?", message: "Le statut daté sera supprimé de l'historique du site.", ok: "Retirer", danger: true });
    if (!ok) return;
    try {
      await api(`/sites/${s.id}/events/${eventId}`, { method: "DELETE" });
      await recharger("Constat retiré");
    } catch (x) {
      GR.toast(x.message, "error");
    }
  }

  function deplacerSite(s, f) {
    const g = s.lat != null ? new ol.geom.Point(ol.proj.fromLonLat([s.lng, s.lat])) : f ? new ol.geom.Point(C.centreDe(f)) : null;
    editer({
      type: "Point",
      mode: "deplacer",
      geometrie: g,
      texte: `${s.code} : glissez le point ou cliquez à son nouvel emplacement`,
      enregistrer: async (gj) => {
        await api(`/sites/${s.id}`, { method: "PATCH", body: { coord: { sys: "wgs", x: String(gj.coordinates[0]), y: String(gj.coordinates[1]) } } });
        await recharger(`Position de ${s.code} enregistrée`);
      },
    });
  }

  function dessinerContour(s) {
    editer({
      type: "Polygon",
      mode: "dessiner",
      texte: `Contour de ${s.code} : cliquez les sommets, double-cliquez pour fermer`,
      enregistrer: async (gj) => {
        const r = await api(`/sites/${s.id}/contour`, { method: "PUT", body: gj });
        await recharger(`Contour de ${s.code} enregistré (${fmt.ha(r.superficie_ha, 2)})`);
      },
    });
  }

  function modifierContour(s) {
    if (!s.contour) return GR.toast("Ce site n'a pas encore de contour", "info");
    editer({
      type: "Polygon",
      mode: "modifier",
      geometrie: geoJson().readGeometry(s.contour),
      texte: `Contour de ${s.code} : glissez les sommets (clic sur un bord pour en ajouter, Alt+clic pour en supprimer)`,
      enregistrer: async (gj) => {
        const r = await api(`/sites/${s.id}/contour`, { method: "PUT", body: gj });
        await recharger(`Contour de ${s.code} mis à jour (${fmt.ha(r.superficie_ha, 2)})`);
      },
    });
    return undefined;
  }

  /** Lit un fichier GeoJSON, KML ou GPX et renvoie la première géométrie du type voulu (projection carte). */
  async function lireFichierGeo(types) {
    const fichier = await new Promise((ok) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".geojson,.json,.kml,.gpx";
      inp.onchange = () => ok(inp.files[0] || null);
      inp.click();
    });
    if (!fichier) return null;
    const txt = await fichier.text();
    const nom = fichier.name.toLowerCase();
    const fmtGeo = nom.endsWith(".kml") ? new ol.format.KML({ extractStyles: false }) : nom.endsWith(".gpx") ? new ol.format.GPX() : new ol.format.GeoJSON();
    let feats;
    try {
      feats = fmtGeo.readFeatures(txt, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
    } catch {
      throw new Error("Fichier illisible (GeoJSON, KML ou GPX attendu)");
    }
    const geoms = feats.map((f) => f.getGeometry()).filter(Boolean);
    const aplatir = (g) => (g.getType() === "GeometryCollection" ? g.getGeometries().flatMap(aplatir) : [g]);
    const g = geoms.flatMap(aplatir).find((x) => types.includes(x.getType()));
    if (!g) throw new Error(`Aucune géométrie de type ${types.join(" / ")} dans le fichier`);
    return g;
  }

  async function importerContour(s) {
    try {
      const g = await lireFichierGeo(["Polygon", "MultiPolygon"]);
      if (!g) return;
      view.fit(g.getExtent(), { padding: [80, 80, 160, 80], duration: 500, maxZoom: 18 });
      editer({
        type: "Polygon",
        mode: "modifier",
        geometrie: g,
        texte: `Contour importé pour ${s.code} : vérifiez-le puis enregistrez`,
        enregistrer: async (gj) => {
          const r = await api(`/sites/${s.id}/contour`, { method: "PUT", body: gj });
          await recharger(`Contour de ${s.code} importé (${fmt.ha(r.superficie_ha, 2)})`);
        },
      });
    } catch (x) {
      GR.toast(x.message, "error");
    }
  }

  async function supprimerContour(s) {
    if (!(await GR.confirm({ titre: "Supprimer le contour ?", message: `Le contour de ${esc(s.code)} sera supprimé. Le point du site est conservé.`, ok: "Supprimer", danger: true }))) return;
    await api(`/sites/${s.id}/contour`, { method: "DELETE" });
    await recharger("Contour supprimé");
  }

  async function recalerPoint(s) {
    if (!s.contour) return;
    const g = geoJson().readGeometry(s.contour);
    const c = ol.proj.toLonLat(g.getType() === "MultiPolygon" ? g.getInteriorPoints().getCoordinates()[0] : g.getInteriorPoint().getCoordinates());
    await api(`/sites/${s.id}`, { method: "PATCH", body: { coord: { sys: "wgs", x: c[0].toFixed(7), y: c[1].toFixed(7) } } });
    await recharger(`Point de ${s.code} placé au centre du contour`);
  }

  async function supprimerSite(s) {
    const ok = await GR.confirm({
      titre: `Supprimer ${s.code} ?`,
      message: `Le site <strong>${esc(s.code)} · ${esc(s.localite)}</strong>, son contour et tout son historique de statuts seront supprimés définitivement. Les visites des BRQ sont conservées sans lien.`,
      ok: "Supprimer définitivement",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/sites/${s.id}`, { method: "DELETE" });
      C.fermerPopup();
      await recharger(`${s.code} supprimé`);
    } catch (x) {
      GR.toast(x.status === 403 ? "Seul le chef de cellule peut supprimer un site." : x.message, "error");
    }
  }

  C.barreEditionSite = (f) => {
    const s = f.site;
    return `<div class="popup-actions edition">
      <button class="btn btn-sm btn-ghost" data-pe="site-modifier" title="Modifier les informations et les coordonnées"><span class="mi">edit</span>Modifier</button>
      <button class="btn btn-sm btn-ghost" data-pe="site-constat" title="Ajouter un statut daté"><span class="mi">fact_check</span>Constat</button>
      <button class="btn btn-sm btn-ghost" data-pe="site-deplacer" title="Déplacer le point"><span class="mi">open_with</span>Déplacer</button>
      <details class="menu-popup"><summary class="btn btn-sm btn-ghost"><span class="mi">pentagon</span>Contour<span class="mi mi-sm">expand_more</span></summary>
        <div>
          <button data-pe="contour-dessiner"><span class="mi">draw</span>${s.contour ? "Redessiner" : "Dessiner"} le contour</button>
          ${s.contour ? '<button data-pe="contour-modifier"><span class="mi">edit_road</span>Modifier les sommets</button>' : ""}
          <button data-pe="contour-importer"><span class="mi">upload_file</span>Importer (GeoJSON, KML, GPX)</button>
          ${s.contour ? '<button data-pe="contour-point"><span class="mi">filter_center_focus</span>Placer le point au centre</button>' : ""}
          ${s.contour ? '<button data-pe="contour-supprimer" class="danger"><span class="mi">delete</span>Supprimer le contour</button>' : ""}
        </div></details>
      <button class="btn btn-sm btn-ghost" data-pe="site-images" title="Images drone du site"><span class="mi">photo_library</span>Images</button>
      <button class="btn btn-sm btn-ghost danger" data-pe="site-supprimer" title="Supprimer le site"><span class="mi">delete</span></button>
    </div>`;
  };

  /* ---------------------------- Fiches -------------------------------- */
  function deplacerFiche(f) {
    const p = f.getProperties();
    editer({
      type: "Point",
      mode: "deplacer",
      geometrie: f.getGeometry(),
      texte: `${p.numero} : glissez le point ou cliquez à son nouvel emplacement`,
      enregistrer: async (gj) => {
        const champs = ["date_recu", "heure_recu", "date_faits", "priorite", "source_type", "source_code", "fiabilite", "credibilite", "departement", "sous_prefecture",
          "localite", "foret", "cours_eau", "nature", "equipements", "personnes", "superficie_ha", "description", "suite"];
        const corps = Object.fromEntries(champs.map((k) => [k, p[k]]));
        corps.coord = { sys: "wgs", x: String(gj.coordinates[0]), y: String(gj.coordinates[1]) };
        await api(`/fiches/${p.id}`, { method: "PUT", body: corps });
        await recharger(`Position de ${p.numero} enregistrée`);
      },
    });
  }

  /* --------------------------- Cours d'eau ---------------------------- */
  const INTENSITES = [
    { value: "tres_impacte", label: "Très impacté" },
    { value: "impacte", label: "Impacté" },
    { value: "faible", label: "Faiblement impacté" },
    { value: "non_impacte", label: "Non impacté / non évalué" },
  ];
  async function formulaireCours(c) {
    await formulaire({
      titre: c ? `Modifier — ${c.nom}` : "Nouveau cours d'eau",
      icone: "water",
      champs: [
        { nom: "nom", libelle: "Nom", requis: true, valeur: c?.nom || "" },
        { nom: "type", libelle: "Type", valeur: c?.type || "", liste: ["Fleuve", "Rivière", "Marigot", "Lac", "Retenue"] },
        { nom: "bassin", libelle: "Bassin", valeur: c?.bassin || "" },
        { nom: "intensite", libelle: "Niveau d'impact", type: "select", options: INTENSITES, valeur: c?.intensite || "non_impacte" },
        { nom: "longueur_km", libelle: "Longueur dans le Gôh (km)", type: "number", step: "0.01", min: 0, valeur: c?.longueur_km ?? "" },
        { nom: "lineaire_impacte_km", libelle: "Linéaire impacté (km)", type: "number", step: "0.01", min: 0, valeur: c?.lineaire_impacte_km ?? "" },
        { nom: "localites", libelle: "Localités traversées", type: "textarea", pleine: true, valeur: c?.localites || "" },
        { nom: "commentaire", libelle: "Commentaire", type: "textarea", pleine: true, valeur: c?.commentaire || "" },
      ],
      valider: async (x) => {
        const r = await api(c ? `/cours-eau/${c.id}` : "/cours-eau", { method: c ? "PATCH" : "POST", body: x });
        await recharger(c ? "Cours d'eau modifié" : `${r.nom} ajouté`);
        return null;
      },
    });
  }
  function tracerCours(c, ajout = false) {
    editer({
      type: "LineString",
      mode: "dessiner",
      texte: `Tracé de ${c.nom} : cliquez le long du cours d'eau, double-cliquez pour terminer`,
      enregistrer: async (gj) => {
        let trace = gj;
        if (ajout && c.trace) {
          const lignes = c.trace.type === "LineString" ? [c.trace.coordinates] : c.trace.coordinates;
          trace = { type: "MultiLineString", coordinates: [...lignes, gj.coordinates] };
        }
        await api(`/cours-eau/${c.id}/trace`, { method: "PUT", body: trace });
        await recharger(`Tracé de ${c.nom} enregistré`);
      },
    });
  }
  async function choisirCoursPuisTracer() {
    const cours = E.coursEau || [];
    const v = await formulaire({
      titre: "Tracer un cours d'eau",
      icone: "water",
      champs: [
        { nom: "id", libelle: "Cours d'eau", type: "select", options: [...cours.map((c) => ({ value: c.id, label: `${c.nom}${c.trace ? " (déjà tracé)" : ""}` })), { value: "__nouveau", label: "+ Nouveau cours d'eau…" }] },
        { nom: "mode", libelle: "Si un tracé existe déjà", type: "select", options: [{ value: "remplacer", label: "Le remplacer" }, { value: "ajouter", label: "Ajouter un tronçon" }], valeur: "ajouter" },
      ],
      ok: "Commencer le tracé",
    });
    if (!v) return;
    if (v.id === "__nouveau") return formulaireCours(null);
    const c = cours.find((x) => x.id === v.id);
    tracerCours(c, v.mode === "ajouter");
    return undefined;
  }
  async function effacerTrace(c) {
    if (!(await GR.confirm({ titre: "Effacer le tracé ?", message: `Le tracé de ${esc(c.nom)} sera effacé (le cours d'eau et ses informations sont conservés).`, ok: "Effacer", danger: true }))) return;
    await api(`/cours-eau/${c.id}/trace`, { method: "DELETE" });
    C.fermerPopup();
    await recharger("Tracé effacé");
  }

  async function gererCoursEau() {
    const cours = E.coursEau || [];
    const m = document.createElement("div");
    m.className = "modal open";
    m.innerHTML = `<div class="modal-dialog lg"><div class="modal-head"><span class="mi" style="color:var(--primary)">water</span><h2>Cours d'eau</h2>
      <div class="actions"><button class="btn btn-sm btn-primary" data-g="nouveau"><span class="mi">add</span>Ajouter</button><button class="btn btn-sm btn-ghost btn-icon" data-g="fermer"><span class="mi">close</span></button></div></div>
      <div class="modal-body flush"><div class="table-wrap"><table class="table compact"><thead><tr><th>Nom</th><th>Impact</th><th class="num">Longueur (km)</th><th>Tracé</th><th></th></tr></thead><tbody>
      ${cours
        .map(
          (c) => `<tr><td class="cell-strong">${esc(c.nom)}<div class="muted" style="font-size:12px">${esc(c.type || "")}</div></td>
          <td>${esc((INTENSITES.find((i) => i.value === c.intensite) || INTENSITES[3]).label)}</td><td class="num">${c.longueur_km ? fmt.n(c.longueur_km, 2) : "—"}</td>
          <td>${c.trace ? '<span class="badge green">oui</span>' : '<span class="badge">à tracer</span>'}</td>
          <td class="nowrap right"><button class="btn btn-sm btn-ghost btn-icon" data-g="tracer" data-id="${c.id}" title="Tracer"><span class="mi">timeline</span></button>
          <button class="btn btn-sm btn-ghost btn-icon" data-g="modifier" data-id="${c.id}" title="Modifier"><span class="mi">edit</span></button>
          <button class="btn btn-sm btn-ghost btn-icon" data-g="supprimer" data-id="${c.id}" title="Supprimer"><span class="mi" style="color:var(--danger)">delete</span></button></td></tr>`
        )
        .join("") || '<tr><td colspan="5"><div class="empty"><span class="mi">water</span><h3>Aucun cours d\'eau</h3></div></td></tr>'}
      </tbody></table></div></div></div>`;
    document.body.appendChild(m);
    const fermer = () => m.remove();
    m.addEventListener("click", async (e) => {
      if (e.target === m) return fermer();
      const b = e.target.closest("[data-g]");
      if (!b) return undefined;
      const c = cours.find((x) => x.id === b.dataset.id);
      if (b.dataset.g === "fermer") return fermer();
      fermer();
      if (b.dataset.g === "nouveau") return formulaireCours(null);
      if (b.dataset.g === "modifier") return formulaireCours(c);
      if (b.dataset.g === "tracer") return tracerCours(c, false);
      if (b.dataset.g === "supprimer") {
        if (!(await GR.confirm({ titre: `Supprimer ${esc(c.nom)} ?`, message: "Le cours d'eau et son tracé seront supprimés.", ok: "Supprimer", danger: true }))) return undefined;
        await api(`/cours-eau/${c.id}`, { method: "DELETE" });
        await recharger("Cours d'eau supprimé");
      }
      return undefined;
    });
  }
  C.gererCoursEau = gererCoursEau;

  /* ------------------------- Zones de travail ------------------------- */
  function dessinerZone() {
    editer({
      type: "Polygon",
      mode: "dessiner",
      texte: "Zone de travail : cliquez les sommets, double-cliquez pour fermer",
      enregistrer: async (gj) => {
        const v = await formulaire({
          titre: "Nouvelle zone de travail",
          icone: "crop_free",
          champs: [
            { nom: "nom", libelle: "Nom", requis: true, placeholder: "Ex. Secteur Sérihio nord" },
            { nom: "categorie", libelle: "Catégorie", type: "select", options: [{ value: "zone_ops", label: "Zone d'opérations" }, { value: "secteur", label: "Secteur de surveillance" }, { value: "prospection", label: "Zone de prospection" }] },
          ],
          ok: "Créer la zone",
        });
        if (!v) return false;
        await api("/zones", { method: "POST", body: { ...v, geometrie: gj } });
        const r = C.refs.zones;
        if (r && !r.couche.getVisible()) {
          r.couche.setVisible(true);
          C.majListeCouches();
        }
        await recharger(`Zone « ${v.nom} » créée`);
        return true;
      },
    });
  }
  C.dessinerZone = dessinerZone;

  function popupZone(f, coord) {
    const p = f.getProperties();
    const surf = ol.sphere.getArea(f.getGeometry()) / 10000;
    C.ouvrirPopupHtml(
      `<div class="popup-head"><span class="mi" style="color:#be185d">crop_free</span><div><h3>${esc(p.nom)}</h3><small>Zone de travail · ${fmt.ha(surf, 0)}</small></div>
        <button data-fermer-popup title="Fermer"><span class="mi mi-sm">close</span></button></div>
       <div class="popup-actions"><button class="btn btn-sm" data-pe="zone-renommer"><span class="mi">edit</span>Renommer</button>
        <button class="btn btn-sm" data-pe="zone-modifier"><span class="mi">edit_road</span>Modifier la forme</button>
        <button class="btn btn-sm" data-pe="zone-prospecter"><span class="mi">radar</span>Prospecter</button>
        <button class="btn btn-sm btn-soft-danger" data-pe="zone-supprimer"><span class="mi">delete</span></button></div>`,
      coord,
      [f]
    );
  }

  /* ---------------------- Clics sur les couches ----------------------- */
  const clicPrecedent = C.clicSupplementaire;
  C.clicSupplementaire = (evt) => {
    if (clicPrecedent?.(evt)) return true;
    const r = C.refs.zones;
    if (!r?.couche.getVisible()) return false;
    let z = null;
    map.forEachFeatureAtPixel(evt.pixel, (f) => (z = f), { layerFilter: (l) => l === r.couche, hitTolerance: 3 });
    if (z) {
      popupZone(z, evt.coordinate);
      return true;
    }
    return false;
  };

  /* ------------------------ Qualité de l'eau -------------------------- */
  async function saisirQualiteEau(f) {
    const ceId = f.get("cours_eau_id") || f.get("id");
    const ce = (E.coursEau || []).find((c) => c.id === ceId);
    if (!ce) return undefined;
    const base = f.get("mesure");
    const mesures = (E.qualiteEau || []).filter((m) => m.cours_eau_id === ceId);
    const points = [...new Set(mesures.map((m) => m.point).filter(Boolean))];
    const v = await formulaire({
      titre: `Qualité de l'eau — ${ce.nom}`,
      icone: "water_drop",
      large: true,
      intro: "Un relevé par station et par semaine (lundi–dimanche). Si un relevé existe déjà pour cette station et cette semaine, il est mis à jour.",
      champs: [
        { nom: "date", libelle: "Date du prélèvement", type: "date", valeur: aujourdhui(), max: aujourdhui(), requis: true },
        { nom: "point", libelle: "Station / point", valeur: base?.point || "", liste: points, placeholder: "ex. amont pont de Zangué" },
        ...PARAMETRES.map((p) => ({ nom: p.cle, libelle: `${p.libelle} (${p.unite})`, type: "number", min: 0, step: "any", aide: `seuil ${String(p.seuil).replace(".", ",")}` })),
        { nom: "autre_parametre", libelle: "Autre paramètre", placeholder: "ex. pH, arsenic, MES…" },
        { nom: "autre_valeur", libelle: "Valeur", type: "number", step: "any" },
        { nom: "autre_unite", libelle: "Unité", placeholder: "ex. µg/L" },
        { nom: "lat", libelle: "Latitude (WGS84)", type: "number", step: "any", valeur: base?.lat ?? "", aide: "facultatif" },
        { nom: "lng", libelle: "Longitude (WGS84)", type: "number", step: "any", valeur: base?.lng ?? "", aide: "facultatif" },
        { nom: "observations", libelle: "Observations", type: "textarea", pleine: true },
      ],
      ok: "Enregistrer la mesure",
      valider: async (x) => {
        const autres = x.autre_parametre && x.autre_valeur !== null ? [{ parametre: x.autre_parametre, valeur: x.autre_valeur, unite: x.autre_unite || "" }] : [];
        if (x.autre_parametre && x.autre_valeur === null) return "Indiquez la valeur de l'autre paramètre.";
        if (PARAMETRES.every((p) => x[p.cle] === null) && !autres.length) return "Renseignez au moins un paramètre.";
        if ((x.lat === null) !== (x.lng === null)) return "Renseignez la latitude et la longitude, ou aucune des deux.";
        const point = (x.point || "").trim();
        const existante = mesures.find((m) => m.semaine === lundi(x.date) && (m.point || "") === point);
        const body = {
          cours_eau_id: ceId,
          date: x.date,
          point,
          coord: x.lat !== null ? { sys: "wgs", x: x.lng, y: x.lat } : null,
          turbidite: x.turbidite,
          mercure: x.mercure,
          cyanure: x.cyanure,
          autres: existante ? [...(existante.autres || []).filter((a) => !autres.some((b) => b.parametre === a.parametre)), ...autres] : autres,
          observations: x.observations || "",
        };
        if (existante) {
          for (const p of PARAMETRES) if (body[p.cle] === null) body[p.cle] = existante[p.cle];
          if (!body.coord && existante.coord_saisie) body.coord = existante.coord_saisie;
          if (!body.observations) body.observations = existante.observations || "";
        }
        const m = await api(existante ? `/qualite-eau/${existante.id}` : "/qualite-eau", { method: existante ? "PUT" : "POST", body });
        const dep = PARAMETRES.filter((p) => depasse(m, p.cle)).map((p) => PARAM[p.cle].libelle);
        GR.toast(dep.length ? `Mesure enregistrée — dépassement : ${dep.join(", ")}` : existante ? "Mesure de la semaine mise à jour" : "Mesure enregistrée", dep.length ? "warning" : "success");
        return null;
      },
    });
    if (!v) return undefined;
    C.fermerPopup();
    return C.recharger();
  }

  /* --------------------------- Actions -------------------------------- */
  const actionPrecedente = C.actionEdition;
  C.actionEdition = async (action, f, bouton) => {
    bouton?.closest("details")?.removeAttribute("open");
    const s = f?.site;
    try {
      switch (action) {
        case "site-modifier":
          return modifierSite(s);
        case "site-constat":
          return constat(s);
        case "site-deplacer":
          return deplacerSite(s, f);
        case "site-supprimer":
          return supprimerSite(s);
        case "site-images":
          return C.ouvrirImagesSite?.(s);
        case "contour-dessiner":
          return dessinerContour(s);
        case "contour-modifier":
          return modifierContour(s);
        case "contour-importer":
          return importerContour(s);
        case "contour-supprimer":
          return supprimerContour(s);
        case "contour-point":
          return recalerPoint(s);
        case "constat-retirer":
          return retirerConstat(s, bouton.dataset.evt);
        case "fiche-deplacer":
          return deplacerFiche(f);
        case "eau-saisir":
          return saisirQualiteEau(f);
        case "cours-modifier":
          return formulaireCours((E.coursEau || []).find((c) => c.id === f.get("id")));
        case "cours-retracer":
          return tracerCours((E.coursEau || []).find((c) => c.id === f.get("id")), false);
        case "cours-effacer":
          return effacerTrace((E.coursEau || []).find((c) => c.id === f.get("id")));
        case "zone-renommer": {
          const v = await formulaire({ titre: "Renommer la zone", icone: "edit", champs: [{ nom: "nom", libelle: "Nom", requis: true, valeur: f.get("nom") }] });
          if (!v) return undefined;
          await api(`/zones/${f.get("id")}`, { method: "PATCH", body: { nom: v.nom, categorie: f.get("categorie"), approximative: f.get("approximative") } });
          C.fermerPopup();
          return recharger("Zone renommée");
        }
        case "zone-modifier":
          return editer({
            type: "Polygon",
            mode: "modifier",
            geometrie: f.getGeometry(),
            texte: `Zone « ${f.get("nom")} » : glissez les sommets puis enregistrez`,
            enregistrer: async (gj) => {
              await api(`/zones/${f.get("id")}`, { method: "PATCH", body: { nom: f.get("nom"), categorie: f.get("categorie"), approximative: false, geometrie: gj } });
              await recharger("Zone modifiée");
            },
          });
        case "zone-supprimer":
          if (!(await GR.confirm({ titre: "Supprimer la zone ?", message: `La zone « ${esc(f.get("nom"))} » sera supprimée.`, ok: "Supprimer", danger: true }))) return undefined;
          await api(`/zones/${f.get("id")}`, { method: "DELETE" });
          C.fermerPopup();
          return recharger("Zone supprimée");
        case "zone-prospecter":
          C.fermerPopup();
          return C.prospecterZone?.(f);
        default:
          return actionPrecedente?.(action, f, bouton);
      }
    } catch (x) {
      GR.toast(x.message, "error");
    }
    return undefined;
  };

  /* -------------------- Boutons de la barre d'outils ------------------ */
  let attenteAjout = null;
  ecoute(racine, "click", (e) => {
    const b = e.target.closest("[data-edition]");
    if (!b) return;
    const a = b.dataset.edition;
    if (a === "ajout-site") {
      editer({
        type: "Point",
        mode: "deplacer",
        geometrie: null,
        texte: "Nouveau site : cliquez sur la carte à l'emplacement du site (ou saisissez les coordonnées ensuite)",
        enregistrer: async (gj, g) => {
          attenteAjout = g.getCoordinates();
          finSession();
          await nouveauSite(attenteAjout);
          return true;
        },
      });
      barre.querySelector('[data-eb="ok"]').innerHTML = '<span class="mi">arrow_forward</span>Continuer';
    }
    if (a === "ajout-site-coord") nouveauSite(null);
    if (a === "tracer-cours") choisirCoursPuisTracer();
    if (a === "gerer-cours") gererCoursEau();
    if (a === "zone") dessinerZone();
  });
  // Rétablit le libellé du bouton après une session « ajout »
  const obs = new MutationObserver(() => {
    if (!barre.classList.contains("show")) barre.querySelector('[data-eb="ok"]').innerHTML = '<span class="mi">check</span>Enregistrer';
  });
  obs.observe(barre, { attributes: true, attributeFilter: ["class"] });

  return () => {
    finSession();
    obs.disconnect();
  };
}
