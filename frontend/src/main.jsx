import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import { AuthProvider, ViewProvider, useAuth } from "./context";
import MapPage from "./pages/MapPage";
import Dashboard from "./pages/Dashboard";
import Sites from "./pages/Sites";
import BrqPage from "./pages/BrqPage";
import Hebdo from "./pages/Hebdo";
import Fiches from "./pages/Fiches";
import Equipe from "./pages/Equipe";

function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try { await login(email, password); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div className="login">
      <form className="card grid" onSubmit={submit}>
        <div>
          <div className="muted" style={{ font: "600 11px var(--f-body)", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--accent)" }}>CRLOI Gôh</div>
          <h1 style={{ marginTop: 6 }}>Cellule renseignement</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Accès réservé aux membres de la cellule.</p>
        </div>
        <label className="f">Adresse e-mail<input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="f">Mot de passe<input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" disabled={busy} type="submit">{busy ? "Connexion…" : "Se connecter"}</button>
      </form>
    </div>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const link = (to, label) => <NavLink to={to} className={({ isActive }) => (isActive ? "active" : "")}>{label}</NavLink>;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="eyebrow">CRLOI Gôh</div>
          <div className="name">Renseignement</div>
          <div className="sub">Lutte contre l'orpaillage illégal</div>
        </div>
        <nav>
          <div className="group">Situation</div>
          {link("/carte", "Carte")}
          {link("/tableau-de-bord", "Tableau de bord")}
          <div className="group">Données</div>
          {link("/sites", "Sites")}
          {link("/brq", "BRQ")}
          {link("/hebdo", "Rapports hebdo")}
          {link("/renseignement", "Fiches de renseignement")}
          {user.role === "chef" && <><div className="group">Administration</div>{link("/equipe", "Équipe")}</>}
        </nav>
        <div className="me">
          <div style={{ fontWeight: 600 }}>{user.full_name}</div>
          <div style={{ color: "var(--side-muted)", fontSize: 12 }}>{user.role_label}</div>
          <button type="button" onClick={logout}>Se déconnecter</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/carte" element={<MapPage />} />
          <Route path="/tableau-de-bord" element={<Dashboard />} />
          <Route path="/sites" element={<Sites />} />
          <Route path="/brq" element={<BrqPage />} />
          <Route path="/hebdo" element={<Hebdo />} />
          <Route path="/renseignement" element={<Fiches />} />
          {user.role === "chef" && <Route path="/equipe" element={<Equipe />} />}
          <Route path="*" element={<Navigate to="/carte" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return user ? <ViewProvider><Shell /></ViewProvider> : <Login />;
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter>
);
