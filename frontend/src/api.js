const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") + "/api";

let token = null;
try { token = localStorage.getItem("crloi_token"); } catch (e) { /* stockage indisponible */ }

export function setToken(t) {
  token = t;
  try { t ? localStorage.setItem("crloi_token", t) : localStorage.removeItem("crloi_token"); } catch (e) { /* ignore */ }
}
export const hasToken = () => !!token;

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function detail(body) {
  const d = body && body.detail;
  if (!d) return "Erreur du serveur";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => (e.loc ? e.loc.slice(-1)[0] + " : " : "") + e.msg).join(" ; ");
  return String(d);
}

export async function api(path, { method = "GET", body, params, form } = {}) {
  const url = new URL(BASE + path, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && url.searchParams.set(k, v));
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, { method, headers, body: payload }); }
  catch (e) { throw new ApiError(0, "Serveur injoignable. Vérifiez la connexion internet."); }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== "/auth/login") { setToken(null); window.dispatchEvent(new Event("crloi-logout")); }
  if (!res.ok) throw new ApiError(res.status, detail(data));
  return data;
}

export const STATUT_COLOR = {
  actif: "var(--st-actif)", recolonise: "var(--st-recolonise)", tentative_reprise: "var(--st-tentative)",
  demantele: "var(--st-demantele)", tenu: "var(--st-tenu)",
};
// Couleurs en clair pour Leaflet et les graphiques (les variables CSS n'y sont pas résolues).
export const STATUT_HEX = { actif: "#c62828", recolonise: "#8e1b6b", tentative_reprise: "#e08a00", demantele: "#2d6fa8", tenu: "#2f8f57" };
export const STATUT_ORDER = ["actif", "recolonise", "tentative_reprise", "demantele", "tenu"];
export const STATUT_LABEL = {
  actif: "Actif", tentative_reprise: "Tentative de reprise", recolonise: "Recolonisé", demantele: "Démantelé", tenu: "Tenu (non recolonisé)",
};

export function frDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
export function isoToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
}
/** Statut d'un site à une date, à partir de ses statuts datés (triés). */
export function statutAt(events, iso) {
  let s = null;
  for (const e of events || []) { if (e.date <= iso) s = e.statut; else break; }
  return s;
}

export const SAISIE_LABEL = {
  motopompes: "Motopompes", tapis: "Tapis de lavage", tuyaux_m: "Tuyaux (m)", motos: "Motos", tricycles: "Tricycles",
  velos: "Vélos", treuils: "Treuils", detecteurs: "Détecteurs", groupes: "Groupes électrogènes",
  engins_lourds: "Engins lourds", sacs_minerai: "Sacs de minerai",
};
export const saisiesText = (s) => Object.entries(s || {}).map(([k, n]) => `${n} ${(SAISIE_LABEL[k] || k).toLowerCase()}`).join(", ");
