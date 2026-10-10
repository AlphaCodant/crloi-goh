/* =====================================================================
   Utilitaires d'interface (repris de GestReb, namespace GR)
   ===================================================================== */
import ApexCharts from "apexcharts";
import { api } from "../api";

const GR = {};
window.ApexCharts = ApexCharts;

/** Appel d'API avec notification d'erreur (comme GR.api dans GestReb). */
GR.api = async function (path, { silencieux = false, ...opts } = {}) {
  try {
    return await api(path, opts);
  } catch (e) {
    if (!silencieux) GR.toast(e.message, "error");
    throw e;
  }
};

/* ---------------------------- Formatage ---------------------------- */
const nf = (d = 0) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
GR.fmt = {
  n: (v, d = 0) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? '—' : nf(d).format(Number(v))),
  ha: (v, d = 2) => (v === null || v === undefined || v === '' ? '—' : `${nf(d).format(Number(v) || 0)} ha`),
  pct: (v, d = 1) => (v === null || v === undefined ? '—' : `${nf(d).format(Number(v) || 0)} %`),
  xof: (v) => (v === null || v === undefined ? '—' : `${nf(0).format(Math.round(Number(v) || 0))} FCFA`),
  compact: (v) => {
    const n = Number(v) || 0;
    if (Math.abs(n) >= 1e9) return `${nf(1).format(n / 1e9)} Md`;
    if (Math.abs(n) >= 1e6) return `${nf(1).format(n / 1e6)} M`;
    if (Math.abs(n) >= 1e3) return `${nf(1).format(n / 1e3)} k`;
    return nf(0).format(n);
  },
  date: (v) => {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR');
  },
  datetime: (v) => {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime())
      ? String(v)
      : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
  ago: (v) => {
    if (!v) return 'jamais';
    const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
    if (s < 60) return "à l'instant";
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    if (s < 86400 * 30) return `il y a ${Math.floor(s / 86400)} j`;
    return GR.fmt.date(v);
  },
  duree: (secondes) => {
    const s = Math.max(0, Number(secondes) || 0);
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min`;
    return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  },
};

/** Échappement HTML (toutes les données injectées dans innerHTML doivent passer par ici). */
GR.esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

GR.debounce = (fn, ms = 250) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

GR.$ = (sel, root = document) => root.querySelector(sel);
GR.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------------------------- Toasts ------------------------------ */
GR.toast = function toast(message, type = 'success', duree = 4200) {
  let zone = document.querySelector('.toasts');
  if (!zone) {
    zone = document.createElement('div');
    zone.className = 'toasts';
    zone.setAttribute('role', 'status');
    zone.setAttribute('aria-live', 'polite');
    document.body.appendChild(zone);
  }
  const icones = { success: 'check_circle', error: 'error', warning: 'warning', info: 'info' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="mi">${icones[type] || 'info'}</span><div>${GR.esc(message)}</div>`;
  zone.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, duree);
};

/* ---------------------------- Modales ----------------------------- */
GR.modal = {
  open(id) {
    const m = typeof id === 'string' ? document.getElementById(id) : id;
    if (!m) return;
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => m.querySelector('[autofocus], input, select, textarea, button.btn-primary')?.focus(), 50);
  },
  close(id) {
    const m = typeof id === 'string' ? document.getElementById(id) : id;
    if (!m) return;
    m.classList.remove('open');
    if (!document.querySelector('.modal.open')) document.body.style.overflow = '';
  },
};
document.addEventListener('click', (e) => {
  const fermer = e.target.closest('[data-close-modal]');
  if (fermer) GR.modal.close(fermer.closest('.modal'));
  if (e.target.classList?.contains('modal') && !e.target.hasAttribute('data-static')) GR.modal.close(e.target);
  const ouvrir = e.target.closest('[data-open-modal]');
  if (ouvrir) GR.modal.open(ouvrir.dataset.openModal);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const ouverts = document.querySelectorAll('.modal.open');
    if (ouverts.length) GR.modal.close(ouverts[ouverts.length - 1]);
    document.querySelectorAll('.dropdown.open, .ms.open').forEach((d) => d.classList.remove('open'));
  }
});

