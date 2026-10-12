import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import "@fontsource-variable/jost";
import "./gr/app.css";
import "./gr/carte.css";
import "./gr/stats.css";
import "./gr/crloi.css";
import "./gr/theme.css";
import "./gr/gr";
import { MODULES } from "./modules";
import { AuthProvider, ViewProvider, useAuth } from "./context";
import MapPage from "./pages/MapPage";
import Dashboard from "./pages/Dashboard";
import Sites from "./pages/Sites";
import BrqPage from "./pages/BrqPage";
import Hebdo from "./pages/Hebdo";
import Fiches from "./pages/Fiches";
import Equipe from "./pages/Equipe";
import Missions from "./pages/Missions";
import QualiteEau from "./pages/QualiteEau";

const PAGES = {
  "/tableau-de-bord": ["Tableau de bord", "Évolution des indicateurs à partir des BRQ et des statuts datés des sites"],
  "/sites": ["Registre des sites", "Sites d'orpaillage recensés dans le Gôh, localisation et historique des constats"],
  "/brq": ["Bulletins de renseignement quotidiens", "Saisie des visites de sites, constats, saisies et interpellations"],
  "/hebdo": ["Rapports hebdomadaires", "Synthèse de la semaine calculée à partir des BRQ"],
  "/renseignement": ["Fiches de renseignement", "Informations reçues, cotation et suivi de vérification"],
  "/qualite-eau": ["Qualité de l'eau", "Relevés hebdomadaires par cours d'eau : turbidité, mercure, cyanure et autres paramètres"],
  "/missions": ["Missions d'éclairage", "Vérification sur le terrain des zones suspectes détectées par satellite ou signalées"],
  "/equipe": ["Équipe de la cellule", "Comptes autorisés à se connecter"],
};

export const initiales = (nom) =>
  (nom || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0].toUpperCase())
    .join("");

function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await login(email, password);
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-visuel">
        <div className="row" style={{ gap: 12 }}>
          <img src="/img/crloi.svg" alt="" width="44" height="44" />
          <div>
            <strong style={{ fontSize: 15 }}>CRLOI Gôh</strong>
            <div style={{ fontSize: 12 }}>Comité régional de lutte contre l'orpaillage illégal</div>
          </div>
        </div>
        <div className="stack" style={{ gap: 14 }}>
          <h1>Cellule renseignement</h1>
          <p>Carte de situation des sites d'orpaillage, suivi des BRQ et des rapports hebdomadaires, fiches de renseignement cotées.</p>
        </div>
        <div className="chiffres">
          <div><strong>2</strong><span>départements</span></div>
          <div><strong>19</strong><span>forêts classées</span></div>
          <div><strong>≥ 70 %</strong><span>cible de neutralisation</span></div>
        </div>
      </section>
      <section className="login-form">
        <form className="stack" onSubmit={submit}>
          <div>
            <h2 style={{ fontSize: 22 }}>Connexion</h2>
            <p className="muted mt-1">Accès réservé aux membres de la cellule. Diffusion restreinte.</p>
          </div>
          <div className="field">
            <label htmlFor="email">Adresse e-mail</label>
            <input className="input" id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input className="input" id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {err && (
            <div className="alert error">
              <span className="mi">error</span>
              <span>{err}</span>
            </div>
          )}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy} type="submit">
            <span className="mi">login</span>
            {busy ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </section>
    </div>
  );
}

