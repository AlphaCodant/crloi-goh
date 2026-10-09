import React, { useEffect } from "react";

export function Modal({ title, sub, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: "min(980px, 100%)" } : null}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="muted" style={{ fontSize: 13 }}>{sub}</div>}
          </div>
          <button className="btn small" type="button" onClick={onClose}>Fermer</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CoordFields({ value, onChange }) {
  const v = value || { sys: "wgs", x: "", y: "" };
  const set = (k) => (e) => onChange({ ...v, [k]: e.target.value });
  const wgs = v.sys === "wgs";
  return (
    <div className="fgrid">
      <label className="f">Système de coordonnées
        <select value={v.sys} onChange={set("sys")}>
          <option value="wgs">WGS84 — degrés décimaux</option>
          <option value="29">UTM zone 29N (ouest : Sérihio…)</option>
          <option value="30">UTM zone 30N (est : Oumé, Gagnoa…)</option>
        </select>
      </label>
      <label className="f">{wgs ? "Longitude" : "X (Est, m)"}<input className="mono" inputMode="decimal" value={v.x} onChange={set("x")} placeholder={wgs ? "-5.3617" : "238747"} /></label>
      <label className="f">{wgs ? "Latitude" : "Y (Nord, m)"}<input className="mono" inputMode="decimal" value={v.y} onChange={set("y")} placeholder={wgs ? "6.3750" : "705256"} /></label>
    </div>
  );
}

export const coordOrNull = (c) => (c && String(c.x).trim() && String(c.y).trim() ? c : null);

export async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}