/** Boîte de confirmation (remplace window.confirm). */
GR.confirm = function confirmer({ titre = 'Confirmation', message = '', ok = 'Confirmer', danger = false, saisie = null } = {}) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal open';
    m.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true">
        <div class="modal-head"><h2>${GR.esc(titre)}</h2></div>
        <div class="modal-body"><p>${message}</p>${
          saisie
            ? `<div class="field mt-4"><label>${GR.esc(saisie.label)}</label>${
                saisie.multiligne
                  ? `<textarea class="input" data-saisie placeholder="${GR.esc(saisie.placeholder || '')}"></textarea>`
                  : `<input class="input" data-saisie type="${saisie.type || 'text'}" placeholder="${GR.esc(saisie.placeholder || '')}">`
              }</div>`
            : ''
        }</div>
        <div class="modal-foot">
          <button class="btn" data-r="0">Annuler</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${GR.esc(ok)}</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const champ = m.querySelector('[data-saisie]');
    (champ || m.querySelector('[data-r="1"]')).focus();
    const fin = (val) => {
      m.remove();
      resolve(val);
    };
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b) fin(b.dataset.r === '1' ? (champ ? champ.value : true) : saisie ? null : false);
      else if (e.target === m) fin(saisie ? null : false);
    });
    m.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') fin(saisie ? null : false);
      if (e.key === 'Enter' && !(champ && champ.tagName === 'TEXTAREA')) fin(champ ? champ.value : true);
    });
  });
};

/* ------------------------ Navigation latérale ---------------------- */
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-toggle-nav]')) document.body.classList.toggle('nav-open');
  if (e.target.classList?.contains('sidebar-backdrop')) document.body.classList.remove('nav-open');

  const dd = e.target.closest('[data-dropdown]');
  document.querySelectorAll('.dropdown.open').forEach((d) => {
    if (!dd || d !== document.getElementById(dd.dataset.dropdown)) d.classList.remove('open');
  });
  if (dd) {
    const menu = document.getElementById(dd.dataset.dropdown);
    if (!menu) return;
    menu.classList.toggle('open');
    // Dans un conteneur défilant (tableau), le menu est positionné par rapport à la fenêtre
    if (menu.classList.contains('open') && dd.closest('.table-wrap')) {
      const r = dd.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.right = `${window.innerWidth - r.right}px`;
      const bas = r.bottom + 6 + menu.offsetHeight > window.innerHeight;
      menu.style.top = bas ? `${Math.max(8, r.top - menu.offsetHeight - 6)}px` : `${r.bottom + 6}px`;
    }
  }
});

document.addEventListener(
  'scroll',
  (e) => {
    if (e.target.closest?.('.dropdown')) return;
    document.querySelectorAll('.dropdown.open').forEach((d) => d.style.position === 'fixed' && d.classList.remove('open'));
  },
  true
);

/* ---------------------- Multi-sélection ---------------------------- */
/**
 * new GR.MultiSelect(element, { options:[{value,label,n,color}], placeholder, onChange, selected:[] })
 */
