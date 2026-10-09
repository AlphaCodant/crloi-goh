import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, hasToken, isoToday, setToken } from "./api";

const AuthCtx = createContext(null);
const ViewCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!hasToken());

  useEffect(() => {
    if (hasToken()) api("/auth/me").then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
    const out = () => setUser(null);
    window.addEventListener("crloi-logout", out);
    return () => window.removeEventListener("crloi-logout", out);
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api("/auth/login", { method: "POST", body: { email, password } });
    setToken(r.token);
    setUser(r.user);
  }, []);
  const logout = useCallback(() => { setToken(null); setUser(null); }, []);

  return <AuthCtx.Provider value={{ user, ready, login, logout }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);

/** Date et département partagés entre la carte et le tableau de bord. */
export function ViewProvider({ children }) {
  const [date, setDate] = useState(isoToday());
  const [departement, setDepartement] = useState("");
  const [focusSite, setFocusSite] = useState(null);
  return (
    <ViewCtx.Provider value={{ date, setDate, departement, setDepartement, focusSite, setFocusSite }}>
      {children}
    </ViewCtx.Provider>
  );
}
export const useView = () => useContext(ViewCtx);
