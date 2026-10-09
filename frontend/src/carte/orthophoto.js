/* Préparation d'une orthophoto drone dans le navigateur :
   lecture du GeoTIFF (ou JPEG/PNG + fichier de calage), emprise, système de coordonnées,
   réduction à 4096 px et conversion en WebP pour l'affichage sur la carte. */

const COTE_MAX = 4096;
export const CRS_PRIS_EN_CHARGE = ["EPSG:4326", "EPSG:3857", "EPSG:32629", "EPSG:32630"];

function devinerCrs(bbox) {
  const [x0, y0] = bbox;
  if (Math.abs(x0) <= 180 && Math.abs(y0) <= 90) return "EPSG:4326";
  if (Math.abs(x0) > 1e6) return "EPSG:3857";
  // UTM : dans le Gôh, X ≈ 170 000–330 000 m en zone 30N, X > 600 000 m en zone 29N (Sérihio)
  return x0 > 600000 ? "EPSG:32629" : "EPSG:32630";
}

function crsDepuisGeoKeys(k) {
  const code = k?.ProjectedCSTypeGeoKey || k?.GeographicTypeGeoKey;
  if (!code || code === 32767) return null;
  if (code === 900913 || code === 3857) return "EPSG:3857";
  return `EPSG:${code}`;
}