class MultiSelect {
  constructor(el, { options = [], placeholder = 'Tous', onChange = () => {}, selected = [], recherche = true } = {}) {
    this.el = typeof el === 'string' ? document.querySelector(el) : el;
    this.placeholder = placeholder;
    this.onChange = onChange;
    this.recherche = recherche;
    this.el.classList.add('ms');
    this.el.innerHTML = `
      <button type="button" class="ms-btn" aria-haspopup="listbox"><span class="ms-label placeholder"></span><span class="count hidden"></span><span class="mi mi-sm">expand_more</span></button>
      <div class="ms-panel">
        ${recherche ? '<div class="ms-search"><input class="input sm" type="search" placeholder="Rechercher…"></div>' : ''}
        <div class="ms-list" role="listbox"></div>
        <div class="ms-actions"><button type="button" class="btn btn-ghost btn-sm" data-all>Tout</button><button type="button" class="btn btn-ghost btn-sm" data-none>Aucun</button></div>
      </div>`;
    this.btn = this.el.querySelector('.ms-btn');
    this.list = this.el.querySelector('.ms-list');
    this.selected = new Set(selected.map(String));
    this.setOptions(options);
    this.btn.addEventListener('click', () => {
      document.querySelectorAll('.ms.open').forEach((m) => m !== this.el && m.classList.remove('open'));
      this.el.classList.toggle('open');
      if (this.el.classList.contains('open')) this.el.querySelector('.ms-search input')?.focus();
    });
    document.addEventListener('click', (e) => {
      if (!this.el.contains(e.target)) this.el.classList.remove('open');
    });
    this.el.querySelector('.ms-search input')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      this.list.querySelectorAll('.ms-item').forEach((it) => {
        it.style.display = it.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
    this.list.addEventListener('change', (e) => {
      if (e.target.checked) this.selected.add(e.target.value);
      else this.selected.delete(e.target.value);
      this.render();
      this.onChange(this.values());
    });
    this.el.querySelector('[data-all]').addEventListener('click', () => {
      this.options.forEach((o) => this.selected.add(String(o.value)));
      this.sync();
    });
    this.el.querySelector('[data-none]').addEventListener('click', () => {
      this.selected.clear();
      this.sync();
    });
  }
  setOptions(options) {
    this.options = options;
    const valides = new Set(options.map((o) => String(o.value)));
    this.selected = new Set([...this.selected].filter((v) => valides.has(v)));
    this.list.innerHTML = options.length
      ? options
          .map(
            (o) => `<label class="ms-item"><input type="checkbox" value="${GR.esc(o.value)}" ${
              this.selected.has(String(o.value)) ? 'checked' : ''
            }>${o.color ? `<i style="width:10px;height:10px;border-radius:3px;background:${GR.esc(o.color)}"></i>` : ''}<span>${GR.esc(
              o.label ?? o.value
            )}</span>${o.n !== undefined ? `<span class="ms-n">${GR.esc(o.n)}</span>` : ''}</label>`
          )
          .join('')
      : '<div class="muted" style="padding:8px">Aucune valeur</div>';
    this.render();
  }
  sync() {
    this.list.querySelectorAll('input').forEach((i) => (i.checked = this.selected.has(i.value)));
    this.render();
    this.onChange(this.values());
  }
  set(values) {
    this.selected = new Set((values || []).map(String));
    this.list.querySelectorAll('input').forEach((i) => (i.checked = this.selected.has(i.value)));
    this.render();
  }
  values() {
    return [...this.selected];
  }
  render() {
    const label = this.el.querySelector('.ms-label');
    const count = this.el.querySelector('.count');
    const n = this.selected.size;
    if (!n || n === this.options.length) {
      label.textContent = n && this.options.length ? 'Tous' : this.placeholder;
      label.classList.toggle('placeholder', !n);
      count.classList.add('hidden');
    } else {
      const libelles = this.options.filter((o) => this.selected.has(String(o.value))).map((o) => o.label ?? o.value);
      label.textContent = libelles.join(', ');
      label.classList.remove('placeholder');
      count.textContent = n;
      count.classList.remove('hidden');
    }
  }
}
GR.MultiSelect = MultiSelect;

/* ---------------------- Tableau triable ---------------------------- */
/**
 * GR.table(container, { colonnes:[{cle, titre, num, rendu, tri}], lignes, onClick, selection, vide })
 * Renvoie un objet { maj(lignes), lignes() } ; tri par clic sur l'en-tête.
 */
GR.table = function table(conteneur, opts) {
  const el = typeof conteneur === 'string' ? document.querySelector(conteneur) : conteneur;
  let lignes = opts.lignes || [];
  let tri = opts.tri || null;
  let sens = opts.sens || 1;
  const valeur = (l, c) => (c.tri ? c.tri(l) : l[c.cle]);

  function trier(arr) {
    if (!tri) return arr;
    const col = opts.colonnes.find((c) => c.cle === tri);
    if (!col) return arr;
    return [...arr].sort((a, b) => {
      const va = valeur(a, col);
      const vb = valeur(b, col);
      if (va === vb) return 0;
      if (va === null || va === undefined || va === '') return 1;
      if (vb === null || vb === undefined || vb === '') return -1;
      const na = Number(va);
      const nb = Number(vb);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * sens;
      return String(va).localeCompare(String(vb), 'fr', { numeric: true }) * sens;
    });
  }

  function rendre() {
    const tries = trier(lignes);
    const head = opts.colonnes
      .map(
        (c) =>
          `<th class="${c.num ? 'num ' : ''}${c.trier === false ? '' : 'sortable '}${tri === c.cle ? 'sorted' : ''}" data-cle="${
            c.cle
          }" style="${c.largeur ? `width:${c.largeur}` : ''}">${GR.esc(c.titre)}${
            c.trier === false ? '' : `<span class="mi sort-ind">${tri === c.cle ? (sens > 0 ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span>`
          }</th>`
      )
      .join('');
    const body = tries.length
      ? tries
          .map(
            (l, i) =>
              `<tr class="${opts.onClick ? 'clickable' : ''} ${opts.estSelectionnee?.(l) ? 'selected' : ''}" data-i="${lignes.indexOf(l)}">${opts.colonnes
                .map((c) => `<td class="${c.num ? 'num' : ''} ${c.classe || ''}">${c.rendu ? c.rendu(l, i) : GR.esc(l[c.cle] ?? '—')}</td>`)
                .join('')}</tr>`
          )
          .join('')
      : `<tr><td colspan="${opts.colonnes.length}"><div class="empty"><span class="mi">${opts.videIcone || 'inbox'}</span><h3>${
          opts.vide || 'Aucune donnée'
        }</h3></div></td></tr>`;
    const foot = opts.pied ? `<tfoot><tr>${opts.pied(tries)}</tr></tfoot>` : '';
    el.innerHTML = `<table class="table ${opts.compact ? 'compact' : ''}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
  }

  el.addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (th) {
      const cle = th.dataset.cle;
      sens = tri === cle ? -sens : 1;
      tri = cle;
      rendre();
      return;
    }
    const tr = e.target.closest('tbody tr[data-i]');
    if (tr && opts.onClick && !e.target.closest('button, a, input, select')) opts.onClick(lignes[Number(tr.dataset.i)], tr, e);
  });

  rendre();
  return {
    maj(nouvelles) {
      lignes = nouvelles || [];
      rendre();
    },
    rendre,
    lignes: () => trier(lignes),
  };
};

/* ---------------------------- Exports ----------------------------- */
GR.telecharger = function telecharger(nom, contenu, type = 'text/plain') {
  const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
};

/** Export CSV (séparateur « ; » et BOM pour Excel français). colonnes = [{cle, titre, valeur?}] */
GR.exportCsv = function exportCsv(nom, lignes, colonnes) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cols = colonnes || Object.keys(lignes[0] || {}).map((k) => ({ cle: k, titre: k }));
  const contenu = [
    cols.map((c) => esc(c.titre)).join(';'),
    ...lignes.map((l) => cols.map((c) => esc(c.valeur ? c.valeur(l) : l[c.cle])).join(';')),
  ].join('\r\n');
  GR.telecharger(nom, `﻿${contenu}`, 'text/csv;charset=utf-8');
};

/** Export Excel via SheetJS (chargé à la demande). */
GR.exportXlsx = async function exportXlsx(nom, feuilles) {
  if (!window.XLSX) {
    await new Promise((ok, ko) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = ok;
      s.onerror = () => ko(new Error('Impossible de charger la bibliothèque Excel'));
      document.head.appendChild(s);
    });
  }
  const wb = window.XLSX.utils.book_new();
  (Array.isArray(feuilles) ? feuilles : [feuilles]).forEach((f) => {
    const data = f.lignes.map((l) => {
      const o = {};
      (f.colonnes || Object.keys(l).map((k) => ({ cle: k, titre: k }))).forEach((c) => {
        o[c.titre] = c.valeur ? c.valeur(l) : l[c.cle];
      });
      return o;
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(data), (f.nom || 'Données').slice(0, 31));
  });
  window.XLSX.writeFile(wb, nom);
};

/* ------------------------- Graphiques ------------------------------ */
GR.palette = ['#15803d', '#2563eb', '#d97706', '#9333ea', '#0891b2', '#dc2626', '#65a30d', '#db2777', '#0f766e', '#7c2d12', '#4338ca', '#a16207'];

/** Options ApexCharts par défaut (français, police, couleurs). */
GR.chartDefaults = function chartDefaults() {
  window.Apex = {
    chart: {
      fontFamily: "'Century Gothic', 'Jost Variable', system-ui, sans-serif",
      foreColor: '#475569',
      toolbar: {
        show: true,
        tools: { download: true, selection: false, zoom: false, zoomin: false, zoomout: false, pan: false, reset: false },
        export: { csv: { headerCategory: 'Catégorie', dateFormatter: (t) => new Date(t).toLocaleDateString('fr-FR') } },
      },
      locales: [
        {
          name: 'fr',
          options: {
            months: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
            shortMonths: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
            days: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
            shortDays: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
            toolbar: { exportToSVG: 'Télécharger SVG', exportToPNG: 'Télécharger PNG', exportToCSV: 'Télécharger CSV', menu: 'Menu' },
          },
        },
      ],
      defaultLocale: 'fr',
      animations: { speed: 400 },
    },
    colors: GR.palette,
    dataLabels: { enabled: false },
    grid: { borderColor: '#e2e8f0', strokeDashArray: 3 },
    legend: { fontSize: '12px', markers: { radius: 3 } },
    tooltip: { theme: 'light' },
    yaxis: { labels: { formatter: (v) => (typeof v === 'number' ? GR.fmt.n(v, v % 1 ? 1 : 0) : v) } },
    noData: { text: 'Aucune donnée pour cette sélection' },
  };
};
GR.chartDefaults();

/** Crée ou remplace un graphique dans un conteneur. */
GR.charts = {};
GR.chart = function chart(id, options) {
  if (GR.charts[id]) {
    GR.charts[id].destroy();
    delete GR.charts[id];
  }
  const el = document.getElementById(id);
  if (!el || !window.ApexCharts) return null;
  el.innerHTML = '';
  const c = new window.ApexCharts(el, options);
  c.render();
  GR.charts[id] = c;
  return c;
};


export default GR;
