import React, { useEffect, useRef, useState } from "react";
import { SAISIE_LABEL, STATUT_HEX, STATUT_LABEL, STATUT_ORDER, api, frDate, isoToday, saisiesText } from "../api";
import { Modal } from "../components/ui";
import { useAuth } from "../context";
import { duree, preparerPhoto, preparerVideo, taille, typeMedia, urlObjet, VIDEO_MAX_MO } from "../medias";
import { imprimerBrq } from "./brqImpression";

const newVisite = () => ({ site_id: "", nouveau: false, nouveau_site: { localite: "", departement: "Gagnoa", sous_prefecture: "" }, unite: "", constat: "tenu", saisies: {}, interpelles: 0, note: "" });
const agentVide = () => ({ grade: "", nom: "", structure: "" });
const nouveauBrq = () => {
  const j = isoToday();
  return { date: j, reference: "", unites: "", observations: "", departement: "", periode_du: j, periode_au: j, chef_mission: agentVide(), agents: [agentVide()], signataire_id: "", medias: [], visites: [newVisite()] };
};
export const nomAgent = (a) => [a?.grade, a?.nom].filter((x) => x && x.trim()).join(" ");
export const periodeTexte = (b) =>
  !b.periode_du ? "" : b.periode_du === b.periode_au ? `le ${frDate(b.periode_du)}` : `du ${frDate(b.periode_du)} au ${frDate(b.periode_au)}`;

/* Image protégée (miniature, signature) chargée avec le jeton */
function ImageApi({ chemin, alt = "", ...props }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let vivant = true;
    urlObjet(chemin).then((u) => vivant && setSrc(u)).catch(() => {});
    return () => { vivant = false; };
  }, [chemin]);
  return src ? <img src={src} alt={alt} {...props} /> : <span className="media-attente" {...props} />;
}

function Vignette({ m, onClick, children }) {
  return (
    <figure className="media-vignette" onClick={onClick}>
      {m.local ? (m.apercu ? <img src={m.apercu} alt="" /> : <span className="media-attente" />) : m.type === "video" && !m.a_miniature ? <span className="media-attente" /> : <ImageApi chemin={`/medias/${m.id}/miniature`} />}
      {m.type === "video" && <span className="media-video"><span className="mi">play_arrow</span>{duree(m.duree_s)}</span>}
      {children}
    </figure>
  );
}

