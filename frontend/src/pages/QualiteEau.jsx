/* Qualité de l'eau : saisie hebdomadaire par cours d'eau, grille des 8 dernières semaines, évolution et historique. */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import GR from "../gr/gr";
import { api, isoToday } from "../api";
import { Chart, Kpi, Vide } from "../components/gr";
import { CoordFields, Modal, coordOrNull } from "../components/ui";
import * as T from "../tableau/calculs";
import { PARAMETRES, PARAM, STATUT_EAU, dernieres, fmtVal, resume, semaines, statutCours, depasse, grapheEau } from "../eau";

const VIDE = (ce = "") => ({ cours_eau_id: ce, date: isoToday(), point: "", coord: { sys: "wgs", x: "", y: "" }, turbidite: "", mercure: "", cyanure: "", autres: [], observations: "" });
const num = (v) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(",", ".")));

export default function QualiteEau() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [cours, setCours] = useState([]);
  const [mesures, setMesures] = useState([]);
  const [err, setErr] = useState("");
  const [edition, setEdition] = useState(null); // { initial, id }
  const [filtreCe, setFiltreCe] = useState(params.get("ce") || "");
  const [param, setParam] = useState("turbidite");
  const today = isoToday();
  const sem = useMemo(() => semaines(today, 8), [today]);

  const charger = () =>
    Promise.all([api("/cours-eau"), api("/qualite-eau")])
      .then(([c, m]) => {
        setCours(c);
        setMesures(m);
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    charger().then(() => {
      if (params.get("nouveau")) {
        setEdition({ initial: VIDE(params.get("ce") || "") });
        params.delete("nouveau");
        setParams(params, { replace: true });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const der = useMemo(() => dernieres(mesures), [mesures]);
  const semCourante = sem[sem.length - 1];
  const k = useMemo(() => {
    const cette = mesures.filter((m) => m.semaine === semCourante);
    const suivis = new Set(mesures.map((m) => m.cours_eau_id));
    return {
      mesuresSemaine: cette.length,
      coursSemaine: new Set(cette.map((m) => m.cours_eau_id)).size,
      depassementsSemaine: new Set(cette.filter((m) => m.statut === "depassement").map((m) => m.cours_eau_id)).size,
      suivis: suivis.size,
      enRetard: [...suivis].filter((id) => !cette.some((m) => m.cours_eau_id === id)).length,
    };
  }, [mesures, semCourante]);

  // Grille : cours d'eau suivis d'abord, puis les autres du registre
  const lignes = useMemo(() => {
    const suivis = new Set(mesures.map((m) => m.cours_eau_id));
    return [...cours].sort((a, b) => (suivis.has(b.id) - suivis.has(a.id)) || a.nom.localeCompare(b.nom, "fr"));
  }, [cours, mesures]);
  const cellule = (ceId, s) => {
    const ms = mesures.filter((m) => m.cours_eau_id === ceId && m.semaine === s);
    if (!ms.length) return null;
    return ms.find((m) => m.statut === "depassement") || ms[0];
  };

  const liste = mesures.filter((m) => !filtreCe || m.cours_eau_id === filtreCe);

  const graphe = useMemo(() => {
    const ids = filtreCe ? [filtreCe] : [...new Set(mesures.filter((m) => m[param] !== null).map((m) => m.cours_eau_id))].slice(0, 8);
    return grapheEau({ mesures, cours, sem, param, ids });
  }, [param, filtreCe, mesures, cours, sem]);

  async function supprimer(m) {
    if (!(await GR.confirm({ titre: "Supprimer la mesure ?", message: `${m.cours_eau} – semaine du ${T.dateFr(m.semaine)}${m.point ? ` (${m.point})` : ""}`, ok: "Supprimer", danger: true }))) return;
    await api(`/qualite-eau/${m.id}`, { method: "DELETE" });
    GR.toast("Mesure supprimée");
    charger();
  }
  const ouvrir = (m) =>
    setEdition({
      id: m.id,
      initial: {
        cours_eau_id: m.cours_eau_id, date: m.date, point: m.point, observations: m.observations, autres: (m.autres || []).map((a) => ({ ...a, valeur: String(a.valeur) })),
        coord: m.coord_saisie ? { sys: m.coord_saisie.sys, x: String(m.coord_saisie.x ?? ""), y: String(m.coord_saisie.y ?? "") } : { sys: "wgs", x: "", y: "" },
        turbidite: m.turbidite ?? "", mercure: m.mercure ?? "", cyanure: m.cyanure ?? "",
      },
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Suivi hebdomadaire</div>
          <h1>Qualité de l'eau</h1>
          <p>Une mesure par cours d'eau, point de prélèvement et semaine : turbidité, mercure, cyanure et tout autre paramètre analysé.</p>
        </div>
        <div className="row">
          <button className="btn" type="button" onClick={() => nav("/carte")}><span className="mi">map</span>Voir sur la carte</button>
          <button className="btn btn-primary" type="button" onClick={() => setEdition({ initial: VIDE(filtreCe) })}><span className="mi">add</span>Nouvelle mesure</button>
        </div>
      </div>
      {err && <div className="alert error">{err}</div>}

      <section className="kpis" aria-label="Indicateurs">
        <Kpi icone="water_drop" couleur="blue" libelle="Cours d'eau mesurés cette semaine" valeur={`${k.coursSemaine}`} unite={k.suivis ? `/ ${k.suivis} suivis` : ""} pied={`semaine du ${T.dateFr(semCourante)} · ${k.mesuresSemaine} mesure(s)`} />
        <Kpi icone="warning" couleur={k.depassementsSemaine ? "red" : ""} libelle="Dépassements de seuil" valeur={k.depassementsSemaine} pied="cours d'eau concernés cette semaine" />
        <Kpi icone="schedule" couleur={k.enRetard ? "amber" : ""} libelle="Mesures en attente" valeur={k.enRetard} pied="cours d'eau suivis non mesurés cette semaine" />
      </section>

      <section className="card mt-4">
        <div className="card-header">
          <span className="mi" style={{ color: "var(--primary)" }}>calendar_view_week</span>
          <h2>Grille hebdomadaire</h2>
          <span className="sub">8 dernières semaines · cliquer une case pour saisir ou modifier</span>
        </div>
        <div className="card-body flush">
          <div className="table-wrap" style={{ maxHeight: 520 }}>
            {lignes.length ? (
              <table className="table compact grille-eau">
                <thead>
                  <tr>
                    <th>Cours d'eau</th>
                    {sem.map((s) => <th key={s} className="center nowrap">{T.semaineCourte(s)}</th>)}
                    <th>Dernière mesure</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((c) => {
                    const d = der.get(c.id);
                    const st = STATUT_EAU[statutCours(d, today)];
                    return (
                      <tr key={c.id}>
                        <td className="cell-strong">{c.nom}<div className="muted" style={{ fontSize: 12 }}>{c.type || ""}</div></td>
                        {sem.map((s) => {
                          const m = cellule(c.id, s);
                          const col = m ? STATUT_EAU[m.statut].couleur : null;
                          return (
                            <td key={s} className="center">
                              <button type="button" className="case-eau" title={m ? `${T.dateFr(m.date)} – ${resume(m)}` : "Saisir une mesure"}
                                style={m ? { background: `${col}1f`, borderColor: col, color: col } : null}
                                onClick={() => (m ? ouvrir(m) : setEdition({ initial: { ...VIDE(c.id), date: s > today ? today : T.ajouter(s, 2) > today ? today : T.ajouter(s, 2) } }))}>
                                {m ? (m.turbidite !== null ? fmtVal(m.turbidite, 0) : m.statut === "depassement" ? "!" : "✓") : "+"}
                              </button>
                            </td>
                          );
                        })}
                        <td>{d ? <span className="badge" style={{ background: `${st.couleur}1f`, color: st.couleur }}>{st.libelle}</span> : <span className="muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <Vide icone="water" titre="Aucun cours d'eau dans le registre">Ajoutez les cours d'eau depuis la carte (menu Édition › Cours d'eau).</Vide>
            )}
          </div>
          <div className="legende-eau muted">Les cases indiquent la turbidité (NTU) ; rouge : au moins un paramètre au-dessus du seuil, vert : conforme.</div>
        </div>
      </section>

      <section className="grid grid-3 mt-4">
        <article className="card span-2">
          <div className="card-header">
            <h2>Évolution hebdomadaire</h2>
            <div className="actions">
              <div className="segmented">
                {PARAMETRES.map((p) => <button key={p.cle} type="button" className={param === p.cle ? "active" : ""} onClick={() => setParam(p.cle)}>{p.libelle}</button>)}
              </div>
            </div>
          </div>
          <div className="card-body"><Chart id="g-eau-evolution" options={graphe} /></div>
        </article>
        <article className="card">
          <div className="card-header"><h2>Seuils de référence</h2></div>
          <div className="card-body stack" style={{ fontSize: 13 }}>
            {PARAMETRES.map((p) => (
              <div key={p.cle}><strong>{p.libelle} : {fmtVal(p.seuil, p.decimales)} {p.unite}</strong><div className="muted">{p.source}</div></div>
            ))}
            <div className="muted">Valeurs indicatives pour l'eau de boisson : une mesure au-dessus du seuil est signalée en dépassement.</div>
          </div>
        </article>
      </section>

      <section className="card mt-4">
        <div className="card-header">
          <span className="mi" style={{ color: "var(--primary)" }}>list_alt</span>
          <h2>Historique des mesures</h2>
          <span className="badge">{liste.length}</span>
          <div className="actions">
            <select className="select sm" style={{ width: "auto" }} value={filtreCe} onChange={(e) => setFiltreCe(e.target.value)} aria-label="Cours d'eau">
              <option value="">Tous les cours d'eau</option>
              {cours.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
        </div>
        <div className="card-body flush">
          <div className="table-wrap" style={{ maxHeight: 520 }}>
            {liste.length ? (
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Semaine</th><th>Date</th><th>Cours d'eau</th><th>Point</th>
                    {PARAMETRES.map((p) => <th key={p.cle} className="num">{p.libelle} ({p.unite})</th>)}
                    <th>Autres</th><th>Statut</th><th />
                  </tr>
                </thead>
                <tbody>
                  {liste.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap">{T.dateFr(m.semaine)}</td>
                      <td className="nowrap">{T.dateFr(m.date)}</td>
                      <td className="cell-strong">{m.cours_eau}</td>
                      <td>{m.point || <span className="muted">—</span>}{m.lat !== null && <span className="mi mi-sm muted" title="Point géolocalisé" style={{ marginLeft: 4 }}>location_on</span>}</td>
                      {PARAMETRES.map((p) => (
                        <td key={p.cle} className="num" style={depasse(m, p.cle) ? { color: "#dc2626", fontWeight: 700 } : null}>{fmtVal(m[p.cle], p.decimales)}</td>
                      ))}
                      <td style={{ fontSize: 12.5 }}>{(m.autres || []).map((a) => `${a.parametre} ${fmtVal(a.valeur, 3)}${a.unite ? ` ${a.unite}` : ""}`).join(" · ") || <span className="muted">—</span>}</td>
                      <td><span className="badge" style={{ background: `${STATUT_EAU[m.statut].couleur}1f`, color: STATUT_EAU[m.statut].couleur }}>{STATUT_EAU[m.statut].libelle}</span></td>
                      <td className="nowrap right">
                        <button className="btn btn-sm btn-ghost btn-icon" type="button" title="Modifier" onClick={() => ouvrir(m)}><span className="mi">edit</span></button>
                        <button className="btn btn-sm btn-ghost btn-icon" type="button" title="Supprimer" onClick={() => supprimer(m)}><span className="mi" style={{ color: "var(--danger)" }}>delete</span></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Vide icone="water_drop" titre="Aucune mesure">Les mesures saisies apparaîtront ici, de la plus récente à la plus ancienne.</Vide>
            )}
          </div>
        </div>
      </section>

      {edition && (
        <FormulaireMesure cours={cours} initial={edition.initial} id={edition.id} onClose={() => setEdition(null)}
          onSaved={() => { setEdition(null); charger(); }} />
      )}
    </div>
  );
}

function FormulaireMesure({ cours, initial, id, onClose, onSaved }) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState("");
  const f = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const setAutre = (i, k) => (e) => setV({ ...v, autres: v.autres.map((a, j) => (j === i ? { ...a, [k]: e.target.value } : a)) });
  async function enregistrer(e) {
    e.preventDefault();
    setErr("");
    const corps = {
      cours_eau_id: v.cours_eau_id, date: v.date, point: v.point, observations: v.observations, coord: coordOrNull(v.coord),
      turbidite: num(v.turbidite), mercure: num(v.mercure), cyanure: num(v.cyanure),
      autres: v.autres.filter((a) => a.parametre.trim() && String(a.valeur).trim() !== "").map((a) => ({ parametre: a.parametre.trim(), valeur: num(a.valeur), unite: a.unite.trim() })),
    };
    if ([corps.turbidite, corps.mercure, corps.cyanure].some((x) => x !== null && (Number.isNaN(x) || x < 0))) return setErr("Les valeurs doivent être des nombres positifs.");
    try {
      await api(id ? `/qualite-eau/${id}` : "/qualite-eau", { method: id ? "PUT" : "POST", body: corps });
      GR.toast(id ? "Mesure modifiée" : "Mesure enregistrée");
      onSaved();
    } catch (x) {
      setErr(x.message);
    }
    return undefined;
  }
  const alertes = PARAMETRES.filter((p) => num(v[p.cle]) !== null && num(v[p.cle]) > p.seuil);
  return (
    <Modal title={id ? "Modifier la mesure" : "Nouvelle mesure de qualité de l'eau"} sub="Une mesure par cours d'eau, point de prélèvement et semaine" onClose={onClose}>
      <form className="grid" onSubmit={enregistrer}>
        <div className="fgrid">
          <label className="f">Cours d'eau
            <select className="select" value={v.cours_eau_id} onChange={f("cours_eau_id")} required>
              <option value="">Choisir…</option>
              {cours.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </label>
          <label className="f">Date du prélèvement<input className="input" type="date" value={v.date} max={isoToday()} onChange={f("date")} required /></label>
          <label className="f">Point de prélèvement <small>facultatif</small><input className="input" value={v.point} onChange={f("point")} placeholder="ex. pont de Doka, amont du site" /></label>
        </div>
        <div className="fgrid">
          {PARAMETRES.map((p) => (
            <label key={p.cle} className="f">{p.libelle} ({p.unite}) <small>seuil {fmtVal(p.seuil, p.decimales)}</small>
              <input className="input mono" inputMode="decimal" value={v[p.cle]} onChange={f(p.cle)} placeholder="non mesuré" />
            </label>
          ))}
        </div>
        {alertes.length > 0 && <div className="alert warning"><span className="mi">warning</span><span>Dépassement de seuil : {alertes.map((p) => p.libelle).join(", ")}.</span></div>}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Autres paramètres <span className="muted" style={{ fontWeight: 500 }}>(pH, conductivité, MES, arsenic…)</span></div>
          <div className="stack" style={{ gap: 6 }}>
            {v.autres.map((a, i) => (
              <div key={i} className="row" style={{ gap: 6 }}>
                <input className="input" style={{ flex: 2 }} value={a.parametre} onChange={setAutre(i, "parametre")} placeholder="Paramètre" />
                <input className="input mono" style={{ flex: 1 }} inputMode="decimal" value={a.valeur} onChange={setAutre(i, "valeur")} placeholder="Valeur" />
                <input className="input" style={{ flex: 1 }} value={a.unite} onChange={setAutre(i, "unite")} placeholder="Unité" />
                <button className="btn btn-sm btn-ghost btn-icon" type="button" title="Retirer" onClick={() => setV({ ...v, autres: v.autres.filter((_, j) => j !== i) })}><span className="mi">close</span></button>
              </div>
            ))}
            <div><button className="btn btn-sm" type="button" onClick={() => setV({ ...v, autres: [...v.autres, { parametre: "", valeur: "", unite: "" }] })}><span className="mi">add</span>Ajouter un paramètre</button></div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Position du point de prélèvement <span className="muted" style={{ fontWeight: 500 }}>(facultatif : sinon, la mesure est placée sur le tracé du cours d'eau)</span></div>
          <CoordFields value={v.coord} onChange={(c) => setV({ ...v, coord: c })} />
        </div>
        <label className="f">Observations<textarea className="input" value={v.observations} onChange={f("observations")} placeholder="couleur, odeur, activité observée en amont, laboratoire…" /></label>
        {err && <div className="alert error">{err}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" type="button" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" type="submit">{id ? "Enregistrer" : "Enregistrer la mesure"}</button>
        </div>
      </form>
    </Modal>
  );
}