const dateTiff = (img) => {
  const d = img.fileDirectory?.DateTime;
  const m = typeof d === "string" && d.match(/^(\d{4}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** Étire une bande (valeurs > 8 bits) entre ses percentiles 2 et 98. */
function etirement(valeurs, pas, decalage, nodata) {
  const echant = [];
  for (let i = decalage; i < valeurs.length; i += pas * 97) {
    const v = valeurs[i];
    if (v !== nodata && Number.isFinite(v)) echant.push(v);
  }
  echant.sort((a, b) => a - b);
  const lo = echant[Math.floor(echant.length * 0.02)] ?? 0;
  const hi = echant[Math.floor(echant.length * 0.98)] ?? 255;
  return [lo, Math.max(lo + 1, hi)];
}

async function depuisGeoTiff(fichier) {
  const { fromBlob } = await import("geotiff");
  const tiff = await fromBlob(fichier);
  const img0 = await tiff.getImage(0);
  const bbox = img0.getBoundingBox();
  const L = img0.getWidth();
  const H = img0.getHeight();
  const crs = crsDepuisGeoKeys(img0.getGeoKeys());
  const res = img0.getResolution?.() || [(bbox[2] - bbox[0]) / L];
  // Aperçu le plus petit qui reste ≥ la taille visée (COG avec pyramides)
  const n = await tiff.getImageCount();
  const facteur = Math.min(1, COTE_MAX / Math.max(L, H));
  const w = Math.max(1, Math.round(L * facteur));
  const h = Math.max(1, Math.round(H * facteur));
  let source = img0;
  for (let i = 1; i < n; i += 1) {
    const ov = await tiff.getImage(i);
    if (ov.getWidth() >= w && ov.getWidth() < source.getWidth() && ov.getSamplesPerPixel() === img0.getSamplesPerPixel()) source = ov;
  }
  const spp = img0.getSamplesPerPixel();
  const nodata = img0.getGDALNoData();
  const bits = img0.getBitsPerSample?.() || 8;
  const ras = await source.readRasters({ width: w, height: h, interleave: true, resampleMethod: "bilinear" });
  const rgba = new Uint8ClampedArray(w * h * 4);
  const bandes = Math.min(spp, 4);
  const plages = [];
  for (let b = 0; b < Math.min(bandes, 3); b += 1) plages.push(bits > 8 || ras instanceof Float32Array ? etirement(ras, spp, b, nodata) : [0, 255]);
  for (let p = 0; p < w * h; p += 1) {
    const o = p * spp;
    let r;
    let g;
    let bl;
    if (spp >= 3) {
      r = ras[o];
      g = ras[o + 1];
      bl = ras[o + 2];
    } else r = g = bl = ras[o];
    const ech = (v, k) => ((v - plages[Math.min(k, plages.length - 1)][0]) / (plages[Math.min(k, plages.length - 1)][1] - plages[Math.min(k, plages.length - 1)][0])) * 255;
    rgba[p * 4] = ech(r, 0);
    rgba[p * 4 + 1] = ech(g, 1);
    rgba[p * 4 + 2] = ech(bl, 2);
    let a = 255;
    if (spp >= 4) a = bits > 8 ? (ras[o + 3] > 0 ? 255 : 0) : ras[o + 3];
    if (nodata !== null && nodata !== undefined && r === nodata && g === nodata && bl === nodata) a = 0;
    if (spp >= 3 && spp < 4 && nodata === null && r === 0 && g === 0 && bl === 0) a = 0; // bords noirs des orthos
    rgba[p * 4 + 3] = a;
  }
  return { rgba, w, h, bbox, crs, resolution: Math.abs(res[0]), largeurOrigine: L, hauteurOrigine: H, date: dateTiff(img0) };
}

/** JPEG / PNG accompagné de son fichier de calage (.jgw, .pgw, .wld, .tfw). */
async function depuisImageCalee(image, calage) {
  const lignes = (await calage.text()).split(/\r?\n/).map((x) => Number(x.trim().replace(",", "."))).filter((x) => Number.isFinite(x));
  if (lignes.length < 6) throw new Error("Fichier de calage illisible (6 valeurs attendues)");
  const [a, d, b, e, c, f] = lignes;
  if (Math.abs(d) > 1e-9 || Math.abs(b) > 1e-9) throw new Error("Images tournées non prises en charge : exportez l'orthophoto en GeoTIFF nord en haut");
  const bmp = await createImageBitmap(image);
  const L = bmp.width;
  const H = bmp.height;
  const x0 = c - a / 2;
  const y1 = f - e / 2;
  const bbox = [x0, y1 + e * H, x0 + a * L, y1];
  const facteur = Math.min(1, COTE_MAX / Math.max(L, H));
  const w = Math.round(L * facteur);
  const h = Math.round(H * facteur);
  const cv = new OffscreenCanvas(w, h);
  cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
  const rgba = cv.getContext("2d").getImageData(0, 0, w, h).data;
  return { rgba, w, h, bbox, crs: null, resolution: Math.abs(a), largeurOrigine: L, hauteurOrigine: H, date: null };
}

/** Lit les fichiers choisis et renvoie l'orthophoto prête à être envoyée (sans la convertir encore). */
export async function lireOrthophoto(fichiers) {
  const liste = [...fichiers];
  const tif = liste.find((f) => /\.tiff?$/i.test(f.name));
  let r;
  let nom;
  if (tif) {
    r = await depuisGeoTiff(tif);
    nom = tif.name;
  } else {
    const image = liste.find((f) => /\.(jpe?g|png)$/i.test(f.name));
    const calage = liste.find((f) => /\.(jgw|pgw|wld|tfw|jpgw|pngw)$/i.test(f.name));
    if (!image) throw new Error("Choisissez un GeoTIFF (.tif) ou une image JPEG / PNG avec son fichier de calage");
    if (!calage) throw new Error(`Le fichier de calage de ${image.name} manque (.jgw, .pgw ou .wld) : sélectionnez les deux fichiers ensemble`);
    r = await depuisImageCalee(image, calage);
    nom = image.name;
  }
  r.crsDevine = r.crs || devinerCrs(r.bbox);
  r.fichier = nom;
  return r;
}

/** Convertit l'orthophoto lue en image WebP (ou PNG si WebP indisponible). */
export async function versBlob(o) {
  const cv = document.createElement("canvas");
  cv.width = o.w;
  cv.height = o.h;
  cv.getContext("2d").putImageData(new ImageData(o.rgba, o.w, o.h), 0, 0);
  const essai = await new Promise((ok) => cv.toBlob(ok, "image/webp", 0.85));
  if (essai && essai.type === "image/webp") return essai;
  return new Promise((ok) => cv.toBlob(ok, "image/png"));
}