export default function BrqPage() {
  const [brqs, setBrqs] = useState([]);
  const [sites, setSites] = useState([]);
  const [signataires, setSignataires] = useState([]);
  const [editing, setEditing] = useState(null);
  const [visionneuse, setVisionneuse] = useState(null);
  const load = () => Promise.all([api("/brq"), api("/sites"), api("/signataires")]).then(([b, s, g]) => { setBrqs(b); setSites(s); setSignataires(g); });
  useEffect(() => { load(); }, []);

  const today = isoToday();
  const hasToday = brqs.some((b) => b.date === today);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p>Chaque visite de site enregistrée ici met à jour le statut du site sur la carte et les indicateurs du tableau de bord.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setEditing(nouveauBrq())}>Saisir un BRQ</button>
      </div>
      {!hasToday && <div className="alert warning">Aucun BRQ enregistré pour aujourd'hui ({frDate(today)}).</div>}
      <div className="grid">
        {brqs.map((b) => (
          <div key={b.id} className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <h3>BRQ du {frDate(b.date)}{b.departement && <span className="muted" style={{ fontWeight: 400 }}> · Comité départemental {b.departement === "Oumé" ? "d'Oumé" : "de " + b.departement}</span>}</h3>
                <div className="muted" style={{ fontSize: 13 }}>{[b.reference, b.unites].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="row" style={{ flex: "none" }}>
                <button className="btn btn-sm" type="button" onClick={() => imprimerBrq(b, sites)}><span className="mi">print</span>Imprimer</button>
                <button className="btn btn-sm" type="button" onClick={() => setEditing({ ...nouveauBrq(), ...b, signataire_id: b.signataire_id || "", periode_du: b.periode_du || "", periode_au: b.periode_au || "", chef_mission: { ...agentVide(), ...b.chef_mission }, agents: b.agents.length ? b.agents : [agentVide()], visites: b.visites.map((v) => ({ ...newVisite(), ...v, site_id: v.site_id || "" })) })}>Modifier</button>
              </div>
            </div>
            <dl className="brq-mission">
              <div><dt>Mission</dt><dd>{periodeTexte(b) || "—"}</dd></div>
              <div><dt>Chef de mission</dt><dd>{nomAgent(b.chef_mission) || "—"}{b.chef_mission?.structure ? ` (${b.chef_mission.structure})` : ""}</dd></div>
              <div><dt>Agents</dt><dd>{b.agents.length ? `${b.agents.length} : ${b.agents.map(nomAgent).join(", ")}` : "—"}</dd></div>
              <div><dt>Visa</dt><dd>{b.signataire ? `${b.signataire.nom}${b.signataire.fonction ? ", " + b.signataire.fonction : ""}` : <span className="muted">non signé</span>}</dd></div>
            </dl>
            <div className="card table-wrap" style={{ marginTop: 10 }}>
              <table className="table">
                <thead><tr><th>Site</th><th>Constat</th><th>Saisies</th><th>Interpellés</th><th>Note</th></tr></thead>
                <tbody>
                  {b.visites.map((v) => (
                    <tr key={v.id}>
                      <td><span className="mono" style={{ fontWeight: 600 }}>{v.site_code || "—"}</span> {v.site_localite}</td>
                      <td><span className="badge"><span className="dot" style={{ background: STATUT_HEX[v.constat] }} />{v.constat_label}</span></td>
                      <td>{saisiesText(v.saisies) || "—"}</td>
                      <td className="num">{v.interpelles || "—"}</td>
                      <td style={{ maxWidth: 360 }}>{v.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {b.observations && <p style={{ margin: "10px 0 0", fontSize: 13.5 }}>{b.observations}</p>}
            {b.medias.length > 0 && (
              <div className="media-bande">
                {b.medias.map((m, i) => <Vignette key={m.id} m={{ ...m, a_miniature: true }} onClick={() => setVisionneuse({ medias: b.medias, i })} />)}
              </div>
            )}
          </div>
        ))}
        {!brqs.length && <div className="card empty">Aucun BRQ enregistré. Commencez par « Saisir un BRQ ».</div>}
      </div>
      {editing && (
        <BrqForm init={editing} sites={sites} signataires={signataires} onSignataires={setSignataires}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
      {visionneuse && <Visionneuse {...visionneuse} sites={sites} onClose={() => setVisionneuse(null)} />}
    </div>
  );
}

function Visionneuse({ medias, i: depart, sites, onClose }) {
  const [i, setI] = useState(depart);
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState("");
  const m = medias[i];
  useEffect(() => {
    setSrc(null);
    setErr("");
    urlObjet(`/medias/${m.id}/fichier`).then(setSrc).catch((e) => setErr(e.message));
  }, [m.id]);
  useEffect(() => {
    const k = (e) => {
      if (e.key === "ArrowRight") setI((x) => Math.min(medias.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [medias.length]);
  const site = sites.find((s) => s.id === m.site_id);
  return (
    <Modal title={m.legende || m.nom_fichier || (m.type === "video" ? "Vidéo" : "Photo")} sub={`${i + 1} / ${medias.length}${m.date_prise ? " · " + frDate(m.date_prise) : ""}${site ? ` · ${site.code} ${site.localite}` : ""} · ${taille(m.taille)}`} onClose={onClose} wide>
      <div className="visionneuse">
        <button className="btn btn-icon" type="button" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Précédent"><span className="mi">chevron_left</span></button>
        <div className="visionneuse-cadre">
          {err ? <div className="alert error">{err}</div> : !src ? <div className="muted">Chargement…</div>
            : m.type === "video" ? <video src={src} controls autoPlay playsInline /> : <img src={src} alt={m.legende} />}
        </div>
        <button className="btn btn-icon" type="button" disabled={i === medias.length - 1} onClick={() => setI(i + 1)} aria-label="Suivant"><span className="mi">chevron_right</span></button>
      </div>
      {src && <div style={{ marginTop: 10 }}><a className="btn btn-sm" href={src} download={m.nom_fichier || "fichier"}><span className="mi">download</span>Télécharger l'original</a></div>}
    </Modal>
  );
}

function BrqForm({ init, sites, signataires, onSignataires, onClose, onSaved }) {
  const { user } = useAuth();
  const [b, setB] = useState(init);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [coller, setColler] = useState(null);
  const [nouveauSig, setNouveauSig] = useState(null);
  const [aEnvoyer, setAEnvoyer] = useState([]); // nouveaux fichiers préparés
  const [aSupprimer, setASupprimer] = useState([]);
  const medsInit = useRef(Object.fromEntries((init.medias || []).map((m) => [m.id, m])));
  const set = (patch) => setB((x) => ({ ...x, ...patch }));
  const setV = (i, patch) => setB((x) => ({ ...x, visites: x.visites.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  const setAgent = (i, patch) => setB((x) => ({ ...x, agents: x.agents.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));
  const setMedia = (id, patch) => setB((x) => ({ ...x, medias: x.medias.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const setLocal = (k, patch) => setAEnvoyer((l) => l.map((m) => (m.cle === k ? { ...m, ...patch } : m)));

  const sitesVisites = b.visites.map((v) => sites.find((s) => s.id === v.site_id)).filter(Boolean);
  const sigListe = [...signataires].sort((x, y) => (y.departement === b.departement) - (x.departement === b.departement));
  const sig = signataires.find((g) => g.id === b.signataire_id) || (init.signataire && init.signataire.id === b.signataire_id ? init.signataire : null);

  function collerAgents() {
    const lignes = coller.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const lus = lignes.map((l) => {
      const c = l.split(/\t|;/).map((x) => x.trim());
      return c.length >= 3 ? { grade: c[0], nom: c[1], structure: c.slice(2).join(" ") } : c.length === 2 ? { grade: c[0], nom: c[1], structure: "" } : { grade: "", nom: c[0], structure: "" };
    });
    set({ agents: [...b.agents.filter((a) => a.nom.trim()), ...lus] });
    setColler(null);
  }

  async function ajouterFichiers(liste) {
    setErr("");
    const fichiers = [...liste];
    for (const [n, f] of fichiers.entries()) {
      const t = typeMedia(f);
      if (!t) { setErr(`« ${f.name} » n'est ni une photo ni une vidéo.`); continue; }
      setBusy(`Préparation ${n + 1} / ${fichiers.length}…`);
      try {
        const p = t === "photo" ? await preparerPhoto(f) : await preparerVideo(f);
        const apercu = p.miniature ? URL.createObjectURL(p.miniature) : null;
        const visite = b.visites.find((v) => v.site_id);
        setAEnvoyer((l) => [...l, { ...p, cle: Math.random().toString(36).slice(2), local: true, apercu, nom_fichier: f.name, legende: "", site_id: sitesVisites.length === 1 ? visite.site_id : "", taille: p.fichier.size }]);
      } catch (x) {
        setErr(x.message);
      }
    }
    setBusy("");
  }

  async function importerSignature(e) {
    e.preventDefault();
    const { nom, fonction, departement, fichier } = nouveauSig;
    if (!nom.trim() || !fichier) { setErr("Indiquez le nom du signataire et choisissez l'image de la signature."); return; }
    const form = new FormData();
    Object.entries({ nom, fonction, departement }).forEach(([k, v]) => form.append(k, v));
    form.append("fichier", fichier);
    try {
      const g = await api("/signataires", { method: "POST", form });
      onSignataires([...signataires, g]);
      set({ signataire_id: g.id });
      setNouveauSig(null);
    } catch (x) { setErr(x.message); }
  }

  async function save(e) {
    e.preventDefault();
    setErr("");
    for (const [i, v] of b.visites.entries()) {
      if (!v.nouveau && !v.site_id) { setErr(`Visite ${i + 1} : choisissez un site ou « Nouveau site ».`); return; }
      if (v.nouveau && !v.nouveau_site.localite.trim()) { setErr(`Visite ${i + 1} : indiquez la localité du nouveau site.`); return; }
    }
    if (b.periode_du && b.periode_au && b.periode_au < b.periode_du) { setErr("La fin de la mission précède son début."); return; }
    const body = {
      date: b.date, reference: b.reference, unites: b.unites, observations: b.observations, departement: b.departement,
      periode_du: b.periode_du || null, periode_au: b.periode_au || null, chef_mission: b.chef_mission,
      agents: b.agents.filter((a) => a.nom.trim()), signataire_id: b.signataire_id || null,
      visites: b.visites.map((v) => ({
        site_id: v.nouveau ? null : v.site_id, nouveau_site: v.nouveau ? v.nouveau_site : null, unite: v.unite, constat: v.constat,
        saisies: Object.fromEntries(Object.entries(v.saisies).filter(([, n]) => Number(n) > 0).map(([k, n]) => [k, Number(n)])),
        interpelles: Number(v.interpelles) || 0, note: v.note,
      })),
    };
    try {
      setBusy("Enregistrement du BRQ…");
      const r = await api(b.id ? "/brq/" + b.id : "/brq", { method: b.id ? "PUT" : "POST", body });
      if (!b.id) set({ id: r.id });
      for (const id of aSupprimer) await api(`/medias/${id}`, { method: "DELETE" });
      setASupprimer([]);
      for (const m of b.medias) {
        const o = medsInit.current[m.id];
        if (o && (o.legende !== m.legende || (o.site_id || "") !== (m.site_id || ""))) await api(`/medias/${m.id}`, { method: "PATCH", body: { legende: m.legende, site_id: m.site_id || "" } });
      }
      const restants = [...aEnvoyer];
      for (const [n, m] of restants.entries()) {
        setBusy(`Envoi ${n + 1} / ${restants.length} : ${m.nom_fichier} (${taille(m.taille)})…`);
        const form = new FormData();
        form.append("fichier", m.fichier, m.fichier.name);
        if (m.miniature) form.append("miniature", m.miniature, "miniature.jpg");
        const champs = { legende: m.legende, site_id: m.site_id, date_prise: m.date_prise, largeur: m.largeur, hauteur: m.hauteur, duree_s: m.duree_s ?? "", nom_fichier: m.nom_fichier };
        Object.entries(champs).forEach(([k, v]) => v !== "" && v != null && form.append(k, v));
        await api(`/brq/${r.id}/medias`, { method: "POST", form });
        setAEnvoyer((l) => l.filter((x) => x.cle !== m.cle));
      }
      setBusy("");
      onSaved();
    } catch (x) {
      setBusy("");
      setErr(x.message + (aEnvoyer.length ? " — le BRQ est enregistré ; les fichiers non envoyés restent dans la liste, réessayez." : ""));
    }
  }

  const fichiersVisibles = [...b.medias.filter((m) => !aSupprimer.includes(m.id)), ...aEnvoyer];

  return (
    <Modal title={b.id ? `Modifier le BRQ du ${frDate(b.date)}` : "Nouveau BRQ"} onClose={onClose} wide>
      <form className="grid" onSubmit={save}>
        <section className="brq-bloc">
          <h4>Bulletin</h4>
          <div className="fgrid">
            <label className="f">Date du BRQ<input type="date" value={b.date} max={isoToday()} onChange={(e) => set({ date: e.target.value })} required /></label>
            <label className="f">Référence <small>n° du bulletin</small><input value={b.reference} onChange={(e) => set({ reference: e.target.value })} /></label>
            <label className="f">Comité départemental<select value={b.departement} onChange={(e) => set({ departement: e.target.value })}><option value="">—</option><option>Gagnoa</option><option>Oumé</option></select></label>
          </div>
        </section>

        <section className="brq-bloc">
          <h4>Mission</h4>
          <div className="fgrid">
            <label className="f">Début de la mission<input type="date" value={b.periode_du || ""} onChange={(e) => set({ periode_du: e.target.value, periode_au: !b.periode_au || b.periode_au < e.target.value ? e.target.value : b.periode_au })} /></label>
            <label className="f">Fin de la mission<input type="date" value={b.periode_au || ""} min={b.periode_du || undefined} onChange={(e) => set({ periode_au: e.target.value })} /></label>
            <label className="f">Unités engagées<input value={b.unites} onChange={(e) => set({ unites: e.target.value })} placeholder="DREF / PEF Galébré" /></label>
          </div>
          <div className="brq-sous">Chef de mission</div>
          <div className="agents-ligne">
            <input aria-label="Grade du chef de mission" placeholder="Grade" value={b.chef_mission.grade} onChange={(e) => set({ chef_mission: { ...b.chef_mission, grade: e.target.value } })} />
            <input aria-label="Nom du chef de mission" placeholder="Nom et prénoms" value={b.chef_mission.nom} onChange={(e) => set({ chef_mission: { ...b.chef_mission, nom: e.target.value } })} />
            <input aria-label="Structure du chef de mission" placeholder="Structure / unité" value={b.chef_mission.structure} onChange={(e) => set({ chef_mission: { ...b.chef_mission, structure: e.target.value } })} />
            <span />
          </div>
          <div className="brq-sous row" style={{ justifyContent: "space-between" }}>
            <span>Agents participants <span className="muted">({b.agents.filter((a) => a.nom.trim()).length})</span></span>
            <span className="row">
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => setColler(coller === null ? "" : null)}>Coller une liste</button>
              <button className="btn btn-sm" type="button" onClick={() => set({ agents: [...b.agents, agentVide()] })}><span className="mi">add</span>Agent</button>
            </span>
          </div>
          {coller !== null && (
            <div className="grid" style={{ gap: 6 }}>
              <textarea value={coller} onChange={(e) => setColler(e.target.value)} placeholder={"Une ligne par agent : Grade ; Nom ; Structure\nou collez trois colonnes depuis Excel"} style={{ minHeight: 90 }} />
              <div className="row"><button className="btn btn-sm" type="button" onClick={collerAgents} disabled={!coller.trim()}>Ajouter à la liste</button></div>
            </div>
          )}
          {b.agents.map((a, i) => (
            <div className="agents-ligne" key={i}>
              <input aria-label={`Grade de l'agent ${i + 1}`} placeholder="Grade" value={a.grade} onChange={(e) => setAgent(i, { grade: e.target.value })} />
              <input aria-label={`Nom de l'agent ${i + 1}`} placeholder="Nom et prénoms" value={a.nom} onChange={(e) => setAgent(i, { nom: e.target.value })} />
              <input aria-label={`Structure de l'agent ${i + 1}`} placeholder="Structure / unité" value={a.structure} onChange={(e) => setAgent(i, { structure: e.target.value })} />
              <button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label="Retirer l'agent" onClick={() => set({ agents: b.agents.filter((_, j) => j !== i) })}><span className="mi">close</span></button>
            </div>
          ))}
        </section>

        <section className="brq-bloc">
          <h4>Sites visités</h4>
          {b.visites.map((v, i) => (
            <fieldset key={i} className="card" style={{ margin: 0 }}>
              <legend style={{ fontWeight: 600, padding: "0 6px" }}>Visite {i + 1}</legend>
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
                  <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--gray-600)" }}>Matériel saisi</div>
                  <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                    {Object.entries(SAISIE_LABEL).map(([k, l]) => (
                      <label key={k} className="f" style={{ fontWeight: 400 }}>{l}<input type="number" min="0" step="1" value={v.saisies[k] ?? ""} onChange={(e) => setV(i, { saisies: { ...v.saisies, [k]: e.target.value } })} /></label>
                    ))}
                  </div>
                </div>
                <label className="f">Constats et observations<textarea style={{ minHeight: 60 }} value={v.note} onChange={(e) => setV(i, { note: e.target.value })} /></label>
                {b.visites.length > 1 && <div><button className="btn btn-sm btn-soft-danger" type="button" onClick={() => set({ visites: b.visites.filter((_, j) => j !== i) })}>Retirer cette visite</button></div>}
              </div>
            </fieldset>
          ))}
          <div><button className="btn" type="button" onClick={() => set({ visites: [...b.visites, newVisite()] })}>+ Ajouter une visite</button></div>
          <label className="f">Observations générales<textarea value={b.observations} onChange={(e) => set({ observations: e.target.value })} /></label>
        </section>

        <section className="brq-bloc">
          <h4>Photos et vidéos <span className="muted" style={{ fontWeight: 400 }}>({fichiersVisibles.length})</span></h4>
          <label className="depot" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); ajouterFichiers(e.dataTransfer.files); }}>
            <input type="file" multiple accept="image/*,video/*" onChange={(e) => { ajouterFichiers(e.target.files); e.target.value = ""; }} />
            <span className="mi">add_photo_alternate</span>
            <span>Déposez des photos ou des vidéos, ou cliquez pour les choisir.<br /><small className="muted">Photos réduites automatiquement · vidéos de {VIDEO_MAX_MO} Mo au plus (MP4, MOV, WebM)</small></span>
          </label>
          {fichiersVisibles.length > 0 && (
            <div className="media-liste">
              {fichiersVisibles.map((m) => {
                const cle = m.local ? m.cle : m.id;
                const maj = (p) => (m.local ? setLocal(m.cle, p) : setMedia(m.id, p));
                return (
                  <div className="media-item" key={cle}>
                    <Vignette m={{ ...m, a_miniature: true }}>{m.local && <span className="media-nouveau">à envoyer</span>}</Vignette>
                    <div className="grid" style={{ gap: 6, minWidth: 0 }}>
                      <input aria-label="Légende" placeholder="Légende" value={m.legende} onChange={(e) => maj({ legende: e.target.value })} />
                      <select aria-label="Site concerné" value={m.site_id || ""} onChange={(e) => maj({ site_id: e.target.value })}>
                        <option value="">Site : aucun</option>
                        {sitesVisites.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.localite}</option>)}
                      </select>
                      <div className="muted" style={{ fontSize: 11.5 }}>{m.nom_fichier} · {taille(m.taille)}{m.duree_s ? " · " + duree(m.duree_s) : ""}</div>
                    </div>
                    <button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label="Retirer le fichier"
                      onClick={() => (m.local ? setAEnvoyer((l) => l.filter((x) => x.cle !== m.cle)) : setASupprimer((l) => [...l, m.id]))}><span className="mi">delete</span></button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="brq-bloc">
          <h4>Visa du responsable du Comité départemental</h4>
          <div className="visa">
            <div className="grid" style={{ gap: 8 }}>
              <label className="f">Signataire
                <select value={b.signataire_id} onChange={(e) => set({ signataire_id: e.target.value })}>
                  <option value="">Non signé</option>
                  {sigListe.map((g) => <option key={g.id} value={g.id}>{g.nom}{g.fonction ? ` — ${g.fonction}` : ""}{g.departement ? ` (${g.departement})` : ""}</option>)}
                  {sig && !signataires.some((g) => g.id === sig.id) && <option value={sig.id}>{sig.nom} (retiré de la liste)</option>}
                </select>
              </label>
              {user.role === "chef" && !nouveauSig && (
                <div><button className="btn btn-sm" type="button" onClick={() => setNouveauSig({ nom: "", fonction: "Président du Comité départemental", departement: b.departement, fichier: null })}><span className="mi">upload</span>Importer une signature</button></div>
              )}
            </div>
            <div className="visa-apercu">
              {sig ? <><ImageApi chemin={`/signataires/${sig.id}/signature`} alt={`Signature de ${sig.nom}`} /><div>{sig.nom}</div></> : <span className="muted">Aucune signature</span>}
            </div>
          </div>
          {nouveauSig && (
            <div className="card" style={{ margin: 0 }}>
              <div className="fgrid">
                <label className="f">Nom du signataire<input value={nouveauSig.nom} onChange={(e) => setNouveauSig({ ...nouveauSig, nom: e.target.value })} placeholder="Grade, nom et prénoms" /></label>
                <label className="f">Fonction<input value={nouveauSig.fonction} onChange={(e) => setNouveauSig({ ...nouveauSig, fonction: e.target.value })} /></label>
                <label className="f">Département<select value={nouveauSig.departement} onChange={(e) => setNouveauSig({ ...nouveauSig, departement: e.target.value })}><option value="">—</option><option>Gagnoa</option><option>Oumé</option></select></label>
                <label className="f">Image de la signature <small>PNG à fond transparent de préférence, 1 Mo au plus</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setNouveauSig({ ...nouveauSig, fichier: e.target.files[0] || null })} /></label>
              </div>
              <div className="row mt-3">
                <button className="btn btn-sm btn-primary" type="button" onClick={importerSignature}>Enregistrer la signature</button>
                <button className="btn btn-sm" type="button" onClick={() => setNouveauSig(null)}>Annuler</button>
              </div>
            </div>
          )}
        </section>

        {err && <div className="alert error">{err}</div>}
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            {b.id && !confirmDel && <button className="btn btn-danger" type="button" onClick={() => setConfirmDel(true)}>Supprimer ce BRQ</button>}
            {confirmDel && <span className="row"><span className="alert error">Les statuts, photos et vidéos de ce BRQ seront supprimés.</span>
              <button className="btn btn-danger" type="button" onClick={() => api("/brq/" + b.id, { method: "DELETE" }).then(onSaved).catch((x) => setErr(x.message))}>Confirmer</button>
              <button className="btn" type="button" onClick={() => setConfirmDel(false)}>Annuler</button></span>}
          </div>
          <div className="row">
            {busy && <span className="muted" style={{ fontSize: 12.5 }}>{busy}</span>}
            <button className="btn btn-primary" type="submit" disabled={!!busy}>Enregistrer le BRQ</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
