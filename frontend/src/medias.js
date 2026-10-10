// Photos, vidéos et signatures : préparation dans le navigateur et lecture authentifiée.
import { getToken, urlApi } from "./api";

export const PHOTO_MAX_PX = 2560;
export const VIDEO_MAX_MO = 50;
const MINI_PX = 360;

/* ---------- Lecture des fichiers protégés (le jeton ne peut pas passer dans <img src>) ---------- */
const cache = new Map();

export function chargerBlob(chemin) {
  if (!cache.has(chemin)) {
    const p = fetch(urlApi(chemin), { headers: { Authorization: "Bearer " + getToken() } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status === 404 ? "Fichier introuvable" : "Erreur " + r.status))));
    p.catch(() => cache.delete(chemin));
    cache.set(chemin, p);
  }
  return cache.get(chemin);
}

const urls = new Map();
export async function urlObjet(chemin) {
  if (!urls.has(chemin)) urls.set(chemin, URL.createObjectURL(await chargerBlob(chemin)));
  return urls.get(chemin);
}

export const versDataUrl = (blob) =>
  new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = ko;
    r.readAsDataURL(blob);
  });

/* ---------- Préparation avant envoi ---------- */
const toBlob = (canvas, type, q) => new Promise((ok) => canvas.toBlob(ok, type, q));

function dessiner(source, w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

async function ouvrirImage(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) { /* format non décodable par createImageBitmap : on passe par <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const dateFichier = (file) => (file.lastModified ? new Date(file.lastModified - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) : "");

export function typeMedia(file) {
  const t = (file.type || "").toLowerCase();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (t.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext)) return "photo";
  if (t.startsWith("video/") || ["mp4", "mov", "webm", "m4v"].includes(ext)) return "video";
  return null;
}

/** Photo : réduite à 2 560 px au plus et recompressée en JPEG (les photos de téléphone font souvent 5 à 10 Mo). */
export async function preparerPhoto(file) {
  const img = await ouvrirImage(file).catch(() => {
    throw new Error(`« ${file.name} » : format de photo non lisible par le navigateur (HEIC ? exportez-la en JPEG).`);
  });
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  let fichier = file;
  const leger = file.type === "image/jpeg" && file.size < 1.5e6 && Math.max(w, h) <= PHOTO_MAX_PX;
  if (!leger) {
    const blob = await toBlob(dessiner(img, w, h, PHOTO_MAX_PX), "image/jpeg", 0.85);
    fichier = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  }
  const mini = await toBlob(dessiner(img, w, h, MINI_PX), "image/jpeg", 0.72);
  const k = Math.min(1, PHOTO_MAX_PX / Math.max(w, h));
  return { type: "photo", fichier, miniature: mini, largeur: Math.round(w * k), hauteur: Math.round(h * k), duree_s: null, date_prise: dateFichier(file) };
}

/** Vidéo : envoyée telle quelle (50 Mo au plus) ; on en tire la durée et une image d'aperçu. */
export async function preparerVideo(file) {
  if (file.size > VIDEO_MAX_MO * 1024 * 1024) {
    throw new Error(`« ${file.name} » fait ${(file.size / 1048576).toFixed(0)} Mo : ${VIDEO_MAX_MO} Mo au plus. Raccourcissez la séquence ou filmez en 720p.`);
  }
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const mime = file.type || (ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime" : "video/mp4");
  const fichier = file.type ? file : new File([file], file.name, { type: mime });
  const info = { type: "video", fichier, miniature: null, largeur: 0, hauteur: 0, duree_s: null, date_prise: dateFichier(file) };
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "metadata";
  v.src = url;
  const attendre = (ev, ms) =>
    new Promise((ok, ko) => {
      const t = setTimeout(() => ko(new Error("délai")), ms);
      v.addEventListener(ev, () => (clearTimeout(t), ok()), { once: true });
      v.addEventListener("error", () => (clearTimeout(t), ko(new Error("lecture"))), { once: true });
    });
  try {
    await attendre("loadedmetadata", 8000);
    info.duree_s = Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null;
    info.largeur = v.videoWidth;
    info.hauteur = v.videoHeight;
    v.currentTime = Math.min(1, (v.duration || 2) / 2);
    await attendre("seeked", 8000);
    if (v.videoWidth) info.miniature = await toBlob(dessiner(v, v.videoWidth, v.videoHeight, MINI_PX), "image/jpeg", 0.72);
  } catch (e) {
    /* codec non lu par ce navigateur (HEVC…) : la vidéo est quand même envoyée, sans aperçu */
  } finally {
    URL.revokeObjectURL(url);
  }
  return info;
}

export const duree = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
export const taille = (o) => (o > 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);
