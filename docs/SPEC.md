# KXKM_Clown — Spécification V1 vérifiée et direction V2

## Statut

Ce document décrit à la fois:
- l'état réel vérifié de la `V1`
- la cible approuvée de la `V2`

Vérifications disponibles:
- `npm run check`
- `npm run smoke`
- `npm run build`

## V1 réellement livrée

KXKM_Clown V1 est un chat web multi-LLM au look mIRC:
- backend `Node.js` avec Express et WebSocket
- stockage local JSON / JSONL dans `data/`
- admin globale locale avec session cookie
- personas culturelles pilotées localement
- Node Engine déjà présent côté admin

Le contrat courant reste:
- usage privé
- exposition `LAN contrôlé`
- bootstrap admin + allowlist réseau
- session admin `HttpOnly` + contrôles same-origin

## V2 approuvée

La V2 sera:
- un monorepo `apps/` + `packages/`
- un backend `Node.js`
- un frontend `React/Vite`
- un produit privé multi-utilisateur
- un `Node Engine` placé au centre de l'orchestration

État déjà livré:
- workspace TypeScript réel
- `apps/api`, `apps/web`, `apps/worker` compilables
- session V2 minimale avec cookie
- RBAC `admin/editor/operator/viewer`
- endpoints V2 minimaux `session`, `personas`, `node-engine`
- shell React/Vite minimal
- worker bootstrap minimal

## Architecture V2 visée

Applications:
- `apps/web`
- `apps/api`
- `apps/worker`

Packages:
- `packages/core`
- `packages/chat-domain`
- `packages/persona-domain`
- `packages/node-engine`
- `packages/auth`
- `packages/storage`
- `packages/ui`
- `packages/tui`

## Interfaces V2 à stabiliser

### Session et rôles

- `POST /api/session/login`
- `POST /api/session/logout`
- `GET /api/session`
- rôles: `admin`, `editor`, `operator`, `viewer`

### Personas

- `GET /api/personas`
- `GET /api/personas/:id`
- `PUT /api/admin/personas/:id`
- `GET/PUT /api/admin/personas/:id/source`
- `GET /api/admin/personas/:id/feedback`
- `GET /api/admin/personas/:id/proposals`
- `POST /api/admin/personas/:id/reinforce`
- `POST /api/admin/personas/:id/revert`

### Node Engine

- `GET /api/admin/node-engine/overview`
- `GET/POST/PUT /api/admin/node-engine/graphs`
- `POST /api/admin/node-engine/graphs/:id/run`
- `POST /api/admin/node-engine/runs/:id/cancel`
- `GET /api/admin/node-engine/runs/:id`
- `GET /api/admin/node-engine/artifacts/:runId`
- `GET /api/admin/node-engine/models`

## Invariants de données

- les snapshots de session restent des archives restaurées manuellement
- `training/` et `dpo/` restent append-only
- le pipeline personas reste séparé entre seed, source, feedback, proposals et overrides
- `chat runtime`, `worker runtime` et `training runtime` doivent rester isolés

## Garde-fous V2

- ne pas perdre l'identité IRC / scène / terminal
- ne pas exposer le produit sur Internet public
- ne pas laisser le feedback modifier une persona sans journal
- ne pas mélanger mémoire éditoriale et exports d'entraînement

## Références

- `docs/ARCHITECTURE.md`
- `docs/FEATURE_MAP.md`
- `docs/PROJECT_MEMORY.md`
- `docs/NODE_ENGINE_ARCHITECTURE.md`
