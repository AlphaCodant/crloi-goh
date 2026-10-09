# CRLOI Gôh – Cellule renseignement

Outil de la cellule renseignement du Comité Régional de Lutte contre l'Orpaillage Illégal de la région du Gôh.

## Contenu de la version 1

| Écran | Rôle |
|---|---|
| **Carte** | Sites en points (couleur = statut à la date choisie) et contours, cours d'eau, fonds satellite / topographique. Barre temporelle (début, −7 j, rejouer, +7 j, aujourd'hui) pour voir l'avant / maintenant / après. Fiche du site avec son historique daté. |
| **Tableau de bord** | Taux de neutralisation (cible ≥ 70 %), recolonisation à 3 mois (cible ≤ 10 %), tentatives de reprise sur 30 j, linéaire de cours d'eau impacté, régularité des BRQ. Graphiques par semaine, liés à la carte (même date, même département). |
| **Sites** | Registre, création, import CSV / GeoJSON (WGS84, UTM 29N, UTM 30N), contours, constats datés, alerte si un point tombe hors du Gôh. |
| **BRQ** | Saisie du bulletin quotidien : visites de sites, constat, matériel saisi, interpellés. Chaque visite met à jour le statut daté du site. |
| **Rapport hebdo** | Chiffres de la semaine calculés à partir des BRQ, synthèse / difficultés / recommandations, validation par le chef de cellule. |
| **Renseignement** | Fiches cotées (fiabilité A–F, crédibilité 1–6), numérotées RENS-AAAA-NNN, suivi de vérification, lien vers un site. Les sources sont désignées par un code, jamais par leur nom. |
| **Équipe** | Comptes (chef, analyste, cartographe) — chef de cellule uniquement. |

Au premier démarrage, la base est remplie avec les 24 sites et les visites du 30/09 au 03/10/2026 du **Rapport n°1 ORPI DREF Gôh** (état des lieux daté du 22/09/2026, date à confirmer) et les 7 cours d'eau recensés.

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
