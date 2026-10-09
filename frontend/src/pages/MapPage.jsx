import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import { CircleMarker, GeoJSON, LayersControl, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { STATUT_HEX, STATUT_LABEL, STATUT_ORDER, addDays, api, daysBetween, frDate, isoToday, saisiesText, statutAt } from "../api";
import { useView } from "../context";

const SOURCE_LABEL = { rapport: "Rapport", brq: "BRQ", fiche: "Fiche RENS", satellite: "Satellite", drone: "Drone", saisie: "Saisie" };

function FitTo({ sites }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    const pts = sites.filter((s) => s.lat != null && !s.coord_alerte).map((s) => [s.lat, s.lng]);
    if (pts.length) { map.fitBounds(L.latLngBounds(pts).pad(0.25)); done.current = true; }
  }, [sites, map]);
  return null;
}

function FlyTo({ site }) {
  const map = useMap();
  useEffect(() => { if (site && site.lat != null) map.flyTo([site.lat, site.lng], Math.max(map.getZoom(), 14), { duration: 0.7 }); }, [site, map]);
  return null;
}

export default function MapPage() {
  const nav = useNavigate();
  const { date, setDate, departement, setDepartement, focusSite, setFocusSite } = useView();
  const [sites, setSites] = useState([]);
  const [zones, setZones] = useState([]);
  const [rivers, setRivers] = useState([]);
  const [selId, setSelId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([api("/sites"), api("/zones"), api("/cours-eau")])
      .then(([s, z, c]) => { setSites(s); setZones(z); setRivers(c); })
      .catch((e) => setErr(e.message));
  }, []);

  const today = isoToday();
  const minDate = useMemo(() => {
    const ds = sites.flatMap((s) => s.events.map((e) => e.date));
    return ds.length ? ds.reduce((a, b) => (a < b ? a : b)) : addDays(today, -30);
  }, [sites, today]);
  const span = Math.max(1, daysBetween(minDate, today));
  const cur = date < minDate ? minDate : date > today ? today : date;
  const eventDates = useMemo(() => Array.from(new Set(sites.flatMap((s) => s.events.map((e) => e.date)))).sort(), [sites]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setDate((d) => {
        const n = addDays(d < minDate ? minDate : d, 1);
        if (n >= today) { setPlaying(false); return today; }
        return n;
      });
    }, 160);
    return () => clearInterval(t);
  }, [playing, minDate, today, setDate]);

  useEffect(() => { if (focusSite) { setSelId(focusSite); setFocusSite(null); } }, [focusSite, setFocusSite]);
  useEffect(() => { if (selId) api("/sites/" + selId).then(setDetail).catch(() => setDetail(null)); else setDetail(null); }, [selId]);

  const visible = sites.filter((s) => !departement || s.departement === departement);
  const withStatus = visible.map((s) => ({ ...s, st: statutAt(s.events, cur) })).filter((s) => s.st);
  const counts = STATUT_ORDER.reduce((o, k) => ({ ...o, [k]: withStatus.filter((s) => s.st === k).length }), {});
  const nonGeo = withStatus.filter((s) => s.lat == null).length;
  const hors = withStatus.filter((s) => s.lat != null && s.coord_alerte).length;
  const sel = sites.find((s) => s.id === selId);

  const pct = (iso) => (daysBetween(minDate, iso) / span) * 100;

  return (
    <div className="map-page">
      <div className="map-top">
        <div>
          <h1 style={{ fontSize: 20 }}>Situation des sites d'orpaillage</h1>
          <div className="muted" style={{ fontSize: 13 }}>Région du Gôh · statuts au {frDate(cur)}</div>
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Département">
            {[["", "Gôh"], ["Gagnoa", "Gagnoa"], ["Oumé", "Oumé"]].map(([v, l]) => (
              <button key={l} type="button" aria-pressed={departement === v} onClick={() => setDepartement(v)}>{l}</button>
            ))}
          </div>
          <button className="btn small" type="button" onClick={() => nav("/tableau-de-bord")}>Indicateurs à cette date</button>
        </div>
      </div>

      <div className="map-wrap">
        <MapContainer center={[6.1, -5.8]} zoom={9} scrollWheelZoom>
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="Image satellite (Esri)">
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Esri, Maxar, Earthstar Geographics" maxZoom={19} />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Plan (OpenStreetMap)">
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Relief (OpenTopoMap)">
              <TileLayer url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" attribution="&copy; OpenTopoMap" />
            </LayersControl.BaseLayer>
            <LayersControl.Overlay checked name="Noms de lieux">
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" />
            </LayersControl.Overlay>
          </LayersControl>
          <FitTo sites={sites} />
          <FlyTo site={sel} />
          {zones.map((z) => (
            <GeoJSON key={z.id} data={z.geometrie} interactive={false} style={{ color: "#f4d35e", weight: 1.5, dashArray: "6 6", fill: false }} />
          ))}
          {rivers.filter((r) => r.trace).map((r) => (
            <GeoJSON key={r.id} data={r.trace} style={{ color: r.intensite === "non_impacte" ? "#5aa9e6" : "#d1495b", weight: 3 }}>
              <Tooltip sticky>{r.nom}</Tooltip>
            </GeoJSON>
          ))}
          {withStatus.filter((s) => s.contour).map((s) => (
            <GeoJSON key={"c" + s.id + s.st} data={s.contour} style={{ color: STATUT_HEX[s.st], weight: 2, fillOpacity: 0.25 }}
              eventHandlers={{ click: () => setSelId(s.id) }} />
          ))}
          {withStatus.filter((s) => s.lat != null).map((s) => (
            <CircleMarker key={s.id + s.st} center={[s.lat, s.lng]} radius={s.id === selId ? 10 : 7}
              pathOptions={{ color: s.id === selId ? "#ffffff" : "#111", weight: s.id === selId ? 3 : 1.5, fillColor: STATUT_HEX[s.st], fillOpacity: 0.95, dashArray: s.coord_alerte ? "3 3" : null }}
              eventHandlers={{ click: () => setSelId(s.id) }}>
              <Tooltip direction="top" offset={[0, -6]}>{s.code} · {s.localite} — {STATUT_LABEL[s.st]}</Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <aside className="map-side">
        {err && <div className="err">{err}</div>}
        {sel && detail ? (
          <SiteDetail site={detail} cur={cur} onClose={() => setSelId(null)} onDate={setDate} />
        ) : (
          <>
            <div>
              <h2>Au {frDate(cur)}</h2>
              <div className="muted" style={{ fontSize: 13 }}>{withStatus.length} site(s) connu(s){departement ? " · " + departement : ""}</div>
            </div>
            <div className="legend">
              {STATUT_ORDER.map((k) => (
                <div key={k}><span className="dot" style={{ background: STATUT_HEX[k] }} /><span style={{ flex: 1 }}>{STATUT_LABEL[k]}</span><b className="num">{counts[k]}</b></div>
              ))}
            </div>
            {(nonGeo > 0 || hors > 0) && (
              <div className="card" style={{ background: "var(--warn-soft)", borderColor: "var(--warn)", fontSize: 13 }}>
                {nonGeo > 0 && <div>{nonGeo} site(s) sans coordonnées, absents de la carte.</div>}
                {hors > 0 && <div>{hors} site(s) hors de la région (contour pointillé) : coordonnées à vérifier.</div>}
                <button className="btn small" style={{ marginTop: 8 }} type="button" onClick={() => nav("/sites")}>Corriger dans le registre</button>
              </div>
            )}
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>Cliquez sur un site pour voir son historique. Faites glisser la barre du temps pour revoir la situation à n'importe quelle date.</p>
          </>
        )}
      </aside>

      <div className="timebar">
        <div className="head">
          <div className="date">{frDate(cur)}{cur === today ? " · aujourd'hui" : ""}</div>
          <div className="row">
            <button className="btn small" type="button" onClick={() => { setPlaying(false); setDate(minDate); }}>Début</button>
            <button className="btn small" type="button" onClick={() => setDate(addDays(cur, -7) < minDate ? minDate : addDays(cur, -7))}>− 7 j</button>
            <button className="btn small" type="button" onClick={() => { if (!playing && cur >= today) setDate(minDate); setPlaying(!playing); }}>{playing ? "Pause" : "Rejouer"}</button>
            <button className="btn small" type="button" onClick={() => setDate(addDays(cur, 7) > today ? today : addDays(cur, 7))}>+ 7 j</button>
            <button className="btn small" type="button" onClick={() => { setPlaying(false); setDate(today); }}>Aujourd'hui</button>
          </div>
        </div>
        <input type="range" min={0} max={span} value={daysBetween(minDate, cur)} aria-label="Date affichée"
          onChange={(e) => { setPlaying(false); setDate(addDays(minDate, Number(e.target.value))); }} />
        <div className="ticks">
          {eventDates.map((d) => <i key={d} style={{ left: pct(d) + "%" }} title={"Mise à jour le " + frDate(d)} />)}
          <span style={{ left: "0%", transform: "none" }}>{frDate(minDate)}</span>
          <span style={{ left: "100%", transform: "translateX(-100%)" }}>{frDate(today)}</span>
        </div>
      </div>
    </div>
  );
}

function SiteDetail({ site, cur, onClose, onDate }) {
  const st = statutAt(site.events, cur);
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="mono" style={{ fontWeight: 600, color: "var(--accent)" }}>{site.code}</div>
          <h2>{site.localite}</h2>
          <div className="muted" style={{ fontSize: 13 }}>{[site.sous_prefecture, site.departement].filter(Boolean).join(" · ")}{site.foret ? " · " + site.foret : ""}</div>
        </div>
        <button className="btn small" type="button" onClick={onClose}>Fermer</button>
      </div>
      <div className="row">
        {st ? <span className="pill"><span className="dot" style={{ background: STATUT_HEX[st] }} />{STATUT_LABEL[st]} au {frDate(cur)}</span> : <span className="pill">Pas encore connu à cette date</span>}
        {site.superficie_ha ? <span className="pill">{site.superficie_ha} ha</span> : null}
      </div>
      {site.coord_alerte && <div className="pill warn" style={{ whiteSpace: "normal" }}>{site.coord_alerte}</div>}
      {site.lat != null && (
        <div className="mono" style={{ fontSize: 12.5 }}>
          {site.lat.toFixed(5)}, {site.lng.toFixed(5)}
          {site.coord_saisie && site.coord_saisie.sys !== "wgs" ? <div className="muted">UTM {site.coord_saisie.sys}N : {site.coord_saisie.x} / {site.coord_saisie.y}</div> : null}
        </div>
      )}
      {site.observations && <p style={{ margin: 0, fontSize: 13.5 }}>{site.observations}</p>}
      <div>
        <h3 style={{ marginBottom: 8 }}>Historique</h3>
        <div className="timeline">
          {[...site.events].reverse().map((e) => (
            <button key={e.id} type="button" className={"ev" + (e.date > cur ? " future" : "")} onClick={() => onDate(e.date)}
              style={{ borderLeftColor: STATUT_HEX[e.statut], background: "none", border: 0, borderLeft: `3px solid ${STATUT_HEX[e.statut]}`, textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit" }}>
              <div className="d">{frDate(e.date)} · {SOURCE_LABEL[e.source] || e.source}</div>
              <div style={{ fontWeight: 600 }}>{STATUT_LABEL[e.statut]}</div>
              {e.note && <div className="muted">{e.note}</div>}
            </button>
          ))}
        </div>
      </div>
      {site.visites && site.visites.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 6 }}>Saisies sur ce site</h3>
          <div style={{ fontSize: 13 }}>
            {site.visites.filter((v) => Object.keys(v.saisies || {}).length || v.interpelles).map((v) => (
              <div key={v.id}>{frDate(v.date)} : {saisiesText(v.saisies)}{v.interpelles ? `, ${v.interpelles} interpellé(s)` : ""}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
