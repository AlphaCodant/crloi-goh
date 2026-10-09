/* Calcul des indicateurs du tableau de bord à partir des sites (statuts datés),
   des BRQ, des fiches et des cours d'eau — mêmes règles que l'API (stats.py). */
export const STATUTS = [
  { cle: "actif", libelle: "Actif", couleur: "#dc2626" },
  { cle: "recolonise", libelle: "Recolonisé", couleur: "#9d174d" },
  { cle: "tentative_reprise", libelle: "Tentative de reprise", couleur: "#ea580c" },
  { cle: "demantele", libelle: "Démantelé", couleur: "#2563eb" },
  { cle: "tenu", libelle: "Tenu (non recolonisé)", couleur: "#15803d" },
];
export const STATUT = Object.fromEntries(STATUTS.map((s) => [s.cle, s]));
export const ACTIFS = new Set(["actif", "recolonise"]);
export const CIBLES = { neutralisation: 0.7, recolonisation: 0.1 };
export const SAISIES = {
  motopompes: "Motopompes",
  tapis: "Tapis de lavage",
  tuyaux_m: "Tuyaux (m)",
  motos: "Motos",
  tricycles: "Tricycles",
  velos: "Vélos",
  treuils: "Treuils",
  detecteurs: "Détecteurs",
  groupes: "Groupes électrogènes",
  engins_lourds: "Engins lourds",
  sacs_minerai: "Sacs de minerai",
};
export const INTENSITE = {
  tres_impacte: { libelle: "Très impacté", couleur: "#b91c1c" },
  impacte: { libelle: "Impacté", couleur: "#ea580c" },
  faible: { libelle: "Faiblement impacté", couleur: "#0284c7" },
};

const J = 864e5;
export const ajouter = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * J).toISOString().slice(0, 10);
export const ecart = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / J);
export const lundi = (s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return ajouter(s, -((d.getUTCDay() + 6) % 7));
};
export const dateFr = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");
export const semaineCourte = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

export function statutA(site, d) {
  let s = null;
  for (const e of site.events || []) {
    if (e.date <= d) s = e.statut;
    else break;
  }
  return s;
}

/** Applique les filtres aux sites et aux visites. */
export function filtrer(donnees, f) {
  const sites = donnees.sites.filter(
    (s) =>
      f.departements.includes(s.departement) &&
      (!f.domaines.length || f.domaines.includes(s.domaine)) &&
      (!f.forets.length || f.forets.includes(s.foret)) &&
      (!f.sp.length || f.sp.includes(s.sous_prefecture))
  );
  const ids = new Set(sites.map((s) => s.id));
  const visites = donnees.brq.flatMap((b) => b.visites.map((v) => ({ ...v, date: b.date, brq: b.reference })) ).filter((v) => v.site_id && ids.has(v.site_id));
  const fiches = donnees.fiches.filter((x) => f.departements.includes(x.departement));
  return { sites, visites, fiches, brqDates: new Set(donnees.brq.map((b) => b.date)), coursEau: donnees.coursEau };
}

export function indicateurs({ sites, visites, fiches, brqDates, coursEau }, d, periode) {
  const n = {};
  let connus = 0;
  sites.forEach((s) => {
    const st = statutA(s, d);
    if (!st) return;
    connus += 1;
    n[st] = (n[st] || 0) + 1;
  });
  const actifs = (n.actif || 0) + (n.recolonise || 0);
  let eligibles = 0;
  let repris = 0;
  sites.forEach((s) => {
    const evts = (s.events || []).filter((e) => e.date <= d);
    const dem = evts.filter((e) => e.statut === "demantele" && e.date <= ajouter(d, -90));
    if (!dem.length) return;
    const t0 = dem[dem.length - 1].date;
    eligibles += 1;
    if (evts.some((e) => ACTIFS.has(e.statut) && e.date > t0 && e.date <= ajouter(t0, 90))) repris += 1;
  });
  const dans = (v) => v.date >= periode.du && v.date <= periode.au;
  const vp = visites.filter(dans);
  const saisies = {};
  vp.forEach((v) => Object.entries(v.saisies || {}).forEach(([k, x]) => (saisies[k] = (saisies[k] || 0) + (Number(x) || 0))));
  const lineaire = coursEau
    .filter((c) => ["tres_impacte", "impacte"].includes(c.intensite))
    .reduce((t, c) => t + (Number(c.lineaire_impacte_km || c.longueur_km) || 0), 0);
  return {
    recenses: connus,
    parStatut: n,
    actifs,
    tentatives: n.tentative_reprise || 0,
    neutralisation: connus ? (connus - actifs) / connus : null,
    recolonisation: eligibles ? repris / eligibles : null,
    eligibles,
    tentatives30: visites.filter((v) => v.constat === "tentative_reprise" && v.date > ajouter(d, -30) && v.date <= d).length,
    lineaire,
    rivieres: coursEau.filter((c) => ["tres_impacte", "impacte"].includes(c.intensite)).length,
    brq7: [...brqDates].filter((x) => x > ajouter(d, -7) && x <= d).length,
    visites: vp.length,
    sitesVisites: new Set(vp.map((v) => v.site_id)).size,
    interpelles: vp.reduce((t, v) => t + (Number(v.interpelles) || 0), 0),
    saisies,
    objets: Object.entries(saisies).filter(([k]) => k !== "tuyaux_m").reduce((t, [, x]) => t + x, 0),
    tuyaux: saisies.tuyaux_m || 0,
    fiches: fiches.filter((x) => x.date_recu >= periode.du && x.date_recu <= periode.au).length,
    fichesAVerifier: fiches.filter((x) => ["a_verifier", "en_cours"].includes(x.statut)).length,
    parDepartement: sites.reduce((o, s) => ((o[s.departement] = (o[s.departement] || 0) + 1), o), {}),
  };
}

/** Séries hebdomadaires du lundi de `du` jusqu'à `au`. */
export function series({ sites, visites, brqDates }, du, au) {
  const out = [];
  for (let w = lundi(du); w <= au; w = ajouter(w, 7)) {
    const fin = ajouter(w, 6) < au ? ajouter(w, 6) : au;
    const vs = visites.filter((v) => v.date >= w && v.date <= fin);
    const parStatut = {};
    let connus = 0;
    sites.forEach((s) => {
      const st = statutA(s, fin);
      if (st) {
        parStatut[st] = (parStatut[st] || 0) + 1;
        connus += 1;
      }
    });
    const saisies = {};
    vs.forEach((v) => Object.entries(v.saisies || {}).forEach(([k, x]) => (saisies[k] = (saisies[k] || 0) + (Number(x) || 0))));
    const actifs = (parStatut.actif || 0) + (parStatut.recolonise || 0);
    out.push({
      semaine: w,
      fin,
      visites: vs.length,
      tentatives: vs.filter((v) => v.constat === "tentative_reprise").length,
      interpelles: vs.reduce((t, v) => t + (Number(v.interpelles) || 0), 0),
      saisies,
      objets: Object.entries(saisies).filter(([k]) => k !== "tuyaux_m").reduce((t, [, x]) => t + x, 0),
      joursBrq: [...brqDates].filter((x) => x >= w && x <= fin).length,
      jours: ecart(w, fin) + 1,
      parStatut,
      neutralisation: connus ? (connus - actifs) / connus : null,
    });
  }
  return out;
}
