/* Petite fenêtre de formulaire (style GestReb) utilisée par les outils d'édition de la carte.
   formulaire({ titre, icone, intro, champs: [{ nom, libelle, type, options, valeur, requis, aide, pleine, min, max, step }], ok, danger })
   → Promise résolue avec les valeurs, ou null si l'utilisateur annule. */
import GR from "../gr/gr";

const { esc } = GR;

export function formulaire({ titre, icone = "edit", intro = "", champs = [], ok = "Enregistrer", danger = false, large = false, valider }) {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal open";
    m.setAttribute("data-static", "");
    const champ = (c) => {
      const id = `f-${c.nom}`;
      const v = c.valeur ?? "";
      const req = c.requis ? "required" : "";
      let saisie;
      if (c.type === "select")
        saisie = `<select class="select" id="${id}" name="${c.nom}" ${req}>${(c.options || [])
          .map((o) => (typeof o === "string" ? { value: o, label: o } : o))
          .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? "selected" : ""}>${esc(o.label)}</option>`)
          .join("")}</select>`;
      else if (c.type === "textarea") saisie = `<textarea class="input" id="${id}" name="${c.nom}" rows="3" ${req}>${esc(v)}</textarea>`;
      else if (c.type === "checkbox") return `<label class="switch ${c.pleine ? "span-all" : ""}"><input type="checkbox" id="${id}" name="${c.nom}" ${v ? "checked" : ""}>${esc(c.libelle)}</label>`;
      else if (c.type === "info") return `<div class="alert info span-all" style="font-size:12.5px"><span class="mi mi-sm">info</span><span>${c.html || esc(c.libelle)}</span></div>`;
      else
        saisie = `<input class="input" id="${id}" name="${c.nom}" type="${c.type || "text"}" value="${esc(v)}" ${req} ${c.min !== undefined ? `min="${c.min}"` : ""} ${
          c.max !== undefined ? `max="${c.max}"` : ""
        } ${c.step !== undefined ? `step="${c.step}"` : ""} ${c.liste ? `list="${id}-l"` : ""} placeholder="${esc(c.placeholder || "")}">${
          c.liste ? `<datalist id="${id}-l">${c.liste.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>` : ""
        }`;
      return `<div class="field ${c.pleine ? "span-all" : ""}" data-champ="${c.nom}"><label for="${id}">${esc(c.libelle)}${c.aide ? ` <span class="muted" style="font-weight:500">${esc(c.aide)}</span>` : ""}</label>${saisie}</div>`;
    };
    m.innerHTML = `
      <div class="modal-dialog ${large ? "lg" : ""}" role="dialog" aria-modal="true">
        <form novalidate>
          <div class="modal-head"><span class="mi" style="color:var(--primary)">${esc(icone)}</span><h2>${esc(titre)}</h2>
            <div class="actions"><button type="button" class="btn btn-sm btn-ghost btn-icon" data-annuler aria-label="Fermer"><span class="mi">close</span></button></div></div>
          <div class="modal-body stack">
            ${intro ? `<p class="muted" style="font-size:13px">${intro}</p>` : ""}
            <div class="form-grid">${champs.map(champ).join("")}</div>
            <div class="alert error hidden" data-erreur><span class="mi">error</span><span></span></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-annuler>Annuler</button>
            <button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}">${esc(ok)}</button></div>
        </form>
      </div>`;
    document.body.appendChild(m);
    const form = m.querySelector("form");
    setTimeout(() => form.querySelector("input:not([type=checkbox]), select, textarea")?.focus(), 30);
    const fin = (val) => {
      m.remove();
      document.removeEventListener("keydown", echap, true);
      resolve(val);
    };
    const echap = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        fin(null);
      }
    };
    document.addEventListener("keydown", echap, true);
    m.addEventListener("click", (e) => {
      if (e.target.closest("[data-annuler]") || e.target === m) fin(null);
    });
    const erreur = (txt) => {
      const z = m.querySelector("[data-erreur]");
      z.classList.toggle("hidden", !txt);
      z.lastElementChild.textContent = txt || "";
    };
    // Champs dépendants : { visibleSi: { champ: 'x', valeurs: [...] } }
    const majVisibilite = () => {
      champs.forEach((c) => {
        if (!c.visibleSi) return;
        const ref = form.elements[c.visibleSi.champ];
        const v = ref?.type === "checkbox" ? ref.checked : ref?.value;
        m.querySelector(`[data-champ="${c.nom}"]`)?.classList.toggle("hidden", !c.visibleSi.valeurs.includes(v));
      });
    };
    form.addEventListener("change", majVisibilite);
    majVisibilite();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const vals = {};
      for (const c of champs) {
        if (c.type === "info") continue;
        const el = form.elements[c.nom];
        if (!el) continue;
        const cache = m.querySelector(`[data-champ="${c.nom}"]`)?.classList.contains("hidden");
        let v = c.type === "checkbox" ? el.checked : el.value.trim();
        if (c.type === "number") v = v === "" ? null : Number(String(v).replace(",", "."));
        if (c.requis && !cache && (v === "" || v === null)) {
          erreur(`Le champ « ${c.libelle} » est obligatoire.`);
          el.focus();
          return;
        }
        vals[c.nom] = v;
      }
      if (valider) {
        const btn = form.querySelector("[type=submit]");
        btn.disabled = true;
        try {
          const msg = await valider(vals);
          if (msg) {
            erreur(msg);
            return;
          }
        } catch (x) {
          erreur(x.message || "Erreur");
          return;
        } finally {
          btn.disabled = false;
        }
      }
      fin(vals);
    });
  });
}
