import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { STATUT_HEX, STATUT_LABEL, STATUT_ORDER, api, frDate, isoToday } from "../api";
import { useAuth } from "../context";
import { CoordFields, Modal, coordOrNull, readJsonFile } from "../components/ui";

const EMPTY = { localite: "", departement: "Gagnoa", sous_prefecture: "", domaine: "rural", foret: "", ugf: "", cours_eau: "",
  coord: { sys: "wgs", x: "", y: "" }, superficie_ha: "", priorite: "normale", observations: "", statut_initial: "actif", date_statut: isoToday() };

export default function Sites() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [sites, setSites] = useState([]);
  const [q, setQ] = useState("");
  const [dep, setDep] = useState("");
  const [st, setSt] = useState("");
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useSearchParams();
  const [openId, setOpenIdRaw] = useState(params.get("site"));
  const setOpenId = (id) => { setOpenIdRaw(id); setParams(id ? { site: id } : {}, { replace: true }); };
  const [importing, setImporting] = useState(false);
  const load = () => api("/sites").then(setSites);
  useEffect(() => { load(); }, []);

  const list = sites.filter((s) => (!dep || s.departement === dep) && (!st || s.statut === st) &&
    (!q || [s.code, s.localite, s.sous_prefecture, s.foret, s.cours_eau].join(" ").toLowerCase().includes(q.toLowerCase())));
  const alerts = sites.filter((s) => s.coord_alerte).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Registre</div>
          <h1>Sites d'orpaillage</h1>
          <p>{sites.length} sites enregistrés. Le statut affiché est le dernier connu ; l'historique complet est dans la fiche de chaque site.</p>
        </div>
        <div className="row">
          <button className="btn" type="button" onClick={() => setImporting(true)}>Importer (CSV, GeoJSON)</button>
          <button className="btn btn-primary" type="button" onClick={() => setCreating(true)}>Nouveau site</button>
        </div>
      </div>
      {alerts > 0 && <div className="card" style={{ background: "var(--warn-soft)", borderColor: "var(--warn)", marginBottom: 14, fontSize: 13.5 }}>{alerts} site(s) sans coordonnées ou avec des coordonnées hors de la région. Ils sont signalés par une pastille orange.</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="search" placeholder="Rechercher : code, localité, forêt…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 240px" }} aria-label="Rechercher" />
        <select value={dep} onChange={(e) => setDep(e.target.value)} style={{ width: 170 }} aria-label="Département"><option value="">Tous départements</option><option>Gagnoa</option><option>Oumé</option></select>
        <select value={st} onChange={(e) => setSt(e.target.value)} style={{ width: 210 }} aria-label="Statut"><option value="">Tous statuts</option>{STATUT_ORDER.map((k) => <option key={k} value={k}>{STATUT_LABEL[k]}</option>)}</select>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Code</th><th>Localité</th><th>Département</th><th>Domaine</th><th>Statut actuel</th><th>Depuis</th><th>Coordonnées</th></tr></thead>
          <tbody>
            {list.map((s) => {
              const last = s.events[s.events.length - 1];
              return (
                <tr key={s.id} className="clickable" tabIndex={0} onClick={() => setOpenId(s.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(s.id)}>
                  <td className="mono" style={{ fontWeight: 600 }}>{s.code}</td>
                  <td>{s.localite}<div className="muted" style={{ fontSize: 12 }}>{s.sous_prefecture}</div></td>
                  <td>{s.departement}</td>
                  <td>{s.domaine === "foret_classee" ? s.foret || "Forêt classée" : "Domaine rural"}</td>
                  <td>{s.statut ? <span className="badge"><span className="dot" style={{ background: STATUT_HEX[s.statut] }} />{STATUT_LABEL[s.statut]}</span> : <span className="muted">—</span>}</td>
                  <td className="num">{last ? frDate(last.date) : "—"}</td>
                  <td className="mono" style={{ fontSize: 12.5 }}>{s.lat != null ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : ""}{s.coord_alerte && <div><span className="badge amber" style={{ fontFamily: "var(--f-body)" }}>{s.lat == null ? "à géolocaliser" : "à vérifier"}</span></div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && <div className="empty">Aucun site ne correspond à ces filtres.</div>}
      </div>
      {creating && <NewSite onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {importing && <ImportSites onClose={() => setImporting(false)} onDone={load} />}
      {openId && <SiteModal id={openId} canDelete={user.role === "chef"} onClose={() => setOpenId(null)} onChanged={load}
        onMap={() => nav(`/carte?site=${openId}`)} />}
    </div>
  );
}

function SiteForm({ v, set }) {
  const f = (k) => (e) => set({ ...v, [k]: e.target.value });
  return (
    <div className="grid">
      <div className="fgrid">
        <label className="f">Localité / village<input value={v.localite} onChange={f("localite")} required /></label>
        <label className="f">Département<select value={v.departement} onChange={f("departement")} disabled={v._lockDep}><option>Gagnoa</option><option>Oumé</option></select></label>
        <label className="f">Sous-préfecture<input value={v.sous_prefecture} onChange={f("sous_prefecture")} /></label>
        <label className="f">Domaine<select value={v.domaine} onChange={f("domaine")}><option value="rural">Domaine rural</option><option value="foret_classee">Forêt classée</option></select></label>
        {v.domaine === "foret_classee" && <label className="f">Forêt classée<input value={v.foret} onChange={f("foret")} /></label>}
        {v.domaine === "foret_classee" && <label className="f">UGF<input value={v.ugf} onChange={f("ugf")} /></label>}
        <label className="f">Cours d'eau concerné<input value={v.cours_eau} onChange={f("cours_eau")} /></label>
        <label className="f">Priorité<select value={v.priorite} onChange={f("priorite")}><option value="normale">Normale</option><option value="haute">Haute</option></select></label>
        <label className="f">Superficie (ha) <small>si pas de contour</small><input type="number" min="0" step="0.01" value={v.superficie_ha ?? ""} onChange={f("superficie_ha")} /></label>
      </div>
      <CoordFields value={v.coord} onChange={(c) => set({ ...v, coord: c })} />
      <label className="f">Observations<textarea value={v.observations} onChange={f("observations")} /></label>
    </div>
  );
}

function NewSite({ onClose, onSaved }) {
  const [v, setV] = useState(EMPTY);
  const [err, setErr] = useState("");
  async function save(e) {
    e.preventDefault();
    setErr("");
    try {
      await api("/sites", { method: "POST", body: { ...v, coord: coordOrNull(v.coord), superficie_ha: v.superficie_ha === "" ? null : Number(v.superficie_ha) } });
      onSaved();
    } catch (x) { setErr(x.message); }
  }
  return (
    <Modal title="Nouveau site" onClose={onClose}>
      <form className="grid" onSubmit={save}>
        <SiteForm v={v} set={setV} />
        <div className="fgrid">
          <label className="f">Statut constaté<select value={v.statut_initial} onChange={(e) => setV({ ...v, statut_initial: e.target.value })}>{STATUT_ORDER.map((k) => <option key={k} value={k}>{STATUT_LABEL[k]}</option>)}</select></label>
          <label className="f">Date du constat<input type="date" value={v.date_statut} max={isoToday()} onChange={(e) => setV({ ...v, date_statut: e.target.value })} /></label>
        </div>
        {err && <div className="alert error">{err}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary" type="submit">Enregistrer le site</button></div>
      </form>
    </Modal>
  );
}

function SiteModal({ id, canDelete, onClose, onChanged, onMap }) {
  const [s, setS] = useState(null);
  const [edit, setEdit] = useState(null);
  const [ev, setEv] = useState({ date: isoToday(), statut: "tenu", note: "", source: "saisie" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const fileRef = useRef(null);
  const load = () => api("/sites/" + id).then(setS).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  const done = (m) => { setMsg(m); setErr(""); load(); onChanged(); };
  const fail = (x) => { setErr(x.message); setMsg(""); };

  if (!s) return <Modal title="Chargement…" onClose={onClose}>{err && <div className="alert error">{err}</div>}</Modal>;

  async function saveEdit(e) {
    e.preventDefault();
    const body = { ...edit, superficie_ha: edit.superficie_ha === "" || edit.superficie_ha == null ? null : Number(edit.superficie_ha) };
    delete body._lockDep; delete body.departement;
    if (!coordOrNull(edit.coord)) delete body.coord;
    try { await api("/sites/" + id, { method: "PATCH", body }); setEdit(null); done("Site mis à jour."); } catch (x) { fail(x); }
  }
  async function addEvent(e) {
    e.preventDefault();
    try { await api(`/sites/${id}/events`, { method: "POST", body: ev }); setEv({ ...ev, note: "" }); done("Statut ajouté."); } catch (x) { fail(x); }
  }
  async function contour(file) {
    if (!file) return;
    try { const g = await readJsonFile(file); const r = await api(`/sites/${id}/contour`, { method: "PUT", body: g }); done(`Contour enregistré : ${r.superficie_ha} ha.`); }
    catch (x) { fail(x instanceof SyntaxError ? new Error("Fichier GeoJSON illisible") : x); }
    finally { fileRef.current.value = ""; }
  }

  return (
    <Modal title={`${s.code} · ${s.localite}`} sub={[s.sous_prefecture, s.departement, s.foret].filter(Boolean).join(" · ")} onClose={onClose} wide>
      <div className="grid" style={{ gap: 16 }}>
        <div className="row">
          <button className="btn" type="button" onClick={onMap} disabled={s.lat == null}>Voir sur la carte</button>
          <button className="btn" type="button" onClick={() => setEdit({ ...s, coord: s.coord_saisie ? { sys: s.coord_saisie.sys, x: s.coord_saisie.x, y: s.coord_saisie.y } : { sys: "wgs", x: "", y: "" }, _lockDep: true })}>Modifier</button>
          <button className="btn" type="button" onClick={() => fileRef.current.click()}>{s.contour ? "Remplacer le contour" : "Ajouter un contour (GeoJSON)"}</button>
          <input ref={fileRef} type="file" accept=".geojson,.json" hidden onChange={(e) => contour(e.target.files[0])} />
          {s.contour && <button className="btn" type="button" onClick={() => api(`/sites/${id}/contour`, { method: "DELETE" }).then(() => done("Contour retiré.")).catch(fail)}>Retirer le contour</button>}
          {canDelete && !confirmDel && <button className="btn btn-danger" type="button" onClick={() => setConfirmDel(true)}>Supprimer le site</button>}
          {confirmDel && <span className="row"><span className="alert error">Supprimer définitivement ce site et son historique ?</span>
            <button className="btn btn-danger" type="button" onClick={() => api("/sites/" + id, { method: "DELETE" }).then(() => { onChanged(); onClose(); }).catch(fail)}>Oui, supprimer</button>
            <button className="btn" type="button" onClick={() => setConfirmDel(false)}>Annuler</button></span>}
        </div>
        {msg && <div className="alert success">{msg}</div>}
        {err && <div className="alert error">{err}</div>}
        {s.coord_alerte && <div className="badge amber" style={{ whiteSpace: "normal" }}>{s.coord_alerte}</div>}

        {edit ? (
          <form className="card grid" onSubmit={saveEdit}>
            <SiteForm v={edit} set={setEdit} />
            <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" type="button" onClick={() => setEdit(null)}>Annuler</button><button className="btn btn-primary" type="submit">Enregistrer</button></div>
          </form>
        ) : (
          <div className="fgrid" style={{ fontSize: 13.5 }}>
            <div><div className="muted">Coordonnées</div><div className="mono">{s.lat != null ? `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}` : "Non renseignées"}</div>{s.coord_saisie && s.coord_saisie.sys !== "wgs" && <div className="muted mono">UTM {s.coord_saisie.sys}N : {s.coord_saisie.x} / {s.coord_saisie.y}</div>}</div>
            <div><div className="muted">Superficie</div><div>{s.superficie_ha ? s.superficie_ha + " ha" + (s.contour ? " (contour)" : " (estimée)") : "—"}</div></div>
            <div><div className="muted">Cours d'eau</div><div>{s.cours_eau || "—"}</div></div>
            <div><div className="muted">Priorité</div><div>{s.priorite === "haute" ? "Haute" : "Normale"}</div></div>
            {s.observations && <div style={{ gridColumn: "1 / -1" }}><div className="muted">Observations</div><div>{s.observations}</div></div>}
          </div>
        )}

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
          <div className="card">
            <h3 style={{ marginBottom: 10 }}>Historique des statuts</h3>
            <div className="timeline">
              {[...s.events].reverse().map((e) => (
                <div key={e.id} className="ev" style={{ borderLeftColor: STATUT_HEX[e.statut] }}>
                  <div className="d">{frDate(e.date)} · {e.source === "brq" ? "BRQ" : e.source}</div>
                  <div style={{ fontWeight: 600 }}>{STATUT_LABEL[e.statut]}</div>
                  {e.note && <div className="muted">{e.note}</div>}
                  {e.source !== "brq" && <button className="btn btn-sm" style={{ marginTop: 4 }} type="button" onClick={() => api(`/sites/${id}/events/${e.id}`, { method: "DELETE" }).then(() => done("Statut retiré.")).catch(fail)}>Retirer</button>}
                </div>
              ))}
              {!s.events.length && <div className="muted">Aucun statut enregistré.</div>}
            </div>
          </div>
          <form className="card grid" onSubmit={addEvent}>
            <h3>Ajouter un constat</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Pour un constat hors BRQ (image satellite, survol drone, information confirmée). Les visites de terrain passent par les BRQ.</p>
            <div className="fgrid">
              <label className="f">Date<input type="date" value={ev.date} max={isoToday()} onChange={(e) => setEv({ ...ev, date: e.target.value })} required /></label>
              <label className="f">Statut<select value={ev.statut} onChange={(e) => setEv({ ...ev, statut: e.target.value })}>{STATUT_ORDER.map((k) => <option key={k} value={k}>{STATUT_LABEL[k]}</option>)}</select></label>
              <label className="f">Source<select value={ev.source} onChange={(e) => setEv({ ...ev, source: e.target.value })}>
                <option value="saisie">Saisie</option><option value="satellite">Image satellite</option><option value="drone">Survol drone</option><option value="fiche">Fiche de renseignement</option><option value="rapport">Rapport</option></select></label>
            </div>
            <label className="f">Note<input value={ev.note} onChange={(e) => setEv({ ...ev, note: e.target.value })} /></label>
            <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary" type="submit">Ajouter</button></div>
          </form>
        </div>
      </div>
    </Modal>
  );
}

function ImportSites({ onClose, onDone }) {
  const [sys, setSys] = useState("30");
  const [statut, setStatut] = useState("");
  const [d, setD] = useState(isoToday());
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [file, setFile] = useState(null);
  async function go(e) {
    e.preventDefault();
    if (!file) { setErr("Choisissez un fichier."); return; }
    const fd = new FormData();
    fd.append("file", file);
    try { const r = await api("/sites/import", { method: "POST", form: fd, params: { sys, statut, date_statut: statut ? d : "" } }); setRes(r); setErr(""); onDone(); }
    catch (x) { setErr(x.message); }
  }
  return (
    <Modal title="Importer des sites" sub="CSV (séparateur ; ou ,) ou GeoJSON de points" onClose={onClose}>
      <form className="grid" onSubmit={go}>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Colonnes reconnues : localite, departement (Gagnoa ou Oumé), sous_prefecture, x, y, foret, cours_eau, statut, observations. Un seul système de coordonnées par fichier : séparez les sites de Sérihio (UTM 29N) de ceux d'Oumé (UTM 30N).</p>
        <div className="fgrid">
          <label className="f">Fichier<input type="file" accept=".csv,.geojson,.json" onChange={(e) => setFile(e.target.files[0])} /></label>
          <label className="f">Coordonnées du fichier<select value={sys} onChange={(e) => setSys(e.target.value)}><option value="wgs">WGS84 décimal</option><option value="29">UTM 29N</option><option value="30">UTM 30N</option></select></label>
          <label className="f">Statut par défaut<select value={statut} onChange={(e) => setStatut(e.target.value)}><option value="">Aucun</option>{STATUT_ORDER.map((k) => <option key={k} value={k}>{STATUT_LABEL[k]}</option>)}</select></label>
          {statut && <label className="f">Date du statut<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>}
        </div>
        {err && <div className="alert error">{err}</div>}
        {res && <div className="alert success">{res.importes} site(s) importé(s).{res.erreurs.length ? ` ${res.erreurs.length} ligne(s) ignorée(s) : ${res.erreurs[0]}` : ""}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary" type="submit">Importer</button></div>
      </form>
    </Modal>
  );
}
