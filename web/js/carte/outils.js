/* =====================================================================
   CRLOI GÔH — Géoportail : outils (mesures, sélection spatiale, annotations,
   requêteur attributaire, géolocalisation, exports et impression) — repris de GestReb
   ===================================================================== */
(function () {
  'use strict';
  const C = window.CARTE;
  const E = C.etat;
  const map = C.map;
  const view = map.getView();
  const { esc, fmt, $, $$ } = GR;

  /* ----------------------- Couche de dessin -------------------------- */
  const sourceDessin = new ol.source.Vector();
  const styleDessin = (f) => {
    const type = f.getGeometry().getType();
    const mesure = f.get('mesure');
    const couleur = mesure ? '#0f4c3a' : '#dc2626';
    const styles = [
      new ol.style.Style({
        fill: new ol.style.Fill({ color: mesure ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.15)' }),
        stroke: new ol.style.Stroke({ color: couleur, width: 2.5, lineDash: mesure ? [8, 6] : undefined }),
        image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: couleur }), stroke: new ol.style.Stroke({ color: '#fff', width: 2 }) }),
      }),
    ];
    if (f.get('libelle') && type === 'Point') {
      styles.push(
        new ol.style.Style({
          text: new ol.style.Text({
            text: f.get('libelle'),
            offsetY: -16,
            font: '600 12px Inter, sans-serif',
            fill: new ol.style.Fill({ color: '#7f1d1d' }),
            stroke: new ol.style.Stroke({ color: '#fff', width: 3 }),
          }),
        })
      );
    }
    return styles;
  };
  const coucheDessin = new ol.layer.Vector({ source: sourceDessin, style: styleDessin, zIndex: 30 });
  map.addLayer(coucheDessin);

  const sourceReperes = new ol.source.Vector();
  map.addLayer(
    new ol.layer.Vector({
      source: sourceReperes,
      zIndex: 31,
      style: (f) => [
        new ol.style.Style({
          image: new ol.style.Icon({
            src: `data:image/svg+xml;utf8,${encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 0C7 0 0 7 0 16c0 12 16 24 16 24s16-12 16-24C32 7 25 0 16 0z" fill="#dc2626"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>'
            )}`,
            anchor: [0.5, 1],
          }),
          text: f.get('libelle')
            ? new ol.style.Text({
                text: f.get('libelle'),
                offsetY: -48,
                font: '700 12px Inter, sans-serif',
                fill: new ol.style.Fill({ color: '#111827' }),
                stroke: new ol.style.Stroke({ color: '#fff', width: 3 }),
              })
            : undefined,
        }),
      ],
    })
  );
  C.placerRepere = (coord, libelle) => {
    sourceReperes.clear();
    sourceReperes.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coord), libelle }));
  };

  /* ----------------------- Gestion de l'outil actif ------------------ */
  let outil = null;
  let interactions = [];
  let ecouteurs = [];
  C.outilActif = () => outil;

  const AIDES = {
    info: 'Cliquez sur un site, une fiche ou une forêt pour afficher ses informations',
    distance: 'Cliquez pour tracer, double-cliquez pour terminer la mesure',
    surface: 'Cliquez pour tracer la zone, double-cliquez pour terminer',
    'selection-rect': 'Tracez un rectangle (cliquer-glisser) — Maj pour ajouter à la sélection',
    'selection-poly': 'Tracez un polygone de sélection, double-cliquez pour terminer',
    'dessin-point': 'Cliquez pour placer un repère annoté',
    'dessin-ligne': 'Cliquez pour tracer, double-cliquez pour terminer',
    'dessin-poly': 'Cliquez pour tracer la zone, double-cliquez pour terminer',
  };

  function arreterOutil() {
    interactions.forEach((i) => map.removeInteraction(i));
    ecouteurs.forEach((k) => ol.Observable.unByKey(k));
    interactions = [];
    ecouteurs = [];
    outil = null;
    map.getInteractions().forEach((i) => i instanceof ol.interaction.DragPan && i.setActive(true));
    $$('[data-outil]').forEach((b) => b.classList.remove('active'));
    $('#aide-outil').classList.remove('show');
    map.getTargetElement().style.cursor = '';
  }
  C.arreterOutil = arreterOutil;

  function activerOutil(nom) {
    const etaitActif = outil === nom;
    arreterOutil();
    if (etaitActif) return;
    outil = nom;
    $(`[data-outil="${nom}"]`)?.classList.add('active');
    $('#aide-outil-texte').textContent = AIDES[nom] || '';
    $('#aide-outil').classList.add('show');
    C.fermerPopup();

    if (nom === 'distance' || nom === 'surface') mesurer(nom === 'surface' ? 'Polygon' : 'LineString');
    if (nom === 'selection-rect') selectionRectangle();
    if (nom === 'selection-poly') selectionPolygone();
    if (nom.startsWith('dessin-')) dessiner({ 'dessin-point': 'Point', 'dessin-ligne': 'LineString', 'dessin-poly': 'Polygon' }[nom]);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-outil]');
    if (b) activerOutil(b.dataset.outil);
  });
  $('#aide-outil-stop').addEventListener('click', arreterOutil);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && outil && !document.querySelector('.modal.open')) arreterOutil();
  });

  /* ----------------------------- Mesures ----------------------------- */
  const formatLongueur = (g) => {
    const l = ol.sphere.getLength(g);
    return l >= 1000 ? `${fmt.n(l / 1000, 2)} km` : `${fmt.n(l, 1)} m`;
  };
  const formatSurface = (g) => {
    const a = ol.sphere.getArea(g);
    return `${fmt.n(a / 10000, 2)} ha${a >= 1e6 ? ` · ${fmt.n(a / 1e6, 2)} km²` : ''}`;
  };

  function mesurer(type) {
    const draw = new ol.interaction.Draw({
      source: sourceDessin,
      type,
      style: new ol.style.Style({
        fill: new ol.style.Fill({ color: 'rgba(255,255,255,0.25)' }),
        stroke: new ol.style.Stroke({ color: '#0f4c3a', width: 2, lineDash: [8, 6] }),
        image: new ol.style.Circle({ radius: 5, stroke: new ol.style.Stroke({ color: '#0f4c3a' }), fill: new ol.style.Fill({ color: '#fff' }) }),
      }),
    });
    let el;
    let ov;
    let ecoute;
    draw.on('drawstart', (evt) => {
      el = document.createElement('div');
      el.className = 'measure-tooltip';
      ov = new ol.Overlay({ element: el, offset: [0, -14], positioning: 'bottom-center', stopEvent: false });
      map.addOverlay(ov);
      ecoute = evt.feature.getGeometry().on('change', (e) => {
        const g = e.target;
        el.textContent = type === 'Polygon' ? formatSurface(g) : formatLongueur(g);
        ov.setPosition(type === 'Polygon' ? g.getInteriorPoint().getCoordinates() : g.getLastCoordinate());
      });
    });
    draw.on('drawend', (evt) => {
      evt.feature.set('mesure', true);
      el.classList.add('static');
      evt.feature.set('overlay', ov);
      ol.Observable.unByKey(ecoute);
      const g = evt.feature.getGeometry();
      GR.toast(`Mesure : ${type === 'Polygon' ? `${formatSurface(g)} — périmètre ${formatLongueur(new ol.geom.LineString(g.getCoordinates()[0]))}` : formatLongueur(g)}`, 'info');
    });
    map.addInteraction(draw);
    interactions.push(draw);
  }

  /* ------------------------ Sélection spatiale ----------------------- */
  function selectionnerDans(geomTest, ajouter) {
    const ids = C.featuresVisibles()
      .filter((f) => geomTest(f.getGeometry()))
      .map((f) => f.getId());
    C.selectionner(ids, { ajouter });
    GR.toast(`${ids.length} site(s) sélectionné(s)`, ids.length ? 'success' : 'info');
    if (ids.length) C.ouvrirTable(true);
  }

  function selectionRectangle() {
    const box = new ol.interaction.DragBox({ condition: ol.events.condition.always });
    box.on('boxend', (e) => {
      const ext = box.getGeometry().getExtent();
      selectionnerDans((g) => g.intersectsExtent(ext), e.mapBrowserEvent?.originalEvent?.shiftKey);
    });
    map.addInteraction(box);
    interactions.push(box);
    // Le cliquer-glisser sert au rectangle : on suspend le déplacement de la carte
    map.getInteractions().forEach((i) => i instanceof ol.interaction.DragPan && i.setActive(false));
  }

  function selectionPolygone() {
    const draw = new ol.interaction.Draw({ type: 'Polygon' });
    draw.on('drawend', (e) => {
      const poly = e.feature.getGeometry();
      selectionnerDans((g) => poly.intersectsCoordinate(g.getCoordinates()), false);
    });
    map.addInteraction(draw);
    interactions.push(draw);
  }

  /* --------------------------- Annotations --------------------------- */
  function dessiner(type) {
    const draw = new ol.interaction.Draw({ source: sourceDessin, type });
    draw.on('drawend', async (e) => {
      if (type === 'Point') {
        const libelle = await GR.confirm({
          titre: 'Annotation',
          message: 'Texte à afficher à côté du repère (facultatif) :',
          ok: 'Ajouter',
          saisie: { label: 'Libellé', placeholder: 'Ex. Campement, puits, piste d’accès…' },
        });
        if (libelle === null) {
          setTimeout(() => sourceDessin.removeFeature(e.feature), 0);
          return;
        }
        e.feature.set('libelle', libelle);
      }
    });
    map.addInteraction(draw);
    interactions.push(draw);
    const modify = new ol.interaction.Modify({ source: sourceDessin });
    map.addInteraction(modify);
    interactions.push(modify);
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-action="effacer-dessins"]')) return;
    sourceDessin.getFeatures().forEach((f) => f.get('overlay') && map.removeOverlay(f.get('overlay')));
    sourceDessin.clear();
    sourceReperes.clear();
    $$('.measure-tooltip').forEach((el) => el.closest('.ol-overlay-container')?.remove());
    GR.toast('Mesures et annotations effacées', 'info');
  });

  /* ------------------------- Géolocalisation ------------------------- */
  const geoloc = new ol.Geolocation({ projection: view.getProjection(), trackingOptions: { enableHighAccuracy: true } });
  const sourcePosition = new ol.source.Vector();
  map.addLayer(new ol.layer.Vector({ source: sourcePosition, zIndex: 32 }));
  geoloc.on('change:position', () => {
    const c = geoloc.getPosition();
    if (!c) return;
    const precision = geoloc.getAccuracyGeometry();
    sourcePosition.clear();
    if (precision) sourcePosition.addFeature(new ol.Feature({ geometry: precision }));
    const pt = new ol.Feature({ geometry: new ol.geom.Point(c) });
    pt.setStyle(
      new ol.style.Style({
        image: new ol.style.Circle({ radius: 8, fill: new ol.style.Fill({ color: '#2563eb' }), stroke: new ol.style.Stroke({ color: '#fff', width: 3 }) }),
      })
    );
    sourcePosition.addFeature(pt);
    view.animate({ center: c, zoom: Math.max(view.getZoom(), 15), duration: 600 });
    geoloc.setTracking(false);
  });
  geoloc.on('error', () => GR.toast("Position indisponible (autorisation refusée ou signal GPS absent).", 'warning'));

  /* ------------------------ Aller à (coordonnées) -------------------- */
  let systemeAller = 'dd';
  $('#aller-systeme').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    systemeAller = b.dataset.s;
    $$('#aller-systeme button').forEach((x) => x.classList.toggle('active', x === b));
    $$('#modal-aller .form-grid[data-s]').forEach((g) => g.classList.toggle('hidden', (g.dataset.s === 'dd') !== (systemeAller === 'dd')));
  });
  const nombre = (s) => Number(String(s).trim().replace(/\s/g, '').replace(',', '.'));
  $('#aller-ok').addEventListener('click', () => {
    let coord;
    if (systemeAller === 'dd') {
      const lat = nombre($('#aller-lat').value);
      const lon = nombre($('#aller-lon').value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        GR.toast('Coordonnées invalides', 'error');
        return;
      }
      coord = ol.proj.fromLonLat([lon, lat]);
    } else {
      const x = nombre($('#aller-x').value);
      const y = nombre($('#aller-y').value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        GR.toast('Coordonnées invalides', 'error');
        return;
      }
      coord = ol.proj.transform([x, y], `EPSG:326${systemeAller}`, 'EPSG:3857');
    }
    view.animate({ center: coord, zoom: Math.max(view.getZoom(), 14), duration: 700 });
    if ($('#aller-marqueur').checked) C.placerRepere(coord, C.formaterCoord(coord));
    GR.modal.close('modal-aller');
  });

  /* ----------------------- Capture de la carte ----------------------- */
  function capturer() {
    return new Promise((resolve, reject) => {
      map.once('rendercomplete', () => {
        try {
          const taille = map.getSize();
          const ratio = window.devicePixelRatio || 1;
          const canvas = document.createElement('canvas');
          canvas.width = taille[0] * ratio;
          canvas.height = taille[1] * ratio;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          map.getViewport().querySelectorAll('.ol-layer canvas, canvas.ol-layer').forEach((c) => {
            if (c.width <= 0) return;
            const op = c.parentNode.style.opacity || c.style.opacity;
            ctx.globalAlpha = op === '' ? 1 : Number(op);
            const tr = c.style.transform;
            const m = tr && tr.match(/^matrix\(([^(]*)\)$/);
            if (m) {
              const mat = m[1].split(',').map(Number);
              ctx.setTransform(mat[0], mat[1], mat[2], mat[3], mat[4], mat[5]);
            } else ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(c, 0, 0);
          });
          ctx.globalAlpha = 1;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          reject(e);
        }
      });
      map.renderSync();
    });
  }

  async function exporterPng() {
    try {
      const url = await capturer();
      const a = document.createElement('a');
      a.href = url;
      a.download = `carte_crloi_goh_${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    } catch {
      GR.toast("Export impossible avec ce fond de carte (restriction du fournisseur). Essayez le fond « Satellite » ou « OpenStreetMap ».", 'error', 7000);
    }
  }

  async function imprimer() {
    let image;
    try {
      image = await capturer();
    } catch {
      GR.toast("Impression impossible avec ce fond de carte. Essayez un autre fond.", 'error');
      return;
    }
    const titre = await GR.confirm({
      titre: 'Imprimer la carte',
      message: 'Titre de la carte :',
      ok: 'Imprimer',
      saisie: { label: 'Titre', placeholder: `Sites d'orpaillage au ${CR.date(E.date)} — Région du Gôh` },
    });
    if (titre === null) return;
    const legende = $('#legende-corps').innerHTML;
    const echelle = $('#echelle').innerText;
    const w = window.open('', '_blank');
    if (!w) {
      GR.toast("Autorisez l'ouverture des fenêtres pour imprimer.", 'warning');
      return;
    }
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(titre || 'Carte CRLOI Gôh')}</title>
      <link href="/css/fonts.css" rel="stylesheet">
      <link href="/css/app.css" rel="stylesheet"><link href="/css/carte.css" rel="stylesheet">
      <style>@page{size:A4 landscape;margin:10mm}body{background:#fff;margin:0;font-family:Inter,sans-serif}
      .feuille{display:grid;grid-template-columns:1fr 62mm;gap:6mm;height:185mm}
      .entete{display:flex;align-items:center;gap:10px;border-bottom:2px solid #0f4c3a;padding-bottom:4mm;margin-bottom:4mm}
      .entete img{width:12mm;height:12mm;border-radius:2mm}.entete h1{font-size:16pt}
      .carte{border:1px solid #94a3b8;width:100%;height:100%;object-fit:contain}
      .cote{font-size:9pt;display:flex;flex-direction:column;gap:4mm}.cote h4{font-size:9pt;margin:2mm 0}
      .nord{font-size:22pt;text-align:center}.legend-item{display:flex;gap:6px;align-items:center;padding:1px 0}
      .legend-item i{width:14px;height:10px;border:1px solid #0003;border-radius:2px}.legend-item i.line{height:0;border:0;border-top:2.5px solid}
      .legend-item .n{margin-left:auto;color:#64748b}.pied{font-size:8pt;color:#64748b;margin-top:3mm}</style></head><body>
      <div class="entete"><img src="/img/logo.svg"><div><h1>${esc(titre || `Sites d'orpaillage au ${CR.date(E.date)}`)}</h1>
      <div style="font-size:9pt;color:#475569">CRLOI Gôh — Cellule renseignement · situation au ${CR.date(E.date)} · édité le ${new Date().toLocaleDateString('fr-FR')}</div></div></div>
      <div class="feuille"><img class="carte" src="${image}"><div class="cote"><div class="nord">▲<div style="font-size:9pt;font-weight:700">N</div></div>
      <div><strong>Échelle :</strong> ${esc(echelle)}</div><div><strong>Légende</strong>${legende}</div>
      <div><strong>Sites :</strong> ${esc($('#nb-sites').textContent)}</div></div></div>
      <div class="pied">Diffusion restreinte. Sources : CRLOI Gôh (BRQ, rapports, fiches), forêts classées du CG Gagnoa, fonds © contributeurs respectifs. Système de coordonnées : WGS 84 / Pseudo-Mercator.</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`);
    w.document.close();
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'position') geoloc.setTracking(true);
    if (a === 'aller-a') GR.modal.open('modal-aller');
    if (a === 'export-png') exporterPng();
    if (a === 'imprimer') imprimer();
  });

  /* ------------------------- Exports de la table --------------------- */
  const COLS_EXPORT = [
    { cle: 'code', titre: 'Code' },
    { cle: 'localite', titre: 'Localité' },
    { cle: 'departement', titre: 'Département' },
    { cle: 'sous_prefecture', titre: 'Sous-préfecture' },
    { cle: 'domaine', titre: 'Domaine', valeur: (l) => (l.domaine === 'foret_classee' ? 'Forêt classée' : 'Domaine rural') },
    { cle: 'foret', titre: 'Forêt classée' },
    { cle: 'cours_eau', titre: "Cours d'eau" },
    { cle: 'statut', titre: 'Statut à la date', valeur: (l) => CR.statut(l.statut).libelle },
    { cle: 'date', titre: 'Date de situation', valeur: () => E.date },
    { cle: 'dernier', titre: 'Dernier constat', valeur: (l) => l.dernier?.date || '' },
    { cle: 'source', titre: 'Source du dernier constat', valeur: (l) => CR.SOURCES[l.dernier?.source] || '' },
    { cle: 'superficie_ha', titre: 'Superficie (ha)' },
    { cle: 'priorite', titre: 'Priorité' },
    { cle: 'lat', titre: 'Latitude' },
    { cle: 'lng', titre: 'Longitude' },
    { cle: 'coord_alerte', titre: 'Alerte localisation' },
    { cle: 'observations', titre: 'Observations' },
  ];
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    document.getElementById('menu-export').classList.remove('open');
    const lignes = C.lignesTable();
    if (!lignes.length) {
      GR.toast('Aucun site à exporter', 'warning');
      return;
    }
    const nom = `sites_crloi_goh_${E.date}`;
    const type = b.dataset.export;
    if (type === 'csv') GR.exportCsv(`${nom}.csv`, lignes, COLS_EXPORT);
    if (type === 'xlsx') await GR.exportXlsx(`${nom}.xlsx`, { nom: 'Sites', lignes, colonnes: COLS_EXPORT });
    if (type === 'geojson' || type === 'kml') {
      const feats = lignes
        .filter((l) => l.lat !== null && l.lat !== undefined)
        .map((l) => {
          const props = {};
          COLS_EXPORT.forEach((c) => (props[c.cle] = c.valeur ? c.valeur(l) : l[c.cle]));
          const f = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([l.lng, l.lat])), ...props });
          f.setId(l.id);
          if (type === 'kml') {
            f.set('name', `${l.code} · ${l.localite}`);
            f.setStyle(new ol.style.Style({ image: new ol.style.Circle({ radius: 7, fill: new ol.style.Fill({ color: CR.statut(l.statut).couleur }), stroke: new ol.style.Stroke({ color: '#fff', width: 2 }) }) }));
          }
          return f;
        });
      if (type === 'geojson') {
        const txt = new ol.format.GeoJSON().writeFeatures(feats, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326', decimals: 7 });
        GR.telecharger(`${nom}.geojson`, txt, 'application/geo+json');
      } else {
        const txt = new ol.format.KML({ extractStyles: true }).writeFeatures(feats, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' });
        GR.telecharger(`${nom}.kml`, txt, 'application/vnd.google-earth.kml+xml');
      }
    }
    GR.toast(`${lignes.length} site(s) exporté(s)`);
  });

  /* ------------------------ Requêteur attributaire ------------------- */
  let champs = [];
  let operateurs = [];
  const conteneur = $('#criteres');

  function ligneCritere(c = {}) {
    const champ = champs.find((x) => x.code === c.champ) || champs[0];
    const ops = operateurs.filter((o) => o.types.includes(champ.type));
    const op = ops.find((o) => o.code === c.op) || ops[0];
    const div = document.createElement('div');
    div.className = 'criterion';
    div.innerHTML = `
      <select class="select sm" data-champ>${champs.map((x) => `<option value="${x.code}" ${x.code === champ.code ? 'selected' : ''}>${esc(x.libelle)}</option>`).join('')}</select>
      <select class="select sm" data-op>${ops.map((o) => `<option value="${o.code}" ${o.code === op.code ? 'selected' : ''}>${esc(o.libelle)}</option>`).join('')}</select>
      <button class="btn btn-ghost btn-icon btn-sm del" title="Supprimer le critère"><span class="mi">close</span></button>
      <div class="val"></div>`;
    conteneur.appendChild(div);
    majValeur(div, c.valeur, c.valeur2);
    return div;
  }

  function valeursSuggerees(champ) {
    if (champ === 'statut') return CR.STATUTS.map((x) => x.libelle);
    if (champ === 'source') return Object.values(CR.SOURCES);
    if (['departement', 'sous_prefecture', 'foret', 'cours_eau', 'priorite', 'localite'].includes(champ)) {
      return [...new Set(E.sites.map((x) => x[champ]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'fr'));
    }
    return [];
  }

  function majValeur(div, v = '', v2 = '') {
    const champ = champs.find((x) => x.code === div.querySelector('[data-champ]').value);
    const op = div.querySelector('[data-op]').value;
    const zone = div.querySelector('.val');
    if (op === 'empty' || op === 'nempty') {
      zone.innerHTML = '';
      return;
    }
    const sugg = valeursSuggerees(champ.code);
    const listeId = `sugg-${champ.code}`;
    if (sugg.length && !document.getElementById(listeId)) {
      const dl = document.createElement('datalist');
      dl.id = listeId;
      dl.innerHTML = sugg.map((s) => `<option value="${esc(s)}">`).join('');
      document.body.appendChild(dl);
    }
    const type = champ.type === 'number' && op !== 'in' ? 'number' : 'text';
    const ph = op === 'in' ? 'valeurs séparées par des virgules' : champ.type === 'number' ? 'valeur' : 'texte';
    zone.innerHTML =
      `<input class="input sm" data-v type="${type}" step="any" placeholder="${ph}" value="${esc(v)}" ${sugg.length ? `list="${listeId}"` : ''}>` +
      (op === 'between' ? `<input class="input sm" data-v2 type="number" step="any" placeholder="et" value="${esc(v2)}">` : '');
  }

  champs = [
    { code: 'code', libelle: 'Code du site', type: 'text' },
    { code: 'localite', libelle: 'Localité', type: 'text' },
    { code: 'statut', libelle: 'Statut (à la date)', type: 'text' },
    { code: 'departement', libelle: 'Département', type: 'text' },
    { code: 'sous_prefecture', libelle: 'Sous-préfecture', type: 'text' },
    { code: 'foret', libelle: 'Forêt classée', type: 'text' },
    { code: 'cours_eau', libelle: "Cours d'eau", type: 'text' },
    { code: 'priorite', libelle: 'Priorité', type: 'text' },
    { code: 'source', libelle: 'Source du dernier constat', type: 'text' },
    { code: 'superficie_ha', libelle: 'Superficie (ha)', type: 'number' },
    { code: 'jours', libelle: 'Jours depuis le dernier constat', type: 'number' },
    { code: 'nb_constats', libelle: 'Nombre de constats', type: 'number' },
    { code: 'observations', libelle: 'Observations', type: 'text' },
  ];
  operateurs = [
    { code: 'eq', libelle: 'est égal à', types: ['text', 'number'] },
    { code: 'neq', libelle: 'est différent de', types: ['text', 'number'] },
    { code: 'contains', libelle: 'contient', types: ['text'] },
    { code: 'ncontains', libelle: 'ne contient pas', types: ['text'] },
    { code: 'starts', libelle: 'commence par', types: ['text'] },
    { code: 'in', libelle: 'fait partie de', types: ['text', 'number'] },
    { code: 'gt', libelle: '>', types: ['number'] },
    { code: 'gte', libelle: '≥', types: ['number'] },
    { code: 'lt', libelle: '<', types: ['number'] },
    { code: 'lte', libelle: '≤', types: ['number'] },
    { code: 'between', libelle: 'entre', types: ['number'] },
    { code: 'empty', libelle: 'est vide', types: ['text', 'number'] },
    { code: 'nempty', libelle: "n'est pas vide", types: ['text', 'number'] },
  ];
  const norm = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  function valeurChamp(s, champ) {
    if (champ === 'statut') return s.statut ? CR.statut(s.statut).libelle : '';
    if (champ === 'source') return s.dernier ? CR.SOURCES[s.dernier.source] || s.dernier.source : '';
    if (champ === 'nb_constats') return (s.events || []).filter((e) => e.date <= E.date).length;
    return s[champ];
  }
  function testerCritere(s, c) {
    const def = champs.find((x) => x.code === c.champ);
    const brut = valeurChamp(s, c.champ);
    const vide = brut === null || brut === undefined || brut === '';
    if (c.op === 'empty') return vide;
    if (c.op === 'nempty') return !vide;
    if (vide) return c.op === 'neq' || c.op === 'ncontains';
    if (def.type === 'number') {
      const v = Number(brut);
      const a = Number(String(c.valeur).replace(',', '.'));
      const b = Number(String(c.valeur2).replace(',', '.'));
      if (c.op === 'in') return String(c.valeur).split(/[;,]/).map((x) => Number(x.trim().replace(',', '.'))).includes(v);
      return { eq: v === a, neq: v !== a, gt: v > a, gte: v >= a, lt: v < a, lte: v <= a, between: v >= Math.min(a, b) && v <= Math.max(a, b) }[c.op] ?? false;
    }
    const v = norm(brut);
    const a = norm(c.valeur);
    if (c.op === 'in') return String(c.valeur).split(/[;,]/).map(norm).includes(v);
    return { eq: v === a, neq: v !== a, contains: v.includes(a), ncontains: !v.includes(a), starts: v.startsWith(a) }[c.op] ?? false;
  }
  C.testerRequete = (s) => (E.mode === 'OU' ? E.criteres.some((c) => testerCritere(s, c)) : E.criteres.every((c) => testerCritere(s, c)));
  C.initRequeteur = () => {
    if (!conteneur.children.length) ligneCritere();
  };
  conteneur.addEventListener('change', (e) => {
    const div = e.target.closest('.criterion');
    if (!div) return;
    if (e.target.matches('[data-champ]')) {
      const c = { champ: e.target.value };
      const nouveau = ligneCritere(c);
      div.replaceWith(nouveau);
    } else if (e.target.matches('[data-op]')) majValeur(div, div.querySelector('[data-v]')?.value || '');
  });
  conteneur.addEventListener('click', (e) => {
    if (e.target.closest('.del')) {
      e.target.closest('.criterion').remove();
      if (!conteneur.children.length) ligneCritere();
    }
  });
  conteneur.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) $('#lancer-requete').click();
  });
  $('#ajout-critere').addEventListener('click', () => ligneCritere());
  $('#mode-requete').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    E.mode = b.dataset.mode;
    $$('#mode-requete button').forEach((x) => x.classList.toggle('active', x === b));
  });

  function lireCriteres() {
    return $$('.criterion', conteneur)
      .map((d) => ({
        champ: d.querySelector('[data-champ]').value,
        op: d.querySelector('[data-op]').value,
        valeur: d.querySelector('[data-v]')?.value ?? '',
        valeur2: d.querySelector('[data-v2]')?.value ?? '',
      }))
      .filter((c) => ['empty', 'nempty'].includes(c.op) || String(c.valeur).trim() !== '');
  }

  $('#lancer-requete').addEventListener('click', async () => {
    E.criteres = lireCriteres();
    if (!E.criteres.length) {
      GR.toast('Renseignez au moins un critère', 'warning');
      return;
    }
    E.requeteActive = true;
    C.toutMettreAJour({ ajuster: true });
    const n = C.sitesFiltres().length;
    $('#requete-resultat').innerHTML = `<div class="alert ${n ? 'success' : 'warning'}"><span class="mi">${n ? 'task_alt' : 'search_off'}</span>
      <div><strong>${n} site(s)</strong> correspondent à la requête au ${CR.date(E.date)}.${n ? ' <a href="#" data-voir-table>Voir la table</a>' : ''}</div></div>`;
  });
  $('#requete-resultat').addEventListener('click', (e) => {
    if (e.target.closest('[data-voir-table]')) {
      e.preventDefault();
      C.ouvrirTable(true);
    }
  });
  C.viderRequete = () => {
    E.criteres = [];
    E.requeteActive = false;
    conteneur.innerHTML = '';
    ligneCritere();
    $('#requete-resultat').innerHTML = '';
  };
  $('#effacer-requete').addEventListener('click', () => {
    const etaitActive = E.requeteActive;
    C.viderRequete();
    if (etaitActive) C.toutMettreAJour({ ajuster: true });
  });
})();
