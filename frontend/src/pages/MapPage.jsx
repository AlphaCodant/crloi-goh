import React, { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, useView } from "../context";
import { initCarte } from "../carte/carte";

/** Monte le géoportail (code natif OpenLayers, comme la carte GestReb) dans la page React. */
export default function MapPage() {
  const racine = useRef(null);
  const { user, logout } = useAuth();
  const vue = useView();
  const naviguer = useNavigate();
  const [params] = useSearchParams();
  // Références stables : la carte n'est montée qu'une fois, la date partagée est lue via la référence.
  const ref = useRef({});
  ref.current = { vue, naviguer, logout };

  useEffect(() => {
    document.title = "Carte de situation · CRLOI Gôh";
    const demonter = initCarte(racine.current, {
      user,
      date: vue.date,
      departement: vue.departement,
      siteCible: params.get("site"),
      setDate: (d) => ref.current.vue.setDate(d),
      setDepartement: (d) => ref.current.vue.setDepartement(d),
      naviguer: (chemin) => ref.current.naviguer(chemin),
      deconnexion: () => ref.current.logout(),
    });
    return demonter;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="carte-racine" ref={racine} />;
}
