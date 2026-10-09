import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context";
import React, { useEffect, useState } from "react";
import { api, frDate, isoToday } from "../api";
import { CoordFields, Modal, coordOrNull } from "../components/ui";

const NATURES = ["Nouveau site", "Site actif", "Recolonisation / reprise", "Pollution de cours d'eau", "Mouvement d'engins", "Filière (mercure, carburant, comptoir)", "Menace / sécurité", "Autre"];
const EQUIP = ["Motopompes", "Tapis de lavage", "Détecteurs de métaux", "Groupe électrogène", "Concasseur / broyeur", "Engin lourd (pelleteuse)", "Treuils", "Produits chimiques", "Motos / tricycles"];
const SOURCES = ["Informateur", "Patrouille / mission", "Autorité locale / chefferie", "Population (signalement)", "Autre service (gendarmerie, Mines…)", "Imagerie satellite", "Drone", "Presse / réseaux sociaux"];
const SUITES = ["Vérification terrain", "Mission d'éclairage", "Survol drone", "Analyse satellitaire", "Transmission à la cellule des opérations", "Recoupement auprès d'une autre source", "Classement sans suite"];
const ST = { a_verifier: ["À vérifier", "warn"], en_cours: ["Vérification en cours", "info"], confirmee: ["Confirmée", "crit"], infirmee: ["Infirmée", ""], exploitee: ["Exploitée", "ok"] };
const FIAB = { A: "Totalement fiable", B: "Habituellement fiable", C: "Assez fiable", D: "Pas toujours fiable", E: "Peu fiable", F: "Fiabilité inconnue" };
const CRED = { 1: "Confirmée par d'autres sources", 2: "Probablement vraie", 3: "Possiblement vraie", 4: "Douteuse", 5: "Improbable", 6: "Ne peut être évaluée" };

const EMPTY = () => ({ date_recu: isoToday(), heure_recu: "", date_faits: "", priorite: "routine", source_type: "", source_code: "", fiabilite: "F", credibilite: "6",
  departement: "", sous_prefecture: "", localite: "", foret: "", cours_eau: "", coord: { sys: "wgs", x: "", y: "" }, nature: [], equipements: [],
  personnes: "", superficie_ha: "", description: "", suite: SUITES[0] });

