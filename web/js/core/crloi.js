/* =====================================================================
   CRLOI GÔH — référentiels, session, coque applicative, dates partagées
   (complète GR, repris de GestReb)
   ===================================================================== */
(function () {
  'use strict';
  const GR = window.GR;
  const { esc } = GR;
  const CR = (window.CR = window.CR || {});

  /* --------------------------- Référentiels -------------------------- */
  CR.STATUTS = [
    { cle: 'actif', libelle: 'Actif', couleur: '#dc2626', actif: true },
    { cle: 'recolonise', libelle: 'Recolonisé', couleur: '#9333ea', actif: true },
    { cle: 'tentative_reprise', libelle: 'Tentative de reprise', couleur: '#f97316' },
    { cle: 'demantele', libelle: 'Démantelé', couleur: '#2563eb' },
    { cle: 'tenu', libelle: 'Tenu (non recolonisé)', couleur: '#15803d' },
  ];
  CR.statut = (k) => CR.STATUTS.find((s) => s.cle === k) || { cle: k || '', libelle: k ? k : 'Non renseigné', couleur: '#94a3b8' };
  CR.SAISIES = {
    motopompes: 'Motopompes', tapis: 'Tapis de lavage', tuyaux_m: 'Tuyaux (m)', motos: 'Motos', tricycles: 'Tricycles',
    velos: 'Vélos', treuils: 'Treuils', detecteurs: 'Détecteurs', groupes: 'Groupes électrogènes',
    engins_lourds: 'Engins lourds', sacs_minerai: 'Sacs de minerai',
  };
  CR.SOURCES = { rapport: 'Rapport', brq: 'BRQ', fiche: 'Fiche de renseignement', satellite: 'Image satellite', drone: 'Drone', saisie: 'Saisie manuelle' };
  CR.DEPARTEMENTS = ['Gagnoa', 'Oumé'];
  CR.ROLES = { chef: 'Chef de cellule', analyste: 'Analyste', cartographe: 'Cartographe' };
  CR.saisiesTexte = (s) =>
    Object.entries(s || {})
      .filter(([, n]) => n)
      .map(([k, n]) => `${GR.fmt.n(n)} ${(CR.SAISIES[k] || k).toLowerCase()}`)
      .join(', ');
  CR.badgeStatut = (k) => {
    const s = CR.statut(k);
    return `<span class="badge" style="background:${GR.esc(s.couleur)}1f;color:${GR.esc(s.couleur)};border-color:${GR.esc(s.couleur)}55"><i class="dot" style="background:${GR.esc(s.couleur)}"></i>${esc(s.libelle)}</span>`;
  };

  /* ----------------------------- Dates ------------------------------- */
  CR.aujourdhui = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  CR.ajouterJours = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  CR.ecartJours = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
  CR.date = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
  CR.lundi = (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return CR.ajouterJours(iso, -((d.getUTCDay() + 6) % 7));
  };
  /** Statut d'un site à une date (dernier constat daté antérieur ou égal). */
  CR.statutA = (evenements, iso) => {
    let s = null;
    (evenements || []).forEach((e) => {
      if (e.date <= iso) s = e.statut;
    });
    return s;
  };
  CR.dernierEvenement = (evenements, iso) => [...(evenements || [])].filter((e) => e.date <= iso).pop() || null;

  /** Date d'analyse partagée entre la carte et le tableau de bord. */
  CR.dateVue = {
    get() {
      try {
        return localStorage.getItem('crloi.date') || CR.aujourdhui();
      } catch {
        return CR.aujourdhui();
      }
    },
    set(v) {
      try {
        localStorage.setItem('crloi.date', v);
      } catch {
        /* indisponible */
      }
    },
  };

  /* -------------------------- Coordonnées ---------------------------- */
  if (window.proj4) {
    proj4.defs('EPSG:32629', '+proj=utm +zone=29 +datum=WGS84 +units=m +no_defs +type=crs');
    proj4.defs('EPSG:32630', '+proj=utm +zone=30 +datum=WGS84 +units=m +no_defs +type=crs');
  }
  CR.utm = (lng, lat) => {
    if (!window.proj4) return null;
    const zone = lng < -6 ? 29 : 30;
    const [x, y] = proj4('EPSG:4326', `EPSG:326${zone}`, [lng, lat]);
    return { zone, x, y };
  };

  /* ----------------------------- Session ----------------------------- */
  CR.utilisateur = null;
  CR.session = async function session() {
    if (!GR.jeton.get()) {
      GR.versConnexion();
      throw new Error('Non connecté');
    }
    if (!CR.utilisateur) CR.utilisateur = await GR.api('/auth/me');
    return CR.utilisateur;
  };
  CR.deconnexion = () => {
    GR.jeton.set(null);
    location.href = '/connexion.html';
  };
  const initiales = (n) =>
    String(n || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((m) => m[0].toUpperCase())
      .join('');

  /* ------------------------ Coque applicative ------------------------ */
  const NAV = [
    { titre: 'Consultation' },
    { href: '/carte.html', icone: 'map', libelle: 'Carte interactive' },
    { href: '/tableau-de-bord.html', icone: 'insights', libelle: 'Tableau de bord' },
    { titre: 'Renseignement' },
    { href: '/renseignement.html', icone: 'contact_page', libelle: 'Fiches de renseignement' },
    { href: '/brq.html', icone: 'event_note', libelle: 'BRQ quotidiens' },
    { href: '/hebdo.html', icone: 'summarize', libelle: 'Rapports hebdomadaires' },
    { href: '/sites.html', icone: 'pin_drop', libelle: 'Registre des sites' },
    { titre: 'Administration', chef: true },
    { href: '/equipe.html', icone: 'groups', libelle: 'Équipe de la cellule', chef: true },
  ];

  const nomAffiche = (u) => (u.grade && !String(u.full_name).toLowerCase().startsWith(String(u.grade).toLowerCase()) ? `${u.grade} ${u.full_name}` : u.full_name);
  CR.nomAffiche = nomAffiche;
  CR.menuUtilisateur = (u) => `
    <div class="user-menu">
      <button class="user-chip" data-dropdown="menu-utilisateur" aria-haspopup="true">
        <span class="avatar">${esc(initiales(u.full_name))}</span>
        <span class="who"><strong>${esc(nomAffiche(u))}</strong><small>${esc(CR.ROLES[u.role] || u.role)}</small></span>
        <span class="mi mi-sm muted">expand_more</span>
      </button>
      <div class="dropdown" id="menu-utilisateur">
        <div class="dd-header row">
          <span class="avatar lg">${esc(initiales(u.full_name))}</span>
          <div><strong style="color:var(--text-strong)">${esc(u.full_name)}</strong><div class="muted" style="font-size:12px">${esc(u.email)}</div>
          <div class="row mt-1"><span class="badge green">${esc(CR.ROLES[u.role] || u.role)}</span></div></div>
        </div>
        <hr>
        <a href="/carte.html"><span class="mi">map</span>Carte interactive</a>
        <a href="/tableau-de-bord.html"><span class="mi">insights</span>Tableau de bord</a>
        <button class="dd-item" data-mot-de-passe><span class="mi">key</span>Changer mon mot de passe</button>
        <hr>
        <button class="dd-item" data-deconnexion style="color:var(--danger)"><span class="mi">logout</span>Se déconnecter</button>
      </div>
    </div>`;

  CR.sidebar = (u) => {
    const chemin = location.pathname;
    const liens = NAV.filter((n) => !n.chef || u.role === 'chef')
      .map((n) =>
        n.titre
          ? `<span class="nav-title">${esc(n.titre)}</span>`
          : `<a class="nav-link ${chemin === n.href ? 'active' : ''}" href="${n.href}"><span class="mi">${n.icone}</span>${esc(n.libelle)}</a>`
      )
      .join('');
    return `<aside class="app-sidebar" id="app-sidebar" aria-label="Navigation principale">
      <a class="app-brand" href="/carte.html"><img src="/img/logo.svg" alt=""><span><strong>CRLOI Gôh</strong><small>Cellule renseignement</small></span></a>
      <nav class="app-nav">${liens}
        <span class="nav-title">Compte</span>
        <a class="nav-link" href="#" data-deconnexion><span class="mi">logout</span>Se déconnecter</a>
      </nav>
      <div class="app-sidebar-footer">Comité Régional de Lutte contre l'Orpaillage Illégal — Gôh</div>
    </aside><div class="sidebar-backdrop"></div>`;
  };

  /**
   * Monte la coque (menu latéral + en-tête) autour de <main class="app-main">.
   * CR.coque({ titre, sousTitre }) → Promise<utilisateur>
   */
  CR.coque = async function coque({ titre, sousTitre = '' } = {}) {
    const u = await CR.session();
    const main = document.querySelector('main.app-main');
    const app = document.createElement('div');
    app.className = 'app';
    app.innerHTML = `${CR.sidebar(u)}
      <header class="app-header">
        <button class="btn btn-ghost btn-icon menu-toggle" data-toggle-nav aria-label="Ouvrir le menu"><span class="mi">menu</span></button>
        <div class="page-heading"><h1>${esc(titre)}</h1>${sousTitre ? `<p>${esc(sousTitre)}</p>` : ''}</div>
        <div class="header-actions">${CR.menuUtilisateur(u)}</div>
      </header>`;
    main.parentNode.insertBefore(app, main);
    app.appendChild(main);
    document.title = `${titre} · CRLOI Gôh`;
    return u;
  };

  /* Actions communes : déconnexion, changement de mot de passe */
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-deconnexion]')) {
      e.preventDefault();
      CR.deconnexion();
    }
    if (e.target.closest('[data-mot-de-passe]')) {
      document.querySelectorAll('.dropdown.open').forEach((d) => d.classList.remove('open'));
      const ancien = await GR.confirm({ titre: 'Changer mon mot de passe', message: 'Étape 1 sur 2', ok: 'Continuer', saisie: { label: 'Mot de passe actuel', type: 'password' } });
      if (!ancien) return;
      const nouveau = await GR.confirm({ titre: 'Changer mon mot de passe', message: 'Étape 2 sur 2 — 8 caractères minimum', ok: 'Enregistrer', saisie: { label: 'Nouveau mot de passe', type: 'password' } });
      if (!nouveau) return;
      try {
        await GR.api('/auth/password', { method: 'POST', body: { ancien, nouveau } });
        GR.toast('Mot de passe modifié');
      } catch {
        /* message affiché par GR.api */
      }
    }
  });

  /* ------------------------- Petites aides UI ------------------------ */
  CR.champsCoord = (prefixe, v = {}) => `
    <div class="form-grid cols-3">
      <div class="field"><label>Système</label><select class="select" id="${prefixe}-sys">
        <option value="wgs" ${v.sys === 'wgs' || !v.sys ? 'selected' : ''}>WGS84 (degrés décimaux)</option>
        <option value="29" ${v.sys === '29' ? 'selected' : ''}>UTM 29N (ouest : Sérihio…)</option>
        <option value="30" ${v.sys === '30' ? 'selected' : ''}>UTM 30N (est : Oumé, Gagnoa…)</option></select></div>
      <div class="field"><label id="${prefixe}-lx">${v.sys && v.sys !== 'wgs' ? 'X (Est, m)' : 'Longitude'}</label><input class="input num" id="${prefixe}-x" inputmode="decimal" value="${esc(v.x ?? '')}" placeholder="-5.9500"></div>
      <div class="field"><label id="${prefixe}-ly">${v.sys && v.sys !== 'wgs' ? 'Y (Nord, m)' : 'Latitude'}</label><input class="input num" id="${prefixe}-y" inputmode="decimal" value="${esc(v.y ?? '')}" placeholder="6.1300"></div>
    </div>`;
  CR.lireCoord = (prefixe) => {
    const sys = document.getElementById(`${prefixe}-sys`).value;
    const x = document.getElementById(`${prefixe}-x`).value.trim();
    const y = document.getElementById(`${prefixe}-y`).value.trim();
    return x && y ? { sys, x, y } : null;
  };
  document.addEventListener('change', (e) => {
    if (!e.target.id?.endsWith('-sys')) return;
    const p = e.target.id.slice(0, -4);
    const wgs = e.target.value === 'wgs';
    const lx = document.getElementById(`${p}-lx`);
    const ly = document.getElementById(`${p}-ly`);
    if (lx) lx.textContent = wgs ? 'Longitude' : 'X (Est, m)';
    if (ly) ly.textContent = wgs ? 'Latitude' : 'Y (Nord, m)';
    const ix = document.getElementById(`${p}-x`);
    const iy = document.getElementById(`${p}-y`);
    if (ix) ix.placeholder = wgs ? '-5.9500' : '238747';
    if (iy) iy.placeholder = wgs ? '6.1300' : '705256';
  });

  /** Ouvre une modale construite à la volée ; renvoie l'élément. */
  CR.modale = function modale({ id, titre, icone = 'edit_note', corps, pied = '', large = false }) {
    document.getElementById(id)?.remove();
    const m = document.createElement('div');
    m.className = 'modal';
    m.id = id;
    m.innerHTML = `<div class="modal-dialog ${large ? 'lg' : ''}" role="dialog" aria-modal="true" aria-label="${esc(titre)}">
      <div class="modal-head"><span class="mi" style="color:var(--primary)">${icone}</span><h2>${esc(titre)}</h2>
        <div class="actions"><button class="btn btn-sm btn-ghost btn-icon" data-close-modal aria-label="Fermer"><span class="mi">close</span></button></div></div>
      <div class="modal-body">${corps}</div>${pied ? `<div class="modal-foot">${pied}</div>` : ''}</div>`;
    document.body.appendChild(m);
    GR.modal.open(m);
    return m;
  };
})();
