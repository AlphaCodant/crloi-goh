/* Missions d'éclairage : vérification sur le terrain des zones suspectes. */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import GR from "../gr/gr";
import { api, getToken, isoToday, urlApi } from "../api";
import { Alerte, Modal, Vide } from "../components/gr";

const { fmt } = GR;
const dateFr = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");
const STATUTS = {
  planifiee: { libelle: "Planifiée", classe: "blue" },
  en_cours: { libelle: "En cours", classe: "amber" },
  terminee: { libelle: "Terminée", classe: "green" },
  annulee: { libelle: "Annulée", classe: "" },
};
const STATUTS_ZONE = {
  a_verifier: ["À vérifier", "amber"],
  programmee: ["Programmée", "blue"],
  confirmee: ["Confirmée", "red"],
  infirmee: ["Infirmée", ""],
  ecartee: ["Écartée", ""],
};
const NIVEAU = { forte: ["Forte", "red"], moyenne: ["Moyenne", "amber"], faible: ["Faible", ""] };
const VIDE = { titre: "", date_prevue: isoToday(), date_fin: "", equipe: "", moyens: "", objectif: "", statut: "planifiee", compte_rendu: "" };

async function telecharger(m, format) {
  const r = await fetch(urlApi(`/missions/${m.id}/${format}`), { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) throw new Error("Export impossible");
  GR.telecharger(`${m.code}.${format}`, await r.blob());
}

export default function Missions() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [missions, setMissions] = useState(null);
  const [filtre, setFiltre] = useState("actives");
  const [ouverte, setOuverte] = useState(null);
  const [creation, setCreation] = useState(false);
  const [err, setErr] = useState("");

  const charger = () =>
    api("/missions")
      .then((l) => {
        setMissions(l);
        return l;
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    charger().then((l) => {
      const id = params.get("mission");
      if (id && l) setOuverte(l.find((m) => m.id === id) || null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ouvrir = (m) => {
    setOuverte(m);
    setParams(m ? { mission: m.id } : {}, { replace: true });
  };

  const liste = useMemo(
    () => (missions || []).filter((m) => (filtre === "actives" ? ["planifiee", "en_cours"].includes(m.statut) : filtre === "toutes" ? true : m.statut === filtre)),
    [missions, filtre]
  );

  if (err) return <Alerte type="error">{err}</Alerte>;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p>
            Une mission regroupe des zones suspectes (détectées par satellite ou signalées) à vérifier sur le terrain. Exportez les points pour le GPS, puis consignez le
            résultat de chaque zone : une zone confirmée devient un site du registre.
          </p>
        </div>
        <div className="row">
          <button className="btn" type="button" onClick={() => nav("/carte?onglet=prospection")}>
            <span className="mi">radar</span>Zones suspectes sur la carte
          </button>
          <button className="btn btn-primary" type="button" onClick={() => setCreation(true)}>
            <span className="mi">add</span>Nouvelle mission
          </button>
        </div>
      </div>

      <div className="segmented" style={{ alignSelf: "flex-start" }}>
        {[["actives", "En cours et planifiées"], ["terminee", "Terminées"], ["annulee", "Annulées"], ["toutes", "Toutes"]].map(([v, l]) => (
          <button key={v} type="button" className={filtre === v ? "active" : ""} onClick={() => setFiltre(v)}>
            {l}
          </button>
        ))}
      </div>

      {missions === null ? (
        <div className="card"><div className="skeleton" style={{ height: 80 }} /></div>
      ) : liste.length ? (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {liste.map((m) => {
            const st = STATUTS[m.statut];
            const n = m.cibles.length;
            const faites = m.cibles.filter((c) => ["confirmee", "infirmee", "ecartee"].includes(c.statut)).length;
            return (
              <article key={m.id} className="card mission-carte clickable" onClick={() => ouvrir(m)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && ouvrir(m)}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="cell-mono">{m.code}</span>
                  <span className={`badge ${st.classe}`}>{st.libelle}</span>
                </div>
                <h3 style={{ marginTop: 6 }}>{m.titre}</h3>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  <span className="mi mi-sm">event</span> {dateFr(m.date_prevue)}
                  {m.equipe && <> · {m.equipe}</>}
                </div>
                <div className="progress-label mt-3"><span>{n} zone(s) à vérifier</span><strong>{faites} / {n} traitée(s)</strong></div>
                <div className="progress"><span style={{ width: `${n ? (faites / n) * 100 : 0}%` }} /></div>
                <div className="row mt-2" style={{ gap: 6, flexWrap: "wrap" }}>
                  {["confirmee", "infirmee"].map((s) => {
                    const k = m.cibles.filter((c) => c.statut === s).length;
                    return k ? <span key={s} className={`badge ${STATUTS_ZONE[s][1]}`}>{k} {STATUTS_ZONE[s][0].toLowerCase()}(s)</span> : null;
                  })}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <Vide icone="assignment" titre="Aucune mission">
            Sélectionnez des zones suspectes dans l'onglet Prospection de la carte puis cliquez « Mission d'éclairage », ou créez une mission vide.
          </Vide>
        </div>
      )}

      {creation && (
        <FormMission
          titre="Nouvelle mission d'éclairage"
          valeur={VIDE}
          onClose={() => setCreation(false)}
          onSave={async (v) => {
            const m = await api("/missions", { method: "POST", body: { ...v, date_fin: v.date_fin || null, date_prevue: v.date_prevue || null, cibles: [] } });
            setCreation(false);
            await charger();
            ouvrir(m);
          }}
        />
      )}
      {ouverte && (
        <FicheMission
          id={ouverte.id}
          onClose={() => ouvrir(null)}
          onChange={charger}
          voirCarte={(c) => nav(`/carte?cible=${c.id}&onglet=prospection`)}
          voirSite={(id) => nav(`/carte?site=${id}`)}
        />
      )}
    </div>
  );
}

function FormMission({ titre, valeur, onClose, onSave }) {
  const [v, setV] = useState(valeur);
  const [err, setErr] = useState("");
  const f = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal
      titre={titre}
      icone="assignment"
      onClose={onClose}
      pied={
        <>
          <button className="btn" type="button" onClick={onClose}>Annuler</button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={async () => {
              if (v.titre.trim().length < 2) return setErr("Indiquez l'intitulé de la mission");
              try {
                await onSave(v);
              } catch (x) {
                setErr(x.message);
              }
              return undefined;
            }}
          >
            Enregistrer
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field span-all"><label>Intitulé</label><input className="input" value={v.titre} onChange={f("titre")} autoFocus /></div>
        <div className="field"><label>Date prévue</label><input className="input" type="date" value={v.date_prevue || ""} onChange={f("date_prevue")} /></div>
        <div className="field"><label>Date de fin</label><input className="input" type="date" value={v.date_fin || ""} onChange={f("date_fin")} /></div>
        <div className="field"><label>Équipe</label><input className="input" value={v.equipe} onChange={f("equipe")} placeholder="Chef de mission, unités…" /></div>
        <div className="field"><label>Moyens</label><input className="input" value={v.moyens} onChange={f("moyens")} placeholder="Véhicules, drone, GPS…" /></div>
        <div className="field span-all"><label>Objectif</label><textarea className="input" rows={3} value={v.objectif} onChange={f("objectif")} /></div>
      </div>
      {err && <div className="mt-3"><Alerte type="error">{err}</Alerte></div>}
    </Modal>
  );
}

function FicheMission({ id, onClose, onChange, voirCarte, voirSite }) {
  const [m, setM] = useState(null);
  const [v, setV] = useState(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [action, setAction] = useState(null); // { type: 'confirmer' | 'infirmer', cible }
  const [confirmSuppr, setConfirmSuppr] = useState(false);

  const charger = () =>
    api(`/missions/${id}`).then((x) => {
      setM(x);
      setV({ ...x, date_prevue: x.date_prevue || "", date_fin: x.date_fin || "" });
    });
  useEffect(() => {
    charger().catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!m || !v) return <Modal titre="Mission" onClose={onClose}>{err ? <Alerte type="error">{err}</Alerte> : <div className="skeleton" style={{ height: 120 }} />}</Modal>;

  const f = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const corps = (cibles) => ({ titre: v.titre, date_prevue: v.date_prevue || null, date_fin: v.date_fin || null, equipe: v.equipe, moyens: v.moyens, objectif: v.objectif, statut: v.statut, compte_rendu: v.compte_rendu, cibles });
  const enregistrer = async (cibles = m.cibles.map((c) => c.id), texte = "Mission enregistrée.") => {
    setErr("");
    try {
      const x = await api(`/missions/${m.id}`, { method: "PUT", body: corps(cibles) });
      setM(x);
      setMsg(texte);
      onChange();
    } catch (e) {
      setErr(e.message);
    }
  };
  const resultat = async (c, statut, commentaire) => {
    await api(`/cibles/${c.id}`, { method: "PATCH", body: { statut, commentaire } });
    await charger();
    onChange();
  };
  const st = STATUTS[m.statut];
  const restantes = m.cibles.filter((c) => ["a_verifier", "programmee"].includes(c.statut)).length;

  return (
    <Modal
      titre={`${m.code} · ${m.titre}`}
      sous={`${STATUTS[v.statut].libelle} · ${m.cibles.length} zone(s) · prévue le ${dateFr(m.date_prevue)}`}
      icone="assignment"
      large
      onClose={onClose}
      pied={
        <>
          {confirmSuppr ? (
            <>
              <span className="muted" style={{ marginRight: "auto", fontSize: 13 }}>Supprimer la mission ? Ses zones redeviennent « à vérifier ».</span>
              <button className="btn" type="button" onClick={() => setConfirmSuppr(false)}>Non</button>
              <button className="btn btn-danger" type="button" onClick={async () => { await api(`/missions/${m.id}`, { method: "DELETE" }); onChange(); onClose(); }}>Supprimer</button>
            </>
          ) : (
            <>
              <button className="btn btn-soft-danger" type="button" style={{ marginRight: "auto" }} onClick={() => setConfirmSuppr(true)}><span className="mi">delete</span>Supprimer</button>
              <button className="btn" type="button" onClick={() => telecharger(m, "gpx").catch((e) => setErr(e.message))} disabled={!m.cibles.length}><span className="mi">gps_fixed</span>GPX</button>
              <button className="btn" type="button" onClick={() => telecharger(m, "kml").catch((e) => setErr(e.message))} disabled={!m.cibles.length}><span className="mi">public</span>KML</button>
              <button className="btn btn-primary" type="button" onClick={() => enregistrer()}><span className="mi">save</span>Enregistrer</button>
            </>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <div className="field span-all"><label>Intitulé</label><input className="input" value={v.titre} onChange={f("titre")} /></div>
          <div className="field"><label>Statut</label>
            <select className="select" value={v.statut} onChange={f("statut")}>{Object.entries(STATUTS).map(([k, x]) => <option key={k} value={k}>{x.libelle}</option>)}</select></div>
          <div className="field"><label>Date prévue</label><input className="input" type="date" value={v.date_prevue} onChange={f("date_prevue")} /></div>
          <div className="field"><label>Date de fin</label><input className="input" type="date" value={v.date_fin} onChange={f("date_fin")} /></div>
          <div className="field"><label>Équipe</label><input className="input" value={v.equipe} onChange={f("equipe")} /></div>
          <div className="field span-all"><label>Moyens</label><input className="input" value={v.moyens} onChange={f("moyens")} /></div>
          <div className="field span-all"><label>Objectif</label><textarea className="input" rows={2} value={v.objectif} onChange={f("objectif")} /></div>
          <div className="field span-all"><label>Compte rendu</label><textarea className="input" rows={4} value={v.compte_rendu} onChange={f("compte_rendu")} placeholder="Déroulement, constats, difficultés, suites à donner…" /></div>
        </div>
        {msg && <Alerte type="success">{msg}</Alerte>}
        {err && <Alerte type="error">{err}</Alerte>}

        <div>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <h3 style={{ fontSize: 15 }}>Zones à vérifier</h3>
            <span className="muted" style={{ fontSize: 12.5 }}>{restantes ? `${restantes} sans résultat` : m.cibles.length ? "toutes traitées" : ""}</span>
          </div>
          {m.cibles.length ? (
            <div className="table-wrap card">
              <table className="table compact">
                <thead><tr><th>Zone</th><th>Suspicion</th><th className="num">Surface</th><th>Coordonnées</th><th>Résultat</th><th /></tr></thead>
                <tbody>
                  {m.cibles.map((c) => {
                    const z = STATUTS_ZONE[c.statut];
                    const n = NIVEAU[c.niveau] || NIVEAU.moyenne;
                    return (
                      <tr key={c.id}>
                        <td className="cell-strong nowrap">{c.code}<div className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>{c.origine === "gee" ? "satellite" : c.origine}</div></td>
                        <td><span className={`badge ${n[1]}`}>{n[0]}</span>{c.score !== null && <span className="muted" style={{ fontSize: 12 }}> {fmt.n(c.score * 100, 0)}</span>}</td>
                        <td className="num">{fmt.ha(c.superficie_ha, 1)}</td>
                        <td className="cell-mono nowrap">{c.lat.toFixed(5)}, {c.lng.toFixed(5)}</td>
                        <td>
                          <span className={`badge ${z[1]}`}>{z[0]}</span>
                          {c.historique?.length > 0 && c.historique[c.historique.length - 1].note && <div className="muted" style={{ fontSize: 11.5 }}>{c.historique[c.historique.length - 1].note}</div>}
                        </td>
                        <td className="nowrap right">
                          <button className="btn btn-ghost btn-icon btn-sm" type="button" title="Voir sur la carte" onClick={() => voirCarte(c)}><span className="mi">map</span></button>
                          {c.site_id ? (
                            <button className="btn btn-ghost btn-sm" type="button" onClick={() => voirSite(c.site_id)}><span className="mi">location_on</span>Site</button>
                          ) : (
                            <>
                              <button className="btn btn-ghost btn-sm" type="button" title="Activité confirmée : enregistrer comme site" onClick={() => setAction({ type: "confirmer", cible: c })}><span className="mi">check_circle</span>Confirmer</button>
                              <button className="btn btn-ghost btn-sm" type="button" title="Pas d'orpaillage constaté" onClick={() => setAction({ type: "infirmer", cible: c })}><span className="mi">cancel</span>Infirmer</button>
                            </>
                          )}
                          <button className="btn btn-ghost btn-icon btn-sm" type="button" title="Retirer de la mission" onClick={() => enregistrer(m.cibles.filter((x) => x.id !== c.id).map((x) => x.id), `${c.code} retirée de la mission.`)}><span className="mi">remove_circle_outline</span></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Alerte type="info">Aucune zone dans cette mission. Ajoutez-en depuis l'onglet Prospection de la carte (cocher les zones puis « Mission d'éclairage »).</Alerte>
          )}
        </div>
      </div>

      {action?.type === "infirmer" && (
        <ResultatInfirme cible={action.cible} onClose={() => setAction(null)} onSave={async (txt) => { await resultat(action.cible, "infirmee", txt); setAction(null); }} />
      )}
      {action?.type === "confirmer" && (
        <ConfirmerSite cible={action.cible} onClose={() => setAction(null)} onSaved={async () => { setAction(null); await charger(); onChange(); }} />
      )}
    </Modal>
  );
}

function ResultatInfirme({ cible, onClose, onSave }) {
  const [txt, setTxt] = useState("");
  return (
    <Modal titre={`Infirmer ${cible.code}`} icone="cancel" onClose={onClose}
      pied={<><button className="btn" type="button" onClick={onClose}>Annuler</button><button className="btn btn-primary" type="button" disabled={!txt.trim()} onClick={() => onSave(txt)}>Enregistrer</button></>}>
      <div className="field"><label>Ce qui a été constaté sur place</label>
        <textarea className="input" rows={3} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Ex. défrichement agricole (manioc), carrière de sable autorisée…" autoFocus /></div>
    </Modal>
  );
}

function ConfirmerSite({ cible, onClose, onSaved }) {
  const [v, setV] = useState({ localite: "", departement: cible.departement || "Gagnoa", sous_prefecture: "", domaine: "rural", foret: "", cours_eau: "", statut: "actif", date_constat: isoToday(), observations: cible.note || "" });
  const [err, setErr] = useState("");
  const f = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal titre={`Enregistrer ${cible.code} comme site`} icone="add_location_alt" onClose={onClose}
      pied={<><button className="btn" type="button" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" type="button" onClick={async () => {
          if (!v.localite.trim()) return setErr("Indiquez la localité");
          try { await api(`/cibles/${cible.id}/site`, { method: "POST", body: v }); await onSaved(); } catch (x) { setErr(x.message); }
          return undefined;
        }}>Créer le site</button></>}>
      <div className="form-grid">
        <div className="field"><label>Localité / village</label><input className="input" value={v.localite} onChange={f("localite")} autoFocus /></div>
        <div className="field"><label>Département</label><select className="select" value={v.departement} onChange={f("departement")}><option>Gagnoa</option><option>Oumé</option></select></div>
        <div className="field"><label>Sous-préfecture</label><input className="input" value={v.sous_prefecture} onChange={f("sous_prefecture")} /></div>
        <div className="field"><label>Domaine</label><select className="select" value={v.domaine} onChange={f("domaine")}><option value="rural">Domaine rural</option><option value="foret_classee">Forêt classée</option></select></div>
        {v.domaine === "foret_classee" && <div className="field"><label>Forêt classée</label><input className="input" value={v.foret} onChange={f("foret")} /></div>}
        <div className="field"><label>Cours d'eau</label><input className="input" value={v.cours_eau} onChange={f("cours_eau")} /></div>
        <div className="field"><label>Statut constaté</label><select className="select" value={v.statut} onChange={f("statut")}>
          <option value="actif">Actif</option><option value="tentative_reprise">Tentative de reprise</option><option value="recolonise">Recolonisé</option><option value="demantele">Démantelé</option><option value="tenu">Tenu</option></select></div>
        <div className="field"><label>Date du constat</label><input className="input" type="date" value={v.date_constat} max={isoToday()} onChange={f("date_constat")} /></div>
        <div className="field span-all"><label>Observations</label><textarea className="input" rows={3} value={v.observations} onChange={f("observations")} /></div>
      </div>
      {err && <div className="mt-3"><Alerte type="error">{err}</Alerte></div>}
    </Modal>
  );
}