export default function Fiches() {
  const [fiches, setFiches] = useState([]);
  const [sites, setSites] = useState([]);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");
  const [st, setSt] = useState("");
  const [params] = useSearchParams();
  const load = () => Promise.all([api("/fiches"), api("/sites")]).then(([f, s]) => {
    setFiches(f);
    setSites(s);
    return f;
  });
  useEffect(() => {
    load().then((f) => {
      const cible = params.get("fiche");
      if (cible) setOpen(f.find((x) => x.id === cible) || null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const list = fiches.filter((f) => (!st || f.statut === st) && (!q || [f.numero, f.localite, f.description, f.source_code, f.nature.join(" ")].join(" ").toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Diffusion restreinte</div>
          <h1>Fiches de renseignement</h1>
          <p>Les informateurs sont identifiés par un code, jamais par leur nom. Une fiche confirmée peut être rattachée à un site du registre.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setCreating(true)}>Nouvelle fiche</button>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="search" placeholder="Rechercher : n°, localité, code source…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 240px" }} aria-label="Rechercher" />
        <select value={st} onChange={(e) => setSt(e.target.value)} style={{ width: 220 }} aria-label="Statut"><option value="">Tous les statuts</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>N° fiche</th><th>Reçue le</th><th>Localité</th><th>Nature</th><th>Cotation</th><th>Priorité</th><th>Statut</th></tr></thead>
          <tbody>
            {list.map((f) => (
              <tr key={f.id} className="clickable" tabIndex={0} onClick={() => setOpen(f)} onKeyDown={(e) => e.key === "Enter" && setOpen(f)}>
                <td className="mono" style={{ fontWeight: 600 }}>{f.numero}</td>
                <td className="num">{frDate(f.date_recu)}</td>
                <td>{f.localite}<div className="muted" style={{ fontSize: 12 }}>{f.departement}</div></td>
                <td>{f.nature.join(", ")}</td>
                <td className="mono">{f.cotation}</td>
                <td><span className={"badge " + (f.priorite === "urgente" ? "crit" : f.priorite === "importante" ? "warn" : "")}>{f.priorite}</span></td>
                <td><span className={"badge " + ST[f.statut][1]}>{ST[f.statut][0]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="empty">{fiches.length ? "Aucune fiche ne correspond." : "Aucune fiche pour l'instant. Les fiches saisies apparaîtront ici, de la plus récente à la plus ancienne."}</div>}
      </div>
      {creating && <NewFiche onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {open && <FicheModal key={open.id + open.historique.length} f={open} sites={sites} onClose={() => setOpen(null)} onSaved={(nf) => { setOpen(nf); load(); }} onDeleted={() => { setOpen(null); load(); }} />}
    </div>
  );
}

function Chips({ options, value, onChange }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {options.map((o) => {
        const on = value.includes(o);
        return <button key={o} type="button" className="badge" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
          style={{ cursor: "pointer", background: on ? "var(--accent-soft)" : "var(--gray-100)", border: `1px solid ${on ? "var(--accent)" : "var(--gray-200)"}`, fontWeight: on ? 600 : 500 }}>{o}</button>;
      })}
    </div>
  );
}

function NewFiche({ onClose, onSaved, initial }) {
  const [v, setV] = useState(() =>
    initial
      ? {
          ...EMPTY(),
          ...initial,
          date_faits: initial.date_faits || "",
          heure_recu: initial.heure_recu || "",
          personnes: initial.personnes ?? "",
          superficie_ha: initial.superficie_ha ?? "",
          coord: initial.coord_saisie
            ? { sys: initial.coord_saisie.sys, x: String(initial.coord_saisie.x ?? ""), y: String(initial.coord_saisie.y ?? "") }
            : { sys: "wgs", x: "", y: "" },
        }
      : EMPTY()
  );
  const [err, setErr] = useState("");
  const f = (k) => (e) => setV({ ...v, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    if (!v.nature.length) { setErr("Choisissez au moins une nature d'information."); return; }
    try {
      const corps = { ...v, date_faits: v.date_faits || null, coord: coordOrNull(v.coord),
        personnes: v.personnes === "" ? null : Number(v.personnes), superficie_ha: v.superficie_ha === "" ? null : Number(v.superficie_ha) };
      ["id", "numero", "cotation", "statut", "statut_label", "historique", "lat", "lng", "coord_saisie", "coord_alerte", "created_at", "site_id"].forEach((k) => delete corps[k]);
      const r = await api(initial ? `/fiches/${initial.id}` : "/fiches", { method: initial ? "PUT" : "POST", body: corps });
      onSaved(r);
    } catch (x) { setErr(x.message); }
  }
  return (
    <Modal title={initial ? `Modifier ${initial.numero}` : "Nouvelle fiche de renseignement"} onClose={onClose} wide>
      <form className="grid" onSubmit={save}>
        <div className="fgrid">
          <label className="f">Date de réception<input type="date" value={v.date_recu} max={isoToday()} onChange={f("date_recu")} required /></label>
          <label className="f">Heure<input type="time" value={v.heure_recu} onChange={f("heure_recu")} /></label>
          <label className="f">Date des faits<input type="date" value={v.date_faits} onChange={f("date_faits")} /></label>
          <label className="f">Priorité<select value={v.priorite} onChange={f("priorite")}><option value="routine">Routine</option><option value="importante">Importante</option><option value="urgente">Urgente</option></select></label>
        </div>
        <div className="fgrid">
          <label className="f">Type de source<select value={v.source_type} onChange={f("source_type")} required><option value="">Choisir…</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="f">Code source <small>jamais de nom</small><input className="mono" maxLength={30} value={v.source_code} onChange={f("source_code")} /></label>
          <label className="f">Fiabilité de la source<select value={v.fiabilite} onChange={f("fiabilite")}>{Object.entries(FIAB).map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}</select></label>
          <label className="f">Crédibilité de l'information<select value={v.credibilite} onChange={f("credibilite")}>{Object.entries(CRED).map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}</select></label>
        </div>
        <div className="fgrid">
          <label className="f">Département<select value={v.departement} onChange={f("departement")} required><option value="">Choisir…</option><option>Gagnoa</option><option>Oumé</option></select></label>
          <label className="f">Sous-préfecture<input value={v.sous_prefecture} onChange={f("sous_prefecture")} /></label>
          <label className="f">Localité<input value={v.localite} onChange={f("localite")} required /></label>
          <label className="f">Forêt classée<input value={v.foret} onChange={f("foret")} /></label>
          <label className="f">Cours d'eau<input value={v.cours_eau} onChange={f("cours_eau")} /></label>
        </div>
        <CoordFields value={v.coord} onChange={(c) => setV({ ...v, coord: c })} />
        <div><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Nature de l'information</div><Chips options={NATURES} value={v.nature} onChange={(n) => setV({ ...v, nature: n })} /></div>
        <div><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Équipements signalés</div><Chips options={EQUIP} value={v.equipements} onChange={(n) => setV({ ...v, equipements: n })} /></div>
        <div className="fgrid">
          <label className="f">Personnes estimées<input type="number" min="0" value={v.personnes} onChange={f("personnes")} /></label>
          <label className="f">Superficie estimée (ha)<input type="number" min="0" step="0.1" value={v.superficie_ha} onChange={f("superficie_ha")} /></label>
          <label className="f">Suite proposée<select value={v.suite} onChange={f("suite")}>{SUITES.map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>
        <label className="f">Description de l'information<textarea value={v.description} onChange={f("description")} required /></label>
        {err && <div className="alert error">{err}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary" type="submit">{initial ? "Enregistrer les modifications" : "Enregistrer la fiche"}</button></div>
      </form>
    </Modal>
  );
}

function FicheModal({ f, sites, onClose, onSaved, onDeleted }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const [edition, setEdition] = useState(false);
  const [suppr, setSuppr] = useState(false);
  const [statut, setStatut] = useState(f.statut);
  const [note, setNote] = useState("");
  const [siteId, setSiteId] = useState(f.site_id || "");
  const [err, setErr] = useState("");
  async function save() {
    try { const nf = await api(`/fiches/${f.id}/statut`, { method: "POST", body: { statut, note, site_id: siteId } }); setNote(""); onSaved(nf); } catch (x) { setErr(x.message); }
  }
  const row = (k, v) => (v ? <div><div className="muted" style={{ fontSize: 12.5 }}>{k}</div><div>{v}</div></div> : null);
  return (
    <Modal title={f.numero} sub={`Reçue le ${frDate(f.date_recu)}${f.heure_recu ? " à " + f.heure_recu : ""} · cotation ${f.cotation}`} onClose={onClose} wide>
      <div className="grid" style={{ gap: 14 }}>
        <div className="row-wrap">
          <button className="btn btn-sm" type="button" onClick={() => setEdition(true)}><span className="mi">edit</span>Modifier la fiche</button>
          {f.lat != null && <button className="btn btn-sm" type="button" onClick={() => nav("/carte")}><span className="mi">map</span>Voir sur la carte</button>}
          {user.role === "chef" && !suppr && <button className="btn btn-sm btn-soft-danger" type="button" style={{ marginLeft: "auto" }} onClick={() => setSuppr(true)}><span className="mi">delete</span>Supprimer</button>}
          {suppr && (
            <span className="row" style={{ marginLeft: "auto" }}>
              <span className="muted" style={{ fontSize: 13 }}>Supprimer définitivement cette fiche ?</span>
              <button className="btn btn-sm" type="button" onClick={() => setSuppr(false)}>Non</button>
              <button className="btn btn-sm btn-danger" type="button" onClick={async () => { try { await api(`/fiches/${f.id}`, { method: "DELETE" }); onDeleted(); } catch (x) { setErr(x.message); } }}>Supprimer</button>
            </span>
          )}
        </div>
        {edition && <NewFiche initial={f} onClose={() => setEdition(false)} onSaved={(nf) => { setEdition(false); onSaved(nf); }} />}
        <div className="fgrid" style={{ fontSize: 13.5 }}>
          {row("Source", f.source_type + (f.source_code ? " · " + f.source_code : ""))}
          {row("Localisation", [f.localite, f.sous_prefecture, f.departement].filter(Boolean).join(", "))}
          {row("Coordonnées", f.lat != null ? `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}` : null)}
          {row("Nature", f.nature.join(", "))}
          {row("Équipements", f.equipements.join(", "))}
          {row("Personnes estimées", f.personnes != null ? String(f.personnes) : null)}
          {row("Suite proposée", f.suite)}
        </div>
        {f.coord_alerte && <div className="badge amber" style={{ whiteSpace: "normal" }}>{f.coord_alerte}</div>}
        <div className="card" style={{ background: "var(--field)", whiteSpace: "pre-wrap" }}>{f.description}</div>
        <div className="card grid">
          <h3>Suivi</h3>
          <div className="fgrid">
            <label className="f">Statut<select value={statut} onChange={(e) => setStatut(e.target.value)}>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></label>
            <label className="f">Site du registre concerné<select value={siteId} onChange={(e) => setSiteId(e.target.value)}><option value="">Aucun</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.localite}</option>)}</select></label>
          </div>
          <label className="f">Note de suivi<textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 60 }} /></label>
          {err && <div className="alert error">{err}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary" type="button" onClick={save}>Mettre à jour</button></div>
        </div>
        <div className="timeline">
          {[...f.historique].reverse().map((h, i) => (
            <div key={i} className="ev" style={{ borderLeftColor: "var(--accent)" }}>
              <div className="d">{new Date(h.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} · {h.by}</div>
              <div><b>{ST[h.statut] ? ST[h.statut][0] : h.statut}</b>{h.note ? " — " + h.note : ""}</div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
