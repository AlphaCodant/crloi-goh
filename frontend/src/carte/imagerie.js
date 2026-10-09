/* =====================================================================
   CRLOI Gôh — Carte : imagerie
   - couches Google Earth Engine (Sentinel-2 / Landsat, NDVI, BSI, eau, perte de végétation)
   - orthophotos drone géoréférencées (dépôt, affichage selon la frise, gestion)
   - rideau de comparaison avant / après
   ===================================================================== */
import GR from "../gr/gr";
import { api, getToken, urlApi } from "../api";
import { formulaire } from "./formulaire";
import { CRS_PRIS_EN_CHARGE, lireOrthophoto, versBlob } from "./orthophoto";

const ol = window.ol;
const { esc, fmt, $, $$ } = GR;
const J = 864e5;
const ajouter = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * J).toISOString().slice(0, 10);
const dateFr = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");
const aujourdhui = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const LIB_CRS = { "EPSG:4326": "WGS84 (degrés)", "EPSG:3857": "Web Mercator", "EPSG:32629": "UTM 29N", "EPSG:32630": "UTM 30N" };

export function initImagerie(C, { racine, ecoute, signal }) {
  const map = C.map;
  const view = map.getView();
  const E = C.etat;
  const pane = $("#pane-imagerie", racine);
  let etatGee = null;

  /* ============================ Panneau ============================== */
  pane.innerHTML = `
    <div class="panel-section">
      <h3><span class="mi mi-sm">public</span>Images satellite — Earth Engine</h3>
      <div id="gee-etat" class="mb-2"></div>
      <div class="stack" style="gap:10px">
        <div class="field"><label>Produit</label><select class="select sm" id="gee-produit">
          <option value="couleurs">Couleurs naturelles</option>
          <option value="fausses_couleurs">Fausses couleurs (végétation en rouge)</option>
          <option value="swir">Infrarouge court (sols remaniés, eau)</option>
          <option value="ndvi" selected>NDVI — végétation</option>
          <option value="bsi">BSI — sol nu</option>
          <option value="mndwi">MNDWI — eau et bassins</option>
          <option value="ndti">NDTI — turbidité de l'eau</option>
          <option value="dndvi">Perte de végétation entre deux périodes</option>
        </select></div>
        <div class="field"><label>Période</label><div class="row"><input class="input sm" type="date" id="gee-du"><span class="muted">au</span><input class="input sm" type="date" id="gee-au"></div>
          <div class="row-wrap mt-1"><button class="btn btn-ghost btn-sm" data-preset="3m">3 derniers mois</button><button class="btn btn-ghost btn-sm" data-preset="sec">Saison sèche</button><button class="btn btn-ghost btn-sm" data-preset="an">Un an plus tôt</button></div></div>
        <div class="field hidden" id="gee-ref"><label>Période de référence (avant)</label><div class="row"><input class="input sm" type="date" id="gee-ref-du"><span class="muted">au</span><input class="input sm" type="date" id="gee-ref-au"></div></div>
        <details class="avance"><summary>Réglages</summary>
          <div class="stack mt-2" style="gap:8px">
            <div class="field"><label>Nuages maximum par scène <span class="muted" id="gee-nuages-val">60 %</span></label><input type="range" id="gee-nuages" min="5" max="100" value="60"></div>
            <div class="field"><label>Capteur</label><select class="select sm" id="gee-capteur"><option value="auto">Automatique (Sentinel-2 depuis 2019, sinon Landsat)</option><option value="sentinel2">Sentinel-2 (10 m)</option><option value="landsat">Landsat 5 à 9 (30 m, depuis 1984)</option></select></div>
          </div>
        </details>
        <button class="btn btn-primary btn-sm" id="gee-ajouter"><span class="mi">add_photo_alternate</span>Afficher sur la carte</button>
      </div>
      <div id="gee-couches" class="stack mt-3" style="gap:8px"></div>
    </div>

    <div class="panel-section">
      <h3><span class="mi mi-sm">flight</span>Images drone</h3>
      <div class="segmented mb-2" id="drone-mode"><button data-m="frise" class="active">Selon la frise</button><button data-m="toutes">Toutes</button><button data-m="aucune">Masquées</button></div>
      <button class="btn btn-soft btn-sm" id="drone-ajouter"><span class="mi">upload</span>Ajouter une orthophoto</button>
      <p class="muted mt-2" style="font-size:12px">GeoTIFF géoréférencé (WGS84, UTM 29N/30N) ou JPEG / PNG avec son fichier de calage. Une version allégée (4096 px au plus) est conservée pour l'affichage. Avec « Selon la frise », chaque site montre sa dernière image à la date choisie.</p>
      <div id="drone-liste" class="mt-2"></div>
    </div>

    <div class="panel-section">
      <h3><span class="mi mi-sm">compare</span>Comparer avant / après</h3>
      <div class="stack" style="gap:8px">
        <div class="field"><label>À gauche (avant)</label><select class="select sm" id="cmp-gauche"></select></div>
        <div class="field"><label>À droite (après)</label><select class="select sm" id="cmp-droite"></select></div>
        <button class="btn btn-sm" id="cmp-go"><span class="mi">compare</span>Lancer le rideau</button>
      </div>
    </div>`;

  /* ======================= Earth Engine : état ======================== */
  async function majEtat() {
    const z = $("#gee-etat", pane);
    try {
      etatGee = await api("/gee/etat");
    } catch {
      etatGee = { configure: false };
    }
    z.innerHTML = etatGee.configure
      ? `<div class="row" style="font-size:12px"><span class="status-dot ok"></span><span class="muted">Connecté au projet <strong>${esc(etatGee.identite?.projet || "")}</strong></span>
         <button class="btn btn-ghost btn-sm" id="gee-test" style="margin-left:auto">Tester</button></div>`
      : `<div class="alert warning" style="font-size:12px"><span class="mi mi-sm">key_off</span><span>Earth Engine n'est pas encore relié : ajoutez la clé du compte de service dans la variable <strong>GEE_SERVICE_ACCOUNT_JSON</strong> de l'API sur Render.</span></div>`;
  }
  ecoute(pane, "click", async (e) => {
    if (!e.target.closest("#gee-test")) return;
    try {
      const r = await api("/gee/verifier", { method: "POST" });
      GR.toast(`Earth Engine répond : ${r.scenes_sentinel2_60j_gagnoa} scène(s) Sentinel-2 sur Gagnoa ces 60 derniers jours`);
    } catch (x) {
      GR.toast(x.message, "error", 8000);
    }
  });

  /* ======================= Earth Engine : couches ===================== */
  const couchesGee = [];
  C.couchesGee = couchesGee;
  const fin0 = E.date || aujourdhui();
  $("#gee-au", pane).value = fin0;
  $("#gee-du", pane).value = ajouter(fin0, -90);
  $("#gee-ref-au", pane).value = ajouter(fin0, -365);
  $("#gee-ref-du", pane).value = ajouter(fin0, -455);
  ecoute($("#gee-produit", pane), "change", (e) => $("#gee-ref", pane).classList.toggle("hidden", e.target.value !== "dndvi"));
  ecoute($("#gee-nuages", pane), "input", (e) => ($("#gee-nuages-val", pane).textContent = `${e.target.value} %`));
  ecoute(pane, "click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (!b) return;
    const au = $("#gee-au", pane).value || aujourdhui();
    if (b.dataset.preset === "3m") {
      const f = E.date || aujourdhui();
      $("#gee-au", pane).value = f;
      $("#gee-du", pane).value = ajouter(f, -90);
    }
    if (b.dataset.preset === "sec") {
      // Grande saison sèche : décembre à mars (moins de nuages)
      const y = Number((E.date || aujourdhui()).slice(0, 4));
      const m = Number((E.date || aujourdhui()).slice(5, 7));
      const fin = m >= 4 ? y : y - 1;
      $("#gee-du", pane).value = `${fin - 1}-12-01`;
      $("#gee-au", pane).value = `${fin}-03-31`;
    }
    if (b.dataset.preset === "an") {
      $("#gee-du", pane).value = ajouter($("#gee-du", pane).value || ajouter(au, -90), -365);
      $("#gee-au", pane).value = ajouter(au, -365);
    }
  });

  function rendreCouchesGee() {
    $("#gee-couches", pane).innerHTML = couchesGee
      .map(
        (c) => `<div class="layer gee" data-gee="${c.id}">
          <div class="layer-row"><input type="checkbox" class="check" data-gv ${c.couche.getVisible() ? "checked" : ""}>
          <span class="name">${esc(c.res.libelle)}<small>${dateFr(c.res.du)} → ${dateFr(c.res.au)} · ${esc(c.res.capteur)} · ${c.res.images} scène(s)</small></span>
          <button class="btn btn-ghost btn-icon btn-sm" data-gz title="Opacité"><span class="mi">tune</span></button>
          <button class="btn btn-ghost btn-icon btn-sm" data-gs title="Retirer"><span class="mi">close</span></button></div>
          ${c.res.legende?.palette?.length ? `<div class="gradient" style="background:linear-gradient(90deg,${c.res.legende.palette.join(",")})"></div><div class="gradient-bornes"><span>${c.res.legende.min}</span><span>${c.res.legende.max}</span></div>` : ""}
          <div class="layer-extra"><label class="label">Opacité</label><input type="range" min="0" max="100" value="${Math.round(c.couche.getOpacity() * 100)}" data-go></div>
        </div>`
      )
      .join("");
    majComparaison();
  }
  ecoute($("#gee-couches", pane), "input", (e) => {
    const c = couchesGee.find((x) => x.id === e.target.closest("[data-gee]")?.dataset.gee);
    if (c && e.target.matches("[data-go]")) c.couche.setOpacity(Number(e.target.value) / 100);
  });
  ecoute($("#gee-couches", pane), "change", (e) => {
    const c = couchesGee.find((x) => x.id === e.target.closest("[data-gee]")?.dataset.gee);
    if (c && e.target.matches("[data-gv]")) c.couche.setVisible(e.target.checked);
  });
  ecoute($("#gee-couches", pane), "click", (e) => {
    const bloc = e.target.closest("[data-gee]");
    if (!bloc) return;
    const i = couchesGee.findIndex((x) => x.id === bloc.dataset.gee);
    if (e.target.closest("[data-gz]")) bloc.classList.toggle("open");
    if (e.target.closest("[data-gs]")) {
      if (rideau && (rideau.g === `gee:${couchesGee[i].id}` || rideau.d === `gee:${couchesGee[i].id}`)) arreterRideau();
      map.removeLayer(couchesGee[i].couche);
      couchesGee.splice(i, 1);
      rendreCouchesGee();
    }
  });

  let nGee = 0;
  async function ajouterCoucheGee(def, { silencieux = false } = {}) {
    const res = await api("/gee/couche", { method: "POST", body: def });
    const couche = new ol.layer.Tile({
      source: new ol.source.XYZ({ url: res.url, crossOrigin: "anonymous", maxZoom: 18, attributions: `${res.capteur} via Google Earth Engine` }),
      opacity: def.produit.match(/couleurs|swir/) ? 1 : 0.8,
      zIndex: 5,
    });
    map.addLayer(couche);
    nGee += 1;
    const c = { id: `g${nGee}`, def, res, couche };
    couchesGee.push(c);
    rendreCouchesGee();
    if (!silencieux) GR.toast(`${res.libelle} ajouté (${res.images} scène(s))`);
    return c;
  }
  C.ajouterCoucheGee = ajouterCoucheGee;

  ecoute($("#gee-ajouter", pane), "click", async (e) => {
    const b = e.currentTarget;
    const produit = $("#gee-produit", pane).value;
    const def = {
      produit,
      du: $("#gee-du", pane).value,
      au: $("#gee-au", pane).value,
      nuages: Number($("#gee-nuages", pane).value),
      capteur: $("#gee-capteur", pane).value,
    };
    if (produit === "dndvi") Object.assign(def, { ref_du: $("#gee-ref-du", pane).value, ref_au: $("#gee-ref-au", pane).value });
    if (!def.du || !def.au) return GR.toast("Indiquez la période", "warning");
    b.disabled = true;
    b.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span>Calcul par Earth Engine…';
    try {
      await ajouterCoucheGee(def);
    } catch (x) {
      GR.toast(x.message, "error", 9000);
    } finally {
      b.disabled = false;
      b.innerHTML = '<span class="mi">add_photo_alternate</span>Afficher sur la carte';
    }
    return undefined;
  });

  /* ============================ Drone ================================= */
  let images = [];
  let modeDrone = "frise";
  const groupeDrone = new ol.layer.Group({ layers: [], zIndex: 6 });
  map.addLayer(groupeDrone);
  const couchesImage = new Map(); // id -> ImageLayer (réutilisées)

  const urlsBlob = [];
  function chargeurAuthentifie(image, src) {
    fetch(src, { headers: { Authorization: `Bearer ${getToken()}` }, signal })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
      .then((b) => {
        const u = URL.createObjectURL(b);
        urlsBlob.push(u);
        image.getImage().src = u;
      })
      .catch(() => {});
  }
  function coucheImage(img) {
    if (couchesImage.has(img.id)) return couchesImage.get(img.id);
    const l = new ol.layer.Image({
      source: new ol.source.ImageStatic({
        url: urlApi(`/images/${img.id}/fichier`),
        imageExtent: img.emprise,
        projection: img.crs,
        imageLoadFunction: chargeurAuthentifie,
        attributions: "Orthophoto drone CRLOI Gôh",
      }),
      zIndex: 6,
    });
    l.set("image", img);
    couchesImage.set(img.id, l);
    return l;
  }
  const cleEmplacement = (img) => img.site_id || img.id;

  /** Images à afficher : la plus récente ≤ date pour chaque site (ou toutes). */
  function selection(dateMax, toutes = false) {
    if (toutes) return images;
    const parSite = new Map();
    images
      .filter((i) => i.date_prise <= dateMax)
      .forEach((i) => {
        const k = cleEmplacement(i);
        const cur = parSite.get(k);
        if (!cur || cur.date_prise < i.date_prise) parSite.set(k, i);
      });
    return [...parSite.values()];
  }

  function majDrone() {
    const liste = modeDrone === "aucune" ? [] : selection(E.date || aujourdhui(), modeDrone === "toutes");
    liste.sort((a, b) => (a.date_prise < b.date_prise ? -1 : 1));
    groupeDrone.setLayers(new ol.Collection(liste.map(coucheImage)));
  }
  C.majDrone = majDrone;

  async function chargerImages() {
    try {
      images = await api("/images");
    } catch {
      images = [];
    }
    rendreListeDrone();
    majDrone();
    majComparaison();
  }
  const siteDe = (id) => E.sites.find((s) => s.id === id);

  function rendreListeDrone() {
    const z = $("#drone-liste", pane);
    if (!images.length) {
      z.innerHTML = '<div class="muted" style="font-size:12.5px">Aucune orthophoto déposée pour l\'instant.</div>';
      return;
    }
    const groupes = new Map();
    images.forEach((i) => {
      const k = i.site_id || "_";
      if (!groupes.has(k)) groupes.set(k, []);
      groupes.get(k).push(i);
    });
    z.innerHTML = [...groupes.entries()]
      .map(([k, l]) => {
        const s = siteDe(k);
        return `<div class="drone-groupe"><div class="drone-titre">${s ? `<strong>${esc(s.code)}</strong> ${esc(s.localite)}` : "<strong>Sans site</strong>"}<span class="muted">${l.length} image(s)</span></div>
          ${l
            .map(
              (i) => `<div class="drone-ligne" data-img="${i.id}"><span class="num">${dateFr(i.date_prise)}</span><span class="muted ell">${esc(i.titre || i.fichier_origine || "")}</span>
              <button class="btn btn-ghost btn-icon btn-sm" data-di="voir" title="Afficher à cette date"><span class="mi">visibility</span></button>
              <button class="btn btn-ghost btn-icon btn-sm" data-di="modifier" title="Modifier"><span class="mi">edit</span></button>
              <button class="btn btn-ghost btn-icon btn-sm" data-di="supprimer" title="Supprimer"><span class="mi" style="color:var(--danger)">delete</span></button></div>`
            )
            .join("")}</div>`;
      })
      .join("");
  }

  async function voirImage(img) {
    modeDrone = modeDrone === "aucune" ? "frise" : modeDrone;
    $$("#drone-mode button", pane).forEach((b) => b.classList.toggle("active", b.dataset.m === modeDrone));
    if (modeDrone === "frise") C.changerDate(img.date_prise);
    majDrone();
    const ext = ol.proj.transformExtent(img.emprise_wgs84, "EPSG:4326", "EPSG:3857");
    view.fit(ext, { padding: [60, 60, 160, 60], duration: 600, maxZoom: 19 });
  }

  async function modifierImage(img) {
    await formulaire({
      titre: "Modifier l'image drone",
      icone: "photo",
      champs: [
        { nom: "titre", libelle: "Titre", valeur: img.titre },
        { nom: "date_prise", libelle: "Date de prise de vue", type: "date", valeur: img.date_prise, requis: true },
        { nom: "site_id", libelle: "Site", type: "select", options: [{ value: "", label: "— Aucun —" }, ...E.sites.map((s) => ({ value: s.id, label: `${s.code} · ${s.localite}` }))], valeur: img.site_id || "" },
        { nom: "note", libelle: "Note", type: "textarea", pleine: true, valeur: img.note },
      ],
      valider: async (v) => {
        await api(`/images/${img.id}`, { method: "PATCH", body: v });
        couchesImage.delete(img.id);
        await chargerImages();
        GR.toast("Image modifiée");
        return null;
      },
    });
  }

  async function supprimerImage(img) {
    if (!(await GR.confirm({ titre: "Supprimer l'image ?", message: `L'orthophoto du ${dateFr(img.date_prise)} sera supprimée définitivement.`, ok: "Supprimer", danger: true }))) return;
    await api(`/images/${img.id}`, { method: "DELETE" });
    couchesImage.delete(img.id);
    await chargerImages();
    GR.toast("Image supprimée");
  }

  ecoute($("#drone-liste", pane), "click", (e) => {
    const b = e.target.closest("[data-di]");
    if (!b) return;
    const img = images.find((i) => i.id === b.closest("[data-img]").dataset.img);
    if (b.dataset.di === "voir") voirImage(img);
    if (b.dataset.di === "modifier") modifierImage(img);
    if (b.dataset.di === "supprimer") supprimerImage(img).catch((x) => GR.toast(x.message, "error"));
  });
  ecoute($("#drone-mode", pane), "click", (e) => {
    const b = e.target.closest("[data-m]");
    if (!b) return;
    modeDrone = b.dataset.m;
    $$("#drone-mode button", pane).forEach((x) => x.classList.toggle("active", x === b));
    majDrone();
  });

  /* --------------------------- Dépôt ---------------------------------- */
  async function deposer(siteParDefaut = null) {
    const fichiers = await new Promise((ok) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.multiple = true;
      inp.accept = ".tif,.tiff,.jpg,.jpeg,.png,.jgw,.pgw,.wld,.tfw";
      inp.onchange = () => ok(inp.files);
      inp.click();
    });
    if (!fichiers || !fichiers.length) return;
    GR.toast("Lecture de l'orthophoto…", "info", 2500);
    let o;
    try {
      o = await lireOrthophoto(fichiers);
    } catch (x) {
      GR.toast(x.message || "Fichier illisible", "error", 8000);
      return;
    }
    // Site proposé : celui qui contient / est le plus proche du centre de l'image
    let site = siteParDefaut;
    if (!site) {
      const crs = CRS_PRIS_EN_CHARGE.includes(o.crsDevine) ? o.crsDevine : "EPSG:32630";
      const c = ol.proj.transform([(o.bbox[0] + o.bbox[2]) / 2, (o.bbox[1] + o.bbox[3]) / 2], crs, "EPSG:4326");
      let d = Infinity;
      E.sites.forEach((s) => {
        if (s.lat == null) return;
        const x = (s.lat - c[1]) ** 2 + (s.lng - c[0]) ** 2;
        if (x < d) {
          d = x;
          site = s;
        }
      });
      if (d > 0.05 ** 2) site = null; // plus de ~5 km : pas de rattachement automatique
    }
    const crsInconnu = !CRS_PRIS_EN_CHARGE.includes(o.crsDevine);
    await formulaire({
      titre: "Ajouter une orthophoto",
      icone: "flight",
      intro: `${esc(o.fichier)} · ${fmt.n(o.largeurOrigine)} × ${fmt.n(o.hauteurOrigine)} px${o.resolution && !String(o.crsDevine).endsWith("4326") ? ` · résolution ${fmt.n(o.resolution * 100, 1)} cm` : ""}`,
      champs: [
        ...(crsInconnu ? [{ type: "info", html: `Système de coordonnées du fichier non reconnu (${esc(o.crs || "absent")}). Choisissez-le ci-dessous.` }] : []),
        { nom: "date_prise", libelle: "Date de prise de vue", type: "date", valeur: o.date || E.date || aujourdhui(), max: aujourdhui(), requis: true },
        { nom: "site_id", libelle: "Site couvert", type: "select", options: [{ value: "", label: "— Aucun —" }, ...E.sites.map((s) => ({ value: s.id, label: `${s.code} · ${s.localite}` }))], valeur: site?.id || "" },
        { nom: "titre", libelle: "Titre", valeur: "", placeholder: "Ex. Survol de contrôle" },
        { nom: "crs", libelle: "Système de coordonnées", type: "select", options: CRS_PRIS_EN_CHARGE.map((c) => ({ value: c, label: `${LIB_CRS[c]} (${c})` })), valeur: CRS_PRIS_EN_CHARGE.includes(o.crsDevine) ? o.crsDevine : "EPSG:32630" },
        { nom: "note", libelle: "Note", type: "textarea", pleine: true },
      ],
      ok: "Envoyer",
      valider: async (v) => {
        const ext = o.bbox;
        let wgs;
        try {
          wgs = ol.proj.transformExtent(ext, v.crs, "EPSG:4326");
        } catch {
          return "Emprise impossible à convertir";
        }
        if (!(wgs[0] > -9 && wgs[2] < -2 && wgs[1] > 4 && wgs[3] < 11)) return `L'image tombe hors de Côte d'Ivoire avec ${LIB_CRS[v.crs]} : vérifiez le système de coordonnées.`;
        const blob = await versBlob(o);
        const fd = new FormData();
        fd.append("fichier", blob, `${o.fichier.replace(/\.[^.]+$/, "")}.${blob.type === "image/webp" ? "webp" : "png"}`);
        Object.entries({
          date_prise: v.date_prise,
          crs: v.crs,
          emprise: ext.join(","),
          emprise_wgs84: wgs.map((x) => x.toFixed(7)).join(","),
          titre: v.titre,
          site_id: v.site_id,
          note: v.note,
          resolution_cm: v.crs === "EPSG:4326" ? "" : String(Math.round(o.resolution * 1000) / 10),
          largeur: String(o.largeurOrigine),
          hauteur: String(o.hauteurOrigine),
          fichier_origine: o.fichier,
        }).forEach(([k, x]) => x !== "" && x !== undefined && fd.append(k, x));
        const img = await api("/images", { method: "POST", form: fd });
        GR.toast(`Orthophoto du ${dateFr(img.date_prise)} enregistrée (${fmt.n(blob.size / 1e6, 1)} Mo)`);
        await chargerImages();
        voirImage(img);
        return null;
      },
    });
  }
  ecoute($("#drone-ajouter", pane), "click", () => deposer());

  /** Fenêtre « Images drone » d'un site (depuis sa fiche sur la carte). */
  C.ouvrirImagesSite = (s) => {
    const liste = images.filter((i) => i.site_id === s.id).sort((a, b) => (a.date_prise < b.date_prise ? 1 : -1));
    const m = document.createElement("div");
    m.className = "modal open";
    m.innerHTML = `<div class="modal-dialog"><div class="modal-head"><span class="mi" style="color:var(--primary)">photo_library</span><div><h2>Images drone — ${esc(s.code)}</h2><div class="muted" style="font-size:12.5px">${esc(s.localite)}</div></div>
      <div class="actions"><button class="btn btn-sm btn-ghost btn-icon" data-x="fermer"><span class="mi">close</span></button></div></div>
      <div class="modal-body stack">
        ${
          liste.length
            ? `<div class="stack" style="gap:6px">${liste
                .map(
                  (i, k) => `<div class="drone-ligne grande" data-img="${i.id}"><span class="num"><strong>${dateFr(i.date_prise)}</strong></span><span class="muted ell">${esc(i.titre || i.fichier_origine)}${i.resolution_cm ? ` · ${fmt.n(i.resolution_cm, 1)} cm/px` : ""}</span>
                  <button class="btn btn-sm" data-x="voir">Afficher</button>
                  ${liste[k + 1] ? `<button class="btn btn-sm btn-soft" data-x="comparer" data-avant="${liste[k + 1].date_prise}" data-apres="${i.date_prise}" title="Comparer avec l'image précédente"><span class="mi">compare</span>Avant / après</button>` : ""}</div>`
                )
                .join("")}</div>`
            : '<div class="empty"><span class="mi">flight</span><h3>Aucune image pour ce site</h3><p>Déposez les orthophotos des survols réguliers pour suivre l\'évolution du site.</p></div>'
        }
      </div>
      <div class="modal-foot"><button class="btn" data-x="fermer">Fermer</button><button class="btn btn-primary" data-x="ajouter"><span class="mi">upload</span>Ajouter une orthophoto</button></div></div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => {
      const b = e.target.closest("[data-x]");
      if (e.target === m || b?.dataset.x === "fermer") return m.remove();
      if (!b) return undefined;
      m.remove();
      const img = images.find((i) => i.id === b.closest("[data-img]")?.dataset.img);
      if (b.dataset.x === "ajouter") deposer(s);
      if (b.dataset.x === "voir") voirImage(img);
      if (b.dataset.x === "comparer") {
        demarrerRideau(`drone:${b.dataset.avant}`, `drone:${b.dataset.apres}`);
        const ext = ol.proj.transformExtent(img.emprise_wgs84, "EPSG:4326", "EPSG:3857");
        view.fit(ext, { padding: [60, 60, 160, 60], duration: 600, maxZoom: 19 });
      }
      return undefined;
    });
  };

  /* ===================== Rideau avant / après ========================= */
  let rideau = null;
  const elRideau = $("#rideau", racine);

  function sources() {
    const l = [{ v: "fond", t: "Fond de carte seul" }];
    couchesGee.forEach((c) => l.push({ v: `gee:${c.id}`, t: `${c.res.libelle} · ${dateFr(c.res.du)} → ${dateFr(c.res.au)}` }));
    [...new Set(images.map((i) => i.date_prise))].sort().forEach((d) => l.push({ v: `drone:${d}`, t: `Drone au ${dateFr(d)}` }));
    return l;
  }
  function majComparaison() {
    const l = sources();
    ["#cmp-gauche", "#cmp-droite"].forEach((sel, k) => {
      const el = $(sel, pane);
      const cur = el.value;
      el.innerHTML = l.map((o) => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join("");
      el.value = l.some((o) => o.v === cur) ? cur : l[Math.min(l.length - 1, k === 0 ? Math.max(0, l.length - 2) : l.length - 1)].v;
    });
  }

  /** Couches à afficher pour une source (tableau de couches OpenLayers). */
  function couchesPour(cle) {
    if (cle === "fond") return [];
    if (cle.startsWith("gee:")) {
      const c = couchesGee.find((x) => `gee:${x.id}` === cle);
      return c ? [c.couche] : [];
    }
    if (cle.startsWith("drone:")) {
      return selection(cle.slice(6)).map((img) => {
        const l = new ol.layer.Image({ source: coucheImage(img).getSource(), zIndex: 7 });
        return l;
      });
    }
    return [];
  }
  const libelleSource = (cle) => sources().find((o) => o.v === cle)?.t || cle;

  function demarrerRideau(g, d) {
    arreterRideau();
    const gauche = couchesPour(g);
    const droite = couchesPour(d);
    const etatAvant = { drone: groupeDrone.getVisible(), gee: couchesGee.map((c) => [c, c.couche.getVisible()]) };
    groupeDrone.setVisible(false);
    couchesGee.forEach((c) => c.couche.setVisible(false));
    const ajoutees = [];
    [...gauche, ...droite].forEach((l) => {
      if (l.getMap?.() || map.getLayers().getArray().includes(l)) l.setVisible(true);
      else {
        map.addLayer(l);
        ajoutees.push(l);
      }
    });
    droite.forEach((l) => l.setZIndex(8));
    const cles = [];
    droite.forEach((l) => {
      cles.push(
        l.on("prerender", (ev) => {
          const ctx2 = ev.context;
          const taille = map.getSize();
          const x = taille[0] * rideau.pos;
          const tl = ol.render.getRenderPixel(ev, [x, 0]);
          const tr = ol.render.getRenderPixel(ev, [taille[0], 0]);
          const bl = ol.render.getRenderPixel(ev, [x, taille[1]]);
          const br = ol.render.getRenderPixel(ev, taille);
          ctx2.save();
          ctx2.beginPath();
          ctx2.moveTo(tl[0], tl[1]);
          ctx2.lineTo(bl[0], bl[1]);
          ctx2.lineTo(br[0], br[1]);
          ctx2.lineTo(tr[0], tr[1]);
          ctx2.closePath();
          ctx2.clip();
        }),
        l.on("postrender", (ev) => ev.context.restore())
      );
    });
    // Le côté gauche est tronqué à la ligne pour que « fond seul » reste lisible
    gauche.forEach((l) => {
      cles.push(
        l.on("prerender", (ev) => {
          const ctx2 = ev.context;
          const taille = map.getSize();
          const x = taille[0] * rideau.pos;
          const tl = ol.render.getRenderPixel(ev, [0, 0]);
          const tr = ol.render.getRenderPixel(ev, [x, 0]);
          const bl = ol.render.getRenderPixel(ev, [0, taille[1]]);
          const br = ol.render.getRenderPixel(ev, [x, taille[1]]);
          ctx2.save();
          ctx2.beginPath();
          ctx2.moveTo(tl[0], tl[1]);
          ctx2.lineTo(bl[0], bl[1]);
          ctx2.lineTo(br[0], br[1]);
          ctx2.lineTo(tr[0], tr[1]);
          ctx2.closePath();
          ctx2.clip();
        }),
        l.on("postrender", (ev) => ev.context.restore())
      );
    });
    rideau = { g, d, pos: 0.5, cles, ajoutees, etatAvant };
    elRideau.classList.remove("hidden");
    $("#rideau-gauche", racine).textContent = libelleSource(g);
    $("#rideau-droite", racine).textContent = libelleSource(d);
    placerRideau();
    $("#cmp-go", pane).innerHTML = '<span class="mi">close</span>Arrêter le rideau';
    $('[data-action="comparer"]', racine)?.classList.add("active");
    map.render();
  }
  C.demarrerRideau = demarrerRideau;

  function arreterRideau() {
    if (!rideau) return;
    rideau.cles.forEach((k) => ol.Observable.unByKey(k));
    rideau.ajoutees.forEach((l) => map.removeLayer(l));
    groupeDrone.setVisible(rideau.etatAvant.drone);
    rideau.etatAvant.gee.forEach(([c, v]) => {
      c.couche.setVisible(v);
      c.couche.setZIndex(5);
    });
    rideau = null;
    elRideau.classList.add("hidden");
    $("#cmp-go", pane).innerHTML = '<span class="mi">compare</span>Lancer le rideau';
    $('[data-action="comparer"]', racine)?.classList.remove("active");
    map.render();
  }
  C.arreterRideau = arreterRideau;

  function placerRideau() {
    const w = map.getSize()?.[0] || 0;
    elRideau.style.setProperty("--x", `${Math.round(w * rideau.pos)}px`);
  }
  let glisse = false;
  ecoute($(".rideau-poignee", elRideau), "pointerdown", (e) => {
    glisse = true;
    e.preventDefault();
    e.target.setPointerCapture?.(e.pointerId);
  });
  ecoute(document, "pointermove", (e) => {
    if (!glisse || !rideau) return;
    const r = map.getTargetElement().getBoundingClientRect();
    rideau.pos = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width));
    placerRideau();
    map.render();
  });
  ecoute(document, "pointerup", () => (glisse = false));
  map.on("change:size", () => rideau && placerRideau());

  ecoute($("#cmp-go", pane), "click", () => {
    if (rideau) return arreterRideau();
    const g = $("#cmp-gauche", pane).value;
    const d = $("#cmp-droite", pane).value;
    if (g === d) return GR.toast("Choisissez deux sources différentes", "warning");
    demarrerRideau(g, d);
    return undefined;
  });
  ecoute(racine, "click", (e) => {
    if (!e.target.closest('[data-action="comparer"]')) return;
    if (rideau) return arreterRideau();
    // Ouvre l'onglet Imagerie sur la section de comparaison
    $('.panel-tabs [data-pane="imagerie"]', racine)?.click();
    if (document.body.classList.contains("panel-closed")) $("#bascule-panneau", racine).click();
    $("#cmp-go", pane).scrollIntoView({ block: "center", behavior: "smooth" });
    if (sources().length < 3) GR.toast("Ajoutez d'abord des images satellite ou drone à comparer", "info");
    return undefined;
  });

  /** Avant / après satellite autour d'une zone (depuis une zone suspecte ou une analyse). */
  C.comparerPeriodes = async ({ avant, apres, produit = "couleurs" }) => {
    $('.panel-tabs [data-pane="imagerie"]', racine)?.click();
    GR.toast("Calcul des images avant / après par Earth Engine…", "info", 4000);
    try {
      const [a, b] = await Promise.all([
        ajouterCoucheGee({ produit, du: avant[0], au: avant[1], nuages: 60, capteur: "auto" }, { silencieux: true }),
        ajouterCoucheGee({ produit, du: apres[0], au: apres[1], nuages: 60, capteur: "auto" }, { silencieux: true }),
      ]);
      demarrerRideau(`gee:${a.id}`, `gee:${b.id}`);
    } catch (x) {
      GR.toast(x.message, "error", 9000);
    }
  };

  /* ======================== Liaison à la frise ======================== */
  const apresDatePrecedent = C.apresChangementDate;
  C.apresChangementDate = (d) => {
    apresDatePrecedent?.(d);
    if (modeDrone === "frise") majDrone();
  };
  const apresChargementPrecedent = C.apresChargement;
  C.apresChargement = () => {
    apresChargementPrecedent?.();
    rendreListeDrone();
    majDrone();
  };

  C.couchesSupplementaires = [
    ...(C.couchesSupplementaires || []),
    {
      id: "drone",
      nom: "Images drone",
      detail: "Orthophotos géoréférencées",
      couleur: "#0ea5e9",
      couche: groupeDrone,
      etendue: () => {
        const ext = ol.extent.createEmpty();
        images.forEach((i) => ol.extent.extend(ext, ol.proj.transformExtent(i.emprise_wgs84, "EPSG:4326", "EPSG:3857")));
        return ext;
      },
    },
  ];
  C.majListeCouches();

  majEtat();
  chargerImages();
  majComparaison();

  return () => {
    arreterRideau();
    urlsBlob.forEach((u) => URL.revokeObjectURL(u));
  };
}
