/* Tableau de bord — même organisation que les statistiques de GestReb :
   filtres, indicateurs clés, graphiques, tableau croisé dynamique et liste. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import GR from "../gr/gr";
import { api, isoToday } from "../api";
import { useView } from "../context";
import { Chart, Kpi, MultiSelect, Vide } from "../components/gr";
import * as T from "../tableau/calculs";

const { fmt } = GR;
const pct = (x, d = 0) => (x === null || x === undefined ? "—" : fmt.pct(x * 100, d));

const DIMENSIONS = {
  departement: { libelle: "Département", valeur: (s) => s.departement },
  sous_prefecture: { libelle: "Sous-préfecture", valeur: (s) => s.sous_prefecture || "Non renseignée" },
  domaine: { libelle: "Domaine", valeur: (s) => (s.domaine === "foret_classee" ? "Forêt classée" : "Domaine rural") },
  foret: { libelle: "Forêt classée", valeur: (s) => s.foret || "Hors forêt classée" },
  cours_eau: { libelle: "Cours d'eau", valeur: (s) => s.cours_eau || "Non renseigné" },
  statut: { libelle: "Statut", valeur: (s, d) => T.STATUT[T.statutA(s, d)]?.libelle || "Non recensé" },
  priorite: { libelle: "Priorité", valeur: (s) => (s.priorite === "haute" ? "Haute" : "Normale") },
};
const MESURES = {
  sites: { libelle: "Nombre de sites", calc: (s) => 1, d: 0 },
  superficie: { libelle: "Superficie (ha)", calc: (s) => Number(s.superficie_ha) || 0, d: 2 },
  visites: { libelle: "Visites (période)", calc: (s, x) => x.visites, d: 0 },
  tentatives: { libelle: "Tentatives de reprise (période)", calc: (s, x) => x.tentatives, d: 0 },
  objets: { libelle: "Objets saisis (période)", calc: (s, x) => x.objets, d: 0 },
  interpelles: { libelle: "Personnes interpellées (période)", calc: (s, x) => x.interpelles, d: 0 },
};

export default function Dashboard() {
  const nav = useNavigate();
  const { date, setDate, departement, setDepartement } = useView();
  const [donnees, setDonnees] = useState(null);
  const [err, setErr] = useState("");
  const [filtres, setFiltres] = useState({ departements: departement ? [departement] : ["Gagnoa", "Oumé"], domaines: [], forets: [], sp: [] });
  const [periode, setPeriode] = useState({ du: "", au: isoToday() });
  const [vues, setVues] = useState({ repartition: "departement", saisies: "bar" });
  const [tc, setTc] = useState({ lignes: "sous_prefecture", colonnes: "statut", mesure: "sites" });
  const [recherche, setRecherche] = useState("");

  useEffect(() => {
    Promise.all([api("/sites"), api("/brq"), api("/fiches").catch(() => []), api("/cours-eau").catch(() => [])])
      .then(([sites, brq, fiches, coursEau]) => {
        setDonnees({ sites, brq, fiches, coursEau });
        const dates = sites.flatMap((s) => (s.events || []).map((e) => e.date)).concat(brq.map((b) => b.date));
        const min = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : T.ajouter(isoToday(), -60);
        setPeriode((p) => ({ ...p, du: p.du || min }));
      })
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    setDepartement(filtres.departements.length === 1 ? filtres.departements[0] : "");
  }, [filtres.departements, setDepartement]);

  const sel = useMemo(() => (donnees ? T.filtrer(donnees, filtres) : null), [donnees, filtres]);
  const k = useMemo(() => (sel && periode.du ? T.indicateurs(sel, date, periode) : null), [sel, date, periode]);
  const series = useMemo(() => (sel && periode.du ? T.series(sel, periode.du, periode.au < date ? date : periode.au) : []), [sel, periode, date]);
  const semaineSel = (series.find((w) => w.semaine <= date && date <= w.fin) || {}).semaine;

  const options = useCallback(
    (cle) => {
      if (!donnees) return [];
      const n = new Map();
      donnees.sites.forEach((s) => {
        const v = s[cle];
        if (v) n.set(v, (n.get(v) || 0) + 1);
      });
      return [...n.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr")).map(([v, c]) => ({ value: v, label: v, n: c }));
    },
    [donnees]
  );

  /* ------------------------- Agrégats par site ------------------------- */
  const parSite = useMemo(() => {
    if (!sel) return [];
    const m = new Map(sel.sites.map((s) => [s.id, { visites: 0, tentatives: 0, objets: 0, interpelles: 0 }]));
    sel.visites
      .filter((v) => v.date >= periode.du && v.date <= periode.au)
      .forEach((v) => {
        const x = m.get(v.site_id);
        if (!x) return;
        x.visites += 1;
        if (v.constat === "tentative_reprise") x.tentatives += 1;
        x.interpelles += Number(v.interpelles) || 0;
        x.objets += Object.entries(v.saisies || {}).filter(([c]) => c !== "tuyaux_m").reduce((t, [, n]) => t + (Number(n) || 0), 0);
      });
    return sel.sites.map((s) => {
      const evts = (s.events || []).filter((e) => e.date <= date);
      return { s, x: m.get(s.id), statut: T.statutA(s, date), dernier: evts.length ? evts[evts.length - 1].date : null };
    });
  }, [sel, periode, date]);

  /* ----------------------------- Graphiques ---------------------------- */
  const marque = semaineSel ? [{ x: T.semaineCourte(semaineSel), borderColor: "#0f4c3a", strokeDashArray: 4, label: { text: "Date affichée", style: { background: "#0f4c3a", color: "#fff", fontSize: "10px" } } }] : [];
  const clicSemaine = {
    dataPointSelection: (e, ctx, cfg) => {
      const w = series[cfg.dataPointIndex];
      if (w) setDate(w.fin);
    },
  };
  const categories = series.map((w) => T.semaineCourte(w.semaine));

  const g = useMemo(() => {
    if (!k) return {};
    const statutsConnus = T.STATUTS.filter((s) => k.parStatut[s.cle]);
    const totauxSaisies = Object.entries(k.saisies).filter(([c, n]) => n && c !== "tuyaux_m").sort((a, b) => b[1] - a[1]);
    const dim = DIMENSIONS[vues.repartition];
    const groupes = new Map();
    parSite.forEach(({ s, statut }) => {
      const cle = dim.valeur(s, date);
      const o = groupes.get(cle) || {};
      o[statut || "inconnu"] = (o[statut || "inconnu"] || 0) + 1;
      groupes.set(cle, o);
    });
    const libGroupes = [...groupes.keys()].sort((a, b) => Object.values(groupes.get(b)).reduce((x, y) => x + y, 0) - Object.values(groupes.get(a)).reduce((x, y) => x + y, 0));
    // Frise sites × semaines (statut en fin de semaine)
    const sitesSuivis = parSite.filter(({ s }) => (s.events || []).length).slice(0, 40);
    const codeStatut = { tenu: 1, demantele: 2, tentative_reprise: 3, recolonise: 4, actif: 5 };
    const fiches = sel.fiches;
    const parStatutFiche = ["a_verifier", "en_cours", "confirmee", "infirmee", "exploitee"].map((c) => fiches.filter((f) => f.statut === c).length);
    const rivieres = [...sel.coursEau].sort((a, b) => (b.longueur_km || 0) - (a.longueur_km || 0));

    return {
      statutSemaine: {
        chart: { type: "bar", height: 320, stacked: true, events: clicSemaine },
        series: T.STATUTS.map((s) => ({ name: s.libelle, data: series.map((w) => w.parStatut[s.cle] || 0) })),
        colors: T.STATUTS.map((s) => s.couleur),
        xaxis: { categories },
        plotOptions: { bar: { columnWidth: "62%", borderRadius: 2 } },
        annotations: { xaxis: marque },
        legend: { position: "bottom" },
        tooltip: { shared: true, intersect: false, x: { formatter: (v) => `Semaine du ${v}` } },
      },
      situation: {
        chart: { type: "donut", height: 320 },
        series: statutsConnus.map((s) => k.parStatut[s.cle]),
        labels: statutsConnus.map((s) => s.libelle),
        colors: statutsConnus.map((s) => s.couleur),
        legend: { position: "bottom" },
        dataLabels: { enabled: true, formatter: (v) => `${Math.round(v)} %` },
        plotOptions: { pie: { donut: { size: "58%", labels: { show: true, total: { show: true, label: "Sites", formatter: () => fmt.n(k.recenses) } } } } },
        tooltip: { y: { formatter: (v) => `${v} site(s)` } },
      },
      activite: {
        chart: { type: "line", height: 320, events: clicSemaine },
        series: [
          { name: "Visites de sites", type: "column", data: series.map((w) => w.visites) },
          { name: "Tentatives de reprise", type: "column", data: series.map((w) => w.tentatives) },
          { name: "Personnes interpellées", type: "line", data: series.map((w) => w.interpelles) },
        ],
        colors: ["#15803d", "#ea580c", "#2563eb"],
        stroke: { width: [0, 0, 3], curve: "smooth" },
        markers: { size: [0, 0, 4] },
        xaxis: { categories },
        yaxis: { labels: { formatter: (v) => fmt.n(v) } },
        plotOptions: { bar: { columnWidth: "58%", borderRadius: 3 } },
        annotations: { xaxis: marque },
        legend: { position: "bottom" },
        tooltip: { shared: true, intersect: false, x: { formatter: (v) => `Semaine du ${v}` } },
      },
      neutralisation: {
        chart: { type: "area", height: 320, events: clicSemaine },
        series: [{ name: "Taux de neutralisation", data: series.map((w) => (w.neutralisation === null ? null : Math.round(w.neutralisation * 1000) / 10)) }],
        colors: ["#15803d"],
        stroke: { width: 3, curve: "smooth" },
        fill: { type: "gradient", gradient: { opacityFrom: 0.35, opacityTo: 0.05 } },
        xaxis: { categories },
        yaxis: { min: 0, max: 100, labels: { formatter: (v) => `${Math.round(v)} %` } },
        annotations: {
          yaxis: [{ y: 70, borderColor: "#d97706", strokeDashArray: 5, label: { text: "Cible 70 %", style: { background: "#d97706", color: "#fff", fontSize: "10px" } } }],
          xaxis: marque,
        },
        tooltip: { y: { formatter: (v) => (v === null ? "—" : `${fmt.n(v, 1)} %`) } },
      },
      saisiesSemaine: {
        chart: { type: "bar", height: 320, stacked: true, events: clicSemaine },
        series: Object.entries(T.SAISIES)
          .filter(([c]) => c !== "tuyaux_m" && series.some((w) => w.saisies[c]))
          .map(([c, l]) => ({ name: l, data: series.map((w) => w.saisies[c] || 0) })),
        xaxis: { categories },
        plotOptions: { bar: { columnWidth: "58%", borderRadius: 2 } },
        annotations: { xaxis: marque },
        legend: { position: "bottom" },
        noData: { text: "Aucune saisie sur la période" },
      },
      saisiesType: {
        chart: { type: "bar", height: 320 },
        series: [{ name: "Quantité", data: totauxSaisies.map(([, n]) => n) }],
        xaxis: { categories: totauxSaisies.map(([c]) => T.SAISIES[c]) },
        plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "62%", distributed: true } },
        legend: { show: false },
        dataLabels: { enabled: true, style: { fontSize: "11px", colors: ["#0f172a"] }, offsetX: 4, dropShadow: { enabled: false } },
        noData: { text: "Aucune saisie sur la période" },
      },
      repartition: (() => {
        const sr = [...T.STATUTS, { cle: "inconnu", libelle: "Non recensé", couleur: "#94a3b8" }]
          .map((s) => ({ name: s.libelle, data: libGroupes.map((l) => groupes.get(l)[s.cle] || 0), couleur: s.couleur }))
          .filter((s) => s.data.some(Boolean));
        return {
          chart: { type: "bar", height: Math.max(260, 60 + libGroupes.length * 34), stacked: true },
          series: sr.map(({ name, data }) => ({ name, data })),
          colors: sr.map((x) => x.couleur),
          xaxis: { categories: libGroupes },
          plotOptions: { bar: { horizontal: true, barHeight: "62%", borderRadius: 2 } },
          legend: { position: "bottom" },
        };
      })(),
      brq: {
        chart: { type: "bar", height: 320, stacked: true, events: clicSemaine },
        series: [
          { name: "Jours avec BRQ", data: series.map((w) => w.joursBrq) },
          { name: "Jours sans BRQ", data: series.map((w) => Math.max(0, w.jours - w.joursBrq)) },
        ],
        colors: ["#15803d", "#e2e8f0"],
        xaxis: { categories },
        yaxis: { max: 7, tickAmount: 7 },
        plotOptions: { bar: { columnWidth: "58%", borderRadius: 2 } },
        annotations: { xaxis: marque },
        legend: { position: "bottom" },
      },
      frise: {
        chart: { type: "heatmap", height: Math.max(260, 70 + sitesSuivis.length * 22), events: clicSemaine },
        series: sitesSuivis
          .map(({ s }) => ({ name: `${s.code} ${s.localite}`.slice(0, 32), data: series.map((w) => ({ x: T.semaineCourte(w.semaine), y: codeStatut[T.statutA(s, w.fin)] || 0 })) }))
          .reverse(),
        dataLabels: { enabled: false },
        stroke: { width: 1, colors: ["#fff"] },
        plotOptions: {
          heatmap: {
            radius: 2,
            enableShades: false,
            colorScale: {
              ranges: [
                { from: 0, to: 0, color: "#f1f5f9", name: "Non recensé" },
                { from: 1, to: 1, color: T.STATUT.tenu.couleur, name: "Tenu" },
                { from: 2, to: 2, color: T.STATUT.demantele.couleur, name: "Démantelé" },
                { from: 3, to: 3, color: T.STATUT.tentative_reprise.couleur, name: "Tentative de reprise" },
                { from: 4, to: 4, color: T.STATUT.recolonise.couleur, name: "Recolonisé" },
                { from: 5, to: 5, color: T.STATUT.actif.couleur, name: "Actif" },
              ],
            },
          },
        },
        tooltip: { y: { formatter: (v) => ["Non recensé", "Tenu", "Démantelé", "Tentative de reprise", "Recolonisé", "Actif"][v] } },
        legend: { position: "bottom" },
      },
      rivieres: {
        chart: { type: "bar", height: 320 },
        series: [{ name: "Longueur dans le Gôh (km)", data: rivieres.map((c) => Number(c.longueur_km) || 0) }],
        xaxis: { categories: rivieres.map((c) => c.nom) },
        colors: rivieres.map((c) => T.INTENSITE[c.intensite]?.couleur || "#94a3b8"),
        plotOptions: { bar: { horizontal: true, distributed: true, borderRadius: 4, barHeight: "62%" } },
        legend: { show: false },
        dataLabels: { enabled: true, formatter: (v, o) => `${fmt.n(v, 1)} km · ${T.INTENSITE[rivieres[o.dataPointIndex].intensite]?.libelle || "non évalué"}`, style: { fontSize: "11px", colors: ["#0f172a"] }, offsetX: 4, dropShadow: { enabled: false } },
      },
      fiches: {
        chart: { type: "donut", height: 320 },
        series: parStatutFiche,
        labels: ["À vérifier", "En cours", "Confirmées", "Infirmées", "Exploitées"],
        colors: ["#d97706", "#2563eb", "#dc2626", "#64748b", "#15803d"],
        legend: { position: "bottom" },
        plotOptions: { pie: { donut: { size: "58%", labels: { show: true, total: { show: true, label: "Fiches", formatter: () => fmt.n(fiches.length) } } } } },
        noData: { text: "Aucune fiche de renseignement" },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, series, parSite, vues, semaineSel, date, sel]);

  /* ---------------------- Tableau croisé dynamique --------------------- */
  const croise = useMemo(() => {
    const L = DIMENSIONS[tc.lignes];
    const Cc = DIMENSIONS[tc.colonnes];
    const M = MESURES[tc.mesure];
    const cellules = new Map();
    const cols = new Set();
    parSite.forEach(({ s, x }) => {
      const l = L.valeur(s, date);
      const c = Cc.valeur(s, date);
      cols.add(c);
      const cle = `${l}\u0000${c}`;
      cellules.set(cle, (cellules.get(cle) || 0) + M.calc(s, x));
    });
    const lignes = [...new Set(parSite.map(({ s }) => L.valeur(s, date)))].sort((a, b) => a.localeCompare(b, "fr"));
    const colonnes = [...cols].sort((a, b) => a.localeCompare(b, "fr"));
    const val = (l, c) => cellules.get(`${l}\u0000${c}`) || 0;
    const max = Math.max(1, ...[...cellules.values()]);
    return { lignes, colonnes, val, max, d: M.d };
  }, [parSite, tc, date]);

  function exporterCroise() {
    const lignes = croise.lignes.map((l) => {
      const o = { [DIMENSIONS[tc.lignes].libelle]: l };
      croise.colonnes.forEach((c) => (o[c] = croise.val(l, c)));
      o.Total = croise.colonnes.reduce((t, c) => t + croise.val(l, c), 0);
      return o;
    });
    GR.exportXlsx(`tableau_croise_crloi_${date}.xlsx`, { nom: "Tableau croisé", lignes });
  }

  /* ------------------------------ Exports ------------------------------ */
  const colsListe = [
    { cle: "code", titre: "Code", valeur: (l) => l.s.code },
    { cle: "localite", titre: "Localité", valeur: (l) => l.s.localite },
    { cle: "departement", titre: "Département", valeur: (l) => l.s.departement },
    { cle: "sp", titre: "Sous-préfecture", valeur: (l) => l.s.sous_prefecture },
    { cle: "domaine", titre: "Domaine", valeur: (l) => (l.s.domaine === "foret_classee" ? `FC ${l.s.foret || ""}` : "Rural") },
    { cle: "cours", titre: "Cours d'eau", valeur: (l) => l.s.cours_eau },
    { cle: "statut", titre: `Statut au ${T.dateFr(date)}`, valeur: (l) => T.STATUT[l.statut]?.libelle || "Non recensé" },
    { cle: "dernier", titre: "Dernier constat", valeur: (l) => T.dateFr(l.dernier) },
    { cle: "visites", titre: "Visites (période)", valeur: (l) => l.x.visites },
    { cle: "tentatives", titre: "Tentatives (période)", valeur: (l) => l.x.tentatives },
    { cle: "objets", titre: "Objets saisis (période)", valeur: (l) => l.x.objets },
    { cle: "interpelles", titre: "Interpellés (période)", valeur: (l) => l.x.interpelles },
  ];
  async function exporter(type) {
    document.getElementById("menu-export-tdb")?.classList.remove("open");
    if (type === "csv") return GR.exportCsv(`sites_crloi_${date}.csv`, parSite, colsListe);
    const feuilles = [
      {
        nom: "Indicateurs",
        lignes: [
          ["Date de situation", T.dateFr(date)],
          ["Période", `${T.dateFr(periode.du)} – ${T.dateFr(periode.au)}`],
          ["Sites recensés", k.recenses],
          ["Sites actifs ou recolonisés", k.actifs],
          ["Taux de neutralisation", pct(k.neutralisation, 1)],
          ["Taux de recolonisation à 3 mois", pct(k.recolonisation, 1)],
          ["Tentatives de reprise (30 j)", k.tentatives30],
          ["Visites de sites (période)", k.visites],
          ["Objets saisis (période)", k.objets],
          ["Tuyaux saisis (m)", k.tuyaux],
          ["Personnes interpellées (période)", k.interpelles],
          ["Linéaire de cours d'eau impacté (km)", k.lineaire],
        ].map(([a, b]) => ({ Indicateur: a, Valeur: b })),
      },
      {
        nom: "Semaines",
        lignes: series.map((w) => ({
          Semaine: T.dateFr(w.semaine),
          Visites: w.visites,
          Tentatives: w.tentatives,
          Interpellés: w.interpelles,
          "Objets saisis": w.objets,
          "Jours avec BRQ": w.joursBrq,
          ...Object.fromEntries(T.STATUTS.map((s) => [s.libelle, w.parStatut[s.cle] || 0])),
          "Taux de neutralisation (%)": w.neutralisation === null ? "" : Math.round(w.neutralisation * 1000) / 10,
        })),
      },
      { nom: "Sites", lignes: parSite, colonnes: colsListe },
    ];
    return GR.exportXlsx(`tableau_de_bord_crloi_${date}.xlsx`, feuilles);
  }

  /* -------------------------------- Rendu ------------------------------ */
  if (err) return <div className="alert error"><span className="mi">error</span><span>{err}</span></div>;
  if (!donnees || !k)
    return (
      <section className="kpis">
        {Array.from({ length: 10 }).map((_, i) => (
          <div className="kpi" key={i}><div className="skeleton" style={{ width: "100%", height: 46 }} /></div>
        ))}
      </section>
    );

  const q = recherche.trim().toLowerCase();
  const liste = parSite
    .filter(({ s }) => !q || [s.code, s.localite, s.sous_prefecture, s.foret, s.cours_eau].some((v) => String(v || "").toLowerCase().includes(q)))
    .sort((a, b) => T.STATUTS.findIndex((x) => x.cle === a.statut) - T.STATUTS.findIndex((x) => x.cle === b.statut) || a.s.code.localeCompare(b.s.code));
  const toggleDep = (d) =>
    setFiltres((f) => {
      const on = f.departements.includes(d);
      const next = on ? f.departements.filter((x) => x !== d) : [...f.departements, d];
      return { ...f, departements: next.length ? next : [d] };
    });

  return (
    <>
      <section className="card filtres-stats no-print" aria-label="Critères de sélection">
        <div className="card-body">
          <div className="filtres-grille tdb">
            <div className="field">
              <label>Départements</label>
              <div className="chips">
                {["Gagnoa", "Oumé"].map((d) => (
                  <label key={d} className={`chip ${filtres.departements.includes(d) ? "on" : ""}`}>
                    <input type="checkbox" checked={filtres.departements.includes(d)} onChange={() => toggleDep(d)} />
                    {d}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Date de situation</label>
              <input className="input" type="date" value={date} max={isoToday()} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Période d'activité</label>
              <div className="row">
                <input className="input" type="date" value={periode.du} max={periode.au} onChange={(e) => e.target.value && setPeriode((p) => ({ ...p, du: e.target.value }))} />
                <input className="input" type="date" value={periode.au} min={periode.du} max={isoToday()} onChange={(e) => e.target.value && setPeriode((p) => ({ ...p, au: e.target.value }))} />
              </div>
            </div>
            <div className="field">
              <label>Domaine</label>
              <MultiSelect
                options={[{ value: "rural", label: "Domaine rural" }, { value: "foret_classee", label: "Forêt classée" }]}
                value={filtres.domaines}
                recherche={false}
                placeholder="Tous"
                onChange={(v) => setFiltres((f) => ({ ...f, domaines: v }))}
              />
            </div>
            <div className="field">
              <label>Forêts classées</label>
              <MultiSelect options={options("foret")} value={filtres.forets} placeholder="Toutes" onChange={(v) => setFiltres((f) => ({ ...f, forets: v }))} />
            </div>
            <div className="field">
              <label>Sous-préfectures</label>
              <MultiSelect options={options("sous_prefecture")} value={filtres.sp} placeholder="Toutes" onChange={(v) => setFiltres((f) => ({ ...f, sp: v }))} />
            </div>
          </div>
          <div className="row-wrap mt-3">
            <span className="muted" style={{ fontSize: 12.5 }}>
              <span className="mi mi-sm">info</span> Statuts au <strong>{T.dateFr(date)}</strong> · activité du {T.dateFr(periode.du)} au {T.dateFr(periode.au)}. Cliquez sur une semaine d'un graphique pour vous y placer, ici comme sur la carte.
            </span>
            <div className="row" style={{ marginLeft: "auto" }}>
              <button className="btn btn-ghost" type="button" onClick={() => (setFiltres({ departements: ["Gagnoa", "Oumé"], domaines: [], forets: [], sp: [] }), setDate(isoToday()))}>
                <span className="mi">restart_alt</span>Réinitialiser
              </button>
              <button className="btn" type="button" onClick={() => nav("/carte")}>
                <span className="mi">map</span>Voir sur la carte
              </button>
              <button className="btn" type="button" onClick={() => window.print()}>
                <span className="mi">print</span>Imprimer
              </button>
              <div className="user-menu">
                <button className="btn btn-primary" type="button" data-dropdown="menu-export-tdb">
                  <span className="mi">download</span>Exporter
                </button>
                <div className="dropdown" id="menu-export-tdb">
                  <button className="dd-item" type="button" onClick={() => exporter("xlsx")}><span className="mi">grid_on</span>Classeur Excel complet</button>
                  <button className="dd-item" type="button" onClick={() => exporter("csv")}><span className="mi">description</span>Liste des sites (CSV)</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="print-only print-titre">
        <h1>Tableau de bord — CRLOI Gôh, cellule renseignement</h1>
        <p>Situation au {T.dateFr(date)} · {filtres.departements.join(", ")} · diffusion restreinte</p>
      </div>

      <section className="kpis" aria-label="Indicateurs clés">
        <Kpi icone="location_on" libelle="Sites recensés" valeur={fmt.n(k.recenses)} pied={Object.entries(k.parDepartement).map(([d, n]) => `${n} ${d}`).join(" · ")} />
        <Kpi icone="local_fire_department" couleur={k.actifs ? "red" : ""} libelle="Actifs ou recolonisés" valeur={fmt.n(k.actifs)} pied={`${k.tentatives} en tentative de reprise`} />
        <Kpi
          icone="verified"
          couleur={k.neutralisation === null ? "gray" : k.neutralisation >= T.CIBLES.neutralisation ? "" : "amber"}
          libelle="Sites neutralisés"
          valeur={k.neutralisation === null ? "—" : fmt.n(k.neutralisation * 100, 0)}
          unite={k.neutralisation === null ? "" : "%"}
          pied="cible : 70 % au moins"
          progression={k.neutralisation === null ? null : k.neutralisation * 100}
          cible={70}
        />
        <Kpi
          icone="replay"
          couleur={k.recolonisation === null ? "gray" : k.recolonisation <= T.CIBLES.recolonisation ? "" : "red"}
          libelle="Recolonisation à 3 mois"
          valeur={k.recolonisation === null ? "—" : fmt.n(k.recolonisation * 100, 0)}
          unite={k.recolonisation === null ? "" : "%"}
          pied={k.recolonisation === null ? "mesurable 90 jours après un démantèlement" : `${k.eligibles} site(s) mesuré(s) · cible ≤ 10 %`}
        />
        <Kpi icone="warning" couleur={k.tentatives30 ? "amber" : ""} libelle="Tentatives de reprise" valeur={fmt.n(k.tentatives30)} pied="constatées sur 30 jours" />
        <Kpi icone="directions_walk" couleur="blue" libelle="Visites de sites" valeur={fmt.n(k.visites)} pied={`${k.sitesVisites} site(s) visité(s) sur la période`} />
        <Kpi icone="construction" couleur="violet" libelle="Matériel saisi" valeur={fmt.n(k.objets)} unite="objets" pied={k.tuyaux ? `et ${fmt.n(k.tuyaux)} m de tuyaux` : "sur la période"} />
        <Kpi icone="person_off" couleur="gray" libelle="Personnes interpellées" valeur={fmt.n(k.interpelles)} pied="sur la période" />
        <Kpi icone="water" couleur="blue" libelle="Cours d'eau impactés" valeur={fmt.n(k.lineaire, 0)} unite="km" pied={`${k.rivieres} cours d'eau impacté(s) ou très impacté(s)`} />
        <Kpi
          icone="mark_email_read"
          couleur={k.brq7 >= 7 ? "" : k.brq7 >= 4 ? "amber" : "red"}
          libelle="BRQ reçus (7 j)"
          valeur={`${k.brq7} / 7`}
          pied={`${k.fiches} fiche(s) reçue(s) · ${k.fichesAVerifier} à vérifier`}
          progression={(k.brq7 / 7) * 100}
        />
      </section>

      <section className="grid grid-3 stats-grille">
        <article className="card span-2">
          <div className="card-header"><h2>Évolution du statut des sites</h2><span className="sub">situation en fin de semaine</span></div>
          <div className="card-body"><Chart id="g-statut" options={g.statutSemaine} /></div>
        </article>
        <article className="card">
          <div className="card-header"><h2>Situation au {T.dateFr(date)}</h2></div>
          <div className="card-body"><Chart id="g-situation" options={g.situation} /></div>
        </article>

        <article className="card span-2">
          <div className="card-header"><h2>Activité de terrain</h2><span className="sub">consignée dans les BRQ</span></div>
          <div className="card-body"><Chart id="g-activite" options={g.activite} /></div>
        </article>
        <article className="card">
          <div className="card-header"><h2>Taux de neutralisation</h2><span className="sub">par semaine</span></div>
          <div className="card-body"><Chart id="g-neutralisation" options={g.neutralisation} /></div>
        </article>

        <article className="card span-2">
          <div className="card-header"><h2>Matériel saisi par semaine</h2><span className="sub">hors tuyaux (comptés en mètres)</span></div>
          <div className="card-body"><Chart id="g-saisies" options={g.saisiesSemaine} /></div>
        </article>
        <article className="card">
          <div className="card-header"><h2>Matériel saisi par type</h2><span className="sub">sur la période</span></div>
          <div className="card-body"><Chart id="g-saisies-type" options={g.saisiesType} /></div>
        </article>

        <article className="card span-2">
          <div className="card-header">
            <h2>Répartition des sites</h2>
            <span className="sub">statut au {T.dateFr(date)}</span>
            <div className="actions">
              <div className="segmented">
                {[["departement", "Département"], ["sous_prefecture", "Sous-préfecture"], ["foret", "Forêt"], ["cours_eau", "Cours d'eau"]].map(([v, l]) => (
                  <button key={v} type="button" className={vues.repartition === v ? "active" : ""} onClick={() => setVues((x) => ({ ...x, repartition: v }))}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="card-body"><Chart id="g-repartition" options={g.repartition} /></div>
        </article>
        <article className="card">
          <div className="card-header"><h2>Régularité des BRQ</h2><span className="sub">jours couverts par semaine</span></div>
          <div className="card-body"><Chart id="g-brq" options={g.brq} /></div>
        </article>

        <article className="card span-3">
          <div className="card-header"><h2>Frise des sites</h2><span className="sub">statut de chaque site en fin de semaine (40 premiers sites suivis)</span></div>
          <div className="card-body"><Chart id="g-frise" options={g.frise} className="chart lg" /></div>
        </article>

        <article className="card span-2">
          <div className="card-header"><h2>Cours d'eau</h2><span className="sub">longueur dans la région et niveau d'impact</span></div>
          <div className="card-body"><Chart id="g-rivieres" options={g.rivieres} /></div>
        </article>
        <article className="card">
          <div className="card-header"><h2>Fiches de renseignement</h2><span className="sub">par état de vérification</span></div>
          <div className="card-body"><Chart id="g-fiches" options={g.fiches} /></div>
        </article>
      </section>

      <section className="card mt-4">
        <div className="card-header">
          <span className="mi" style={{ color: "var(--primary)" }}>pivot_table_chart</span>
          <h2>Tableau croisé dynamique</h2>
          <div className="actions row-wrap no-print">
            <label className="muted" style={{ fontSize: 12 }}>Lignes</label>
            <select className="select sm" style={{ width: "auto" }} value={tc.lignes} onChange={(e) => setTc((x) => ({ ...x, lignes: e.target.value }))}>
              {Object.entries(DIMENSIONS).map(([v, d]) => <option key={v} value={v}>{d.libelle}</option>)}
            </select>
            <label className="muted" style={{ fontSize: 12 }}>Colonnes</label>
            <select className="select sm" style={{ width: "auto" }} value={tc.colonnes} onChange={(e) => setTc((x) => ({ ...x, colonnes: e.target.value }))}>
              {Object.entries(DIMENSIONS).map(([v, d]) => <option key={v} value={v}>{d.libelle}</option>)}
            </select>
            <label className="muted" style={{ fontSize: 12 }}>Valeur</label>
            <select className="select sm" style={{ width: "auto" }} value={tc.mesure} onChange={(e) => setTc((x) => ({ ...x, mesure: e.target.value }))}>
              {Object.entries(MESURES).map(([v, d]) => <option key={v} value={v}>{d.libelle}</option>)}
            </select>
            <button className="btn btn-sm" type="button" onClick={exporterCroise}><span className="mi">grid_on</span>Excel</button>
          </div>
        </div>
        <div className="card-body flush">
          <div className="table-wrap" style={{ maxHeight: 480 }}>
            <table className="table compact tableau-croise">
              <thead>
                <tr>
                  <th>{DIMENSIONS[tc.lignes].libelle} \ {DIMENSIONS[tc.colonnes].libelle}</th>
                  {croise.colonnes.map((c) => <th key={c} className="num">{c}</th>)}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {croise.lignes.map((l) => {
                  const tot = croise.colonnes.reduce((t, c) => t + croise.val(l, c), 0);
                  return (
                    <tr key={l}>
                      <td className="cell-strong">{l}</td>
                      {croise.colonnes.map((c) => {
                        const v = croise.val(l, c);
                        return (
                          <td key={c} className="num" style={v ? { background: `rgba(21,128,61,${0.08 + (v / croise.max) * 0.42})` } : null}>
                            {v ? fmt.n(v, croise.d) : "·"}
                          </td>
                        );
                      })}
                      <td className="num cell-strong">{fmt.n(tot, croise.d)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  {croise.colonnes.map((c) => <td key={c} className="num">{fmt.n(croise.lignes.reduce((t, l) => t + croise.val(l, c), 0), croise.d)}</td>)}
                  <td className="num">{fmt.n(croise.lignes.reduce((t, l) => t + croise.colonnes.reduce((u, c) => u + croise.val(l, c), 0), 0), croise.d)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>

      <section className="card mt-4">
        <div className="card-header">
          <span className="mi" style={{ color: "var(--primary)" }}>list_alt</span>
          <h2>Sites de la sélection</h2>
          <span className="badge">{liste.length}</span>
          <div className="actions no-print">
            <div className="input-icon" style={{ width: 240 }}>
              <span className="mi">search</span>
              <input className="input sm" type="search" placeholder="Filtrer la liste" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="card-body flush">
          <div className="table-wrap" style={{ maxHeight: 520 }}>
            {liste.length ? (
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Code</th><th>Localité</th><th>Département</th><th>Domaine</th><th>Statut</th><th>Dernier constat</th>
                    <th className="num">Visites</th><th className="num">Tentatives</th><th className="num">Objets saisis</th><th className="num">Interpellés</th><th />
                  </tr>
                </thead>
                <tbody>
                  {liste.map(({ s, x, statut, dernier }) => {
                    const st = T.STATUT[statut];
                    return (
                      <tr key={s.id} className="clickable" onClick={() => nav(`/carte?site=${s.id}`)}>
                        <td className="cell-strong nowrap">{s.code}</td>
                        <td>{s.localite}{s.coord_alerte && <span className="mi mi-sm" style={{ color: "var(--danger)", marginLeft: 4 }} title={s.coord_alerte}>wrong_location</span>}</td>
                        <td>{s.departement}</td>
                        <td>{s.domaine === "foret_classee" ? `FC ${s.foret || ""}` : "Rural"}</td>
                        <td>{st ? <span className="badge" style={{ background: `${st.couleur}1f`, color: st.couleur }}>{st.libelle}</span> : <span className="badge">Non recensé</span>}</td>
                        <td className="nowrap">{T.dateFr(dernier)}</td>
                        <td className="num">{x.visites || "·"}</td>
                        <td className="num">{x.tentatives || "·"}</td>
                        <td className="num">{x.objets || "·"}</td>
                        <td className="num">{x.interpelles || "·"}</td>
                        <td><span className="mi mi-sm muted" title="Voir sur la carte">map</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <Vide icone="search_off" titre="Aucun site pour ces critères" />
            )}
          </div>
        </div>
      </section>
    </>
  );
}
