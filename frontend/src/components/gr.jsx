/* Petits composants React au-dessus des utilitaires GestReb (GR). */
import React, { useEffect, useRef } from "react";
import GR from "../gr/gr";

/** Graphique ApexCharts (recréé quand `options` change). */
export function Chart({ id, options, className = "chart" }) {
  useEffect(() => {
    if (!options) return undefined;
    GR.chart(id, options);
    return () => {
      if (GR.charts[id]) {
        GR.charts[id].destroy();
        delete GR.charts[id];
      }
    };
  }, [id, options]);
  return <div id={id} className={className} />;
}

/** Liste à choix multiples de GestReb. */
export function MultiSelect({ options, value, onChange, placeholder, recherche = true }) {
  const el = useRef(null);
  const inst = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    inst.current = new GR.MultiSelect(el.current, { options, placeholder, recherche, selected: value, onChange: (v) => cb.current(v) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    inst.current?.setOptions(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(options)]);
  useEffect(() => {
    const cur = inst.current?.values() || [];
    if (JSON.stringify([...cur].sort()) !== JSON.stringify([...(value || [])].map(String).sort())) inst.current?.set(value || []);
  }, [value]);
  return <div ref={el} />;
}

export function Kpi({ icone, couleur = "", libelle, valeur, unite, pied, progression, cible }) {
  return (
    <div className="kpi">
      <div className={`kpi-icon ${couleur}`}>
        <span className="mi">{icone}</span>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="kpi-label">{libelle}</div>
        <div className="kpi-value">
          {valeur}
          {unite && <small>{unite}</small>}
        </div>
        {pied && <div className="kpi-foot">{pied}</div>}
        {progression !== undefined && progression !== null && (
          <div className={`progress ${couleur === "amber" ? "amber" : couleur === "red" ? "red" : ""}`} style={{ position: "relative" }}>
            <span style={{ width: `${Math.min(100, Math.max(0, progression))}%` }} />
            {cible !== undefined && <b className="cible-marque" style={{ left: `${cible}%` }} title={`Cible : ${cible} %`} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** Fenêtre modale au format GestReb. */
export function Modal({ titre, sous, icone, onClose, children, pied, large }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="modal open" data-static onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-dialog ${large ? "lg" : ""}`} role="dialog" aria-modal="true" aria-label={titre}>
        <div className="modal-head">
          {icone && <span className="mi" style={{ color: "var(--primary)" }}>{icone}</span>}
          <div style={{ minWidth: 0 }}>
            <h2>{titre}</h2>
            {sous && <div className="muted" style={{ fontSize: 12.5 }}>{sous}</div>}
          </div>
          <div className="actions">
            <button className="btn btn-sm btn-ghost btn-icon" type="button" onClick={onClose} aria-label="Fermer">
              <span className="mi">close</span>
            </button>
          </div>
        </div>
        <div className="modal-body">{children}</div>
        {pied && <div className="modal-foot">{pied}</div>}
      </div>
    </div>
  );
}

export function Alerte({ type = "info", icone, children }) {
  const ic = icone || { info: "info", success: "check_circle", warning: "warning", error: "error" }[type];
  return (
    <div className={`alert ${type}`}>
      <span className="mi">{ic}</span>
      <div>{children}</div>
    </div>
  );
}

export function Vide({ icone = "inbox", titre, children }) {
  return (
    <div className="empty">
      <span className="mi">{icone}</span>
      <h3>{titre}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
