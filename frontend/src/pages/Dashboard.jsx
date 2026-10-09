import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SAISIE_LABEL, STATUT_HEX, STATUT_LABEL, STATUT_ORDER, api, frDate, isoToday } from "../api";
import { useView } from "../context";

const pct = (x) => (x == null ? "—" : Math.round(x * 100) + " %");
const shortWeek = (iso) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
const nf = (x) => Number(x).toLocaleString("fr-FR", { maximumFractionDigits: 1 });

function Kpi({ label, value, sub, tone, target, ratio, inverse }) {
  return (
    <div className={"card kpi " + (tone || "")}>
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {ratio != null && (
        <div className="bar" aria-hidden="true">
          <i style={{ width: Math.min(100, ratio * 100) + "%", background: tone === "crit" ? "var(--crit)" : tone === "warn" ? "var(--warn)" : "var(--ok)" }} />
          {target != null && <b style={{ left: target * 100 + "%" }} />}
        </div>
      )}
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, note, children }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {note && <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>{note}</div>}
      <div style={{ height: 250 }}>{children}</div>
    </div>
  );
}

const axis = { fontSize: 11, fill: "var(--muted)" };

export default function Dashboard() {
  const nav = useNavigate();
  const { date, setDate, departement, setDepartement } = useView();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/stats", { params: { at: date, departement } }).then(setData).catch((e) => setErr(e.message));
  }, [date, departement]);

  const k = data && data.kpi;
  const series = (data && data.series) || [];
  const rows = series.map((w) => ({
    semaine: shortWeek(w.semaine), fin: w.fin, ...w.par_statut, visites: w.visites, tentatives: w.tentatives_reprise,
    saisies: w.saisies_total, interpelles: w.interpelles, brq: w.jours_brq, sans_brq: Math.max(0, w.jours_semaine - w.jours_brq),
  }));
  const totals = {};
  series.forEach((w) => Object.entries(w.saisies).forEach(([key, n]) => { totals[key] = (totals[key] || 0) + n; }));
  const selWeek = (series.find((w) => w.semaine <= date && date <= w.fin) || {}).semaine;
  const selLabel = selWeek ? shortWeek(selWeek) : null;
  const marker = selLabel ? <ReferenceLine x={selLabel} stroke="var(--accent)" strokeDasharray="4 3" strokeWidth={2} /> : null;
  const pick = (e) => { if (e && e.activePayload && e.activePayload[0]) setDate(e.activePayload[0].payload.fin); };

  const neutr = k && k.taux_neutralisation;
  const recol = k && k.taux_recolonisation_3m;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Plan d'action 22/09/2026 – 31/03/2027</div>
          <h1>Tableau de bord</h1>
          <p>Indicateurs au {frDate(date)}, calculés à partir des BRQ et des statuts des sites. La ligne pointillée marque la semaine affichée ; cliquez sur une autre semaine pour vous y placer, sur la carte comme ici.</p>
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Département">
            {[["", "Gôh"], ["Gagnoa", "Gagnoa"], ["Oumé", "Oumé"]].map(([v, l]) => (
              <button key={l} type="button" aria-pressed={departement === v} onClick={() => setDepartement(v)}>{l}</button>
            ))}
          </div>
          <input type="date" value={date} max={isoToday()} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 160 }} aria-label="Date" />
          <button className="btn" type="button" onClick={() => nav("/carte")}>Voir sur la carte</button>
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      {k && (
        <div className="grid" style={{ gap: 16 }}>
          <div className="kpis">
            <Kpi label="Sites recensés" value={k.sites_recenses} sub={`${k.sites_actifs} actif(s) ou recolonisé(s)`} />
            <Kpi label="Sites neutralisés" value={pct(neutr)} ratio={neutr} target={k.cible_neutralisation}
              tone={neutr == null ? "" : neutr >= k.cible_neutralisation ? "ok" : "warn"} sub={`Cible : ${pct(k.cible_neutralisation)} au moins`} />
            <Kpi label="Recolonisation à 3 mois" value={pct(recol)}
              tone={recol == null ? "" : recol <= k.cible_recolonisation_3m ? "ok" : "crit"}
              sub={recol == null ? "Mesurable 90 jours après un démantèlement" : `${k.recolonisation_eligibles} site(s) mesuré(s) · cible ≤ ${pct(k.cible_recolonisation_3m)}`} />
            <Kpi label="Tentatives de reprise (30 j)" value={k.tentatives_reprise_30j} tone={k.tentatives_reprise_30j ? "warn" : "ok"} sub="Constatées dans les BRQ" />
            <Kpi label="Cours d'eau impactés" value={nf(k.lineaire_impacte_km) + " km"} sub="Longueur dans la région des cours d'eau impactés" />
            <Kpi label="BRQ reçus (7 j)" value={`${k.brq_7j} / 7`} tone={k.brq_7j >= 7 ? "ok" : k.brq_7j >= 4 ? "warn" : "crit"} sub="Jours couverts par un BRQ" />
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
            <ChartCard title="Statut des sites, semaine par semaine" note="Situation en fin de semaine">
              <ResponsiveContainer>
                <BarChart data={rows} onClick={pick} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="semaine" tick={axis} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                  <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
                  {marker}
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", fontSize: 12 }} labelFormatter={(l) => "Semaine du " + l} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {STATUT_ORDER.map((s) => <Bar key={s} dataKey={s} name={STATUT_LABEL[s]} stackId="st" fill={STATUT_HEX[s]} />)}
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Visites de sites et tentatives de reprise" note="Nombre de visites consignées dans les BRQ">
              <ResponsiveContainer>
                <BarChart data={rows} onClick={pick} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="semaine" tick={axis} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                  <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
                  {marker}
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", fontSize: 12 }} labelFormatter={(l) => "Semaine du " + l} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="visites" name="Visites" fill="#6b8f7a" />
                  <Bar dataKey="tentatives" name="Tentatives de reprise" fill={STATUT_HEX.tentative_reprise} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Matériel saisi et personnes interpellées" note="Hors tuyaux (comptés en mètres)">
              <ResponsiveContainer>
                <BarChart data={rows} onClick={pick} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="semaine" tick={axis} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                  <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
                  {marker}
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", fontSize: 12 }} labelFormatter={(l) => "Semaine du " + l} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="saisies" name="Objets saisis" fill="#9c4f17" />
                  <Bar dataKey="interpelles" name="Interpellés" fill="#2a5e88" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Régularité des BRQ" note="Jours couverts par un BRQ, sur les jours de la semaine">
              <ResponsiveContainer>
                <BarChart data={rows} onClick={pick} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="semaine" tick={axis} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                  <YAxis allowDecimals={false} domain={[0, 7]} tick={axis} tickLine={false} axisLine={false} />
                  {marker}
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", fontSize: 12 }} labelFormatter={(l) => "Semaine du " + l} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="brq" name="Avec BRQ" stackId="b" fill={STATUT_HEX.tenu} />
                  <Bar dataKey="sans_brq" name="Sans BRQ" stackId="b" fill="#c9d1c8" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Matériel saisi depuis le {frDate(data.periode.debut)}</h3>
            {Object.keys(totals).filter((x) => totals[x]).length ? (
              <div className="row" style={{ gap: 8 }}>
                {Object.entries(totals).filter(([, n]) => n).map(([key, n]) => <span key={key} className="pill"><b className="num">{n}</b> {SAISIE_LABEL[key]}</span>)}
              </div>
            ) : <div className="muted">Aucune saisie enregistrée sur la période.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