function Sidebar() {
  const { user, logout } = useAuth();
  const lien = (to, icone, label) => (
    <NavLink to={to} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
      <span className="mi">{icone}</span>
      {label}
    </NavLink>
  );
  return (
    <aside className="app-sidebar" id="app-sidebar" aria-label="Navigation principale">
      <NavLink className="app-brand" to="/carte">
        <img src="/img/crloi.svg" alt="" />
        <span>
          <strong>CRLOI Gôh</strong>
          <small>Cellule renseignement</small>
        </span>
      </NavLink>
      <nav className="app-nav">
        <span className="nav-title">Situation</span>
        {lien("/carte", "map", "Carte de situation")}
        {lien("/tableau-de-bord", "insights", "Tableau de bord")}
        <span className="nav-title">Renseignement</span>
        {MODULES.brq && lien("/brq", "today", "BRQ")}
        {MODULES.hebdo && lien("/hebdo", "date_range", "Rapports hebdomadaires")}
        {lien("/renseignement", "policy", "Fiches de renseignement")}
        {lien("/sites", "location_on", "Registre des sites")}
        {lien("/qualite-eau", "water_drop", "Qualité de l'eau")}
        <span className="nav-title">Prospection</span>
        <Link to="/carte?onglet=prospection" className="nav-link">
          <span className="mi">radar</span>Zones suspectes (GEE)
        </Link>
        {lien("/missions", "assignment", "Missions d'éclairage")}
        {user.role === "chef" && (
          <>
            <span className="nav-title">Administration</span>
            {lien("/equipe", "admin_panel_settings", "Équipe")}
          </>
        )}
        <span className="nav-title">Compte</span>
        <a className="nav-link" href="#" onClick={(e) => (e.preventDefault(), logout())}>
          <span className="mi">logout</span>Se déconnecter
        </a>
      </nav>
      <div className="app-sidebar-footer">CRLOI Gôh · Diffusion restreinte</div>
    </aside>
  );
}

function Header() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [titre, sous] = PAGES[pathname] || ["CRLOI Gôh", ""];
  useEffect(() => {
    document.title = `${titre} · CRLOI Gôh`;
  }, [titre]);
  return (
    <header className="app-header">
      <button className="btn btn-ghost btn-icon menu-toggle" data-toggle-nav aria-label="Ouvrir le menu">
        <span className="mi">menu</span>
      </button>
      <div className="page-heading">
        <h1>{titre}</h1>
        {sous && <p>{sous}</p>}
      </div>
      <div className="header-actions">
        <div className="user-menu">
          <button className="user-chip" data-dropdown="menu-utilisateur" aria-haspopup="true">
            <span className="avatar">{initiales(user.full_name)}</span>
            <span className="who">
              <strong>{user.full_name}</strong>
              <small>{user.role_label}</small>
            </span>
            <span className="mi mi-sm muted">expand_more</span>
          </button>
          <div className="dropdown" id="menu-utilisateur">
            <div className="dd-header row">
              <span className="avatar lg">{initiales(user.full_name)}</span>
              <div>
                <strong style={{ color: "var(--text-strong)" }}>{user.full_name}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{user.email}</div>
                <div className="row mt-1"><span className="badge green">{user.role_label}</span></div>
              </div>
            </div>
            <hr />
            <NavLink to="/carte"><span className="mi">map</span>Carte de situation</NavLink>
            <NavLink to="/tableau-de-bord"><span className="mi">insights</span>Tableau de bord</NavLink>
            <hr />
            <a href="#" style={{ color: "var(--danger)" }} onClick={(e) => (e.preventDefault(), logout())}>
              <span className="mi">logout</span>Se déconnecter
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}

function Shell() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => {
    document.body.classList.remove("nav-open");
    document.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"));
  }, [pathname]);

  if (pathname === "/carte") {
    return (
      <>
        <Sidebar />
        <div className="sidebar-backdrop" />
        <MapPage />
      </>
    );
  }
  return (
    <>
      <div className="app">
        <Sidebar />
        <Header />
        <main className="app-main" id="contenu">
          <Routes>
            <Route path="/tableau-de-bord" element={<Dashboard />} />
            <Route path="/sites" element={<Sites />} />
            {MODULES.brq && <Route path="/brq" element={<BrqPage />} />}
            {MODULES.hebdo && <Route path="/hebdo" element={<Hebdo />} />}
            <Route path="/renseignement" element={<Fiches />} />
            <Route path="/missions" element={<Missions />} />
            <Route path="/qualite-eau" element={<QualiteEau />} />
            {user.role === "chef" && <Route path="/equipe" element={<Equipe />} />}
            <Route path="*" element={<Navigate to="/carte" replace />} />
          </Routes>
        </main>
      </div>
      <div className="sidebar-backdrop" />
    </>
  );
}

function App() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return user ? (
    <ViewProvider>
      <Shell />
    </ViewProvider>
  ) : (
    <Login />
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
);
