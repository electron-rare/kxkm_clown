# TODO

## P0 Critical (sécurité & stabilité)

- [x] Fix bash injection dans `node-engine-runtimes.js` — validation runtimeId/nodeType + timeout 30min
- [x] Ajouter timeout sur les appels Ollama — 15s metadata, 5min chat streaming
- [x] Validation des entrées sur les messages WebSocket — 64KB max frame, 8192 chars text, type checks
- [x] Rate limiting par user/IP sur chat — `rate-limit.js` + 30 msg/min par IP dans WebSocket
- [x] `escapeHtml` dédupliqué → `utils.js`
- [x] `normalizeAuth` consolidé dans `admin-api.js`
- [x] `ensureSeedGraphs` guard flag ajouté
- [x] `finishRun` comptage d'artifacts sans JSON parse
- [x] `recoverRunnableRuns` double-read corrigé

## P1 V1 Quality

- [ ] Migrer vers le SDK officiel `ollama-js` (remplacer le custom `ollama.js`)
- [x] Ajouter un audit logging pour les actions admin — `audit-log.js` + intégré dans `http-api.js` et `server.js`
- [x] Implémenter l'analyse image/audio dans `attachment-pipeline.js` — stubs factory avec adapter slot
- [x] Corriger la validation d'origine `postMessage` — déjà en place (personas.js:1476)
- [ ] Ajouter la déduplication de requêtes dans `admin-api.js`
- [x] Node Engine : validation de tri topologique — déjà en place (cycle detection dans runner)
- [x] Node Engine : timeout d'exécution par nœud — 10min default via `NODE_ENGINE_STEP_TIMEOUT_MS`

## P2 V2 Domaines

- [x] Schéma Postgres + migrations + repos typés (`packages/storage`) — session, persona, graph, run repos
- [x] Module auth réel (`packages/auth`) — crypto.scrypt, token gen, extractSessionId, validateLoginInput
- [x] Logique domaine chat (`packages/chat-domain`) — ChatMessage, ChatSession, compactHistory, channel validation
- [x] Logique domaine persona (`packages/persona-domain`) — validatePersonaUpdate, aggregateFeedback, computePersonaDiff
- [x] Brancher les repos Postgres dans `apps/api` — async `createApp()`, fallback in-memory si pas de DATABASE_URL

## P3 Node Engine V2

- [x] Porter registry → `packages/node-engine` (15 node types, 7 familles)
- [x] Porter graph ops (topologicalSort, validateEdgeContracts, collectNodeInputs)
- [x] Porter run state machine (createRun, RunStep, resolveFinalStatus)
- [x] Porter queue logic (createQueueState, enqueue, dequeue, canDequeue)
- [x] Runtime definitions (5 runtimes)
- [ ] Isoler les runtimes avec sandboxing approprié
- [ ] Adaptateurs d'entraînement réels (LoRA, QLoRA, SFT)
- [x] Brancher le runner V2 dans `apps/worker` — poll loop, stub executors, graceful shutdown

## P4 Frontend V2

- [x] API client centralisé (`api.ts`)
- [x] 9 composants React (Header, Login, Nav, PersonaList, PersonaDetail, NodeEngineOverview, GraphDetail, RunStatus, ChannelList)
- [x] Routing hash-based + responsive CSS
- [ ] Interface chat React (WebSocket live)
- [ ] Éditeur visuel Node Engine (intégration Drawflow)

## P5 TUI & Ops

- [x] TUI health-check (V1+V2+Ollama+disk+memory)
- [x] TUI queue-viewer (runs, statuses)
- [x] TUI persona-manager (overview)
- [x] Log rotation (--dry-run, --max-age-days)
- [x] Packages/tui: ansi, statusDot, formatTable, drawBox

## P6 Migration

- [x] Matrice de parité V1 → V2 — `scripts/parity-check.js` (persona, graph, channel, API shape checks)
- [x] Scripts de migration de données — `scripts/migrate-v1-to-v2.js` (personas, graphs, runs → Postgres, --dry-run support)
- [x] Smoke tests pour V2 — `scripts/smoke-v2.js` (22 tests, 5 catégories, `npm run smoke:v2`)
- [x] Procédure de rollback — `scripts/rollback-v2.js` (drop/truncate tables with confirmation, --yes, --tables filter)

## P0+ Sécurité V1 (deep analyse 2026-03-16)

- [x] Path traversal dans `storage.js` — sanitisation session IDs + boundary check memory paths
- [x] Path traversal dans `persona-registry.js` / `persona-store.js` — `safeFsId()` helper
- [x] Path traversal dans `attachment-store.js` — sanitisation IDs + boundary check
- [x] SSRF dans `web-tools.js` — blocage localhost, IPs privées, .local/.internal
- [x] Response body limit dans `web-tools.js` — truncation 2 MB
- [x] Log injection dans `storage.js` — sanitisation paramètre `role`
- [x] Crash JSONL corrompu dans `storage.js` — try/catch par ligne
- [x] Map mutation during iteration dans `sessions.js` — collect then process
- [x] Session leak `/msg` dans `commands.js` — clé stable au lieu de Date.now()
- [x] Unbounded userRateLimits dans `chat-routing.js` — pruning > 200 entries
- [x] Session pruning O(n) dans `admin-session.js` — throttle 60s

## P7 Intégration avancée

- [x] Migrer vers ollama-js SDK officiel — `ollama.js` réécrit avec `Ollama` class, même interface
- [x] Chat WebSocket React live — hook `useWebSocket` + composant Chat IRC, auto-reconnect
- [x] Éditeur visuel Node Engine avec React Flow — `NodeEditor.tsx` + `EngineNode.tsx`, 7 familles colorées
- [x] Déduplication requêtes GET dans `admin-api.js` — `deduplicatedFetch` transparent
- [x] Repos Postgres pour persona sources/feedback/proposals — 3 tables + repos + fallback in-memory
- [x] CI/CD GitHub Actions — `.github/workflows/ci.yml` (check V1+V2)
- [x] Deep analyse finale V1+V2 — 14 modules V1 vérifiés, 3 fixes TS V2, intégrité confirmée

## P8 Production Readiness

- [x] Adaptateurs training réels (TRL + Unsloth pour LoRA/DPO) — `packages/node-engine/src/training.ts` + worker intégré
- [x] Sandboxing runtimes Node Engine (containers/VM) — `packages/node-engine/src/sandbox.ts` (none/subprocess/container)
- [x] Turborepo pour build orchestration monorepo — `turbo.json` + scripts alignés + CI mis à jour
- [x] Tests unitaires V2 avec node:test + supertest — 102 tests, 46 suites, 6 packages + API integration
- [x] Tests React avec Vitest + RTL — 33 tests, 6 composants (Header, Login, Nav, PersonaList, RunStatus, ChannelList)
- [ ] Créer le repo GitHub privé (token avec scope admin nécessaire)

## P9 Code Quality (simplify review)

- [x] Triple filter → single-pass loop dans `node-engine.js:deriveAsyncMeta`
- [x] Duplicate sanitization extraite dans `attachment-store.js:sanitizeId`
- [x] Double `loadModelIndex()` éliminé dans `node-engine-store.js:registerDeployment`
