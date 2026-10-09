import React, { useEffect, useState } from "react";
import { STATUT_HEX, STATUT_LABEL, STATUT_ORDER, addDays, api, frDate, isoToday, saisiesText } from "../api";
import { useAuth } from "../context";

const monday = (iso) => { const d = new Date(iso + "T00:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; return addDays(iso, -wd); };

export default function Hebdo() {
  const { user } = useAuth();
  const [week, setWeek] = useState(monday(isoToday()));
  const [reports, setReports] = useState([]);
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [form, setForm] = useState({ synthese: "", difficultes: "", recommandations: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const loadReports = () => api("/hebdo").then(setReports);
  useEffect(() => { loadReports(); }, []);
  useEffect(() => {
    setMsg(""); setErr("");
    api(`/hebdo/${week}/donnees`).then(setData);
    api("/stats", { params: { at: addDays(week, 6) > isoToday() ? isoToday() : addDays(week, 6) } }).then(setStats);
  }, [week]);
  const rep = reports.find((r) => r.semaine_debut === week);
  useEffect(() => { setForm(rep ? { synthese: rep.synthese, difficultes: rep.difficultes, recommandations: rep.recommandations } : { synthese: "", difficultes: "", recommandations: "" }); }, [rep && rep.id, week]);

  const w = stats && stats.series.find((s) => s.semaine === week);
  const visites = data ? data.brq.flatMap((b) => b.visites.map((v) => ({ ...v, date: b.date }))) : [];

  async function save() {
    try { await api(`/hebdo/${week}`, { method: "PUT", body: form }); setMsg("Rapport enregistré."); setErr(""); loadReports(); } catch (x) { setErr(x.message); }
  }
  async function validate(v) {
    try { await api(`/hebdo/${week}/validation`, { method: "POST", params: { valide: v } }); setMsg(v ? "Rapport validé." : "Rapport rouvert."); loadReports(); } catch (x) { setErr(x.message); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Comité régional · réunion hebdomadaire</div>
          <h1>Rapport hebdomadaire</h1>
          <p>Les chiffres viennent des BRQ de la semaine. Rédigez la synthèse, puis le chef de cellule valide le rapport avant transmission.</p>
        </div>
        <div className="row">
          <button className="btn" type="button" onClick={() => setWeek(addDays(week, -7))}>← Semaine précédente</button>
          <input type="date" value={week} onChange={(e) => e.target.value && setWeek(monday(e.target.value))} style={{ width: 160 }} aria-label="Semaine" />
          <button className="btn" type="button" disabled={addDays(week, 7) > isoToday()} onClick={() => setWeek(addDays(week, 7))}>Semaine suivante →</button>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", alignItems: "start" }}>
        <div className="card grid">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Semaine du {frDate(week)} au {frDate(addDays(week, 6))}</h2>
            {rep && rep.valide ? <span className="pill ok">Validé le {frDate(rep.date_validation)}</span> : <span className="pill">{rep ? "Brouillon" : "Non rédigé"}</span>}
          </div>
          {w ? (
            <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
              <div className="kpi"><div className="lbl">Jours avec BRQ</div><div className="val">{w.jours_brq}/{w.jours_semaine}</div></div>
              <div className="kpi"><div className="lbl">Visites</div><div className="val">{w.visites}</div></div>
              <div className="kpi"><div className="lbl">Tentatives</div><div className="val">{w.tentatives_reprise}</div></div>
              <div className="kpi"><div className="lbl">Interpellés</div><div className="val">{w.interpelles}</div></div>
            </div>
          ) : <div className="muted">Aucune donnée pour cette semaine.</div>}
          {w && (
            <div className="legend">
              <div className="muted" style={{ fontSize: 12.5 }}>Statut des sites en fin de semaine</div>
              {STATUT_ORDER.filter((k) => w.par_statut[k]).map((k) => <div key={k}><span className="dot" style={{ background: STATUT_HEX[k] }} /><span style={{ flex: 1 }}>{STATUT_LABEL[k]}</span><b>{w.par_statut[k]}</b></div>)}
            </div>
          )}
          <div>
            <h3 style={{ marginBottom: 6 }}>Visites de la semaine</h3>
            {visites.length ? visites.map((v) => (
              <div key={v.id} style={{ fontSize: 13, borderLeft: `3px solid ${STATUT_HEX[v.constat]}`, paddingLeft: 8, marginBottom: 6 }}>
                <b>{frDate(v.date)}</b> · {v.site_code} {v.site_localite} — {v.constat_label}{saisiesText(v.saisies) ? ` · saisies : ${saisiesText(v.saisies)}` : ""}{v.interpelles ? ` · ${v.interpelles} interpellé(s)` : ""}
              </div>
            )) : <div className="muted">Aucune visite enregistrée.</div>}
          </div>
        </div>
        <div className="card grid">
          <label className="f">Synthèse de la semaine<textarea value={form.synthese} disabled={rep && rep.valide} onChange={(e) => setForm({ ...form, synthese: e.target.value })} style={{ minHeight: 140 }} /></label>
          <label className="f">Difficultés rencontrées<textarea value={form.difficultes} disabled={rep && rep.valide} onChange={(e) => setForm({ ...form, difficultes: e.target.value })} /></label>
          <label className="f">Recommandations au comité<textarea value={form.recommandations} disabled={rep && rep.valide} onChange={(e) => setForm({ ...form, recommandations: e.target.value })} /></label>
          {msg && <div className="okmsg">{msg}</div>}
          {err && <div className="err">{err}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            {!(rep && rep.valide) && <button className="btn primary" type="button" onClick={save}>Enregistrer</button>}
            {user.role === "chef" && rep && !rep.valide && <button className="btn" type="button" onClick={() => validate(true)}>Valider</button>}
            {user.role === "chef" && rep && rep.valide && <button className="btn" type="button" onClick={() => validate(false)}>Rouvrir</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
