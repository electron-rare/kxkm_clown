# PLAN

## Direction active

Refonte `V2` en parallèle de la `V1`, avec bascule finale.

Choix verrouillés:
- backend `Node.js`
- frontend `React/Vite`
- monorepo `apps/` + `packages/`
- cible produit `privé multi-utilisateur`
- `Node Engine` comme cœur d'orchestration de la V2

## V1 conservée

La V1 reste la base exploitable et la référence de comportement pour:
- chat multi-personas
- session admin cookie
- pipeline éditorial personas
- Node Engine local/async
- uploads multimodaux
- scripts `check`, `smoke`, `build`

## Lot 0 — Cadrage et gel V1 `[complété]`

Livré:
- architecture cible validée
- invariants V1/V2 explicités
- mémoire, spec, feature map, agents et README alignés
- orchestration batch/logs V2 ajoutée sous `ops/v2`
- squelette monorepo initial posé

## Lot 1 — Socle V2 `[complété]`

Livré:
- workspace TypeScript réel (`apps/web`, `apps/api`, `apps/worker`)
- packages TypeScript (`core`, `chat-domain`, `persona-domain`, `node-engine`, `auth`, `storage`, `ui`, `tui`)
- `check:v2` et `build:v2` intégrés aux scripts racine
- premier shell React/Vite
- premier backend V2
- premier worker V2

## Lot 2 — Code Quality V1 `[complété]`

Objectif: corriger les problèmes critiques identifiés lors de l'analyse de la base V1.

Livré:
- `escapeHtml` dédupliqué vers `utils.js`
- `normalizeAuth` consolidé dans `admin-api.js`
- `ensureSeedGraphs` guard flag ajouté (évite les réexécutions)
- `finishRun` comptage d'artifacts sans JSON parse
- `recoverRunnableRuns` double-read corrigé
- Bash injection fixé dans `node-engine-runtimes.js` (whitelist + timeout 30min)
- Timeout Ollama ajouté (15s metadata, 5min chat streaming)
- Validation WebSocket (64KB frame max, 8192 chars text, type checks)
- Rate limiting par IP (30 msg/min, `rate-limit.js`)
- Timeout par nœud Node Engine (10min default, configurable)
- Stubs analyse image/audio dans `attachment-pipeline.js` (en cours agent P1)
- Audit logging admin actions (en cours agent P1)

## Lot 3 — Domaines V2 `[complété]`

Objectif: contrats partagés, schémas métiers, auth réelle, persistance Postgres.

Livré:
- contrats TypeScript `core`, `auth`, `chat-domain`, `persona-domain`, `node-engine`, `storage`
- rôles `admin/editor/operator/viewer`
- session cookie V2 de dev
- endpoints V2 minimaux pour session, personas et Node Engine
- contrat Postgres côté configuration et schémas SQL initiaux
- repos Postgres typés (session, persona, graph, run) + `runMigrations()`
- auth réelle: crypto.scrypt hashing, token gen, extractSessionId, validateLoginInput
- chat domain: ChatMessage, ChatSession, compactHistory, channel validation
- persona domain: validatePersonaUpdate, aggregateFeedback, computePersonaDiff, createPersonaSource

Reste à faire:
- brancher les repos Postgres dans `apps/api` (remplacer les Maps in-memory)

## Lot 4 — Node Engine V2 `[complété]`

Objectif: porter store/runner/queue dans le package dédié, séparer les runtimes.

Livré:
- overview V2 minimale + graphes/runs/models de dev côté API + worker bootstrap
- registry TypeScript complet (15 node types, 7 familles, params typés)
- graph ops pures (topologicalSort, validateEdgeContracts, collectNodeInputs)
- run state machine (createRun, RunStep, resolveFinalStatus)
- queue logic pure (createQueueState, enqueue, dequeue, canDequeue, markComplete)
- runtime definitions (5 runtimes: local_cpu, local_gpu, remote_gpu, cluster, cloud_api)

## Lot 5 — Personas V2 `[complété]`

Objectif: `Pharmacius` opéré comme sous-système Node Engine, pipeline éditorial complet.

Livré:
- seed personas V2 + source/feedback/proposals/reinforce/revert côté API
- registry state machine pure (CRUD, enable/disable, getByNick/Model)
- Pharmacius prompt builder + response parser (pure, pas d'appels LLM)
- editorial pipeline state machine (idle → collecting → generating → review → applied/reverted)
- DPO training pair extraction (extractDPOPairs)
- patch apply/revert logic (applyPatches, reversePatches)

## Lot 6 — Frontend V2 `[complété]`

Objectif: shell React/Vite complet avec toutes les surfaces.

Livré:
- API client centralisé (`api.ts`) couvrant session, personas, node engine, chat
- 9 composants React (Header, Login, Nav, PersonaList, PersonaDetail, NodeEngineOverview, GraphDetail, RunStatus, ChannelList)
- routing hash-based sans react-router (#/dashboard, #/personas, #/node-engine, etc.)
- CSS IRC theme avec custom properties (SHELL_THEME + STATUS_COLORS)
- responsive breakpoints (sidebar → tabs à 720px)

## Lot 7 — TUI et opérabilité `[complété]`

Livré:
- `ops/v2/health-check.js` — probes V1+V2+Ollama+disk+memory, --watch/--json
- `ops/v2/queue-viewer.js` — TUI queue/runs Node Engine, --watch/--json
- `ops/v2/persona-manager.js` — TUI personas overview, --json
- `ops/v2/log-rotate.js` — rotation/nettoyage logs avec --dry-run/--max-age-days
- `packages/tui` — ansi helpers, statusDot, formatTable, drawBox, stripAnsi

## Lot 8 — Migration et bascule `[complété]`

Livré:
- `scripts/migrate-v1-to-v2.js` — migration personas, graphs, runs → Postgres (upsert, --dry-run, --verbose)
- `scripts/parity-check.js` — 10 checks parité V1/V2 (personas, graphs, channels, API shapes)
- `scripts/rollback-v2.js` — drop/truncate tables avec confirmation (--yes, --tables, --truncate)
- `scripts/smoke-v2.js` — 22 tests sur 5 catégories (`npm run smoke:v2`)

## Lot 9 — Intégration avancée `[complété]`

Livré:
- Migration ollama-js SDK officiel (même interface, streaming natif)
- Chat WebSocket React (hook useWebSocket, auto-reconnect, composant IRC)
- Éditeur visuel Node Engine (React Flow, 7 familles colorées, drag/connect/save/run)
- Persona sub-stores Postgres (sources, feedback, proposals — 3 tables, 3 repos)
- Déduplication requêtes GET admin-api.js
- CI/CD GitHub Actions (`.github/workflows/ci.yml`)
- Deep analyse finale V1+V2 (14 modules vérifiés, intégrité confirmée)

## Lot 10 — Production readiness `[en cours]`

Livré:
- Adaptateurs training réels (TRL + Unsloth) — `packages/node-engine/src/training.ts`, worker intégré
- Sandboxing runtimes (none/subprocess/container) — `packages/node-engine/src/sandbox.ts`
- Tests unitaires V2 (node:test + supertest) — 102 tests, 46 suites, 0 failures
- Turborepo build orchestration — `turbo.json`, scripts alignés, CI mis à jour
- Code quality review (simplify) — 3 fixes efficacité/duplication

- Tests React (Vitest + RTL) — 33 tests, 6 composants, jsdom

Reste:
- Repo GitHub privé (token avec scope admin nécessaire)
