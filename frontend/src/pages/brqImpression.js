// Version imprimable (et enregistrable en PDF) d'un BRQ, avec photos en annexe et signature.
import { frDate, saisiesText } from "../api";
import { chargerBlob, duree, versDataUrl } from "../medias";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nom = (a) => [a?.grade, a?.nom].filter((x) => x && String(x).trim()).join(" ");

export async function imprimerBrq(b, sites) {
  // La fenêtre est ouverte tout de suite (sinon le navigateur la bloque), puis remplie.
  const w = window.open("", "_blank");
  if (!w) {
    alert("Autorisez l'ouverture des fenêtres pour imprimer le BRQ.");
    return;
  }
  w.document.write("<p style='font-family:sans-serif;padding:20px'>Préparation du BRQ…</p>");

  const dataUrl = (chemin) => chargerBlob(chemin).then(versDataUrl).catch(() => null);
  const signature = b.signataire ? await dataUrl(`/signataires/${b.signataire.id}/signature`) : null;
  const photos = await Promise.all(b.medias.filter((m) => m.type === "photo").map(async (m) => ({ ...m, src: await dataUrl(`/medias/${m.id}/fichier`) })));
  const videos = b.medias.filter((m) => m.type === "video");
  const site = (id) => sites.find((s) => s.id === id);
  const periode = !b.periode_du ? "—" : b.periode_du === b.periode_au ? `le ${frDate(b.periode_du)}` : `du ${frDate(b.periode_du)} au ${frDate(b.periode_au)}`;
  const tot = b.visites.reduce((t, v) => t + (v.interpelles || 0), 0);

  w.document.open();
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>BRQ du ${esc(frDate(b.date))}</title>
<style>
@page{size:A4;margin:14mm 14mm 16mm}
*{box-sizing:border-box}
body{margin:0;font-family:'Century Gothic','Jost Variable',system-ui,sans-serif;font-size:9.5pt;color:#152124;line-height:1.4}
header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.5px solid #165d66;padding-bottom:3mm;margin-bottom:5mm}
header .org{font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;line-height:1.5}
header .restreint{font-size:8pt;border:1px solid #152124;padding:1mm 2.5mm;letter-spacing:.08em}
h1{font-size:14pt;font-weight:600;margin:0 0 1mm;text-align:center;letter-spacing:.03em}
.sous{text-align:center;color:#4d5f63;margin-bottom:6mm}
h2{font-size:10pt;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#165d66;margin:6mm 0 2mm;border-bottom:.5px solid #c3d3d6;padding-bottom:1mm}
dl{display:grid;grid-template-columns:38mm 1fr;gap:1.2mm 4mm;margin:0}
dt{color:#4d5f63}dd{margin:0}
table{width:100%;border-collapse:collapse;font-size:8.8pt}
th,td{border:.5px solid #93a6aa;padding:1.4mm 2mm;text-align:left;vertical-align:top}
th{background:#e9f5f7;font-weight:600}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.obs{white-space:pre-wrap}
.visa{margin-top:10mm;display:flex;justify-content:flex-end;break-inside:avoid}
.visa div{width:75mm;text-align:center}
.visa img{max-width:60mm;max-height:28mm;display:block;margin:2mm auto}
.visa .vide{height:24mm}
.annexe{break-before:page}
.photos{display:grid;grid-template-columns:1fr 1fr;gap:5mm}
figure{margin:0;break-inside:avoid}
figure img{width:100%;max-height:85mm;object-fit:contain;border:.5px solid #c3d3d6;background:#f5f9fa}
figcaption{font-size:8.5pt;margin-top:1mm}
figcaption small{color:#66797e}
footer{margin-top:8mm;font-size:7.5pt;color:#66797e;text-align:center}
</style></head><body>
<header>
  <div class="org">Comité régional de lutte contre l'orpaillage illégal du Gôh<br>${b.departement ? `Comité départemental ${b.departement === "Oumé" ? "d'Oumé" : "de " + esc(b.departement)}` : "Cellule renseignement"}</div>
  <div class="restreint">DIFFUSION RESTREINTE</div>
</header>
<h1>BULLETIN DE RENSEIGNEMENT QUOTIDIEN</h1>
<div class="sous">${b.reference ? `N° ${esc(b.reference)} — ` : ""}du ${esc(frDate(b.date))}</div>

<h2>Mission</h2>
<dl>
  <dt>Période</dt><dd>${esc(periode)}</dd>
  <dt>Unités engagées</dt><dd>${esc(b.unites) || "—"}</dd>
  <dt>Chef de mission</dt><dd>${esc(nom(b.chef_mission)) || "—"}${b.chef_mission?.structure ? ` (${esc(b.chef_mission.structure)})` : ""}</dd>
</dl>

<h2>Agents participants (${b.agents.length})</h2>
${b.agents.length ? `<table><thead><tr><th style="width:8mm">N°</th><th>Grade</th><th>Nom et prénoms</th><th>Structure / unité</th></tr></thead><tbody>
${b.agents.map((a, i) => `<tr><td class="n">${i + 1}</td><td>${esc(a.grade)}</td><td>${esc(a.nom)}</td><td>${esc(a.structure)}</td></tr>`).join("")}</tbody></table>` : "<p>—</p>"}

<h2>Sites visités (${b.visites.length})</h2>
<table><thead><tr><th>Site</th><th>Constat</th><th>Matériel saisi</th><th>Interpellés</th><th>Observations</th></tr></thead><tbody>
${b.visites.map((v) => `<tr><td><strong>${esc(v.site_code || "—")}</strong> ${esc(v.site_localite || "")}</td><td>${esc(v.constat_label)}</td><td>${esc(saisiesText(v.saisies)) || "—"}</td><td class="n">${v.interpelles || "—"}</td><td>${esc(v.note)}</td></tr>`).join("")}
</tbody></table>
${tot ? `<p>Total des personnes interpellées : <strong>${tot}</strong></p>` : ""}

${b.observations ? `<h2>Observations générales</h2><div class="obs">${esc(b.observations)}</div>` : ""}
${b.medias.length ? `<p style="margin-top:4mm">Pièces jointes : ${photos.length} photo(s)${photos.length ? " en annexe" : ""}${videos.length ? `, ${videos.length} vidéo(s) consultable(s) dans l'application` : ""}.</p>` : ""}

<div class="visa"><div>
  ${b.signataire ? `<div>${esc(b.signataire.fonction || "Le responsable du Comité départemental")}</div>${signature ? `<img src="${signature}" alt="">` : '<div class="vide"></div>'}<strong>${esc(b.signataire.nom)}</strong>`
    : `<div>Le responsable du Comité départemental</div><div class="vide"></div><div>&nbsp;</div>`}
</div></div>

${photos.length || videos.length ? `<section class="annexe"><h2>Annexe — photos${videos.length ? " et vidéos" : ""}</h2>
<div class="photos">${photos.map((p, i) => {
    const s = site(p.site_id);
    return `<figure>${p.src ? `<img src="${p.src}" alt="">` : ""}<figcaption><strong>Photo ${i + 1}</strong>${p.legende ? ` — ${esc(p.legende)}` : ""}<br><small>${[s ? `${s.code} ${s.localite}` : "", p.date_prise ? frDate(p.date_prise) : ""].filter(Boolean).map(esc).join(" · ")}</small></figcaption></figure>`;
  }).join("")}</div>
${videos.length ? `<table style="margin-top:5mm"><thead><tr><th>Vidéo</th><th>Légende</th><th>Site</th><th>Durée</th></tr></thead><tbody>${videos.map((v) => {
    const s = site(v.site_id);
    return `<tr><td>${esc(v.nom_fichier)}</td><td>${esc(v.legende)}</td><td>${s ? esc(s.code + " " + s.localite) : ""}</td><td>${duree(v.duree_s)}</td></tr>`;
  }).join("")}</tbody></table>` : ""}
</section>` : ""}
<footer>CRLOI Gôh — édité le ${new Date().toLocaleDateString("fr-FR")} — diffusion restreinte</footer>
<script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script>
</body></html>`);
  w.document.close();
}
