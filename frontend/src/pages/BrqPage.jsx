import React, { useEffect, useState } from "react";
import { SAISIE_LABEL, STATUT_HEX, STATUT_LABEL, STATUT_ORDER, api, frDate, isoToday, saisiesText } from "../api";
import { Modal } from "../components/ui";

const newVisite = () => ({ site_id: "", nouveau: false, nouveau_site: { localite: "", departement: "Gagnoa", sous_prefecture: "" }, unite: "", constat: "tenu", saisies: {}, interpelles: 0, note: "" });

export default function BrqPage() {
  const [brqs, setBrqs] = useState([]);
  const [sites, setSites] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => Promise.all([api("/brq"), api("/sites")]).then(([b, s]) => { setBrqs(b); setSites(s); });
  useEffect(() => { load(); }, []);

  const today = isoToday();
  const hasToday = brqs.some((b) => b.date === today);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Bulletins de relevé quotidien</div>
          <h1>BRQ</h1>
          <p>Chaque visite de site enregistrée ici met à jour le statut du site sur la carte et les indicateurs du tableau de bord.</p>
        </div>
        <button className="btn primary" type="button" onClick={() => setEditing({ date: today, reference: "", unites: "", observations: "", visites: [newVisite()] })}>Saisir un BRQ</button>
      </div>
      {!hasToday && <div className="card" style={{ background: "var(--warn-soft)", borderColor: "var(--warn)", marginBottom: 14, fontSize: 13.5 }}>Aucun BRQ enregistré pour aujourd'hui ({frDate(today)}).</div>}
      <div className="grid">
        {brqs.map((b) => (
          <div key={b.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <h3>BRQ du {frDate(b.date)}</h3>
                <div className="muted" style={{ fontSize: 13 }}>{[b.unites, b.reference].filter(Boolean).join(" · ")}</div>
              </div>
              <button className="btn small" type="button" onClick={() => setEditing({ ...b, visites: b.visites.map((v) => ({ ...newVisite(), ...v, site_id: v.site_id || "" })) })}>Modifier</button>
            </div>
            <div className="table-box" style={{ marginTop: 10 }}>
              <table>
                <thead><tr><th>Site</th><th>Constat</th><th>Saisies</th><th>Interpellés</th><th>Note</th></tr></thead>
                <tbody>
                  {b.visites.map((v) => (
                    <tr key={v.id}>
                      <td><span className="mono" style={{ fontWeight: 600 }}>{v.site_code || "—"}</span> {v.site_localite}</td>
                      <td><span className="pill"><span className="dot" style={{ background: STATUT_HEX[v.constat] }} />{v.constat_label}</span></td>
                      <td>{saisiesText(v.saisies) || "—"}</td>
                      <td className="num">{v.interpelles || "—"}</td>
                      <td style={{ maxWidth: 360 }}>{v.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {b.observations && <p style={{ margin: "10px 0 0", fontSize: 13.5 }}>{b.observations}</p>}
          </div>
        ))}
        {!brqs.length && <div className="card empty">Aucun BRQ enregistré. Commencez par « Saisir un BRQ ».</div>}
      </div>
      {editing && <BrqForm init={editing} sites={sites} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function BrqForm({ init, sites, onClose, onSaved }) {
  const [b, setB] = useState(init);
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const setV = (i, patch) => setB({ ...b, visites: b.visites.map((v, j) => (j === i ? { ...v, ...patch } : v)) });

  async function save(e) {
    e.preventDefault();
    setErr("");
    for (const [i, v] of b.visites.entries()) {
      if (!v.nouveau && !v.site_id) { setErr(`Visite ${i + 1} : choisissez un site ou « Nouveau site ».`); return; }
      if (v.nouveau && !v.nouveau_site.localite.trim()) { setErr(`Visite ${i + 1} : indiquez la localité du nouveau site.`); return; }
    }
    const body = {
      date: b.date, reference: b.reference, unites: b.unites, observations: b.observations,
      visites: b.visites.map((v) => ({
        site_id: v.nouveau ? null : v.site_id, nouveau_site: v.nouveau ? v.nouveau_site : null, unite: v.unite, constat: v.constat,
        saisies: Object.fromEntries(Object.entries(v.saisies).filter(([, n]) => Number(n) > 0).map(([k, n]) => [k, Number(n)])),
        interpelles: Number(v.interpelles) || 0, note: v.note,
      })),
    };
    try { await api(b.id ? "/brq/" + b.id : "/brq", { method: b.id ? "PUT" : "POST", body }); onSaved(); } catch (x) { setErr(x.message); }
  }

  return (
    <Modal title={b.id ? `Modifier le BRQ du ${frDate(b.date)}` : "Nouveau BRQ"} onClose={onClose} wide>
      <form className="grid" onSubmit={save}>
        <div className="fgrid">
          <label className="f">Date<input type="date" value={b.date} max={isoToday()} onChange={(e) => setB({ ...b, date: e.target.value })} required /></label>
          <label className="f">Référence <small>n° du bulletin</small><input value={b.reference} onChange={(e) => setB({ ...b, reference: e.target.value })} /></label>
          <label className="f">Unités engagées<input value={b.unites} onChange={(e) => setB({ ...b, unites: e.target.value })} placeholder="DREF / PEF Galébré" /></label>
        </div>
        {b.visites.map((v, i) => (
          <fieldset key={i} className="card" style={{ margin: 0 }}>
            <legend style={{ fontWeight: 700, padding: "0 6px" }}>Visite {i + 1}</legend>
            <div className="grid">
              <div className="fgrid">
                <label className="f">Site
                  <select value={v.nouveau ? "__new" : v.site_id} onChange={(e) => setV(i, e.target.value === "__new" ? { nouveau: true, site_id: "" } : { nouveau: false, site_id: e.target.value })}>
                    <option value="">Choisir…</option>
                    {["Gagnoa", "Oumé"].map((d) => (
                      <optgroup key={d} label={d}>{sites.filter((s) => s.departement === d).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.localite}</option>)}</optgroup>
                    ))}
                    <option value="__new">+ Nouveau site</option>
                  </select>
                </label>
                <label className="f">Constat<select value={v.constat} onChange={(e) => setV(i, { constat: e.target.value })}>{STATUT_ORDER.map((k) => <option key={k} value={k}>{STATUT_LABEL[k]}</option>)}</select></label>
                <label className="f">Unité <small>si différente</small><input value={v.unite} onChange={(e) => setV(i, { unite: e.target.value })} /></label>
                <label className="f">Interpellés<input type="number" min="0" value={v.interpelles} onChange={(e) => setV(i, { interpelles: e.target.value })} /></label>
              </div>
              {v.nouveau && (
                <div className="fgrid">
                  <label className="f">Localité du nouveau site<input value={v.nouveau_site.localite} onChange={(e) => setV(i, { nouveau_site: { ...v.nouveau_site, localite: e.target.value } })} /></label>
                  <label className="f">Département<select value={v.nouveau_site.departement} onChange={(e) => setV(i, { nouveau_site: { ...v.nouveau_site, departement: e.target.value } })}><option>Gagnoa</option><option>Oumé</option></select></label>
                  <label className="f">Sous-préfecture<input value={v.nouveau_site.sous_prefecture} onChange={(e) => setV(i, { nouveau_site: { ...v.nouveau_site, sous_prefecture: e.target.value } })} /></label>
                </div>
              )}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Matériel saisi</div>
                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                  {Object.entries(SAISIE_LABEL).map(([k, l]) => (
                    <label key={k} className="f" style={{ fontWeight: 400 }}>{l}<input type="number" min="0" step="1" value={v.saisies[k] ?? ""} onChange={(e) => setV(i, { saisies: { ...v.saisies, [k]: e.target.value } })} /></label>
                  ))}
                </div>
              </div>
              <label className="f">Constats et observations<textarea style={{ minHeight: 60 }} value={v.note} onChange={(e) => setV(i, { note: e.target.value })} /></label>
              {b.visites.length > 1 && <div><button className="btn small danger" type="button" onClick={() => setB({ ...b, visites: b.visites.filter((_, j) => j !== i) })}>Retirer cette visite</button></div>}
            </div>
          </fieldset>
        ))}
        <div><button className="btn" type="button" onClick={() => setB({ ...b, visites: [...b.visites, newVisite()] })}>+ Ajouter une visite</button></div>
        <label className="f">Observations générales<textarea value={b.observations} onChange={(e) => setB({ ...b, observations: e.target.value })} /></label>
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            {b.id && !confirmDel && <button className="btn danger" type="button" onClick={() => setConfirmDel(true)}>Supprimer ce BRQ</button>}
            {confirmDel && <span className="row"><span className="err">Les statuts issus de ce BRQ seront retirés.</span>
              <button className="btn danger" type="button" onClick={() => api("/brq/" + b.id, { method: "DELETE" }).then(onSaved).catch((x) => setErr(x.message))}>Confirmer</button>
              <button className="btn" type="button" onClick={() => setConfirmDel(false)}>Annuler</button></span>}
          </div>
          <button className="btn primary" type="submit">Enregistrer le BRQ</button>
        </div>
      </form>
    </Modal>
  );
}
