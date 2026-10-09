/* =====================================================================
   CRLOI GÔH — Géoportail : sites, statuts datés et barre temporelle,
   filtres, analyse thématique, légende, recherche, fenêtres d'information
   et table attributaire. (Architecture reprise du géoportail GestReb.)
   ===================================================================== */
(function () {
  'use strict';
  const C = window.CARTE;
  const { esc, fmt, $, $$ } = GR;
  const ACCUEIL = { centre: [-5.75, 6.15], zoom: 8.6 };
  const ZOOM_DETAIL = 10.5;
  const PARAMS = new URLSearchParams(location.search);

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

  /* ============================ État ================================= */
  const E = (C.etat = {
    sites: [],
    fiches: [],
    coursEau: [],
    zones: [],
    date: CR.dateVue.get(),
    debut: CR.aujourdhui(),
    fin: CR.aujourdhui(),
    filtres: { departements: [...CR.DEPARTEMENTS], domaines: ['rural', 'foret_classee'], statuts: [], sp: [], forets: [], cours: [], priorite: '', alertes: false },
    criteres: [],
    mode: 'ET',
    requeteActive: false,
    theme: stock.get('theme', 'statut'),
    opacite: stock.get('opacite', 0.45),
    etiquettes: stock.get('etiquettes', true),
    halo: stock.get('halo', true),
    regroupement: stock.get('regroupement', false),
    chaleur: false,
    categories: new Map(),
    masquees: new Set(),
    selection: new Set(),
    survol: null,
    premierChargement: true,
  });

  /* ============================ Carte ================================ */
  const view = new ol.View({ center: ol.proj.fromLonLat(ACCUEIL.centre), zoom: ACCUEIL.zoom, minZoom: 5, maxZoom: 20 });
  const groupeFond = new ol.layer.Group({ layers: [], zIndex: 0 });
  const map = (C.map = new ol.Map({
    target: 'map',
    view,
    layers: [groupeFond],
    controls: [new ol.control.Attribution({ collapsible: true, collapsed: true })],
  }));
  map.addControl(new ol.control.ScaleLine({ units: 'metric', target: $('#echelle'), minWidth: 80 }));
  map.addControl(
    new ol.control.OverviewMap({
      collapsed: stock.get('situation-repliee', false),
      layers: [new ol.layer.Tile({ source: new ol.source.OSM() })],
      tipLabel: 'Carte de situation',
      label: '«',
      collapseLabel: '»',
    })
  );

  /* ------------------------ Fonds de carte --------------------------- */
  function choisirFond(id) {
    const def = C.fonds.find((f) => f.id === id) || C.fonds[0];
    groupeFond.setLayers(new ol.Collection(def.couches()));
    $$('.basemap').forEach((b) => b.classList.toggle('active', b.dataset.id === def.id));
    stock.set('fond', def.id);
  }
  $('#fonds').innerHTML = C.fonds
    .map(
      (f) => `<button class="basemap" data-id="${f.id}" title="${esc(f.nom)}">${
        f.apercu ? `<img src="${f.apercu}" alt="" loading="lazy">` : '<div class="thumb" style="display:grid;place-items:center"><span class="mi muted">layers_clear</span></div>'
      }<span>${esc(f.nom)}</span></button>`
    )
    .join('');
  $('#fonds').addEventListener('click', (e) => {
    const b = e.target.closest('.basemap');
    if (b) choisirFond(b.dataset.id);
  });
  choisirFond(stock.get('fond', 'satellite'));

  /* ---------------------- Couches de référence ----------------------- */
  const refs = {};
  const etatRefs = stock.get('references', {});
  C.references.forEach((def) => {
    const couche = def.couche();
    couche.setVisible(etatRefs[def.id]?.visible ?? def.visible);
    couche.setOpacity(etatRefs[def.id]?.opacite ?? def.opacite);
    map.addLayer(couche);
    refs[def.id] = { def, couche };
  });

  /* -------------------- Couches propres au CRLOI --------------------- */
  const formatGeo = new ol.format.GeoJSON({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });

  // Zone d'étude
  const sourceZones = new ol.source.Vector();
  const coucheZones = new ol.layer.Vector({
    source: sourceZones,
    zIndex: 3,
    style: (f) =>
      new ol.style.Style({
        stroke: new ol.style.Stroke({ color: '#7c3aed', width: 2, lineDash: f.get('approximative') ? [10, 7] : undefined }),
        fill: new ol.style.Fill({ color: 'rgba(124,58,237,0.03)' }),
      }),
  });

  // Cours d'eau impactés
  const INTENSITES = {
    tres_impacte: { libelle: 'Très impacté', couleur: '#dc2626', largeur: 4.5 },
    impacte: { libelle: 'Impacté', couleur: '#f97316', largeur: 3.5 },
    faible: { libelle: 'Faiblement impacté', couleur: '#eab308', largeur: 2.5 },
  };
  const sourceCours = new ol.source.Vector();
  const coucheCours = new ol.layer.Vector({
    source: sourceCours,
    zIndex: 6,
    style: (f, res) => {
      const i = INTENSITES[f.get('intensite')] || { couleur: '#0ea5e9', largeur: 2 };
      return [
        new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.85)', width: i.largeur + 3 }) }),
        new ol.style.Style({
          stroke: new ol.style.Stroke({ color: i.couleur, width: i.largeur }),
          text:
            res < 150
              ? new ol.style.Text({
                  text: f.get('nom'),
                  placement: 'line',
                  font: 'italic 600 12px Inter, sans-serif',
                  fill: new ol.style.Fill({ color: '#0c4a6e' }),
                  stroke: new ol.style.Stroke({ color: '#fff', width: 3 }),
                })
              : undefined,
        }),
      ];
    },
  });

  // Contours des sites
  const sourceContours = new ol.source.Vector();
  const coucheContours = new ol.layer.Vector({ source: sourceContours, zIndex: 8, style: styleContour });

  // Sites (points)
  const sourceSites = (C.sourceSites = new ol.source.Vector());
  const coucheSites = (C.coucheSites = new ol.layer.Vector({ source: sourceSites, zIndex: 12, style: styleSite }));
  const coucheGroupes = new ol.layer.Vector({
    source: new ol.source.Cluster({ distance: 40, minDistance: 14, source: sourceSites }),
    style: styleGroupe,
    zIndex: 13,
    maxZoom: ZOOM_DETAIL,
  });
  const coucheChaleur = new ol.layer.Heatmap({
    source: sourceSites,
    blur: 26,
    radius: 18,
    weight: (f) => ({ actif: 1, recolonise: 1, tentative_reprise: 0.6 }[f.get('statut')] || 0),
    visible: false,
    zIndex: 7,
  });
  const coucheEtiquettes = new ol.layer.Vector({ source: sourceSites, style: styleEtiquette, declutter: true, zIndex: 14, minZoom: 10 });

  // Fiches de renseignement
  const STATUTS_FICHE = {
    a_verifier: { libelle: 'À vérifier', couleur: '#eab308' },
    en_cours: { libelle: 'Vérification en cours', couleur: '#0284c7' },
    confirmee: { libelle: 'Confirmée', couleur: '#dc2626' },
    infirmee: { libelle: 'Infirmée', couleur: '#64748b' },
    exploitee: { libelle: 'Exploitée', couleur: '#15803d' },
  };
  const sourceFiches = new ol.source.Vector();
  const coucheFiches = new ol.layer.Vector({
    source: sourceFiches,
    zIndex: 15,
    style: (f) => {
      const s = STATUTS_FICHE[f.get('statut')] || { couleur: '#64748b' };
      const sel = E.survol === f.getId();
      return new ol.style.Style({
        image: new ol.style.RegularShape({
          points: 4,
          radius: sel ? 11 : 9,
          angle: Math.PI / 4,
          fill: new ol.style.Fill({ color: s.couleur }),
          stroke: new ol.style.Stroke({ color: '#fff', width: 2 }),
        }),
      });
    },
  });

  [coucheZones, coucheCours, coucheContours, coucheChaleur, coucheSites, coucheGroupes, coucheEtiquettes, coucheFiches].forEach((l) => map.addLayer(l));

  const COUCHES_DONNEES = [
    { id: 'sites', nom: 'Sites d’orpaillage', detail: 'Points — couleur selon l’analyse', couleur: '#dc2626', couche: coucheSites, point: true },
    { id: 'contours', nom: 'Contours des sites', detail: 'Polygones relevés', couleur: '#f97316', couche: coucheContours },
    { id: 'fiches', nom: 'Fiches de renseignement', detail: 'Informations géolocalisées reçues', couleur: '#eab308', couche: coucheFiches, point: true },
    { id: 'cours', nom: "Cours d'eau impactés", detail: 'Tracés par intensité', couleur: '#0284c7', couche: coucheCours, ligne: true },
    { id: 'zones', nom: "Zone d'étude", detail: 'Région du Gôh (emprise approximative)', couleur: '#7c3aed', couche: coucheZones, ligne: true },
  ];
  COUCHES_DONNEES.forEach((d) => {
    const st = etatRefs[d.id];
    if (st) {
      d.couche.setVisible(st.visible);
      d.couche.setOpacity(st.opacite);
    }
  });

  function appliquerRegroupement() {
    coucheSites.setMinZoom(E.regroupement ? ZOOM_DETAIL - 0.01 : -Infinity);
    coucheGroupes.setVisible(E.regroupement && coucheSites.getVisible());
  }

  /* --------------------------- Thèmes -------------------------------- */
  const LIB_DOMAINE = { rural: 'Domaine rural', foret_classee: 'Forêt classée' };
  const LIB_PRIORITE = { haute: 'Haute', normale: 'Normale' };

  function cleSite(p) {
    switch (E.theme) {
      case 'statut':
        return p.statut || '—';
      case 'departement':
        return p.departement || '—';
      case 'sous_prefecture':
        return p.sous_prefecture || '—';
      case 'domaine':
        return p.domaine || '—';
      case 'foret':
        return p.foret || '—';
      case 'cours_eau':
        return p.cours_eau || '—';
      case 'priorite':
        return p.priorite || '—';
      case 'source':
        return p.dernier?.source || '—';
      case 'anciennete': {
        const j = p.jours;
        if (j === null || j === undefined) return '—';
        return C.classesAnciennete.find((c) => j < c.max).cle;
      }
      default:
        return 'tout';
    }
  }
  const cle = (f) => cleSite(f.getProperties());

  function calculerTheme() {
    const sites = sitesAffiches();
    const cats = new Map();
    sites.forEach((s) => {
      const k = cleSite(s);
      const c = cats.get(k) || { cle: k, n: 0, sup: 0 };
      c.n += 1;
      c.sup += Number(s.superficie_ha) || 0;
      cats.set(k, c);
    });
    const vide = (k) => ({ cle: k, n: 0, sup: 0 });
    let liste;
    if (E.theme === 'statut') {
      liste = CR.STATUTS.map((s) => ({ ...(cats.get(s.cle) || vide(s.cle)), libelle: s.libelle, couleur: s.couleur }));
    } else if (E.theme === 'anciennete') {
      liste = C.classesAnciennete.map((c) => ({ ...(cats.get(c.cle) || vide(c.cle)), libelle: c.libelle, couleur: c.couleur }));
    } else if (E.theme === 'unique') {
      liste = [{ ...(cats.get('tout') || vide('tout')), libelle: 'Sites', couleur: '#dc2626' }];
    } else {
      const libelle = (k) =>
        k === '—'
          ? 'Non renseigné'
          : E.theme === 'domaine'
            ? LIB_DOMAINE[k] || k
            : E.theme === 'priorite'
              ? LIB_PRIORITE[k] || k
              : E.theme === 'source'
                ? CR.SOURCES[k] || k
                : k;
      liste = [...cats.values()]
        .sort((a, b) => (a.cle === '—') - (b.cle === '—') || b.n - a.n || a.cle.localeCompare(b.cle))
        .map((c, i) => {
          let couleur = c.cle === '—' ? '#94a3b8' : C.palette[i % C.palette.length];
          if (E.theme === 'domaine') couleur = c.cle === 'foret_classee' ? '#15803d' : c.cle === 'rural' ? '#d97706' : couleur;
          if (E.theme === 'priorite') couleur = c.cle === 'haute' ? '#dc2626' : c.cle === 'normale' ? '#2563eb' : couleur;
          return { ...c, libelle: libelle(c.cle), couleur };
        });
    }
    if (E.theme !== 'statut' && E.theme !== 'anciennete') liste = liste.filter((c) => c.n > 0);
    E.categories = new Map(liste.map((c) => [c.cle, c]));
  }

  const estVisible = (f) => !E.masquees.has(cle(f));
  C.estVisible = estVisible;
  C.couleurDe = (p) => E.categories.get(cleSite(p))?.couleur || '#94a3b8';

  /* ---------------------------- Styles ------------------------------- */
  function styleSite(f) {
    if (!estVisible(f)) return null;
    const p = f.getProperties();
    const couleur = C.couleurDe(p);
    const survol = E.survol === f.getId();
    const actif = p.statut === 'actif' || p.statut === 'recolonise';
    const r = survol ? 9 : 7;
    const styles = [];
    if (E.halo && actif) {
      styles.push(new ol.style.Style({ image: new ol.style.Circle({ radius: 15, fill: new ol.style.Fill({ color: C.rgba(CR.statut(p.statut).couleur, 0.28) }) }) }));
    }
    styles.push(
      new ol.style.Style({
        image: new ol.style.Circle({
          radius: r,
          fill: new ol.style.Fill({ color: couleur }),
          stroke: new ol.style.Stroke({ color: p.coord_alerte ? '#111827' : '#ffffff', width: survol ? 3 : 2, lineDash: p.coord_alerte ? [3, 2] : undefined }),
        }),
        zIndex: actif ? 2 : 1,
      })
    );
    if (E.selection.has(f.getId())) {
      styles.push(new ol.style.Style({ image: new ol.style.Circle({ radius: r + 5, stroke: new ol.style.Stroke({ color: '#facc15', width: 3.5 }) }), zIndex: 3 }));
    }
    return styles;
  }

  function styleContour(f) {
    const site = sourceSites.getFeatureById(f.get('site_id'));
    const p = site ? site.getProperties() : f.getProperties();
    if (site && !estVisible(site)) return null;
    const couleur = C.couleurDe(p);
    const sel = E.selection.has(f.get('site_id'));
    return new ol.style.Style({
      fill: new ol.style.Fill({ color: C.rgba(couleur, E.opacite) }),
      stroke: new ol.style.Stroke({ color: sel ? '#facc15' : couleur, width: sel ? 3.5 : 2 }),
    });
  }

  function styleEtiquette(f) {
    if (!E.etiquettes || !estVisible(f)) return null;
    return new ol.style.Style({
      text: new ol.style.Text({
        text: String(f.get('code') || ''),
        offsetY: -17,
        font: '700 11.5px Inter, sans-serif',
        fill: new ol.style.Fill({ color: '#0f172a' }),
        stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.95)', width: 3.5 }),
      }),
    });
  }

  function styleGroupe(f) {
    const membres = f.get('features').filter(estVisible);
    const n = membres.length;
    if (!n) return null;
    if (n === 1) return styleSite(membres[0]);
    const nActifs = membres.filter((m) => ['actif', 'recolonise'].includes(m.get('statut'))).length;
    const couleur = nActifs ? '#dc2626' : '#15803d';
    const r = Math.min(28, 12 + Math.sqrt(n) * 3);
    return [
      new ol.style.Style({ image: new ol.style.Circle({ radius: r + 5, fill: new ol.style.Fill({ color: C.rgba(couleur, 0.25) }) }) }),
      new ol.style.Style({
        image: new ol.style.Circle({ radius: r, fill: new ol.style.Fill({ color: couleur }), stroke: new ol.style.Stroke({ color: '#fff', width: 2 }) }),
        text: new ol.style.Text({ text: String(n), font: '700 12px Inter, sans-serif', fill: new ol.style.Fill({ color: '#fff' }) }),
      }),
    ];
  }

  function rafraichirStyles() {
    [coucheSites, coucheContours, coucheEtiquettes, coucheGroupes, coucheFiches].forEach((l) => l.changed());
    coucheGroupes.getSource().refresh();
  }
  C.rafraichirStyles = rafraichirStyles;

  /* ----------------------- Données et filtres ------------------------ */
  /** Statut, dernier constat et ancienneté de chaque site à la date affichée. */
  function deriver() {
    E.sites.forEach((s) => {
      s.dernier = CR.dernierEvenement(s.events, E.date);
      s.statut = s.dernier ? s.dernier.statut : null;
      s.jours = s.dernier ? CR.ecartJours(s.dernier.date, E.date) : null;
    });
  }

  function passeFiltres(s) {
    const f = E.filtres;
    if (!s.statut) return false; // pas encore recensé à cette date
    if (!f.departements.includes(s.departement)) return false;
    if (!f.domaines.includes(s.domaine)) return false;
    if (f.statuts.length && !f.statuts.includes(s.statut)) return false;
    if (f.sp.length && !f.sp.includes(s.sous_prefecture || '—')) return false;
    if (f.forets.length && !f.forets.includes(s.foret || '—')) return false;
    if (f.cours.length && !f.cours.includes(s.cours_eau || '—')) return false;
    if (f.priorite && s.priorite !== f.priorite) return false;
    const sup = Number(s.superficie_ha);
    if (f.supMin && !(sup >= Number(f.supMin))) return false;
    if (f.supMax && !(sup <= Number(f.supMax))) return false;
    if (f.alertes && !s.coord_alerte) return false;
    if (E.requeteActive && E.criteres.length && !C.testerRequete(s)) return false;
    return true;
  }

  /** Sites retenus (filtres + date), géolocalisés ou non. */
  function sitesFiltres() {
    return E.sites.filter(passeFiltres);
  }
  /** Sites retenus et non masqués par la légende. */
  function sitesAffiches() {
    return sitesFiltres().filter((s) => !E.masquees.has(cleSite(s)));
  }
  C.sitesFiltres = sitesFiltres;

  function construireSources() {
    const retenus = sitesFiltres();
    const pts = [];
    const polys = [];
    retenus.forEach((s) => {
      if (s.lat !== null && s.lng !== null && s.lat !== undefined) {
        const f = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([s.lng, s.lat])), ...s });
        f.setId(s.id);
        f.site = s;
        pts.push(f);
      }
      if (s.contour) {
        try {
          const g = formatGeo.readGeometry(s.contour);
          const fc = new ol.Feature({ geometry: g, site_id: s.id, ...s });
          fc.setId(`c-${s.id}`);
          polys.push(fc);
        } catch {
          /* contour illisible */
        }
      }
    });
    sourceSites.clear(true);
    sourceSites.addFeatures(pts);
    sourceContours.clear(true);
    sourceContours.addFeatures(polys);
    E.selection = new Set([...E.selection].filter((id) => retenus.some((s) => s.id === id)));

    sourceFiches.clear(true);
    sourceFiches.addFeatures(
      E.fiches
        .filter((x) => x.lat !== null && x.lat !== undefined && x.date_recu <= E.date && E.filtres.departements.includes(x.departement))
        .map((x) => {
          const f = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([x.lng, x.lat])), ...x, type: 'fiche' });
          f.setId(`f-${x.id}`);
          return f;
        })
    );
  }

  function toutMettreAJour({ ajuster = false } = {}) {
    deriver();
    lireFiltresUI();
    construireSources();
    calculerTheme();
    rafraichirStyles();
    majLegende();
    majResume();
    majTimebar();
    C.majTable?.();
    if (popupSite) {
      const s = E.sites.find((x) => x.id === popupSite);
      if (s && s.statut) popupEl.innerHTML = contenuPopup(s);
      else fermerPopup();
    }
    if (ajuster) ajusterEmprise();
  }
  C.toutMettreAJour = toutMettreAJour;

  /* ---------------------------- Légende ------------------------------ */
  const LIBELLES_THEME = {
    statut: 'Statut au', departement: 'Département', sous_prefecture: 'Sous-préfecture', domaine: 'Domaine', foret: 'Forêt classée',
    cours_eau: "Cours d'eau", priorite: 'Priorité', source: 'Source du dernier constat', anciennete: 'Ancienneté du dernier constat', unique: 'Sites',
  };

  function majLegende() {
    $('#legende-titre').textContent = `Légende — ${LIBELLES_THEME[E.theme]}${E.theme === 'statut' ? ` ${CR.date(E.date)}` : ''}`;
    const cats = [...E.categories.values()];
    const items = cats
      .map(
        (c) => `<div class="legend-item toggle ${E.masquees.has(c.cle) ? 'off' : ''}" data-cle="${esc(c.cle)}" title="Cliquer pour masquer / afficher">
          <i style="background:${c.couleur};border-color:${c.couleur};border-radius:50%"></i><span>${esc(c.libelle)}</span><span class="n">${c.n}</span></div>`
      )
      .join('');
    const extra = [];
    if (coucheFiches.getVisible() && sourceFiches.getFeatures().length) {
      const n = {};
      sourceFiches.getFeatures().forEach((f) => (n[f.get('statut')] = (n[f.get('statut')] || 0) + 1));
      extra.push(
        `<h4>Fiches de renseignement</h4>${Object.entries(STATUTS_FICHE)
          .filter(([k]) => n[k])
          .map(([k, s]) => `<div class="legend-item"><i style="background:${s.couleur};border-color:${s.couleur};transform:rotate(45deg) scale(.8)"></i><span>${esc(s.libelle)}</span><span class="n">${n[k]}</span></div>`)
          .join('')}`
      );
    }
    if (coucheCours.getVisible() && sourceCours.getFeatures().length) {
      extra.push(
        `<h4>Cours d'eau</h4>${Object.values(INTENSITES)
          .map((i) => `<div class="legend-item"><i class="line" style="border-top-color:${i.couleur};border-top-width:${i.largeur - 1}px"></i><span>${esc(i.libelle)}</span></div>`)
          .join('')}`
      );
    }
    const refsVisibles = Object.values(refs)
      .filter((r) => r.couche.getVisible())
      .map((r) =>
        r.def.legende
          ? `<div class="legend-item"><strong style="font-size:11.5px">${esc(r.def.nom)}</strong></div>${r.def.legende
              .map(
                (l) => `<div class="legend-item" style="padding-left:6px"><i style="background:${l.pointille ? 'transparent' : C.rgba(l.couleur, 0.15)};border:1.5px ${
                  l.pointille ? 'dashed' : 'solid'
                } ${l.couleur}"></i><span>${esc(l.libelle)}</span></div>`
              )
              .join('')}`
          : `<div class="legend-item"><i class="${r.def.ligne ? 'line' : ''}" style="${
              r.def.ligne ? `border-top-color:${r.def.couleur}` : `background:${C.rgba(r.def.couleur, 0.15)};border-color:${r.def.couleur}`
            }"></i><span>${esc(r.def.nom)}</span></div>`
      )
      .join('');
    $('#legende-corps').innerHTML = `${items || '<div class="muted">Aucun site</div>'}${extra.join('')}${
      refsVisibles ? `<h4>Couches de référence</h4>${refsVisibles}` : ''
    }`;
  }
  $('#legende-corps').addEventListener('click', (e) => {
    const it = e.target.closest('.legend-item.toggle');
    if (!it) return;
    const k = it.dataset.cle;
    if (E.masquees.has(k)) E.masquees.delete(k);
    else E.masquees.add(k);
    rafraichirStyles();
    majLegende();
    majResume();
    C.majTable?.();
  });
  $('#legende-tete').addEventListener('click', () => {
    $('#legende').classList.toggle('collapsed');
    stock.set('legende-repliee', $('#legende').classList.contains('collapsed'));
  });
  if (stock.get('legende-repliee', window.innerWidth < 700)) $('#legende').classList.add('collapsed');

  /* ---------------------- Liste des couches -------------------------- */
  function majListeCouches() {
    const lignes = [...COUCHES_DONNEES, ...Object.values(refs).map((r) => ({ ...r.def, couche: r.couche }))];
    $('#liste-couches').innerHTML = lignes
      .map(
        (d) => `<div class="layer" data-id="${d.id}">
          <div class="layer-row">
            <input type="checkbox" class="check" data-vis ${d.couche.getVisible() ? 'checked' : ''} aria-label="Afficher ${esc(d.nom)}">
            <i class="swatch" style="${
              d.ligne
                ? `border-color:${d.couleur};background:transparent`
                : d.point
                  ? `border-color:${d.couleur};background:${d.couleur};border-radius:50%`
                  : `border-color:${d.couleur};background:${C.rgba(d.couleur, 0.25)}`
            }"></i>
            <span class="name">${esc(d.nom)}<small data-detail>${esc(d.detail || '')}</small></span>
            <button class="btn btn-ghost btn-icon btn-sm" data-zoom title="Zoomer sur la couche"><span class="mi">zoom_in_map</span></button>
            <button class="btn btn-ghost btn-icon btn-sm" data-plus title="Options"><span class="mi">tune</span></button>
          </div>
          <div class="layer-extra"><label class="label">Opacité</label><input type="range" min="0" max="100" value="${Math.round(d.couche.getOpacity() * 100)}" data-op></div>
        </div>`
      )
      .join('');
  }
  function coucheDe(id) {
    return COUCHES_DONNEES.find((d) => d.id === id)?.couche || refs[id]?.couche;
  }
  function sauverCouches() {
    const etat = Object.fromEntries(Object.entries(refs).map(([id, r]) => [id, { visible: r.couche.getVisible(), opacite: r.couche.getOpacity() }]));
    COUCHES_DONNEES.forEach((d) => (etat[d.id] = { visible: d.couche.getVisible(), opacite: d.couche.getOpacity() }));
    stock.set('references', etat);
  }
  $('#liste-couches').addEventListener('change', (e) => {
    const bloc = e.target.closest('.layer');
    if (!bloc || !e.target.matches('[data-vis]')) return;
    coucheDe(bloc.dataset.id).setVisible(e.target.checked);
    if (bloc.dataset.id === 'sites') {
      coucheEtiquettes.setVisible(e.target.checked);
      appliquerRegroupement();
    }
    sauverCouches();
    majLegende();
  });
  $('#liste-couches').addEventListener('input', (e) => {
    const bloc = e.target.closest('.layer');
    if (!bloc || !e.target.matches('[data-op]')) return;
    coucheDe(bloc.dataset.id).setOpacity(Number(e.target.value) / 100);
    if (bloc.dataset.id === 'sites') coucheEtiquettes.setOpacity(Number(e.target.value) / 100);
    sauverCouches();
  });
  $('#liste-couches').addEventListener('click', (e) => {
    const bloc = e.target.closest('.layer');
    if (!bloc) return;
    if (e.target.closest('[data-plus]')) bloc.classList.toggle('open');
    if (e.target.closest('[data-zoom]')) {
      const ext = coucheDe(bloc.dataset.id).getSource().getExtent();
      if (ext && Number.isFinite(ext[0])) view.fit(ext, { padding: [60, 60, 60, 60], duration: 600, maxZoom: 15 });
      else GR.toast('Cette couche ne contient encore aucune donnée', 'info');
    }
  });
  function majDetailsCouches() {
    const det = (id, txt) => {
      const el = $(`.layer[data-id="${id}"] [data-detail]`);
      if (el) el.textContent = txt;
    };
    const nc = E.coursEau.filter((c) => c.trace).length;
    det('cours', `${nc} tracé(s) sur ${E.coursEau.length} cours d'eau recensés`);
    det('contours', `${sourceContours.getFeatures().length} contour(s) relevé(s)`);
    det('fiches', `${sourceFiches.getFeatures().length} fiche(s) géolocalisée(s) à cette date`);
  }

  /* ------------------------ Panneau & onglets ------------------------ */
  $('.panel-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pane]');
    if (!b) return;
    $$('.panel-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.panel-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === b.dataset.pane));
    if (b.dataset.pane === 'analyse') majMiniGraphe();
  });
  function basculerPanneau(force) {
    const ferme = force !== undefined ? !force : !document.body.classList.contains('panel-closed');
    document.body.classList.toggle('panel-closed', ferme);
    $('#bascule-panneau .mi').textContent = ferme ? 'menu' : 'menu_open';
    stock.set('panneau-ferme', ferme);
    setTimeout(() => map.updateSize(), 240);
  }
  $('#bascule-panneau').addEventListener('click', () => basculerPanneau());
  if (stock.get('panneau-ferme', window.innerWidth < 900)) basculerPanneau(false);

  /* ----------------------------- Filtres ----------------------------- */
  const ms = {};
  function lireFiltresUI() {
    const f = E.filtres;
    f.departements = $$('#f-departements input:checked').map((i) => i.value);
    f.domaines = $$('#f-domaines input:checked').map((i) => i.value);
    f.statuts = ms.statuts?.values() || [];
    f.sp = ms.sp?.values() || [];
    f.forets = ms.forets?.values() || [];
    f.cours = ms.cours?.values() || [];
    f.priorite = $('#f-priorite .active')?.dataset.v || '';
    f.supMin = $('#f-supmin').value || undefined;
    f.supMax = $('#f-supmax').value || undefined;
    f.alertes = $('#f-alertes').checked;
    const n =
      (f.departements.length < 2 ? 1 : 0) +
      (f.domaines.length < 2 ? 1 : 0) +
      (f.statuts.length ? 1 : 0) +
      (f.sp.length ? 1 : 0) +
      (f.forets.length ? 1 : 0) +
      (f.cours.length ? 1 : 0) +
      (f.priorite ? 1 : 0) +
      (f.supMin || f.supMax ? 1 : 0) +
      (f.alertes ? 1 : 0) +
      (E.requeteActive ? 1 : 0);
    $('#nb-filtres').textContent = n;
    $('#nb-filtres').classList.toggle('hidden', !n);
  }
  const appliquerDiffere = GR.debounce(() => toutMettreAJour(), 250);
  ['#f-departements', '#f-domaines'].forEach((s) =>
    $(s).addEventListener('change', (e) => {
      e.target.closest('.chip')?.classList.toggle('on', e.target.checked);
      appliquerDiffere();
    })
  );
  $('#f-priorite').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    $$('#f-priorite button').forEach((x) => x.classList.toggle('active', x === b));
    appliquerDiffere();
  });
  ['#f-supmin', '#f-supmax'].forEach((s) => $(s).addEventListener('input', appliquerDiffere));
  $('#f-alertes').addEventListener('change', appliquerDiffere);

  function optionsDe(cleChamp) {
    const n = new Map();
    E.sites.forEach((s) => {
      const v = s[cleChamp] || '—';
      n.set(v, (n.get(v) || 0) + 1);
    });
    return [...n.entries()]
      .sort((a, b) => (a[0] === '—') - (b[0] === '—') || a[0].localeCompare(b[0], 'fr'))
      .map(([v, k]) => ({ value: v, label: v === '—' ? 'Non renseigné' : v, n: k }));
  }
  function initFiltres() {
    ms.statuts = new GR.MultiSelect('#f-statuts', {
      options: CR.STATUTS.map((s) => ({ value: s.cle, label: s.libelle, color: s.couleur })),
      placeholder: 'Tous les statuts',
      onChange: appliquerDiffere,
      recherche: false,
    });
    ms.sp = new GR.MultiSelect('#f-sp', { options: optionsDe('sous_prefecture'), placeholder: 'Toutes', onChange: appliquerDiffere });
    ms.forets = new GR.MultiSelect('#f-forets', { options: optionsDe('foret'), placeholder: 'Toutes', onChange: appliquerDiffere });
    ms.cours = new GR.MultiSelect('#f-cours', { options: optionsDe('cours_eau'), placeholder: 'Tous', onChange: appliquerDiffere });
  }

  /* ----------------------------- Résumé ------------------------------ */
  function majResume() {
    const sites = sitesAffiches();
    const actifs = sites.filter((s) => s.statut === 'actif' || s.statut === 'recolonise').length;
    const sup = sites.reduce((t, s) => t + (Number(s.superficie_ha) || 0), 0);
    const r = $('#resume');
    $('#resume-date').textContent = CR.date(E.date);
    r.querySelector('[data-k="n"]').textContent = fmt.n(sites.length);
    r.querySelector('[data-k="actifs"]').textContent = fmt.n(actifs);
    const taux = sites.length ? ((sites.length - actifs) / sites.length) * 100 : null;
    const el = r.querySelector('[data-k="taux"]');
    el.textContent = taux === null ? '—' : fmt.pct(taux, 0);
    el.style.color = taux === null ? '' : taux >= 70 ? 'var(--success)' : 'var(--warning)';
    r.querySelector('[data-k="sup"]').textContent = sup ? fmt.ha(sup, 1) : '—';
    const sansCoord = sites.filter((s) => s.lat === null || s.lat === undefined).length;
    const hors = sites.filter((s) => s.lat !== null && s.lat !== undefined && s.coord_alerte).length;
    const al = $('#alerte-geoloc');
    al.classList.toggle('hidden', !sansCoord && !hors);
    al.querySelector('span:last-child').textContent = [
      sansCoord ? `${sansCoord} site(s) sans coordonnées (absents de la carte, visibles dans la table)` : '',
      hors ? `${hors} point(s) hors région : vérifier la zone UTM` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const n = sourceSites.getFeatures().filter(estVisible).length;
    $('#nb-sites').textContent = `${n} site${n > 1 ? 's' : ''} sur la carte`;
    majDetailsCouches();
    if ($('.panel-pane[data-pane="analyse"]').classList.contains('active')) majMiniGraphe();
  }

  function majMiniGraphe() {
    const cats = [...E.categories.values()].filter((c) => !E.masquees.has(c.cle) && c.n > 0);
    GR.chart('mini-graphe', {
      chart: { type: 'donut', height: 260, toolbar: { show: false } },
      series: cats.map((c) => c.n),
      labels: cats.map((c) => c.libelle),
      colors: cats.map((c) => c.couleur),
      legend: { position: 'bottom', fontSize: '11px' },
      dataLabels: { enabled: true, formatter: (v) => `${Math.round(v)} %` },
      tooltip: { y: { formatter: (v) => `${v} site(s)` } },
      plotOptions: { pie: { donut: { size: '58%', labels: { show: true, total: { show: true, label: 'Sites', formatter: (w) => w.globals.seriesTotals.reduce((a, b) => a + b, 0) } } } } },
      stroke: { width: 1 },
    });
  }

  /* -------------------------- Analyse UI ----------------------------- */
  $('#theme').value = E.theme;
  $('#opacite').value = Math.round(E.opacite * 100);
  $('#opacite-val').textContent = `${Math.round(E.opacite * 100)} %`;
  $('#etiquettes').checked = E.etiquettes;
  $('#halo').checked = E.halo;
  $('#regroupement').checked = E.regroupement;
  $('#theme').addEventListener('change', (e) => {
    E.theme = e.target.value;
    E.masquees.clear();
    stock.set('theme', E.theme);
    calculerTheme();
    rafraichirStyles();
    majLegende();
    majResume();
    majMiniGraphe();
    C.majTable?.();
  });
  $('#opacite').addEventListener('input', (e) => {
    E.opacite = Number(e.target.value) / 100;
    $('#opacite-val').textContent = `${e.target.value} %`;
    stock.set('opacite', E.opacite);
    coucheContours.changed();
  });
  $('#etiquettes').addEventListener('change', (e) => {
    E.etiquettes = e.target.checked;
    stock.set('etiquettes', E.etiquettes);
    coucheEtiquettes.changed();
  });
  $('#halo').addEventListener('change', (e) => {
    E.halo = e.target.checked;
    stock.set('halo', E.halo);
    coucheSites.changed();
  });
  $('#regroupement').addEventListener('change', (e) => {
    E.regroupement = e.target.checked;
    stock.set('regroupement', E.regroupement);
    appliquerRegroupement();
  });
  $('#chaleur').addEventListener('change', (e) => {
    E.chaleur = e.target.checked;
    coucheChaleur.setVisible(E.chaleur);
  });

  /* ------------------------ Barre temporelle ------------------------- */
  const curseur = $('#tb-curseur');
  function bornesTemps() {
    const dates = E.sites.flatMap((s) => (s.events || []).map((e) => e.date)).concat(E.fiches.map((f) => f.date_recu));
    E.debut = dates.length ? dates.sort()[0] : CR.aujourdhui();
    E.fin = CR.aujourdhui();
    if (E.debut > E.fin) E.debut = E.fin;
    if (E.date < E.debut) E.date = E.debut;
    if (E.date > E.fin) E.date = E.fin;
    const total = CR.ecartJours(E.debut, E.fin);
    curseur.max = String(total);
    $('#tb-min').textContent = CR.date(E.debut);
    $('#tb-max').textContent = "Aujourd'hui";
    // Repères : un trait par jour de constat, couleur du statut le plus préoccupant
    const parJour = new Map();
    const rang = { actif: 0, recolonise: 1, tentative_reprise: 2, demantele: 3, tenu: 4 };
    E.sites.forEach((s) =>
      (s.events || []).forEach((e) => {
        const cur = parJour.get(e.date);
        if (!cur || rang[e.statut] < rang[cur]) parJour.set(e.date, e.statut);
      })
    );
    $('#tb-ticks').innerHTML = [...parJour.entries()]
      .map(([d, st]) => `<i style="left:${total ? (CR.ecartJours(E.debut, d) / total) * 100 : 0}%;background:${CR.statut(st).couleur}" title="${CR.date(d)}"></i>`)
      .join('');
  }
  function majTimebar() {
    curseur.value = String(CR.ecartJours(E.debut, E.date));
    $('#tb-date').textContent = CR.date(E.date);
    const evDuJour = E.sites.reduce((t, s) => t + (s.events || []).filter((e) => e.date === E.date).length, 0);
    const prochains = E.sites.flatMap((s) => (s.events || []).map((e) => e.date)).filter((d) => d > E.date).sort();
    $('#tb-info').textContent = evDuJour
      ? `${evDuJour} constat(s) ce jour`
      : prochains.length
        ? `Prochain constat : ${CR.date(prochains[0])}`
        : E.date === E.fin
          ? 'Situation actuelle'
          : 'Aucun constat après cette date';
    $('#lien-tdb').href = '/tableau-de-bord.html';
  }
  function allerA(iso, { conserverLecture = false } = {}) {
    if (!conserverLecture) arreterLecture();
    E.date = iso < E.debut ? E.debut : iso > E.fin ? E.fin : iso;
    CR.dateVue.set(E.date);
    toutMettreAJour();
  }
  C.allerA = allerA;
  curseur.addEventListener('input', () => allerA(CR.ajouterJours(E.debut, Number(curseur.value))));
  let lecture = null;
  function arreterLecture() {
    if (lecture) clearInterval(lecture);
    lecture = null;
    $('#tb-lecture .mi').textContent = 'play_arrow';
  }
  $('#barre-temps').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tb]');
    if (!b) return;
    const a = b.dataset.tb;
    if (a === 'debut') allerA(E.debut);
    if (a === 'aujourdhui') allerA(E.fin);
    if (a === '-7' || a === '+7') allerA(CR.ajouterJours(E.date, Number(a)));
    if (a === 'lecture') {
      if (lecture) return arreterLecture();
      if (E.date >= E.fin) allerA(E.debut);
      $('#tb-lecture .mi').textContent = 'pause';
      const pas = Math.max(1, Math.round(CR.ecartJours(E.debut, E.fin) / 40));
      lecture = setInterval(() => {
        if (E.date >= E.fin) return arreterLecture();
        allerA(CR.ajouterJours(E.date, pas), { conserverLecture: true });
      }, 450);
    }
    return undefined;
  });
  $('#tb-replier').addEventListener('click', () => {
    $('#barre-temps').classList.toggle('collapsed');
    stock.set('temps-replie', $('#barre-temps').classList.contains('collapsed'));
  });
  if (stock.get('temps-replie', false)) $('#barre-temps').classList.add('collapsed');

  /* --------------------------- Chargement ---------------------------- */
  async function charger() {
    $('#chargement').classList.add('show');
    try {
      const [sites, fiches, cours, zones] = await Promise.all([
        GR.api('/sites'),
        GR.api('/fiches').catch(() => []),
        GR.api('/cours-eau').catch(() => []),
        GR.api('/zones').catch(() => []),
      ]);
      E.sites = sites.map((s) => ({ ...s, events: [...(s.events || [])].sort((a, b) => a.date.localeCompare(b.date)) }));
      E.fiches = fiches;
      E.coursEau = cours;
      E.zones = zones;
      sourceCours.clear();
      sourceCours.addFeatures(
        cours
          .filter((c) => c.trace)
          .map((c) => {
            const f = new ol.Feature({ geometry: formatGeo.readGeometry(c.trace), ...c });
            f.setId(`ce-${c.id}`);
            return f;
          })
      );
      sourceZones.clear();
      sourceZones.addFeatures(
        zones
          .filter((z) => z.geometrie)
          .map((z) => {
            const f = new ol.Feature({ geometry: formatGeo.readGeometry(z.geometrie), ...z });
            f.setId(`z-${z.id}`);
            return f;
          })
      );
      bornesTemps();
      initFiltres();
      C.initRequeteur?.();
      toutMettreAJour();
      const cible = PARAMS.get('site');
      if (cible && sourceSites.getFeatureById(cible)) {
        C.selectionner([cible], { zoom: true });
        setTimeout(() => afficherPopup(E.sites.find((s) => s.id === cible), sourceSites.getFeatureById(cible).getGeometry().getCoordinates()), 800);
      } else if (!lireVueUrl()) ajusterEmprise();
    } catch (e) {
      console.error(e);
    } finally {
      $('#chargement').classList.remove('show');
    }
  }

  function ajusterEmprise(features) {
    const feats = features || [...sourceSites.getFeatures().filter(estVisible), ...sourceContours.getFeatures()];
    if (!feats.length) return;
    const ext = ol.extent.createEmpty();
    feats.forEach((f) => ol.extent.extend(ext, f.getGeometry().getExtent()));
    view.fit(ext, { padding: [80, 80, 150, document.body.classList.contains('panel-closed') ? 80 : 50], duration: 700, maxZoom: 15 });
  }
  C.ajusterEmprise = ajusterEmprise;

  /* --------------------------- Sélection ----------------------------- */
  C.selectionner = function selectionner(ids, { ajouter = false, zoom = false, basculer = false } = {}) {
    if (!ajouter && !basculer) E.selection.clear();
    ids.forEach((id) => {
      if (basculer && E.selection.has(id)) E.selection.delete(id);
      else E.selection.add(id);
    });
    rafraichirStyles();
    if (zoom && ids.length) ajusterEmprise(ids.map((id) => sourceSites.getFeatureById(id)).filter(Boolean));
    C.majTable?.({ defiler: true });
  };
  C.featuresVisibles = () => sourceSites.getFeatures().filter(estVisible);

  /* ---------------------- Fenêtres d'information --------------------- */
  const popupEl = $('#popup');
  const popup = new ol.Overlay({ element: popupEl, positioning: 'bottom-center', offset: [0, -10], autoPan: { animation: { duration: 250 }, margin: 60 }, stopEvent: true });
  map.addOverlay(popup);
  let popupSite = null;

  function coordsTexte(s) {
    if (s.lat === null || s.lat === undefined) return '<span class="muted">Non géolocalisé</span>';
    const u = CR.utm(s.lng, s.lat);
    return `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}${u ? `<br><small class="muted">UTM ${u.zone}N · X ${fmt.n(u.x)} · Y ${fmt.n(u.y)}</small>` : ''}`;
  }

  function historiqueHtml(s, max = 5) {
    const evs = s.events || [];
    const courant = s.dernier;
    const debut = Math.max(0, evs.length - max);
    return `<ul class="timeline">${evs
      .slice(debut)
      .reverse()
      .map((e) => {
        const st = CR.statut(e.statut);
        const cls = e.date > E.date ? 'futur' : courant && e.id === courant.id ? 'courant' : '';
        return `<li class="${cls}" style="--c:${st.couleur}"><div class="row" style="gap:6px"><strong style="font-size:12.5px">${esc(st.libelle)}</strong>
          <span class="t-date">${CR.date(e.date)} · ${esc(CR.SOURCES[e.source] || e.source)}</span></div>${e.note ? `<div class="t-note">${esc(e.note)}</div>` : ''}</li>`;
      })
      .join('')}</ul>${debut ? `<div class="muted" style="font-size:11.5px">${debut} constat(s) plus ancien(s) dans la fiche du site</div>` : ''}`;
  }

  function contenuPopup(s) {
    const st = CR.statut(s.statut);
    return `
      <div class="popup-head">
        <span class="mi" style="color:${st.couleur}">location_on</span>
        <div><h3>${esc(s.code)} · ${esc(s.localite)}</h3><small>${esc(s.departement)}${s.sous_prefecture ? ` · S/P ${esc(s.sous_prefecture)}` : ''}</small></div>
        <button data-fermer-popup title="Fermer"><span class="mi mi-sm">close</span></button>
      </div>
      <div class="popup-body" style="max-height:340px;overflow:auto">
        <div class="row mb-2" style="gap:6px;flex-wrap:wrap">${CR.badgeStatut(s.statut)}<span class="badge">au ${CR.date(E.date)}</span>${
          s.priorite === 'haute' ? '<span class="badge red">Priorité haute</span>' : ''
        }</div>
        ${s.coord_alerte ? `<div class="alert warning mb-2" style="font-size:12px"><span class="mi mi-sm">warning</span><span>${esc(s.coord_alerte)}</span></div>` : ''}
        <dl class="dl">
          <dt>Domaine</dt><dd>${s.domaine === 'foret_classee' ? `Forêt classée${s.foret ? ` de ${esc(s.foret)}` : ''}${s.ugf ? ` · ${esc(s.ugf)}` : ''}` : 'Domaine rural'}</dd>
          ${s.cours_eau ? `<dt>Cours d'eau</dt><dd>${esc(s.cours_eau)}</dd>` : ''}
          <dt>Superficie</dt><dd>${s.superficie_ha ? fmt.ha(s.superficie_ha) : '—'}</dd>
          <dt>Coordonnées</dt><dd class="num">${coordsTexte(s)}</dd>
          <dt>Dernier constat</dt><dd>${s.dernier ? `${CR.date(s.dernier.date)} (il y a ${s.jours} j)` : '—'}</dd>
        </dl>
        <div class="popup-hist"><h4>Historique</h4>${historiqueHtml(s)}</div>
      </div>
      <div class="popup-actions">
        <button class="btn btn-sm btn-primary" data-pa="fiche"><span class="mi">description</span>Fiche du site</button>
        <button class="btn btn-sm" data-pa="zoom"><span class="mi">zoom_in</span>Zoomer</button>
        <button class="btn btn-sm" data-pa="selection"><span class="mi">${E.selection.has(s.id) ? 'deselect' : 'check_box_outline_blank'}</span>${E.selection.has(s.id) ? 'Retirer' : 'Sélectionner'}</button>
        ${s.lat !== null && s.lat !== undefined ? `<a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat.toFixed(6)},${s.lng.toFixed(6)}" title="Itinéraire"><span class="mi">directions</span></a>` : ''}
      </div>`;
  }

  function afficherPopup(s, coord) {
    if (!s) return;
    popupSite = s.id;
    popupEl.style.display = 'block';
    popupEl.innerHTML = contenuPopup(s);
    popup.setPosition(coord);
  }
  C.afficherPopup = afficherPopup;
  function fermerPopup() {
    popupSite = null;
    popup.setPosition(undefined);
    popupEl.style.display = 'none';
  }
  C.fermerPopup = fermerPopup;

  popupEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-fermer-popup]')) return fermerPopup();
    const a = e.target.closest('[data-pa]');
    if (!a || !popupSite) return undefined;
    const s = E.sites.find((x) => x.id === popupSite);
    if (a.dataset.pa === 'fiche') ficheSite(s.id);
    if (a.dataset.pa === 'zoom') {
      const fc = sourceContours.getFeatureById(`c-${s.id}`);
      const fp = sourceSites.getFeatureById(s.id);
      ajusterEmprise([fc || fp].filter(Boolean));
    }
    if (a.dataset.pa === 'selection') {
      C.selectionner([s.id], { basculer: true });
      popupEl.innerHTML = contenuPopup(s);
    }
    return undefined;
  });

  function popupFiche(f, coord) {
    const p = f.getProperties();
    const s = STATUTS_FICHE[p.statut] || { libelle: p.statut, couleur: '#64748b' };
    popupSite = null;
    popupEl.style.display = 'block';
    popupEl.innerHTML = `
      <div class="popup-head"><span class="mi" style="color:${s.couleur}">contact_page</span>
        <div><h3>Fiche ${esc(p.numero)}</h3><small>Reçue le ${CR.date(p.date_recu)} · ${esc(p.localite)}</small></div>
        <button data-fermer-popup title="Fermer"><span class="mi mi-sm">close</span></button></div>
      <div class="popup-body" style="max-height:300px;overflow:auto">
        <div class="row mb-2" style="gap:6px;flex-wrap:wrap"><span class="badge" style="background:${s.couleur}1f;color:${s.couleur}">${esc(s.libelle)}</span>
          <span class="badge violet cotation" title="Fiabilité de la source · crédibilité de l'information">Cotation ${esc(p.cotation)}</span>
          ${p.priorite !== 'routine' ? `<span class="badge red">${esc(p.priorite)}</span>` : ''}</div>
        <dl class="dl">
          <dt>Nature</dt><dd>${esc((p.nature || []).join(', '))}</dd>
          ${p.equipements?.length ? `<dt>Équipements</dt><dd>${esc(p.equipements.join(', '))}</dd>` : ''}
          ${p.personnes ? `<dt>Personnes</dt><dd>${fmt.n(p.personnes)}</dd>` : ''}
          <dt>Source</dt><dd>${esc(p.source_type)}${p.source_code ? ` · ${esc(p.source_code)}` : ''}</dd>
        </dl>
        <p style="font-size:12.5px;margin-top:8px">${esc(p.description)}</p>
      </div>
      <div class="popup-actions"><a class="btn btn-sm btn-primary" href="/renseignement.html#${encodeURIComponent(p.id)}"><span class="mi">open_in_new</span>Ouvrir la fiche</a></div>`;
    popup.setPosition(coord);
  }

  function popupCours(f, coord) {
    const p = f.getProperties();
    const i = INTENSITES[p.intensite];
    popupSite = null;
    popupEl.style.display = 'block';
    popupEl.innerHTML = `
      <div class="popup-head"><span class="mi" style="color:#0284c7">water</span><div><h3>${esc(p.nom)}</h3><small>Bassin ${esc(p.bassin || '—')}</small></div>
        <button data-fermer-popup title="Fermer"><span class="mi mi-sm">close</span></button></div>
      <div class="popup-body"><dl class="dl">
        <dt>Intensité</dt><dd>${esc(i ? i.libelle : p.intensite || '—')}</dd>
        <dt>Longueur (région)</dt><dd>${p.longueur_km ? `${fmt.n(p.longueur_km, 2)} km` : '—'}</dd>
        <dt>Localités</dt><dd>${esc(p.localites || '—')}</dd></dl>
        ${p.commentaire ? `<p style="font-size:12.5px;margin-top:8px">${esc(p.commentaire)}</p>` : ''}</div>`;
    popup.setPosition(coord);
  }

  /** Fiche d'une forêt classée (couche harmonisée du CG Gagnoa) avec les sites qu'elle contient. */
  function popupForet(f, coord) {
    const p = f.getProperties();
    const oui = (v) => (v ? `<span class="badge ${v === 'Oui' || v === 'Ok' ? 'green' : v === 'Non' ? 'red' : 'amber'}">${esc(v)}</span>` : '—');
    const nomNorm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^fc\s+/, '').trim();
    const dedans = sitesFiltres().filter((s) => {
      if (nomNorm(s.foret) === nomNorm(p.nom)) return true;
      if (s.lat === null || s.lat === undefined) return false;
      return f.getGeometry().intersectsCoordinate(ol.proj.fromLonLat([s.lng, s.lat]));
    });
    const actifs = dedans.filter((s) => s.statut === 'actif' || s.statut === 'recolonise').length;
    popupSite = null;
    popupEl.style.display = 'block';
    popupEl.innerHTML = `
      <div class="popup-head"><span class="mi">forest</span>
        <div><h3>Forêt classée de ${esc(p.nom)}</h3><small>${p.code ? `Code ${esc(p.code)} · ` : ''}${esc(p.ugf || 'UGF non renseignée')}</small></div>
        <button data-fermer-popup title="Fermer"><span class="mi mi-sm">close</span></button></div>
      <div class="popup-body" style="max-height:320px;overflow:auto">
        <div class="row mb-2" style="gap:6px;flex-wrap:wrap"><span class="badge ${dedans.length ? (actifs ? 'red' : 'green') : ''}">${dedans.length} site(s) d'orpaillage au ${CR.date(E.date)}</span>${
          actifs ? `<span class="badge red">${actifs} actif(s)</span>` : ''
        }</div>
        <dl class="dl">
          <dt>Statut</dt><dd>${esc(p.statut || '—')}${p.categorie ? ` · catégorie ${esc(p.categorie)}` : ''}</dd>
          <dt>Sup. cartographique</dt><dd>${fmt.ha(p.sup_carto, 0)}</dd>
          <dt>Sup. calculée</dt><dd>${fmt.ha(ol.sphere.getArea(f.getGeometry()) / 10000, 0)}</dd>
          <dt>Limites</dt><dd>${oui(p.limites)}</dd>
          <dt>Plan d'aménagement</dt><dd>${oui(p.plan_amenagement)}</dd>
        </dl>
        ${dedans.length ? `<div class="mt-2" style="font-size:12.5px">${dedans.map((s) => `<div class="row" style="gap:6px;padding:2px 0"><i class="site-dot" style="background:${CR.statut(s.statut).couleur}"></i><a href="#" data-site="${esc(s.id)}">${esc(s.code)}</a> ${esc(s.localite)}</div>`).join('')}</div>` : ''}
      </div>
      <div class="popup-actions"><button class="btn btn-sm" data-pf="zoom"><span class="mi">zoom_in_map</span>Zoomer sur la forêt</button></div>`;
    popupEl.querySelector('[data-pf="zoom"]').addEventListener('click', () => view.fit(f.getGeometry().getExtent(), { padding: [60, 60, 60, 60], duration: 700 }));
    popup.setPosition(coord);
  }
  popupEl.addEventListener('click', (e) => {
    const a = e.target.closest('[data-site]');
    if (!a) return;
    e.preventDefault();
    allerAuSite(a.dataset.site);
  });

  function allerAuSite(id) {
    const s = E.sites.find((x) => x.id === id);
    const f = sourceSites.getFeatureById(id);
    if (!s) return;
    if (!f) {
      ficheSite(id);
      return;
    }
    C.selectionner([id], { zoom: true });
    setTimeout(() => afficherPopup(s, f.getGeometry().getCoordinates()), 750);
  }
  C.allerAuSite = allerAuSite;

  /** Fiche complète d'un site : historique et visites consignées dans les BRQ. */
  async function ficheSite(id) {
    const m = CR.modale({
      id: 'modal-site',
      titre: 'Fiche du site',
      icone: 'location_on',
      large: true,
      corps: '<div class="empty"><span class="spinner"></span><p>Chargement…</p></div>',
      pied: `<a class="btn" href="/sites.html#${encodeURIComponent(id)}"><span class="mi">edit</span>Modifier dans le registre</a><button class="btn btn-primary" data-close-modal>Fermer</button>`,
    });
    try {
      const d = await GR.api(`/sites/${id}`);
      const s = E.sites.find((x) => x.id === id) || d;
      m.querySelector('.modal-body').innerHTML = `
        <div class="fiche-head">
          <div><span>Code</span><strong>${esc(d.code)}</strong></div>
          <div><span>Localité</span><strong>${esc(d.localite)}</strong></div>
          <div><span>Département · S/P</span><strong>${esc(d.departement)}${d.sous_prefecture ? ` · ${esc(d.sous_prefecture)}` : ''}</strong></div>
          <div><span>Statut au ${CR.date(E.date)}</span><strong>${esc(CR.statut(s.statut).libelle)}</strong></div>
          <div><span>Domaine</span><strong>${d.domaine === 'foret_classee' ? `FC ${esc(d.foret || '')}` : 'Rural'}</strong></div>
          <div><span>Cours d'eau</span><strong>${esc(d.cours_eau || '—')}</strong></div>
          <div><span>Superficie</span><strong>${d.superficie_ha ? fmt.ha(d.superficie_ha) : '—'}</strong></div>
          <div><span>Priorité</span><strong>${esc(LIB_PRIORITE[d.priorite] || d.priorite)}</strong></div>
        </div>
        ${d.coord_alerte ? `<div class="alert warning mb-4"><span class="mi">warning</span><span>${esc(d.coord_alerte)}</span></div>` : ''}
        ${d.observations ? `<div class="alert info mb-4"><span class="mi">sticky_note_2</span><span>${esc(d.observations)}</span></div>` : ''}
        <div class="grid grid-2" style="align-items:start">
          <div class="fiche-section"><h3>Historique des statuts</h3>${historiqueHtml({ ...s, events: d.events }, 50)}</div>
          <div class="fiche-section"><h3>Coordonnées</h3><dl class="dl"><dt>WGS84</dt><dd class="num">${coordsTexte(d)}</dd>
            ${d.coord_saisie ? `<dt>Saisie d'origine</dt><dd class="num">${esc(d.coord_saisie.sys === 'wgs' ? 'WGS84' : `UTM ${d.coord_saisie.sys}N`)} · ${esc(d.coord_saisie.x)} / ${esc(d.coord_saisie.y)}</dd>` : ''}
            <dt>Contour</dt><dd>${d.contour ? 'Relevé' : 'Non relevé'}</dd></dl></div>
        </div>
        <div class="fiche-section mt-4"><h3>Visites consignées dans les BRQ</h3>${
          (d.visites || []).length
            ? `<div class="table-wrap"><table class="table compact"><thead><tr><th>Date</th><th>Unité</th><th>Constat</th><th>Matériel saisi</th><th class="num">Interpellés</th><th>Note</th></tr></thead><tbody>${d.visites
                .map(
                  (v) => `<tr><td class="nowrap">${CR.date(v.date)}</td><td>${esc(v.unite || '—')}</td><td>${CR.badgeStatut(v.constat)}</td><td>${esc(CR.saisiesTexte(v.saisies) || '—')}</td><td class="num">${fmt.n(
                    v.interpelles
                  )}</td><td>${esc(v.note || '')}</td></tr>`
                )
                .join('')}</tbody></table></div>`
            : '<div class="muted">Aucune visite consignée.</div>'
        }</div>`;
    } catch (e) {
      m.querySelector('.modal-body').innerHTML = `<div class="alert error"><span class="mi">error</span>${esc(e.message)}</div>`;
    }
  }
  C.ficheSite = ficheSite;

  /* ------------------------ Interactions carte ----------------------- */
  const infobulle = document.createElement('div');
  infobulle.className = 'map-tooltip';
  const overlayInfobulle = new ol.Overlay({ element: infobulle, offset: [14, 0], positioning: 'center-left' });
  map.addOverlay(overlayInfobulle);
  const couchesCliquables = (l) => [coucheSites, coucheGroupes, coucheContours, coucheFiches, coucheCours].includes(l);

  map.on('pointermove', (evt) => {
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
      { layerFilter: couchesCliquables, hitTolerance: 4 }
    );
    map.getTargetElement().style.cursor = trouve ? 'pointer' : '';
    let id = null;
    if (trouve && couche === coucheSites) id = trouve.getId();
    if (trouve && couche === coucheContours) id = trouve.get('site_id');
    if (trouve && couche === coucheFiches) id = trouve.getId();
    if (id !== E.survol) {
      E.survol = id;
      coucheSites.changed();
      coucheFiches.changed();
    }
    if (trouve) {
      if (couche === coucheGroupes) {
        const n = trouve.get('features').length;
        infobulle.textContent = n > 1 ? `${n} sites — cliquer pour zoomer` : `${trouve.get('features')[0].get('code')} · ${trouve.get('features')[0].get('localite')}`;
      } else if (couche === coucheFiches) infobulle.textContent = `Fiche ${trouve.get('numero')} · ${trouve.get('localite')}`;
      else if (couche === coucheCours) infobulle.textContent = trouve.get('nom');
      else infobulle.textContent = `${trouve.get('code')} · ${trouve.get('localite')} — ${CR.statut(trouve.get('statut')).libelle}`;
      overlayInfobulle.setPosition(evt.coordinate);
    } else overlayInfobulle.setPosition(undefined);
  });
  map.getViewport().addEventListener('mouseleave', () => {
    overlayInfobulle.setPosition(undefined);
    if (E.survol !== null) {
      E.survol = null;
      coucheSites.changed();
    }
  });

  map.on('singleclick', (evt) => {
    if (C.outilActif?.() && C.outilActif() !== 'info') return;
    let trouve = null;
    let couche = null;
    map.forEachFeatureAtPixel(
      evt.pixel,
      (f, l) => {
        if (!trouve || (l === coucheSites && couche !== coucheSites) || (l === coucheFiches && couche === coucheContours)) {
          trouve = f;
          couche = l;
        }
      },
      { layerFilter: couchesCliquables, hitTolerance: 5 }
    );
    if (trouve && couche === coucheGroupes) {
      const membres = trouve.get('features');
      if (membres.length === 1) return afficherPopup(E.sites.find((s) => s.id === membres[0].getId()), membres[0].getGeometry().getCoordinates());
      const ext = ol.extent.boundingExtent(membres.map((m) => m.getGeometry().getCoordinates()));
      return view.fit(ext, { duration: 500, padding: [80, 80, 80, 80], maxZoom: 14 });
    }
    if (trouve && (couche === coucheSites || couche === coucheContours)) {
      const id = couche === coucheSites ? trouve.getId() : trouve.get('site_id');
      const multi = evt.originalEvent.ctrlKey || evt.originalEvent.metaKey || evt.originalEvent.shiftKey;
      if (multi) return C.selectionner([id], { basculer: true });
      const pt = sourceSites.getFeatureById(id);
      return afficherPopup(E.sites.find((s) => s.id === id), pt ? pt.getGeometry().getCoordinates() : evt.coordinate);
    }
    if (trouve && couche === coucheFiches) return popupFiche(trouve, trouve.getGeometry().getCoordinates());
    if (trouve && couche === coucheCours) return popupCours(trouve, evt.coordinate);
    let foret = null;
    if (refs.forets?.couche.getVisible()) map.forEachFeatureAtPixel(evt.pixel, (f) => (foret = f), { layerFilter: (l) => l === refs.forets.couche });
    if (foret) popupForet(foret, evt.coordinate);
    else fermerPopup();
    return undefined;
  });

  /* ------------------------ Coordonnées & URL ------------------------ */
  const dms = (v, pos, neg) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = ((a - d - m / 60) * 3600).toFixed(1);
    return `${d}°${String(m).padStart(2, '0')}′${s.padStart(4, '0')}″${v >= 0 ? pos : neg}`;
  };
  function formaterCoord(c3857) {
    const sys = $('#systeme-coord').value;
    const [lon, lat] = ol.proj.toLonLat(c3857);
    if (sys === 'dms') return `${dms(lat, 'N', 'S')}  ${dms(lon, 'E', 'O')}`;
    if (sys === 'utm') {
      const u = CR.utm(lon, lat);
      if (u) return `UTM ${u.zone}N · X ${fmt.n(u.x)} m · Y ${fmt.n(u.y)} m`;
    }
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
  C.formaterCoord = formaterCoord;
  map.on('pointermove', (e) => {
    $('#coord').textContent = formaterCoord(e.coordinate);
  });
  $('#systeme-coord').value = stock.get('systeme-coord', 'dd');
  $('#systeme-coord').addEventListener('change', (e) => stock.set('systeme-coord', e.target.value));

  function ecrireVueUrl() {
    const [lon, lat] = ol.proj.toLonLat(view.getCenter());
    const z = view.getZoom();
    $('#niveau-zoom').textContent = z.toFixed(1);
    history.replaceState(null, '', `${location.pathname}${location.search}#${z.toFixed(2)}/${lat.toFixed(5)}/${lon.toFixed(5)}`);
  }
  function lireVueUrl() {
    const m = location.hash.match(/^#([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/);
    if (!m) return false;
    view.setZoom(Number(m[1]));
    view.setCenter(ol.proj.fromLonLat([Number(m[3]), Number(m[2])]));
    return true;
  }
  map.on('moveend', GR.debounce(ecrireVueUrl, 200));
  map.on('moveend', () => {
    if ($('#table-emprise')?.checked) C.majTable?.();
  });

  /* ------------------------ Boutons de contrôle ---------------------- */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'zoom-plus') view.animate({ zoom: view.getZoom() + 1, duration: 220 });
    if (a === 'zoom-moins') view.animate({ zoom: view.getZoom() - 1, duration: 220 });
    if (a === 'emprise') ajusterEmprise();
    if (a === 'accueil') view.animate({ center: ol.proj.fromLonLat(ACCUEIL.centre), zoom: ACCUEIL.zoom, duration: 600 });
    if (a === 'plein-ecran') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    }
    if (a === 'partager') {
      try {
        await navigator.clipboard.writeText(location.href);
        GR.toast('Lien de la vue copié dans le presse-papiers');
      } catch {
        GR.toast('Copie impossible : copiez l’adresse de la barre du navigateur.', 'warning');
      }
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const btn = $('[data-action="plein-ecran"] .mi');
    if (btn) btn.textContent = document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen';
    setTimeout(() => map.updateSize(), 100);
  });

  $('#reinitialiser').addEventListener('click', () => {
    $$('#f-departements input, #f-domaines input').forEach((i) => {
      i.checked = true;
      i.closest('.chip').classList.add('on');
    });
    Object.values(ms).forEach((m) => m.set([]));
    $$('#f-priorite button').forEach((x, i) => x.classList.toggle('active', i === 0));
    ['#f-supmin', '#f-supmax'].forEach((s) => ($(s).value = ''));
    $('#f-alertes').checked = false;
    E.masquees.clear();
    E.selection.clear();
    E.requeteActive = false;
    C.viderRequete?.();
    fermerPopup();
    toutMettreAJour({ ajuster: true });
  });

  /* ---------------------------- Recherche ---------------------------- */
  const champRecherche = $('#recherche');
  const zoneResultats = $('#resultats-recherche');
  let resultats = [];
  let curseurRech = -1;
  const sansAccent = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function rendreResultats(sites, fiches, lieux, chargementLieux) {
    const q = sansAccent(champRecherche.value.trim());
    const forets = q ? (C.sourceForets?.getFeatures() || []).filter((f) => sansAccent(`${f.get('nom')} ${f.get('code') || ''}`).includes(q)).slice(0, 4) : [];
    resultats = [...sites.map((s) => ({ type: 'site', s })), ...fiches.map((f) => ({ type: 'fiche', f })), ...forets.map((f) => ({ type: 'foret', f })), ...lieux.map((l) => ({ type: 'lieu', l }))];
    curseurRech = -1;
    let i = 0;
    const groupe = (titre, items, rendu) => (items.length ? `<div class="sr-group">${titre}</div>${items.map((x) => rendu(x, i++)).join('')}` : '');
    const html =
      groupe('Sites', sites, (s, k) => `<button data-i="${k}"><span class="mi" style="color:${CR.statut(s.statut).couleur}">location_on</span><span><strong>${esc(s.code)} · ${esc(s.localite)}</strong><small>${esc(
        CR.statut(s.statut).libelle
      )} au ${CR.date(E.date)} · ${esc(s.departement)}${s.sous_prefecture ? ` · ${esc(s.sous_prefecture)}` : ''}</small></span></button>`) +
      groupe('Fiches de renseignement', fiches, (f, k) => `<button data-i="${k}"><span class="mi" style="color:#ca8a04">contact_page</span><span><strong>${esc(f.numero)}</strong><small>${esc(f.localite)} · ${CR.date(
        f.date_recu
      )}</small></span></button>`) +
      groupe('Forêts classées', forets, (f, k) => `<button data-i="${k}"><span class="mi" style="color:#15803d">forest</span><span><strong>FC ${esc(f.get('nom'))}</strong><small>${fmt.ha(f.get('sup_carto'), 0)}</small></span></button>`) +
      (lieux.length
        ? groupe('Lieux', lieux, (l, k) => `<button data-i="${k}"><span class="mi muted">place</span><span>${esc(l.display_name.split(',').slice(0, 2).join(','))}<small>${esc(l.display_name.split(',').slice(2, 5).join(','))}</small></span></button>`)
        : chargementLieux
          ? '<div class="sr-group">Lieux</div><div class="muted" style="padding:8px 12px"><span class="spinner" style="width:12px;height:12px"></span> Recherche…</div>'
          : '');
    zoneResultats.innerHTML = html || '<div class="muted" style="padding:12px">Aucun résultat</div>';
    zoneResultats.classList.add('open');
  }
  let ctrlLieux;
  const rechercherLieux = GR.debounce(async (q, sites, fiches) => {
    ctrlLieux?.abort();
    ctrlLieux = new AbortController();
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=ci&accept-language=fr&q=${encodeURIComponent(q)}`, { signal: ctrlLieux.signal });
      const lieux = await r.json();
      if (champRecherche.value.trim() === q) rendreResultats(sites, fiches, lieux, false);
    } catch {
      if (champRecherche.value.trim() === q) rendreResultats(sites, fiches, [], false);
    }
  }, 450);
  champRecherche.addEventListener('input', () => {
    const q = sansAccent(champRecherche.value.trim());
    if (!q) return zoneResultats.classList.remove('open');
    const sites = E.sites
      .filter((s) => s.statut && sansAccent(`${s.code} ${s.localite} ${s.sous_prefecture || ''} ${s.foret || ''} ${s.cours_eau || ''}`).includes(q))
      .slice(0, 8);
    const fiches = E.fiches.filter((f) => f.date_recu <= E.date && sansAccent(`${f.numero} ${f.localite}`).includes(q)).slice(0, 4);
    rendreResultats(sites, fiches, [], q.length >= 3);
    if (q.length >= 3) rechercherLieux(champRecherche.value.trim(), sites, fiches);
    return undefined;
  });
  function choisirResultat(i) {
    const r = resultats[i];
    if (!r) return;
    zoneResultats.classList.remove('open');
    if (r.type === 'site') {
      champRecherche.value = `${r.s.code} · ${r.s.localite}`;
      allerAuSite(r.s.id);
    } else if (r.type === 'fiche') {
      champRecherche.value = r.f.numero;
      const f = sourceFiches.getFeatureById(`f-${r.f.id}`);
      if (f) {
        view.animate({ center: f.getGeometry().getCoordinates(), zoom: Math.max(view.getZoom(), 13), duration: 700 });
        setTimeout(() => popupFiche(f, f.getGeometry().getCoordinates()), 750);
      } else location.href = `/renseignement.html#${encodeURIComponent(r.f.id)}`;
    } else if (r.type === 'foret') {
      champRecherche.value = `FC ${r.f.get('nom')}`;
      view.fit(r.f.getGeometry().getExtent(), { padding: [60, 60, 60, 60], duration: 700 });
      setTimeout(() => popupForet(r.f, r.f.getGeometry().getInteriorPoint().getCoordinates().slice(0, 2)), 750);
    } else {
      const bb = r.l.boundingbox?.map(Number);
      if (bb) view.fit(ol.proj.transformExtent([bb[2], bb[0], bb[3], bb[1]], 'EPSG:4326', 'EPSG:3857'), { duration: 700, maxZoom: 15 });
      else view.animate({ center: ol.proj.fromLonLat([Number(r.l.lon), Number(r.l.lat)]), zoom: 14, duration: 700 });
      C.placerRepere?.(ol.proj.fromLonLat([Number(r.l.lon), Number(r.l.lat)]), r.l.display_name.split(',')[0]);
    }
  }
  zoneResultats.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) choisirResultat(Number(b.dataset.i));
  });
  champRecherche.addEventListener('keydown', (e) => {
    const boutons = $$('button[data-i]', zoneResultats);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      curseurRech = Math.max(0, Math.min(boutons.length - 1, curseurRech + (e.key === 'ArrowDown' ? 1 : -1)));
      boutons.forEach((b, i) => b.classList.toggle('focus', i === curseurRech));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choisirResultat(curseurRech >= 0 ? Number(boutons[curseurRech].dataset.i) : 0);
    } else if (e.key === 'Escape') zoneResultats.classList.remove('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.geo-search')) zoneResultats.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea, select')) {
      e.preventDefault();
      champRecherche.focus();
    }
  });

  /* ------------------------- Table attributaire ---------------------- */
  const COLONNES = [
    { cle: 'code', titre: 'Code', rendu: (l) => `<span class="row" style="gap:6px"><i class="site-dot" style="background:${C.couleurDe(l)}"></i><strong>${esc(l.code)}</strong></span>` },
    { cle: 'localite', titre: 'Localité' },
    { cle: 'departement', titre: 'Département' },
    { cle: 'sous_prefecture', titre: 'Sous-préfecture' },
    { cle: 'foret', titre: 'Domaine', tri: (l) => (l.domaine === 'foret_classee' ? `FC ${l.foret || ''}` : 'Rural'), rendu: (l) => (l.domaine === 'foret_classee' ? `FC ${esc(l.foret || '')}` : 'Rural') },
    { cle: 'statut', titre: 'Statut', tri: (l) => CR.statut(l.statut).libelle, rendu: (l) => CR.badgeStatut(l.statut) },
    { cle: 'jours', titre: 'Dernier constat', num: true, rendu: (l) => (l.dernier ? `${CR.date(l.dernier.date)} <span class="muted">(${l.jours} j)</span>` : '—') },
    { cle: 'superficie_ha', titre: 'Superficie (ha)', num: true, rendu: (l) => (l.superficie_ha ? fmt.n(l.superficie_ha, 2) : '—') },
    {
      cle: 'coord_alerte',
      titre: 'Localisation',
      rendu: (l) => (l.lat === null || l.lat === undefined ? '<span class="badge amber">Sans coordonnées</span>' : l.coord_alerte ? '<span class="badge red">À vérifier</span>' : '<span class="badge green">OK</span>'),
    },
    { cle: 'actions', titre: '', trier: false, rendu: (l) => `<button class="btn btn-ghost btn-sm btn-icon" data-fiche="${esc(l.id)}" title="Fiche du site"><span class="mi">description</span></button>` },
  ];
  function lignesTable() {
    let sites = sitesAffiches();
    if ($('#table-emprise').checked) {
      const ext = view.calculateExtent(map.getSize());
      sites = sites.filter((s) => {
        const f = sourceSites.getFeatureById(s.id);
        return f && ol.extent.containsCoordinate(ext, f.getGeometry().getCoordinates());
      });
    }
    if ($('#table-selectionnees').checked) sites = sites.filter((s) => E.selection.has(s.id));
    const q = sansAccent($('#table-recherche').value.trim());
    if (q) sites = sites.filter((s) => sansAccent(`${s.code} ${s.localite} ${s.sous_prefecture || ''} ${s.foret || ''} ${s.cours_eau || ''} ${CR.statut(s.statut).libelle}`).includes(q));
    return sites;
  }
  const table = GR.table('#table-sites', {
    colonnes: COLONNES,
    lignes: [],
    compact: true,
    tri: 'code',
    vide: 'Aucun site pour ces critères',
    estSelectionnee: (l) => E.selection.has(l.id),
    onClick: (l, tr, e) => {
      const multi = e.ctrlKey || e.metaKey || e.shiftKey;
      if (!sourceSites.getFeatureById(l.id)) return ficheSite(l.id);
      C.selectionner([l.id], { basculer: multi, zoom: !multi });
      return undefined;
    },
    pied: (lignes) =>
      `<td colspan="7">${lignes.length} site(s) · ${lignes.filter((s) => s.statut === 'actif' || s.statut === 'recolonise').length} actif(s) ou recolonisé(s)</td><td class="num">${fmt.n(
        lignes.reduce((t, s) => t + (Number(s.superficie_ha) || 0), 0),
        2
      )}</td><td></td><td></td>`,
  });
  C.majTable = function majTable({ defiler = false } = {}) {
    if (!document.body.classList.contains('drawer-open')) {
      $('#table-compte').textContent = sitesAffiches().length;
      majCompteSelection();
      return;
    }
    const lignes = lignesTable();
    table.maj(lignes);
    $('#table-compte').textContent = lignes.length;
    majCompteSelection();
    if (defiler) $('#table-sites tr.selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  function majCompteSelection() {
    const n = E.selection.size;
    $('#table-selection').textContent = `${n} sélectionné${n > 1 ? 's' : ''}`;
    $('#table-selection').classList.toggle('hidden', !n);
  }
  C.lignesTable = lignesTable;
  $('#table-sites').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fiche]');
    if (b) ficheSite(b.dataset.fiche);
  });
  $('#table-recherche').addEventListener('input', GR.debounce(() => C.majTable(), 200));
  ['#table-emprise', '#table-selectionnees'].forEach((s) => $(s).addEventListener('change', () => C.majTable()));
  $('#table-vider-selection').addEventListener('click', () => C.selectionner([]));
  function ouvrirTable(ouvrir = !document.body.classList.contains('drawer-open')) {
    document.body.classList.toggle('drawer-open', ouvrir);
    if (!ouvrir) document.body.classList.remove('drawer-max');
    setTimeout(() => map.updateSize(), 240);
    C.majTable();
  }
  C.ouvrirTable = ouvrirTable;
  $('#ouvrir-table').addEventListener('click', () => ouvrirTable(true));
  $('#table-fermer').addEventListener('click', () => ouvrirTable(false));
  $('#table-agrandir').addEventListener('click', () => {
    document.body.classList.toggle('drawer-max');
    $('#table-agrandir .mi').textContent = document.body.classList.contains('drawer-max') ? 'close_fullscreen' : 'open_in_full';
    setTimeout(() => map.updateSize(), 240);
  });

  /* ------------------------------ Init ------------------------------- */
  appliquerRegroupement();
  majListeCouches();
  CR.session()
    .then((u) => {
      $('#emplacement-sidebar').outerHTML = CR.sidebar(u);
      $('#emplacement-utilisateur').outerHTML = CR.menuUtilisateur(u);
      return charger();
    })
    .catch(() => {});
  Object.values(refs).forEach((r) => r.couche.getSource().once?.('featuresloadend', majLegende));
})();
