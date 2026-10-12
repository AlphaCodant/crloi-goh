/* Qualité de l'eau : paramètres suivis, seuils de référence et évaluation (mêmes règles que routes_eau.py). */
import { ajouter, lundi, semaineCourte } from "./tableau/calculs";

export const PARAMETRES = [
  { cle: "turbidite", libelle: "Turbidité", unite: "NTU", seuil: 5, decimales: 1, source: "OMS – seuil d'acceptabilité de l'eau de boisson" },
  { cle: "mercure", libelle: "Mercure", unite: "µg/L", seuil: 6, decimales: 2, source: "OMS – valeur guide (mercure inorganique)" },
  { cle: "cyanure", libelle: "Cyanure", unite: "mg/L", seuil: 0.07, decimales: 3, source: "OMS – ancienne valeur guide" },
];
export const PARAM = Object.fromEntries(PARAMETRES.map((p) => [p.cle, p]));

export const STATUT_EAU = {
  depassement: { libelle: "Dépassement", couleur: "#dc2626" },
  conforme: { libelle: "Conforme", couleur: "#16a34a" },
  autre: { libelle: "Autres paramètres", couleur: "#0284c7" },
  ancien: { libelle: "Mesure ancienne (> 2 semaines)", couleur: "#94a3b8" },
  aucune: { libelle: "Aucune mesure", couleur: "#cbd5e1" },
};

export const fmtVal = (v, d = 2) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d }));
export const depasse = (m, cle) => m[cle] !== null && m[cle] !== undefined && m[cle] > PARAM[cle].seuil;

/** Les n derniers lundis (le plus récent en dernier), à partir de la date d. */
export function semaines(d, n = 8) {
  const l = lundi(d);
  return Array.from({ length: n }, (_, i) => ajouter(l, -7 * (n - 1 - i)));
}

/** Dernière mesure de chaque cours d'eau (toutes stations confondues : la pire de la semaine la plus récente). */
export function dernieres(mesures) {
  const par = new Map();
  for (const m of mesures) {
    const cur = par.get(m.cours_eau_id);
    if (!cur || m.semaine > cur.semaine || (m.semaine === cur.semaine && m.statut === "depassement" && cur.statut !== "depassement")) par.set(m.cours_eau_id, m);
  }
  return par;
}

/** Statut affiché pour un cours d'eau à la date d (mesure de plus de 2 semaines = ancienne). */
export function statutCours(derniere, d) {
  if (!derniere) return "aucune";
  if (derniere.semaine < ajouter(lundi(d), -14)) return "ancien";
  return derniere.statut;
}

/** Résumé court des valeurs d'une mesure. */
export function resume(m) {
  const t = PARAMETRES.filter((p) => m[p.cle] !== null && m[p.cle] !== undefined).map((p) => `${p.libelle} ${fmtVal(m[p.cle], p.decimales)} ${p.unite}`);
  (m.autres || []).forEach((a) => t.push(`${a.parametre} ${fmtVal(a.valeur, 3)}${a.unite ? ` ${a.unite}` : ""}`));
  return t.join(" · ");
}

/** Options ApexCharts : valeur maximale hebdomadaire d'un paramètre par cours d'eau, avec la ligne de seuil. */
export function grapheEau({ mesures, cours, sem, param, ids, hauteur = 300 }) {
  const p = PARAM[param];
  const series = ids.map((id) => ({
    name: cours.find((c) => c.id === id)?.nom || "?",
    data: sem.map((s) => {
      const v = mesures.filter((m) => m.cours_eau_id === id && m.semaine === s && m[param] !== null && m[param] !== undefined).map((m) => m[param]);
      return v.length ? Math.max(...v) : null;
    }),
  }));
  const vmax = Math.max(p.seuil, ...series.flatMap((x) => x.data.filter((v) => v !== null)));
  return {
    chart: { type: "line", height: hauteur, zoom: { enabled: false } },
    series,
    xaxis: { categories: sem.map((s) => semaineCourte(s)), title: { text: "Semaine du" } },
    yaxis: { title: { text: `${p.libelle} (${p.unite})` }, min: 0, max: vmax * 1.15, labels: { formatter: (v) => fmtVal(v, p.decimales) } },
    stroke: { width: 2.5, curve: "straight" },
    markers: { size: 4 },
    annotations: { yaxis: [{ y: p.seuil, borderColor: "#dc2626", strokeDashArray: 5, label: { text: `Seuil ${fmtVal(p.seuil, p.decimales)} ${p.unite}`, style: { color: "#fff", background: "#dc2626" } } }] },
    legend: { position: "bottom" },
    tooltip: { y: { formatter: (v) => (v === null || v === undefined ? "—" : `${fmtVal(v, p.decimales)} ${p.unite}`) } },
    noData: { text: `Aucune mesure sur les ${sem.length} dernières semaines` },
  };
}
