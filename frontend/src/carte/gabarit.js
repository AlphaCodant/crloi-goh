/* Gabarit HTML du géoportail (structure identique à la carte GestReb). */
import GR from "../gr/gr";
import { MODULES } from "../modules";

const { esc } = GR;

export function gabarit({ user }) {
  const initiales = (user.full_name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0].toUpperCase())
    .join("");
  return `
  <header class="geo-top">
    <button class="btn btn-ghost btn-icon" data-toggle-nav aria-label="Menu de l'application" title="Menu"><span class="mi">apps</span></button>
    <a class="geo-brand" href="/carte" data-lien="/carte"><img src="/img/crloi.svg" alt=""><span><strong>Carte de situation</strong><small>CRLOI Gôh · Cellule renseignement</small></span></a>

    <div class="geo-search">
      <span class="mi">search</span>
      <input class="input" id="recherche" type="search" autocomplete="off" placeholder="Site, localité, forêt, cours d'eau ou lieu…" aria-label="Rechercher">
      <div class="search-results" id="resultats-recherche" role="listbox"></div>
    </div>

    <div class="row">
      <a class="btn btn-ghost btn-sm hide-sm" href="/tableau-de-bord" data-lien="/tableau-de-bord"><span class="mi">insights</span>Tableau de bord</a>
      <div class="user-menu">
        <button class="user-chip" data-dropdown="menu-utilisateur"><span class="avatar">${esc(initiales)}</span><span class="who"><strong>${esc(user.full_name)}</strong><small>${esc(user.role_label || "")}</small></span></button>
        <div class="dropdown" id="menu-utilisateur">
          <div class="dd-header"><strong style="color:var(--text-strong)">${esc(user.full_name)}</strong><div class="muted" style="font-size:12px">${esc(user.email)}</div></div>
          <hr>
          <a href="/tableau-de-bord" data-lien="/tableau-de-bord"><span class="mi">insights</span>Tableau de bord</a>
          <a href="/sites" data-lien="/sites"><span class="mi">location_on</span>Registre des sites</a>
          ${MODULES.brq ? '<a href="/brq" data-lien="/brq"><span class="mi">today</span>BRQ</a>' : ""}
          <a href="/renseignement" data-lien="/renseignement"><span class="mi">policy</span>Fiches de renseignement</a>
          <hr>
          <a href="#" data-deconnexion style="color:var(--danger)"><span class="mi">logout</span>Se déconnecter</a>
        </div>
      </div>
    </div>
  </header>

  <div class="geo-body">
    <aside class="geo-panel" id="panneau" aria-label="Panneau de la carte">
      <div class="panel-tabs" role="tablist">
        <button class="active" data-pane="couches" role="tab"><span class="mi">layers</span>Couches</button>
        <button data-pane="filtres" role="tab"><span class="mi">filter_alt</span>Filtres<span class="badge solid hidden" id="nb-filtres"></span></button>
        <button data-pane="analyse" role="tab"><span class="mi">palette</span>Analyse</button>
        <button data-pane="requete" role="tab"><span class="mi">manage_search</span>Requête</button>
        <button data-pane="imagerie" role="tab"><span class="mi">satellite_alt</span>Imagerie</button>
        <button data-pane="prospection" role="tab"><span class="mi">radar</span>Prospection<span class="badge solid hidden" id="nb-cibles"></span></button>
      </div>

      <div class="panel-content">
        <section class="panel-pane active" data-pane="couches">
          <div class="panel-section">
            <h3><span class="mi mi-sm">satellite_alt</span>Fond de carte</h3>
            <div class="basemaps" id="fonds"></div>
          </div>
          <div class="panel-section">
            <h3><span class="mi mi-sm">layers</span>Couches de données</h3>
            <div id="liste-couches"></div>
          </div>
          <div class="panel-section">
            <h3><span class="mi mi-sm">edit_location_alt</span>Saisie sur la carte</h3>
            <div class="row-wrap">
              <button class="btn btn-sm btn-soft" data-edition="ajout-site"><span class="mi">add_location_alt</span>Ajouter un site</button>
              <button class="btn btn-sm" data-edition="ajout-site-coord"><span class="mi">pin_drop</span>Par coordonnées</button>
              <button class="btn btn-sm" data-edition="gerer-cours"><span class="mi">water</span>Cours d'eau</button>
              <button class="btn btn-sm" data-edition="zone"><span class="mi">crop_free</span>Zone de travail</button>
            </div>
            <p class="muted mt-2" style="font-size:12px">Cliquez sur un site pour le modifier, le déplacer, changer son statut, dessiner ou importer son contour, ajouter des images drone ou le supprimer.</p>
          </div>
          <div class="panel-section">
            <h3><span class="mi mi-sm">summarize</span>Situation au <span id="resume-date">—</span></h3>
            <div class="summary" id="resume">
              <div><span>Sites affichés</span><strong data-k="n">—</strong></div>
              <div><span>Actifs / recolonisés</span><strong data-k="actifs">—</strong></div>
              <div><span>Taux de neutralisation</span><strong data-k="taux">—</strong></div>
              <div><span>Superficie connue</span><strong data-k="sup">—</strong></div>
            </div>
            <div class="alert warning mt-3 hidden" id="sans-coord"><span class="mi">wrong_location</span><span></span></div>
          </div>
        </section>

        <section class="panel-pane" data-pane="filtres">
          <div class="panel-section">
            <h3><span class="mi mi-sm">account_balance</span>Départements</h3>
            <div class="chips" id="f-departements">
              <label class="chip on"><input type="checkbox" value="Gagnoa" checked><span class="mi mi-sm">location_city</span>Gagnoa</label>
              <label class="chip on"><input type="checkbox" value="Oumé" checked><span class="mi mi-sm">location_city</span>Oumé</label>
            </div>
          </div>
          <div class="panel-section stack">
            <div class="field"><label>Statut à la date affichée</label><div id="f-statuts"></div></div>
            <div class="field"><label>Domaine</label><div id="f-domaines"></div></div>
            <div class="field"><label>Forêt classée</label><div id="f-forets"></div></div>
            <div class="field"><label>Sous-préfecture</label><div id="f-sp"></div></div>
            <div class="field"><label>Cours d'eau</label><div id="f-cours"></div></div>
            <div class="field"><label>Priorité</label><div id="f-priorites"></div></div>
            <div class="field"><label>Superficie (ha)</label>
              <div class="row"><input class="input sm" type="number" step="0.1" min="0" id="f-supmin" placeholder="min"><span class="muted">à</span><input class="input sm" type="number" step="0.1" min="0" id="f-supmax" placeholder="max"></div>
            </div>
          </div>
          <div class="alert info"><span class="mi">info</span><span>Les filtres s'appliquent immédiatement à la carte, à la table et au résumé du panneau.</span></div>
        </section>

        <section class="panel-pane" data-pane="analyse">
          <div class="panel-section">
            <h3><span class="mi mi-sm">palette</span>Représentation des sites</h3>
            <div class="field mb-2">
              <label for="theme">Colorer selon</label>
              <select class="select" id="theme">
                <option value="statut">Statut à la date affichée</option>
                <option value="departement">Département</option>
                <option value="sous_prefecture">Sous-préfecture</option>
                <option value="domaine">Domaine (rural / forêt classée)</option>
                <option value="foret">Forêt classée</option>
                <option value="cours_eau">Cours d'eau</option>
                <option value="priorite">Priorité</option>
                <option value="anciennete">Ancienneté du dernier constat</option>
                <option value="unique">Couleur unique</option>
              </select>
            </div>
            <div class="field mb-2"><label for="opacite">Opacité du remplissage <span class="muted" id="opacite-val">65 %</span></label><input type="range" id="opacite" min="0" max="100" value="65"></div>
            <div class="stack" style="gap:8px">
              <label class="switch"><input type="checkbox" id="etiquettes" checked>Afficher les codes des sites</label>
              <label class="switch"><input type="checkbox" id="contours" checked>Contours marqués</label>
              <label class="switch"><input type="checkbox" id="regroupement" checked>Regrouper les sites à petite échelle</label>
              <label class="switch"><input type="checkbox" id="chaleur">Carte de chaleur des sites actifs</label>
            </div>
          </div>
          <div class="panel-section">
            <h3><span class="mi mi-sm">donut_large</span>Répartition (nombre de sites)</h3>
            <div id="mini-graphe" style="min-height:220px"></div>
          </div>
        </section>

        <section class="panel-pane" data-pane="requete">
          <div class="panel-section">
            <h3><span class="mi mi-sm">manage_search</span>Requête attributaire</h3>
            <p class="muted mb-2" style="font-size:12.5px">Combinez autant de critères que nécessaire. La requête s'ajoute aux filtres en cours.</p>
            <div class="mode-switch mb-2">
              <span>Sites vérifiant</span>
              <div class="segmented" id="mode-requete"><button class="active" data-mode="ET">tous les critères</button><button data-mode="OU">au moins un</button></div>
            </div>
            <div class="criteria" id="criteres"></div>
            <button class="btn btn-sm btn-soft mt-2" id="ajout-critere"><span class="mi">add</span>Ajouter un critère</button>
          </div>
          <div class="row">
            <button class="btn btn-primary grow" id="lancer-requete"><span class="mi">play_arrow</span>Exécuter</button>
            <button class="btn" id="effacer-requete"><span class="mi">backspace</span>Effacer</button>
          </div>
          <div class="mt-4" id="requete-resultat"></div>
        </section>

        <section class="panel-pane" data-pane="imagerie" id="pane-imagerie"></section>
        <section class="panel-pane" data-pane="prospection" id="pane-prospection"></section>
      </div>
      <div class="panel-foot">
        <button class="btn btn-sm grow" id="reinitialiser"><span class="mi">restart_alt</span>Réinitialiser</button>
        <button class="btn btn-sm btn-primary grow" id="ouvrir-table"><span class="mi">table_view</span>Table attributaire</button>
      </div>
    </aside>

    <div class="geo-map-wrap">
      <div id="map" tabindex="0" aria-label="Carte">
        <button class="map-btn panel-toggle" id="bascule-panneau" title="Afficher / masquer le panneau"><span class="mi">menu_open</span></button>

        <div class="tools-bar" role="toolbar" aria-label="Outils">
          <button class="map-btn" data-outil="info" title="Identifier (clic sur un site)"><span class="mi">info</span></button>
          <span class="sep"></span>
          <button class="map-btn" data-outil="distance" title="Mesurer une distance"><span class="mi">straighten</span></button>
          <button class="map-btn" data-outil="surface" title="Mesurer une surface"><span class="mi">square_foot</span></button>
          <span class="sep"></span>
          <button class="map-btn" data-outil="selection-rect" title="Sélectionner par rectangle"><span class="mi">highlight_alt</span></button>
          <button class="map-btn" data-outil="selection-poly" title="Sélectionner par polygone"><span class="mi">pentagon</span></button>
          <span class="sep"></span>
          <button class="map-btn" data-outil="dessin-point" title="Annoter : point"><span class="mi">add_location_alt</span></button>
          <button class="map-btn" data-outil="dessin-ligne" title="Annoter : ligne / itinéraire"><span class="mi">timeline</span></button>
          <button class="map-btn" data-outil="dessin-poly" title="Annoter : zone"><span class="mi">format_shapes</span></button>
          <button class="map-btn" data-action="effacer-dessins" title="Effacer mesures et annotations"><span class="mi">cleaning_services</span></button>
          <span class="sep"></span>
          <button class="map-btn" data-edition="ajout-site" title="Ajouter un site (clic sur la carte)"><span class="mi">add_location</span></button>
          <button class="map-btn" data-edition="tracer-cours" title="Tracer un cours d'eau"><span class="mi">water</span></button>
          <button class="map-btn" data-edition="zone" title="Dessiner une zone de travail"><span class="mi">crop_free</span></button>
          <button class="map-btn" data-prospection="dessiner-cible" title="Signaler une zone suspecte (dessin)"><span class="mi">report</span></button>
          <span class="sep"></span>
          <button class="map-btn" data-action="comparer" title="Comparer avant / après (rideau)"><span class="mi">compare</span></button>
        </div>
        <div class="tool-hint" id="aide-outil"><span id="aide-outil-texte"></span><button id="aide-outil-stop">Terminer (Échap)</button></div>
        <div class="map-loading" id="chargement"><span class="spinner"></span>Chargement des sites…</div>

        <div class="map-controls">
          <div class="map-ctrl-group">
            <button class="map-btn" data-action="zoom-plus" title="Zoom avant"><span class="mi">add</span></button>
            <button class="map-btn" data-action="zoom-moins" title="Zoom arrière"><span class="mi">remove</span></button>
          </div>
          <div class="map-ctrl-group">
            <button class="map-btn" data-action="emprise" title="Emprise des sites"><span class="mi">fit_screen</span></button>
            <button class="map-btn" data-action="accueil" title="Vue d'ensemble du Gôh"><span class="mi">home</span></button>
            <button class="map-btn" data-action="position" title="Ma position"><span class="mi">my_location</span></button>
            <button class="map-btn" data-action="plein-ecran" title="Plein écran"><span class="mi">fullscreen</span></button>
          </div>
          <div class="map-ctrl-group">
            <button class="map-btn" data-action="aller-a" title="Aller à des coordonnées"><span class="mi">pin_drop</span></button>
            <button class="map-btn" data-action="export-png" title="Exporter l'image de la carte (PNG)"><span class="mi">image</span></button>
            <button class="map-btn" data-action="imprimer" title="Imprimer la carte"><span class="mi">print</span></button>
            <button class="map-btn" data-action="partager" title="Copier le lien de cette vue"><span class="mi">share</span></button>
          </div>
        </div>

        <div class="rideau hidden" id="rideau" aria-hidden="true"><div class="rideau-ligne"></div><button class="rideau-poignee" title="Glisser pour comparer"><span class="mi">compare_arrows</span></button>
          <span class="rideau-etiquette gauche" id="rideau-gauche"></span><span class="rideau-etiquette droite" id="rideau-droite"></span></div>
        <div class="legend" id="legende">
          <div class="legend-head" id="legende-tete"><span class="mi">legend_toggle</span><span id="legende-titre">Légende</span><span class="mi mi-sm" style="margin-left:auto">expand_more</span></div>
          <div class="legend-body" id="legende-corps"></div>
        </div>

        <div class="timebar" id="frise" aria-label="Évolution dans le temps">
          <div class="tb-buttons">
            <button class="map-btn" data-temps="debut" title="Premier constat"><span class="mi">first_page</span></button>
            <button class="map-btn" data-temps="-7" title="Reculer d'une semaine"><span class="mi">fast_rewind</span></button>
            <button class="map-btn tb-play" data-temps="lecture" title="Rejouer l'évolution"><span class="mi">play_arrow</span></button>
            <button class="map-btn" data-temps="+7" title="Avancer d'une semaine"><span class="mi">fast_forward</span></button>
            <button class="map-btn" data-temps="aujourdhui" title="Aujourd'hui"><span class="mi">today</span></button>
          </div>
          <div class="tb-track">
            <div class="tb-head"><strong id="frise-date">—</strong><span class="muted" id="frise-info"></span></div>
            <div class="tb-range">
              <div class="tb-ticks" id="frise-ticks"></div>
              <input type="range" id="frise-curseur" min="0" max="0" value="0" aria-label="Date affichée">
            </div>
            <div class="tb-bornes"><span id="frise-min"></span><span id="frise-max"></span></div>
          </div>
        </div>

        <div class="status-bar">
          <span class="sb-item"><span class="mi mi-sm">near_me</span><span id="coord">—</span></span>
          <select id="systeme-coord" aria-label="Système de coordonnées" title="Système de coordonnées">
            <option value="dd">WGS84 décimal</option>
            <option value="dms">WGS84 DMS</option>
            <option value="utm29">UTM 29N (m)</option>
            <option value="utm30">UTM 30N (m)</option>
          </select>
          <span class="sb-item hide-sm" id="echelle"></span>
          <span class="sb-item hide-sm">Zoom <strong id="niveau-zoom">—</strong></span>
          <span class="sb-item" style="margin-left:auto"><span class="mi mi-sm">location_on</span><span id="nb-sites">0 site</span></span>
        </div>
      </div>

      <div id="popup" class="ol-popup" style="display:none"></div>

      <section class="geo-drawer" id="tiroir" aria-label="Table attributaire">
        <div class="drawer-head">
          <span class="mi" style="color:var(--primary)">table_view</span>
          <h3>Table attributaire</h3>
          <span class="badge" id="table-compte">0</span>
          <span class="badge green hidden" id="table-selection"></span>
          <div class="input-icon hide-sm" style="width:220px;margin-left:8px"><span class="mi">search</span><input class="input sm" id="table-recherche" type="search" placeholder="Rechercher dans la table"></div>
          <label class="switch hide-sm" style="font-size:12px"><input type="checkbox" id="table-emprise">Emprise visible</label>
          <label class="switch hide-sm" style="font-size:12px"><input type="checkbox" id="table-selectionnees">Sélection seule</label>
          <div class="row" style="margin-left:auto">
            <button class="btn btn-sm btn-ghost" id="table-vider-selection" title="Vider la sélection"><span class="mi">deselect</span></button>
            <div class="user-menu">
              <button class="btn btn-sm" data-dropdown="menu-export"><span class="mi">download</span>Exporter</button>
              <div class="dropdown" id="menu-export" style="bottom:calc(100% + 6px);top:auto">
                <button class="dd-item" data-export="csv"><span class="mi">description</span>CSV (tableur)</button>
                <button class="dd-item" data-export="xlsx"><span class="mi">grid_on</span>Excel (.xlsx)</button>
                <button class="dd-item" data-export="geojson"><span class="mi">data_object</span>GeoJSON (SIG)</button>
                <button class="dd-item" data-export="kml"><span class="mi">public</span>KML (Google Earth)</button>
              </div>
            </div>
            <button class="btn btn-sm btn-ghost btn-icon" id="table-agrandir" title="Agrandir"><span class="mi">open_in_full</span></button>
            <button class="btn btn-sm btn-ghost btn-icon" id="table-fermer" title="Fermer"><span class="mi">close</span></button>
          </div>
        </div>
        <div class="drawer-body" id="table-sites"></div>
      </section>
    </div>
  </div>

  <div class="modal" id="modal-aller">
    <div class="modal-dialog">
      <div class="modal-head"><span class="mi" style="color:var(--primary)">pin_drop</span><h2>Aller à des coordonnées</h2><div class="actions"><button class="btn btn-sm btn-ghost btn-icon" data-close-modal><span class="mi">close</span></button></div></div>
      <div class="modal-body stack">
        <div class="segmented" id="aller-systeme"><button class="active" data-s="dd">Degrés décimaux</button><button data-s="29">UTM 29N</button><button data-s="30">UTM 30N</button></div>
        <div class="form-grid" data-s="dd"><div class="field"><label>Latitude</label><input class="input" id="aller-lat" placeholder="6.1300"></div><div class="field"><label>Longitude</label><input class="input" id="aller-lon" placeholder="-5.9500"></div></div>
        <div class="form-grid hidden" data-s="utm"><div class="field"><label>X (Est, m)</label><input class="input" id="aller-x" placeholder="238747"></div><div class="field"><label>Y (Nord, m)</label><input class="input" id="aller-y" placeholder="705256"></div></div>
        <label class="switch"><input type="checkbox" id="aller-marqueur" checked>Placer un repère</label>
      </div>
      <div class="modal-foot"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="aller-ok"><span class="mi">near_me</span>Y aller</button></div>
    </div>
  </div>`;
}
