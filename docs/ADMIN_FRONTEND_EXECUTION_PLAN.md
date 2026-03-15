# Plan d'execution — Frontend Admin Global

## Resume

Construire un frontend admin unifie sous `/admin/`, en gardant une stack `vanilla HTML/CSS/JS`.
L'admin personas nodal existant devient le premier module d'un shell admin global, pas une page isolee.

Le plan est structure pour une execution parallele par lots avec `agent-batch-orchestrator` et agents natifs, avec ownership disjoint par zone de code.

## Cible produit

Point d'entree unique:
- `/admin/index.html`

Modules v1:
- `dashboard`
- `personas`
- `runtime`
- `channels`
- `data`

Contraintes figees:
- auth admin: bootstrap token existant, conserve en `sessionStorage`
- stack frontend: vanilla + modules JS + Drawflow
- Drawflow reserve au module `personas`
- la page `/admin/personas.html` devient une surface de transition, puis une redirection vers `#/personas`

## Architecture cible

Fichiers shell:
- `public/admin/index.html`
- `public/admin/admin.css`
- `public/admin/admin.js`
- `public/admin/admin-api.js`
- `public/admin/admin-store.js`

Modules:
- `public/admin/modules/dashboard.js`
- `public/admin/modules/personas.js`
- `public/admin/modules/runtime.js`
- `public/admin/modules/channels.js`
- `public/admin/modules/data.js`

Backend a reutiliser/etendre:
- `http-api.js`
- `runtime-state.js`
- `chat-routing.js`
- `websocket.js`

## Lots d'execution paralleles

### Lot 1 — Shell admin global

Ownership:
- Agent A: `public/admin/index.html`, `public/admin/admin.css`
- Agent B: `public/admin/admin.js`, `public/admin/admin-store.js`, `public/admin/admin-api.js`

Objectif:
- poser le layout global, la navigation, le token admin, l'etat commun et le hash routing

Definition de fini:
- `/admin/index.html#/dashboard` charge
- token admin partage entre modules
- status global et refresh centralises

### Lot 2 — Module personas nodal

Ownership:
- Agent C: `public/admin/modules/personas.js`, adaptation de `public/admin/personas.js`
- Agent D: `http-api.js`, `runtime-state.js`, `chat-routing.js`

Objectif:
- migrer la logique personas dans le shell global
- rendre le nodal pleinement operable
- ajouter `disable/enable` runtime d'une persona

Definition de fini:
- creation sourcee depuis l'inspecteur nodal
- edition runtime/source depuis l'inspecteur nodal
- feedback, reinforce, revert depuis le nodal
- disable/enable avec effet immediat sur le routing et `#general`

### Lot 3 — Modules runtime et channels

Ownership:
- Agent E: `public/admin/modules/runtime.js`
- Agent F: `public/admin/modules/channels.js`, endpoints associes dans `http-api.js`

Objectif:
- exposer l'etat serveur/modeles
- livrer la gestion topics/canaux/routing

Definition de fini:
- module runtime affiche modeles, charge, idle/unload, clients, sessions
- module channels affiche canaux, activite, topics, regles
- topic editable depuis l'admin global

### Lot 4 — Module data

Ownership:
- Agent G: `public/admin/modules/data.js`
- Agent H: endpoints `history/export/logs` dans `http-api.js` et helpers de lecture

Objectif:
- centraliser exports, recherche d'historique et lecture operationnelle

Definition de fini:
- acces `training`, `dpo`, `HTML export`
- recherche d'historique avec filtres simples
- resume logs utilisable depuis l'admin

### Lot 5 — Verification et consolidation

Ownership:
- Agent I: `scripts/check.js`, `scripts/smoke.js`
- Agent J: `docs/SPEC.md`, `PLAN.md`, `TODO.md`, eventuelle redirection de `/admin/personas.html`

Objectif:
- fermer la boucle de verification et de documentation

Definition de fini:
- `npm run check` couvre le shell admin et les modules
- `npm run smoke` couvre login admin, navigation, personas, disable/enable, runtime, channels, data
- docs alignees sur le nouvel admin

## API a ajouter ou normaliser

Reutiliser:
- `GET /api/status`
- `GET /api/models`
- `GET /api/channels`
- `GET/PUT/POST /api/admin/personas*`
- `GET /api/dpo/export`
- `GET /api/training/export`

A ajouter:
- `GET /api/admin/runtime`
- `GET /api/admin/channels`
- `PUT /api/admin/channels/:id/topic`
- `POST /api/admin/personas/:id/disable`
- `POST /api/admin/personas/:id/enable`
- `GET /api/admin/history/search`
- `GET /api/admin/export/html`
- `GET /api/admin/logs/summary`

Semantique `disable`:
- ne supprime pas la persona
- n'ecrit jamais dans `personas.js`
- agit via override/runtime local
- exclut immediatement la persona du routing actif
- rend l'etat visible dans l'admin global

## Tests d'acceptation

- acces admin refuse sans token valide
- navigation `dashboard/personas/runtime/channels/data` sans rupture
- creation sourcee complete depuis le nodal
- edition source/runtime depuis le nodal
- feedback, reinforce, revert depuis le nodal
- disable/enable reflete immediatement dans les personas actives
- runtime montre les modeles charges et leur etat
- topics edites visibles cote admin et cote chat
- exports et recherche historique disponibles dans `data`

## Orchestration recommandee

Skill:
- `agent-batch-orchestrator` pour suivre les lots et relancer les echecs

Parallellisme recommande:
- `max_parallel_tasks = 3`

Ordre:
1. Lot 1
2. Lot 2
3. Lots 3 et 4 en parallele
4. Lot 5

Etat de sortie attendu:
- le shell admin global est la surface principale
- le module personas nodal est complet et operable
- le runtime et les canaux sont pilotables
- les exports et la recherche historique sont regroupes
