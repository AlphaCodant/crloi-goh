import React, { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context";

export default function Equipe() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [v, setV] = useState({ email: "", full_name: "", grade: "", role: "analyste", password: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const load = () => api("/users").then(setUsers);
  useEffect(() => { load(); }, []);
  const f = (k) => (e) => setV({ ...v, [k]: e.target.value });

  async function add(e) {
    e.preventDefault();
    try { await api("/users", { method: "POST", body: v }); setMsg(`Compte créé pour ${v.full_name}. Communiquez-lui son mot de passe en main propre.`); setErr(""); setV({ email: "", full_name: "", grade: "", role: "analyste", password: "" }); load(); }
    catch (x) { setErr(x.message); setMsg(""); }
  }
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Administration</div><h1>Équipe de la cellule</h1><p>Seuls les comptes listés ici peuvent se connecter.</p></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", alignItems: "start" }}>
        <div className="table-box">
          <table>
            <thead><tr><th>Nom</th><th>Rôle</th><th>Statut</th><th></th></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id}>
                <td>{u.grade ? u.grade + " " : ""}{u.full_name}<div className="muted" style={{ fontSize: 12 }}>{u.email}</div></td>
                <td>{u.role_label}</td>
                <td>{u.active ? <span className="pill ok">Actif</span> : <span className="pill">Désactivé</span>}</td>
                <td>{u.id !== user.id && <button className="btn small" type="button" onClick={() => api(`/users/${u.id}/active`, { method: "POST", params: { active: !u.active } }).then(load)}>{u.active ? "Désactiver" : "Réactiver"}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <form className="card grid" onSubmit={add}>
          <h2>Ajouter un membre</h2>
          <div className="fgrid">
            <label className="f">Grade<input value={v.grade} onChange={f("grade")} /></label>
            <label className="f">Nom et prénoms<input value={v.full_name} onChange={f("full_name")} required /></label>
            <label className="f">Adresse e-mail<input type="email" value={v.email} onChange={f("email")} required /></label>
            <label className="f">Rôle<select value={v.role} onChange={f("role")}><option value="analyste">Analyste</option><option value="cartographe">Cartographe</option><option value="chef">Chef de cellule</option></select></label>
            <label className="f">Mot de passe provisoire <small>8 caractères minimum</small><input type="text" value={v.password} onChange={f("password")} minLength={8} required /></label>
          </div>
          {msg && <div className="okmsg">{msg}</div>}
          {err && <div className="err">{err}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" type="submit">Créer le compte</button></div>
        </form>
      </div>
    </div>
  );
}
