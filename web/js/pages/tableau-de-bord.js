/* =====================================================================
   CRLOI GÔH — Tableau de bord des indicateurs (BRQ, rapports, fiches)
   Construit sur le modèle des statistiques multicritères de GestReb.
   ===================================================================== */
(function () {
  'use strict';
  const { esc, fmt, $, $$ } = GR;
  const CIBLES = { neutralisation: 70, recolonisation: 10 };
  const vues = { evolution: 'bar', territoire: 'bar' };
  const D = { sites: [], brq: [], fiches: [], cours: [] };
  let R = null; // résultats calculés pour la sélection

  /* ----------------------------- Filtres ----------------------------- */
  const ms = {};
  function filtres() {
    return {
      departements: $$('#f-departements input:checked').map((i) => i.value),
      domaines: $$('#f-domaines input:checked').map((i) => i.value),
      sp: ms.sp ? ms.sp.values() : [],
      date: $('#f-date').value || CR.aujourdhui(),
      debut: $('#f-debut').value,
    };
  }
  function libellesFiltres(f) {
    const l = [];
    if (f.departements.length < 2) l.push({ cle: 'departements', txt: `Département : ${f.departements.join(', ') || 'aucun'}` });
    if (f.domaines.length < 2) l.push({ cle: 'domaines', txt: `Domaine : ${f.domaines.map((d) => (d === 'rural' ? 'rural' : 'forêts classées')).join(', ') || 'aucun'}` });
    if (f.sp.length) l.push({ cle: 'sp', txt: `Sous-préfectures : ${f.sp.length > 3 ? `${f.sp.length} sélectionnées` : f.sp.join(', ')}` });
    return l;
  }
  function majFiltresActifs(f) {
    const l = libellesFiltres(f);
    $('#filtres-actifs').innerHTML = l.length
      ? l.map((x) => `<span class="filtre-actif">${esc(x.txt)}<button data-retirer="${x.cle}" aria-label="Retirer"><span class="mi mi-sm">close</span></button></span>`).join('')
      : `<span class="muted" style="font-size:12.5px"><span class="mi mi-sm">info</span> Toute la région du Gôh · situation au ${CR.date(f.date)}.</span>`;
    $('#print-criteres').textContent = `${l.length ? l.map((x) => x.txt).join(' · ') : 'Toute la région'} — situation au ${CR.date(f.date)}`;
  }
  $('#filtres-actifs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-retirer]');
    if (!b) return;
    const k = b.dataset.retirer;
    if (k === 'departements' || k === 'domaines') $$(`#f-${k} input`).forEach((i) => ((i.checked = true), i.closest('.chip').classList.add('on')));
    if (ms[k]) ms[k].set([]);
    calculer();
  });
  const calculerDiffere = GR.debounce(() => calculer(), 200);
  ['#f-departements', '#f-domaines'].forEach((s) =>
    $(s).addEventListener('change', (e) => {
      e.target.closest('.chip').classList.toggle('on', e.target.checked);
      calculerDiffere();
    })
  );
  $('#f-date').addEventListener('change', () => {
    if ($('#f-date').value) CR.dateVue.set($('#f-date').value);
    calculer();
  });
  $('#f-debut').addEventListener('change', calculerDiffere);
  $('#f-aujourdhui').addEventListener('click', () => {
    $('#f-date').value = CR.aujourdhui();
    CR.dateVue.set($('#f-date').value);
    calculer();
  });
  $('#reinitialiser').addEventListener('click', () => {
    $$('#f-departements input, #f-domaines input').forEach((i) => ((i.checked = true), i.closest('.chip').classList.add('on')));
    ms.sp?.set([]);
    $('#f-date').value = CR.aujourdhui();
    CR.dateVue.set($('#f-date').value);
    $('#f-debut').value = premiereDate();
    calculer();
  });
  $('#imprimer').addEventListener('click', () => window.print());
  $('#voir-carte').addEventListener('click', () => CR.dateVue.set(filtres().date));

  function allerAuJour(iso) {
    $('#f-date').value = iso > CR.aujourdhui() ? CR.aujourdhui() : iso;
    CR.dateVue.set($('#f-date').value);
    calculer();
  }

  /* ---------------------------- Calculs ------------------------------ */
  const premiereDate = () => {
    const d = D.sites.flatMap((s) => (s.events || []).map((e) => e.date)).concat(D.brq.map((b) => b.date)).sort();
    return d[0] || CR.aujourdhui();
  };
  const estActif = (st) => st === 'actif' || st === 'recolonise';

  function calculer() {
    const f = filtres();
    majFiltresActifs(f);
    const d = f.date;
    const debut = f.debut && f.debut <= d ? f.debut : premiereDate();
    const finSeries = d > CR.aujourdhui() ? d : CR.aujourdhui();

    const sites = D.sites.filter(
      (s) => f.departements.includes(s.departement) && f.domaines.includes(s.domaine) && (!f.sp.length || f.sp.includes(s.sous_prefecture || '—'))
    );
    const idsSites = new Set(sites.map((s) => s.id));
    const visitesToutes = D.brq.flatMap((b) => (b.visites || []).map((v) => ({ ...v, date: b.date }))).filter((v) => v.site_id && idsSites.has(v.site_id));
    const visites = visitesToutes.filter((v) => v.date >= debut && v.date <= d);
    const lignes = sites
      .map((s) => {
        const dernier = CR.dernierEvenement(s.events, d);
        const vs = visites.filter((v) => v.site_id === s.id);
        return {
          ...s,
          statut: dernier ? dernier.statut : null,
          dernier,
          jours: dernier ? CR.ecartJours(dernier.date, d) : null,
          visites: vs.length,
          tentatives: vs.filter((v) => v.constat === 'tentative_reprise').length,
          interpelles: vs.reduce((t, v) => t + (v.interpelles || 0), 0),
        };
      })
      .filter((s) => s.statut);

    // Indicateurs
    const actifs = lignes.filter((s) => estActif(s.statut)).length;
    const neutr = lignes.length ? ((lignes.length - actifs) / lignes.length) * 100 : null;
    let eligibles = 0;
    let repris = 0;
    sites.forEach((s) => {
      const evs = (s.events || []).filter((e) => e.date <= d);
      const dem = evs.filter((e) => e.statut === 'demantele' && e.date <= CR.ajouterJours(d, -90));
      if (!dem.length) return;
      const t0 = dem[dem.length - 1].date;
      eligibles += 1;
      if (evs.some((e) => estActif(e.statut) && e.date > t0 && e.date <= CR.ajouterJours(t0, 90))) repris += 1;
    });
    const recol = eligibles ? (repris / eligibles) * 100 : null;
    const d30 = CR.ajouterJours(d, -30);
    const tent30 = visitesToutes.filter((v) => v.date > d30 && v.date <= d && v.constat === 'tentative_reprise').length;
    const saisiesTot = {};
    visites.forEach((v) => Object.entries(v.saisies || {}).forEach(([k, n]) => (saisiesTot[k] = (saisiesTot[k] || 0) + (Number(n) || 0))));
    const objets = Object.entries(saisiesTot)
      .filter(([k]) => k !== 'tuyaux_m')
      .reduce((t, [, n]) => t + n, 0);
    const interp = visites.reduce((t, v) => t + (v.interpelles || 0), 0);
    const joursBrq = new Set(D.brq.map((b) => b.date));
    const brq7 = [...joursBrq].filter((x) => x > CR.ajouterJours(d, -7) && x <= d).length;
    const nbJoursPeriode = CR.ecartJours(debut, d) + 1;
    const brqPeriode = [...joursBrq].filter((x) => x >= debut && x <= d).length;

    // Séries hebdomadaires
    const semaines = [];
    for (let w = CR.lundi(debut); w <= finSeries; w = CR.ajouterJours(w, 7)) {
      const fin = CR.ajouterJours(w, 6) < finSeries ? CR.ajouterJours(w, 6) : finSeries;
      const vs = visitesToutes.filter((v) => v.date >= w && v.date <= fin);
      const parStatut = {};
      CR.STATUTS.forEach((s) => (parStatut[s.cle] = 0));
      sites.forEach((s) => {
        const st = CR.statutA(s.events, fin);
        if (st) parStatut[st] = (parStatut[st] || 0) + 1;
      });
      const sais = {};
      vs.forEach((v) => Object.entries(v.saisies || {}).forEach(([k, n]) => (sais[k] = (sais[k] || 0) + (Number(n) || 0))));
      const jours = [];
      for (let j = 0; j < 7; j += 1) {
        const x = CR.ajouterJours(w, j);
        jours.push(x > finSeries ? null : joursBrq.has(x) ? 1 : 0);
      }
      semaines.push({
        semaine: w,
        fin,
        libelle: `${w.slice(8, 10)}/${w.slice(5, 7)}`,
        visites: vs.length,
        tentatives: vs.filter((v) => v.constat === 'tentative_reprise').length,
        interpelles: vs.reduce((t, v) => t + (v.interpelles || 0), 0),
        objets: Object.entries(sais)
          .filter(([k]) => k !== 'tuyaux_m')
          .reduce((t, [, n]) => t + n, 0),
        parStatut,
        jours,
      });
    }
    const semaineSel = semaines.find((s) => s.semaine <= d && d <= s.fin);

    const fiches = D.fiches.filter((x) => x.date_recu <= d && f.departements.includes(x.departement));

    R = { f, d, debut, sites, lignes, visites, actifs, neutr, recol, eligibles, tent30, saisiesTot, objets, interp, brq7, brqPeriode, nbJoursPeriode, semaines, semaineSel, fiches };
    rendre();
  }

  /* ------------------------------ KPIs ------------------------------- */
  function kpi(icone, couleur, libelle, valeur, unite, pied, progression, cible) {
    return `<div class="kpi"><div class="kpi-icon ${couleur}"><span class="mi">${icone}</span></div><div style="min-width:0;flex:1">
      <div class="kpi-label">${libelle}</div><div class="kpi-value">${valeur}${unite ? `<small>${unite}</small>` : ''}</div>
      ${pied ? `<div class="kpi-foot">${pied}</div>` : ''}
      ${
        progression !== undefined && progression !== null
          ? `<div class="progress ${couleur === 'amber' ? 'amber' : couleur === 'red' ? 'red' : ''}" style="position:relative"><span style="width:${Math.min(100, progression)}%"></span>${
              cible !== undefined ? `<b style="position:absolute;top:-3px;bottom:-3px;left:${cible}%;width:2px;background:var(--gray-700)" title="Cible"></b>` : ''
            }</div>`
          : ''
      }</div></div>`;
  }
  function rendreKpis() {
    const r = R;
    $('#kpis').innerHTML = [
      kpi('location_on', '', 'Sites recensés', fmt.n(r.lignes.length), '', `${r.actifs} actif(s) ou recolonisé(s) · ${r.lignes.length - r.actifs} neutralisé(s)`),
      kpi(
        'verified',
        r.neutr === null ? 'gray' : r.neutr >= CIBLES.neutralisation ? '' : 'amber',
        'Taux de neutralisation',
        r.neutr === null ? '—' : fmt.n(r.neutr, 0),
        r.neutr === null ? '' : '%',
        `cible : ${CIBLES.neutralisation} % au moins`,
        r.neutr ?? undefined,
        CIBLES.neutralisation
      ),
      kpi(
        'restart_alt',
        r.recol === null ? 'gray' : r.recol <= CIBLES.recolonisation ? '' : 'red',
        'Recolonisation à 3 mois',
        r.recol === null ? '—' : fmt.n(r.recol, 0),
        r.recol === null ? '' : '%',
        r.recol === null ? 'mesurable 90 jours après un démantèlement' : `${r.eligibles} site(s) mesuré(s) · cible ≤ ${CIBLES.recolonisation} %`
      ),
      kpi('warning', r.tent30 ? 'amber' : '', 'Tentatives de reprise (30 j)', fmt.n(r.tent30), '', 'constatées dans les BRQ'),
      kpi('directions_walk', 'blue', 'Contrôles de terrain', fmt.n(r.visites.length), '', `${new Set(r.visites.map((v) => v.site_id)).size} site(s) distinct(s) depuis le ${CR.date(r.debut)}`),
      kpi('construction', 'violet', 'Matériel saisi', fmt.n(r.objets), 'objets', r.saisiesTot.tuyaux_m ? `et ${fmt.n(r.saisiesTot.tuyaux_m)} m de tuyaux` : 'tuyaux non comptés'),
      kpi('gavel', 'red', 'Personnes interpellées', fmt.n(r.interp), '', 'sur la période'),
      kpi(
        'event_available',
        r.brq7 >= 7 ? '' : r.brq7 >= 4 ? 'amber' : 'red',
        'BRQ reçus (7 j)',
        `${r.brq7} / 7`,
        '',
        `${fmt.pct(r.nbJoursPeriode ? (r.brqPeriode / r.nbJoursPeriode) * 100 : 0, 0)} des jours couverts sur la période`,
        (r.brq7 / 7) * 100
      ),
    ].join('');
  }

  /* --------------------------- Graphiques ---------------------------- */
  const repere = () =>
    R.semaineSel
      ? { xaxis: [{ x: R.semaineSel.libelle, borderColor: '#0f4c3a', strokeDashArray: 4, label: { text: `au ${CR.date(R.d)}`, style: { background: '#0f4c3a', color: '#fff', fontSize: '10.5px' } } }] }
      : {};
  const clicSemaine = {
    dataPointSelection: (e, ctx, o) => {
      const s = R.semaines[o.dataPointIndex];
      if (s) allerAuJour(s.fin);
    },
    markerClick: (e, ctx, o) => {
      const s = R.semaines[o.dataPointIndex];
      if (s) allerAuJour(s.fin);
    },
  };

  function gEvolution() {
    const S = R.semaines;
    GR.chart('g-evolution', {
      chart: { type: vues.evolution, height: 330, stacked: true, events: clicSemaine },
      series: CR.STATUTS.map((s) => ({ name: s.libelle, data: S.map((w) => w.parStatut[s.cle] || 0) })),
      colors: CR.STATUTS.map((s) => s.couleur),
      xaxis: { categories: S.map((w) => w.libelle), title: { text: 'Semaine du' } },
      yaxis: { title: { text: 'Sites' }, labels: { formatter: (v) => fmt.n(v) } },
      plotOptions: { bar: { columnWidth: '60%', borderRadius: 2 } },
      stroke: { width: vues.evolution === 'area' ? 1.5 : 0, curve: 'smooth' },
      fill: { opacity: vues.evolution === 'area' ? 0.75 : 1 },
      annotations: repere(),
      legend: { position: 'top' },
      tooltip: { shared: true, intersect: false, y: { formatter: (v) => `${v} site(s)` } },
    });
  }

  function gStatuts() {
    $('#t-date').textContent = CR.date(R.d);
    const cats = CR.STATUTS.map((s) => ({ ...s, n: R.lignes.filter((l) => l.statut === s.cle).length })).filter((c) => c.n);
    GR.chart('g-statuts', {
      chart: { type: 'donut', height: 330 },
      series: cats.map((c) => c.n),
      labels: cats.map((c) => c.libelle),
      colors: cats.map((c) => c.couleur),
      legend: { position: 'bottom' },
      dataLabels: { enabled: true, formatter: (v) => `${Math.round(v)} %` },
      tooltip: { y: { formatter: (v) => `${v} site(s)` } },
      plotOptions: { pie: { donut: { size: '58%', labels: { show: true, total: { show: true, label: 'Sites', formatter: (w) => w.globals.seriesTotals.reduce((a, b) => a + b, 0) } } } } },
    });
  }

  function gControles() {
    const S = R.semaines;
    GR.chart('g-controles', {
      chart: { type: 'line', height: 320, events: clicSemaine },
      series: [
        { name: 'Visites de sites', type: 'column', data: S.map((w) => w.visites) },
        { name: 'Tentatives de reprise', type: 'line', data: S.map((w) => w.tentatives) },
      ],
      colors: ['#0891b2', '#f97316'],
      stroke: { width: [0, 3], curve: 'smooth' },
      markers: { size: [0, 5] },
      xaxis: { categories: S.map((w) => w.libelle) },
      yaxis: [
        { title: { text: 'Visites' }, labels: { formatter: (v) => fmt.n(v) } },
        { opposite: true, title: { text: 'Tentatives' }, labels: { formatter: (v) => fmt.n(v) } },
      ],
      plotOptions: { bar: { columnWidth: '50%', borderRadius: 3 } },
      annotations: repere(),
      legend: { position: 'top' },
      tooltip: { shared: true, intersect: false },
    });
  }

  function gObjectifs() {
    const n = R.neutr ?? 0;
    const controles = R.lignes.length ? (R.lignes.filter((l) => l.dernier && l.jours <= 30).length / R.lignes.length) * 100 : 0;
    const brq = R.nbJoursPeriode ? (R.brqPeriode / R.nbJoursPeriode) * 100 : 0;
    GR.chart('g-objectifs', {
      chart: { type: 'radialBar', height: 340 },
      series: [Math.round(n), Math.round(controles), Math.round(brq)],
      labels: ['Neutralisation (cible 70 %)', 'Sites constatés < 30 j', 'Jours couverts par un BRQ'],
      colors: [n >= CIBLES.neutralisation ? '#15803d' : '#d97706', '#2563eb', '#0891b2'],
      plotOptions: {
        radialBar: {
          hollow: { size: '30%' },
          track: { background: '#f1f5f9', margin: 4 },
          dataLabels: { name: { fontSize: '12px' }, value: { fontSize: '16px', formatter: (v) => `${fmt.n(v, 0)} %` }, total: { show: true, label: 'Neutralisation', formatter: () => `${fmt.n(n, 0)} %` } },
        },
      },
      legend: { show: true, position: 'bottom', fontSize: '11px', formatter: (nom, o) => `${nom} : ${fmt.n(o.w.globals.series[o.seriesIndex], 0)} %` },
    });
  }

  function gTerritoire() {
    const sps = [...new Set(R.lignes.map((l) => l.sous_prefecture || 'Non renseignée'))].sort((a, b) => a.localeCompare(b, 'fr'));
    if (vues.territoire === 'treemap') {
      return GR.chart('g-territoire', {
        chart: { type: 'treemap', height: 340 },
        series: [{ data: R.lignes.map((l) => ({ x: `${l.code} · ${l.localite}`, y: Math.max(1, Number(l.superficie_ha) || 1), fillColor: CR.statut(l.statut).couleur })) }],
        plotOptions: { treemap: { distributed: false, enableShades: false } },
        dataLabels: { enabled: true, style: { fontSize: '11.5px' } },
        tooltip: { y: { formatter: (v, o) => `${CR.statut(R.lignes[o.dataPointIndex].statut).libelle}${R.lignes[o.dataPointIndex].superficie_ha ? ` · ${fmt.ha(v)}` : ''}` } },
        legend: { show: false },
      });
    }
    return GR.chart('g-territoire', {
      chart: { type: 'bar', height: Math.max(300, sps.length * 34 + 80), stacked: true },
      series: CR.STATUTS.map((s) => ({ name: s.libelle, data: sps.map((sp) => R.lignes.filter((l) => (l.sous_prefecture || 'Non renseignée') === sp && l.statut === s.cle).length) })),
      colors: CR.STATUTS.map((s) => s.couleur),
      xaxis: { categories: sps, labels: { formatter: (v) => fmt.n(v) } },
      plotOptions: { bar: { horizontal: true, barHeight: '65%', borderRadius: 2 } },
      legend: { position: 'top' },
      tooltip: { shared: true, intersect: false, y: { formatter: (v) => `${v} site(s)` } },
    });
  }

  function gSaisies() {
    const S = R.semaines;
    GR.chart('g-saisies', {
      chart: { type: 'line', height: 320, events: clicSemaine },
      series: [
        { name: 'Objets saisis', type: 'column', data: S.map((w) => w.objets) },
        { name: 'Personnes interpellées', type: 'line', data: S.map((w) => w.interpelles) },
      ],
      colors: ['#9333ea', '#dc2626'],
      stroke: { width: [0, 3], curve: 'smooth' },
      markers: { size: [0, 5] },
      xaxis: { categories: S.map((w) => w.libelle) },
      yaxis: { labels: { formatter: (v) => fmt.n(v) } },
      plotOptions: { bar: { columnWidth: '50%', borderRadius: 3 } },
      annotations: repere(),
      legend: { position: 'top' },
      tooltip: { shared: true, intersect: false },
    });
  }

  function gSaisiesType() {
    const d = Object.entries(R.saisiesTot)
      .filter(([, n]) => n)
      .sort((a, b) => b[1] - a[1]);
    $('#sub-saisies').textContent = `depuis le ${CR.date(R.debut)}`;
    GR.chart('g-saisies-type', {
      chart: { type: 'bar', height: 320 },
      series: [{ name: 'Quantité', data: d.map(([, n]) => n) }],
      xaxis: { categories: d.map(([k]) => CR.SAISIES[k] || k), labels: { formatter: (v) => fmt.n(v) } },
      colors: ['#9333ea'],
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: '60%' } },
      dataLabels: { enabled: true, textAnchor: 'start', offsetX: 4, style: { colors: ['#0f172a'], fontSize: '11px' }, dropShadow: { enabled: false } },
      tooltip: { y: { formatter: (v, o) => `${fmt.n(v)} ${d[o.dataPointIndex][0] === 'tuyaux_m' ? 'm' : ''}` } },
    });
  }

  function gBrq() {
    const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const S = R.semaines;
    GR.chart('g-brq', {
      chart: { type: 'heatmap', height: 300, events: clicSemaine },
      series: JOURS.map((j, i) => ({ name: j, data: S.map((w) => ({ x: w.libelle, y: w.jours[i] === null ? -1 : w.jours[i] })) })).reverse(),
      dataLabels: { enabled: false },
      plotOptions: {
        heatmap: {
          radius: 3,
          enableShades: false,
          colorScale: {
            ranges: [
              { from: -1, to: -1, color: '#ffffff', name: 'à venir' },
              { from: 0, to: 0, color: '#fecaca', name: 'sans BRQ' },
              { from: 1, to: 1, color: '#15803d', name: 'BRQ reçu' },
            ],
          },
        },
      },
      stroke: { width: 2, colors: ['#fff'] },
      tooltip: { y: { formatter: (v) => (v === 1 ? 'BRQ reçu' : v === 0 ? 'Aucun BRQ' : '—') } },
      legend: { position: 'bottom' },
    });
  }

  function gDomaines() {
    const rural = R.lignes.filter((l) => l.domaine !== 'foret_classee');
    const fc = R.lignes.filter((l) => l.domaine === 'foret_classee');
    const parForet = {};
    fc.forEach((l) => (parForet[l.foret || 'FC non précisée'] = (parForet[l.foret || 'FC non précisée'] || 0) + 1));
    const labels = ['Domaine rural', ...Object.keys(parForet).map((f) => `FC ${f}`)];
    const series = [rural.length, ...Object.values(parForet)];
    GR.chart('g-domaines', {
      chart: { type: 'pie', height: 330 },
      series,
      labels,
      colors: ['#d97706', '#15803d', '#166534', '#22c55e', '#4d7c0f', '#65a30d', '#0f766e'],
      legend: { position: 'bottom' },
      dataLabels: { enabled: true, formatter: (v) => `${Math.round(v)} %` },
      tooltip: { y: { formatter: (v) => `${v} site(s)` } },
    });
  }

  function gCours() {
    const ORDRE = { tres_impacte: 0, impacte: 1, faible: 2 };
    const COUL = { tres_impacte: '#dc2626', impacte: '#f97316', faible: '#eab308' };
    const LIB = { tres_impacte: 'Très impacté', impacte: 'Impacté', faible: 'Faiblement impacté' };
    const d = [...D.cours].sort((a, b) => (ORDRE[a.intensite] ?? 9) - (ORDRE[b.intensite] ?? 9) || (b.longueur_km || 0) - (a.longueur_km || 0));
    GR.chart('g-cours', {
      chart: { type: 'bar', height: 320 },
      series: [{ name: 'Longueur (km)', data: d.map((c) => c.longueur_km || 0) }],
      xaxis: { categories: d.map((c) => c.nom) },
      colors: d.map((c) => COUL[c.intensite] || '#0ea5e9'),
      plotOptions: { bar: { distributed: true, borderRadius: 4, columnWidth: '55%' } },
      legend: { show: false },
      dataLabels: { enabled: true, formatter: (v) => (v ? fmt.n(v, 1) : ''), offsetY: -18, style: { colors: ['#334155'], fontSize: '11px' } },
      tooltip: { y: { formatter: (v, o) => `${fmt.n(v, 2)} km · ${LIB[d[o.dataPointIndex].intensite] || 'intensité non renseignée'}` } },
    });
  }

  function gFiches() {
    const ST = { a_verifier: ['À vérifier', '#eab308'], en_cours: ['En cours', '#0284c7'], confirmee: ['Confirmée', '#dc2626'], infirmee: ['Infirmée', '#64748b'], exploitee: ['Exploitée', '#15803d'] };
    const n = {};
    R.fiches.forEach((x) => (n[x.statut] = (n[x.statut] || 0) + 1));
    const cles = Object.keys(ST).filter((k) => n[k]);
    $('#sub-fiches').textContent = `${R.fiches.length} fiche(s) reçue(s)`;
    GR.chart('g-fiches', {
      chart: { type: 'donut', height: 320 },
      series: cles.map((k) => n[k]),
      labels: cles.map((k) => ST[k][0]),
      colors: cles.map((k) => ST[k][1]),
      legend: { position: 'bottom' },
      dataLabels: { enabled: true, formatter: (v) => `${Math.round(v)} %` },
      noData: { text: 'Aucune fiche reçue à cette date' },
      plotOptions: { pie: { donut: { size: '58%', labels: { show: true, total: { show: true, label: 'Fiches', formatter: (w) => w.globals.seriesTotals.reduce((a, b) => a + b, 0) } } } } },
    });
  }

  /* -------------------------- Tableau croisé ------------------------- */
  const NOMS = { sous_prefecture: 'Sous-préfecture', departement: 'Département', domaine: 'Domaine', foret: 'Forêt classée', cours_eau: "Cours d'eau", statut: 'Statut', priorite: 'Priorité' };
  const libelleDim = (l, dim) => {
    if (dim === 'statut') return CR.statut(l.statut).libelle;
    if (dim === 'domaine') return l.domaine === 'foret_classee' ? 'Forêt classée' : 'Domaine rural';
    if (dim === 'priorite') return l.priorite === 'haute' ? 'Haute' : 'Normale';
    return String(l[dim] || 'Non renseigné');
  };
  function tableauCroise() {
    const lignesDim = $('#tc-lignes').value;
    let colonnesDim = $('#tc-colonnes').value;
    if (colonnesDim === lignesDim) colonnesDim = lignesDim === 'statut' ? 'departement' : 'statut';
    const mesure = $('#tc-mesure').value;
    const val = (l) => (mesure === 'sites' ? 1 : mesure === 'superficie' ? Number(l.superficie_ha) || 0 : Number(l[mesure]) || 0);
    const rows = R.lignes;
    const ordreStatut = (a, b) => CR.STATUTS.findIndex((s) => s.libelle === a) - CR.STATUTS.findIndex((s) => s.libelle === b);
    const tri = (dim) => (dim === 'statut' ? ordreStatut : (a, b) => a.localeCompare(b, 'fr', { numeric: true }));
    const L = [...new Set(rows.map((l) => libelleDim(l, lignesDim)))].sort(tri(lignesDim));
    const Co = [...new Set(rows.map((l) => libelleDim(l, colonnesDim)))].sort(tri(colonnesDim));
    const m = new Map();
    rows.forEach((l) => {
      const k = `${libelleDim(l, lignesDim)}|${libelleDim(l, colonnesDim)}`;
      m.set(k, (m.get(k) || 0) + val(l));
    });
    const dec = mesure === 'superficie' ? 2 : 0;
    const total = (fn) => [...m.entries()].filter(([k]) => fn(k)).reduce((s, [, v]) => s + v, 0);
    const max = Math.max(1, ...m.values());
    const cellule = (v) => `<td class="heat" style="background:${v ? `rgba(22,163,74,${0.08 + (v / max) * 0.45})` : 'transparent'}">${v ? fmt.n(v, dec) : '<span class="muted">·</span>'}</td>`;
    $('#tableau-croise').innerHTML = rows.length
      ? `<table class="table compact pivot"><thead><tr><th>${NOMS[lignesDim]} \\ ${NOMS[colonnesDim]}</th>${Co.map((c) => `<th class="num">${esc(c)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>${L.map(
          (l) => `<tr><td>${esc(l)}</td>${Co.map((c) => cellule(m.get(`${l}|${c}`) || 0)).join('')}<td class="num cell-strong">${fmt.n(total((k) => k.startsWith(`${l}|`)), dec)}</td></tr>`
        ).join('')}</tbody><tfoot><tr><td>Total</td>${Co.map((c) => `<td class="num">${fmt.n(total((k) => k.endsWith(`|${c}`)), dec)}</td>`).join('')}<td class="num">${fmt.n(total(() => true), dec)}</td></tr></tfoot></table>`
      : '<div class="empty"><span class="mi">inbox</span><h3>Aucun site pour cette sélection</h3></div>';
    return { L, Co, m, lignesDim, total };
  }
  ['#tc-lignes', '#tc-colonnes', '#tc-mesure'].forEach((s) => $(s).addEventListener('change', tableauCroise));
  $('#tc-export').addEventListener('click', () => {
    const t = tableauCroise();
    const lignes = t.L.map((l) => {
      const o = { [NOMS[t.lignesDim]]: l };
      t.Co.forEach((c) => (o[c] = Math.round((t.m.get(`${l}|${c}`) || 0) * 100) / 100));
      o.Total = Math.round(t.total((k) => k.startsWith(`${l}|`)) * 100) / 100;
      return o;
    });
    GR.exportXlsx(`tableau_croise_crloi_${R.d}.xlsx`, { nom: 'Tableau croisé', lignes });
  });

  /* ----------------------------- Liste ------------------------------- */
  const tableListe = GR.table('#liste-sites', {
    colonnes: [
      { cle: 'code', titre: 'Code', rendu: (l) => `<strong>${esc(l.code)}</strong>` },
      { cle: 'localite', titre: 'Localité' },
      { cle: 'sous_prefecture', titre: 'Sous-préfecture' },
      { cle: 'domaine', titre: 'Domaine', tri: (l) => libelleDim(l, 'domaine'), rendu: (l) => (l.domaine === 'foret_classee' ? `FC ${esc(l.foret || '')}` : 'Rural') },
      { cle: 'statut', titre: 'Statut', tri: (l) => CR.statut(l.statut).libelle, rendu: (l) => CR.badgeStatut(l.statut) },
      { cle: 'jours', titre: 'Dernier constat', num: true, rendu: (l) => (l.dernier ? `${CR.date(l.dernier.date)} <span class="muted">(${l.jours} j)</span>` : '—') },
      { cle: 'visites', titre: 'Visites', num: true },
      { cle: 'tentatives', titre: 'Tentatives', num: true, rendu: (l) => (l.tentatives ? `<span class="badge amber">${l.tentatives}</span>` : '0') },
      { cle: 'interpelles', titre: 'Interpellés', num: true },
      {
        cle: 'act',
        titre: '',
        trier: false,
        rendu: (l) =>
          `<span class="row nowrap">${l.lat !== null && l.lat !== undefined ? `<a class="btn btn-ghost btn-sm btn-icon" href="/carte.html?site=${encodeURIComponent(l.id)}" data-carte title="Voir sur la carte"><span class="mi">map</span></a>` : ''}<a class="btn btn-ghost btn-sm btn-icon" href="/sites.html#${encodeURIComponent(l.id)}" title="Registre"><span class="mi">edit</span></a></span>`,
      },
    ],
    lignes: [],
    compact: true,
    tri: 'code',
  });
  $('#liste-sites').addEventListener('click', (e) => {
    if (e.target.closest('[data-carte]')) CR.dateVue.set(R.d);
  });
  function majListe() {
    const q = $('#liste-recherche').value.trim().toLowerCase();
    const l = R.lignes.filter((s) => !q || [s.code, s.localite, s.sous_prefecture, s.foret, s.cours_eau, CR.statut(s.statut).libelle].some((v) => String(v ?? '').toLowerCase().includes(q)));
    tableListe.maj(l);
    $('#nb-liste').textContent = l.length;
  }
  $('#liste-recherche').addEventListener('input', GR.debounce(majListe, 200));

  /* ----------------------------- Rendu ------------------------------- */
  function rendre() {
    rendreKpis();
    gEvolution();
    gStatuts();
    gControles();
    gObjectifs();
    gTerritoire();
    gSaisies();
    gSaisiesType();
    gBrq();
    gDomaines();
    gCours();
    gFiches();
    tableauCroise();
    majListe();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bascule] button');
    if (!b) return;
    const groupe = b.closest('[data-bascule]');
    $$('button', groupe).forEach((x) => x.classList.toggle('active', x === b));
    vues[groupe.dataset.bascule] = b.dataset.v;
    if (groupe.dataset.bascule === 'evolution') gEvolution();
    if (groupe.dataset.bascule === 'territoire') gTerritoire();
  });

  /* ----------------------------- Exports ----------------------------- */
  const COLS = [
    { cle: 'code', titre: 'Code' },
    { cle: 'localite', titre: 'Localité' },
    { cle: 'departement', titre: 'Département' },
    { cle: 'sous_prefecture', titre: 'Sous-préfecture' },
    { cle: 'domaine', titre: 'Domaine', valeur: (l) => libelleDim(l, 'domaine') },
    { cle: 'foret', titre: 'Forêt classée' },
    { cle: 'cours_eau', titre: "Cours d'eau" },
    { cle: 'statut', titre: 'Statut', valeur: (l) => CR.statut(l.statut).libelle },
    { cle: 'dernier', titre: 'Dernier constat', valeur: (l) => l.dernier?.date || '' },
    { cle: 'visites', titre: 'Visites (période)' },
    { cle: 'tentatives', titre: 'Tentatives de reprise (période)' },
    { cle: 'interpelles', titre: 'Interpellés (période)' },
    { cle: 'superficie_ha', titre: 'Superficie (ha)' },
    { cle: 'lat', titre: 'Latitude' },
    { cle: 'lng', titre: 'Longitude' },
  ];
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-export]');
    if (!b || !R) return undefined;
    $('#menu-export').classList.remove('open');
    if (b.dataset.export === 'csv') return GR.exportCsv(`sites_crloi_goh_${R.d}.csv`, R.lignes, COLS);
    return GR.exportXlsx(`tableau_de_bord_crloi_goh_${R.d}.xlsx`, [
      {
        nom: 'Synthèse',
        lignes: [
          { Indicateur: 'Critères', Valeur: $('#print-criteres').textContent },
          { Indicateur: 'Sites recensés', Valeur: R.lignes.length },
          { Indicateur: 'Sites actifs ou recolonisés', Valeur: R.actifs },
          { Indicateur: 'Taux de neutralisation (%)', Valeur: R.neutr === null ? '' : Math.round(R.neutr * 10) / 10 },
          { Indicateur: 'Taux de recolonisation à 3 mois (%)', Valeur: R.recol === null ? 'non mesurable' : Math.round(R.recol * 10) / 10 },
          { Indicateur: 'Tentatives de reprise (30 j)', Valeur: R.tent30 },
          { Indicateur: `Contrôles de terrain depuis le ${CR.date(R.debut)}`, Valeur: R.visites.length },
          { Indicateur: 'Objets saisis', Valeur: R.objets },
          { Indicateur: 'Tuyaux saisis (m)', Valeur: R.saisiesTot.tuyaux_m || 0 },
          { Indicateur: 'Personnes interpellées', Valeur: R.interp },
          { Indicateur: 'BRQ reçus (7 derniers jours)', Valeur: R.brq7 },
        ],
      },
      {
        nom: 'Par semaine',
        lignes: R.semaines.map((w) => ({
          'Semaine du': w.semaine,
          ...Object.fromEntries(CR.STATUTS.map((s) => [s.libelle, w.parStatut[s.cle] || 0])),
          Visites: w.visites,
          'Tentatives de reprise': w.tentatives,
          'Objets saisis': w.objets,
          Interpellés: w.interpelles,
          'Jours avec BRQ': w.jours.filter((x) => x === 1).length,
        })),
      },
      { nom: 'Matériel saisi', lignes: Object.entries(R.saisiesTot).map(([k, n]) => ({ Matériel: CR.SAISIES[k] || k, Quantité: n })) },
      { nom: 'Sites', lignes: R.lignes, colonnes: COLS },
    ]);
  });

  /* ------------------------------ Init ------------------------------- */
  (async function init() {
    await CR.coque({ titre: 'Tableau de bord', sousTitre: "Indicateurs du plan d'action — lutte contre l'orpaillage illégal dans le Gôh" });
    const [sites, brq, fiches, cours] = await Promise.all([GR.api('/sites'), GR.api('/brq'), GR.api('/fiches').catch(() => []), GR.api('/cours-eau').catch(() => [])]);
    D.sites = sites.map((s) => ({ ...s, events: [...(s.events || [])].sort((a, b) => a.date.localeCompare(b.date)) }));
    D.brq = brq;
    D.fiches = fiches;
    D.cours = cours;
    const n = new Map();
    D.sites.forEach((s) => n.set(s.sous_prefecture || '—', (n.get(s.sous_prefecture || '—') || 0) + 1));
    ms.sp = new GR.MultiSelect('#f-sp', {
      options: [...n.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([v, k]) => ({ value: v, label: v === '—' ? 'Non renseignée' : v, n: k })),
      placeholder: 'Toutes',
      onChange: calculerDiffere,
    });
    $('#f-date').max = CR.aujourdhui();
    $('#f-date').value = CR.dateVue.get() > CR.aujourdhui() ? CR.aujourdhui() : CR.dateVue.get();
    $('#f-debut').value = premiereDate();
    calculer();
  })().catch((e) => console.error(e));
})();
