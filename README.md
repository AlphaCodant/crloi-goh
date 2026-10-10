# CRLOI Gôh – Cellule renseignement

Outil de la cellule renseignement du Comité Régional de Lutte contre l'Orpaillage Illégal de la région du Gôh.

## Interface

L'interface reprend le système de design et le géoportail de **GestReb** (branche `optimise_gestreb`) :
OpenLayers 10 (version complète copiée dans `public/vendor` au build), ApexCharts, polices Inter et Material Icons,
panneau Couches / Filtres / Analyse / Requête, outils de mesure, de sélection et d'annotation, table attributaire
exportable (CSV, Excel, GeoJSON, KML), impression et export PNG. Les couches de référence (19 forêts classées,
limite du CG Gagnoa, Côte d'Ivoire) proviennent de GestReb.

## Contenu de la version 1

| Écran | Rôle |
|---|---|
| **Carte de situation** | Géoportail GestReb adapté : sites en points et contours colorés selon le statut à la date (ou département, forêt, cours d'eau, ancienneté du constat…), regroupement à petite échelle, carte de chaleur des sites actifs, fiches de renseignement géolocalisées, forêts classées, cours d'eau. Fonds satellite, hybride, Sentinel-2 (EOX), OSM, topographique, relief. Frise temporelle (début, −7 j, rejouer, +7 j, aujourd'hui) pour voir l'avant / maintenant / après. Coordonnées WGS84, DMS, UTM 29N et 30N. |
| **Tableau de bord** | Sur le modèle des statistiques GestReb : filtres (départements, date de situation, période, domaine, forêts, sous-préfectures), 10 indicateurs (neutralisation ≥ 70 %, recolonisation à 3 mois ≤ 10 %, tentatives, visites, saisies, interpellations, cours d'eau, BRQ…), graphiques hebdomadaires cliquables, frise des sites, tableau croisé dynamique, liste exportable (Excel, CSV). Date et département partagés avec la carte. |
| **Sites** | Registre, création, import CSV / GeoJSON (WGS84, UTM 29N, UTM 30N), contours, constats datés, alerte si un point tombe hors du Gôh. |
| **BRQ** | Saisie du bulletin quotidien : visites de sites, constat, matériel saisi, interpellés. Chaque visite met à jour le statut daté du site. |
| **Rapport hebdo** | Chiffres de la semaine calculés à partir des BRQ, synthèse / difficultés / recommandations, validation par le chef de cellule. |
| **Renseignement** | Fiches cotées (fiabilité A–F, crédibilité 1–6), numérotées RENS-AAAA-NNN, suivi de vérification, lien vers un site. Les sources sont désignées par un code, jamais par leur nom. |
| **Équipe** | Comptes (chef, analyste, cartographe) — chef de cellule uniquement. |

Au premier démarrage, la base est remplie avec les 24 sites et les visites du 30/09 au 03/10/2026 du **Rapport n°1 ORPI DREF Gôh** (état des lieux daté du 22/09/2026, date à confirmer) et les 7 cours d'eau recensés.

## Version 2 : édition, imagerie, prospection

| Fonction | Où |
|---|---|
| **Tout modifier depuis la carte** | Ajouter un site d'un clic (ou par coordonnées), modifier ses informations et coordonnées, ajouter un constat daté, déplacer le point, dessiner / modifier / importer (GeoJSON, KML, GPX) / supprimer le contour, supprimer le site. Tracer les cours d'eau, dessiner des zones de travail, déplacer les fiches de renseignement. |
| **Imagerie Earth Engine** | Onglet *Imagerie* : couleurs naturelles, fausses couleurs, infrarouge court, NDVI, BSI (sol nu), MNDWI (eau), NDTI (turbidité), perte de végétation entre deux périodes. Sentinel-2 (10 m) depuis 2019, Landsat (30 m) avant. |
| **Images drone** | Dépôt d'orthophotos GeoTIFF (WGS84, Web Mercator, UTM 29N / 30N) ou JPEG / PNG + fichier de calage, rattachées à un site et datées. Une version allégée (4 096 px au plus, WebP) est conservée en base pour l'affichage. Mode « selon la frise » : chaque site montre sa dernière image à la date choisie. |
| **Rideau avant / après** | Comparaison de deux sources (fond, couches GEE, images drone à deux dates). |
| **Prospection GEE** | Onglet *Prospection* : analyse d'une zone (emprise visible, zone dessinée, forêt classée, zone de travail) entre une période de référence et une période récente ; zones suspectes scorées (perte de NDVI 35 %, sol nu 25 %, turbidité 10 %, proximité de l'eau 20 %, surface 10 %). Signalement manuel de zones. |
| **Missions d'éclairage** | Page *Missions* : regroupement de zones suspectes, équipe, moyens, export GPX / KML pour le GPS, compte rendu, résultat par zone (confirmée → devient un site, infirmée, écartée). |
| **BRQ complet** | Période de la mission (en plus de la date du bulletin), comité départemental, chef de mission, agents participants (saisie ou liste collée depuis Excel), photos (réduites à 2 560 px dans le navigateur) et vidéos (50 Mo au plus), visa du responsable du Comité départemental avec signature numérisée importée une fois puis réutilisée. Version imprimable / PDF avec photos en annexe. |

### Relier Google Earth Engine

1. Le compte de service doit appartenir à un projet Google Cloud **enregistré pour Earth Engine** (usage non commercial), avec l'API Earth Engine activée.
2. Sur Render, service `crloi-goh-api` → *Environment* → ajouter `GEE_SERVICE_ACCOUNT_JSON` = contenu complet du fichier de clé JSON (facultatif : `GEE_PROJECT`).
3. Dans la carte, onglet *Imagerie*, bouton *Tester*.

Sans cette variable, tout le reste fonctionne ; les fonctions GEE affichent un message explicite.

## Lancer en local

```bash
# API (Python 3.11+ et PostgreSQL)
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env        # puis compléter
uvicorn app.main:app --port 8010

# Interface
cd frontend
npm install
npm run dev                    # http://localhost:5173 (l'API est relayée sur /api)
```

Tests : `cd backend && pytest` (les tests d'API ne tournent que si `TEST_DATABASE_URL` pointe vers une base de test, qui sera vidée).

## Variables d'environnement (API)

| Variable | Exemple | Rôle |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:mdp@hote/base` | Base PostgreSQL |
| `DB_SSL` | `true` / `false` | SSL vers la base (`true` pour l'URL externe Render) |
| `DB_SCHEMA` | `crloi` | Schéma PostgreSQL dédié (permet de partager une base avec une autre application sans mélanger les tables) |
| `JWT_SECRET` | 32 caractères aléatoires ou plus | Signature des sessions |
| `CORS_ORIGINS` | `https://crloi-goh.onrender.com` | Adresse de l'interface |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_GRADE` | | Compte du chef de cellule créé au premier démarrage |

Interface : `VITE_API_URL` = adresse de l'API **sans** `/api` (vide en local).

## Mettre en ligne sur Render

1. Pousser ce dépôt sur GitHub.
2. Render → **New → Blueprint** → choisir le dépôt : `render.yaml` crée l'API `crloi-goh-api` et l'interface `crloi-goh`.
3. Renseigner les valeurs demandées :
   - `DATABASE_URL` : l'**Internal Database URL** de la base Render existante (même région, Oregon) ;
   - `ADMIN_*` : votre compte ; changez le mot de passe après la première connexion ;
   - `CORS_ORIGINS` : l'adresse de l'interface, `VITE_API_URL` : l'adresse de l'API.
4. Après le premier déploiement, si les adresses ont changé, corriger `CORS_ORIGINS` / `VITE_API_URL` et redéployer.

Ne jamais mettre de mot de passe, clé GEE ou fichier `.env` dans le dépôt.

## Étape suivante (phase 2)

- Couches raster : images drone géoréférencées (GeoTIFF), Sentinel-2 récente et NDVI via Google Earth Engine.
- Mode comparaison avant / après (rideau).
- Prospection GEE des zones suspectes et préparation des missions d'éclairage.
- Mode présentation pour les parties prenantes, export de cartes.
