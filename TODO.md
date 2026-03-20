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

- [x] Migrer vers le SDK officiel `ollama-js` — fait en P7 (`ollama.js` réécrit)
- [x] Ajouter un audit logging pour les actions admin — `audit-log.js` + intégré dans `http-api.js` et `server.js`
- [x] Implémenter l'analyse image/audio dans `attachment-pipeline.js` — stubs factory avec adapter slot
- [x] Corriger la validation d'origine `postMessage` — déjà en place (personas.js:1476)
- [x] Ajouter la déduplication de requêtes dans `admin-api.js` — fait en P7 (`deduplicatedFetch`)
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
- [x] Isoler les runtimes avec sandboxing approprié — fait en P8 (`sandbox.ts`)
- [x] Adaptateurs d'entraînement réels (LoRA, QLoRA, SFT) — fait en P8 (`training.ts`)
- [x] Brancher le runner V2 dans `apps/worker` — poll loop, stub executors, graceful shutdown

## P4 Frontend V2

- [x] API client centralisé (`api.ts`)
- [x] 9 composants React (Header, Login, Nav, PersonaList, PersonaDetail, NodeEngineOverview, GraphDetail, RunStatus, ChannelList)
- [x] Routing hash-based + responsive CSS
- [x] Interface chat React (WebSocket live) — fait en P7 (`Chat.tsx` + `useWebSocket.ts`)
- [x] Éditeur visuel Node Engine (React Flow) — fait en P7 (`NodeEditor.tsx` + `EngineNode.tsx`)

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
- [x] Créer le repo GitHub privé — https://github.com/electron-rare/kxkm_clown

## P9 Code Quality (simplify review)

- [x] Triple filter → single-pass loop dans `node-engine.js:deriveAsyncMeta`
- [x] Duplicate sanitization extraite dans `attachment-store.js:sanitizeId`
- [x] Double `loadModelIndex()` éliminé dans `node-engine-store.js:registerDeployment`

## P10 Lot 11 — Consolidation & Feature Parity

### Phase A — Analyse & Recherche
- [x] Deep analyse code V1+V2 (agent en cours)
- [x] Veille OSS mise à jour (agent en cours)
- [x] Recherche HuggingFace (agent en cours)

### Phase B — Correctifs sécurité (deep analyse)
- [x] **P0 SEC-01** Path traversal `node-engine-runner.js` — reject absolute paths + rootDir boundary check
- [x] **P0 SEC-04** V2 login role self-assignment — viewer par défaut, admin via ADMIN_TOKEN
- [x] **P1 BUG-06** Health endpoint leaking DATABASE_URL — remplacé par storageMode string
- [x] **P1 BUG-02** Timeout promise leak `node-engine-runner.js` — AbortSignal cancel
- [x] **P1 SEC-03** Attachments sans auth — ajout requireAdminNetwork middleware
- [x] Compilation + 119 tests OK après correctifs

### Phase C — Feature Parity V2
- [x] Recovery on crash worker — `recoverStaleRuns()` + worker startup recovery
- [x] Cancel support — `requestCancel()` repo + `shouldCancel` callback worker + API endpoint
- [ ] Tab completion chat V2
- [x] Commandes slash V2 — `parseSlashCommand`, `resolveCommand`, `generateHelpText` + 11 commandes + 17 tests
- [x] Mémoire conversationnelle V2 — `ConversationMemory`, `addToMemory`, `buildLlmContext`, `clearMemory`
- [x] Status strip admin V2 — GET `/api/v2/status` (personas, graphs, runs, queue)
- [x] Subnet gate V2 — CIDR middleware `/api/v2/admin/*` avec ADMIN_SUBNET env
- [x] Retention sweep V2 — `deleteOlderThan()` repo + POST `/api/v2/admin/retention-sweep`
- [x] Export HTML V2 — GET `/api/v2/export/html` avec download attachment
- [x] Upload fichiers V2 — bouton upload base64 dans Chat.tsx, accept image/audio/text/pdf/json/csv
- [x] Tab completion chat V2 — nicks + commandes slash, cycling Tab, reset auto

### Phase D — Déploiement & Docs
- [x] Docker — `Dockerfile` (multi-stage Node 22 alpine) + `docker-compose.yml` (5 services) + `.dockerignore`
- [ ] Documentation utilisateur
- [ ] Performance profiling

## P11 Lot 17 — Deep Audit & Refactoring

### Phase A — Analyse & documentation

- [x] Script TUI deep-audit.js (security, perf, complexity, deps) — `ops/v2/deep-audit.js`
- [x] Veille OSS enrichie 2026-03-17 (10 nouvelles catégories) — `docs/OSS_WATCH_2026-03-16.md`
- [x] Diagrammes Mermaid (Context Store, Docker, Inter-persona) — `docs/ARCHITECTURE.md`
- [x] AGENTS.md refondu (matrice 10 agents, Mermaid routing, pipeline) — `docs/AGENTS.md`
- [x] PLAN.md consolidé avec lots 17-19
- [x] TODO.md consolidé avec backlog Phase 6+
- [ ] Deep analyse code agents (api, web, packages, mascarade, v1+worker) — en cours

### Phase B — Refactoring code

- [ ] **P1** ws-chat.ts: extraction modules (1449 LOC → ~4×350 LOC)
  - [ ] Extraire `ws-multimodal.ts` (vision, STT, TTS, PDF handlers)
  - [ ] Extraire `ws-persona-router.ts` (pickResponders, inter-persona, memory)
  - [ ] Extraire `ws-commands.ts` (slash commands, /web, /imagine)
  - [ ] Garder `ws-chat.ts` core (WebSocket lifecycle, broadcast, rate limit)
- [ ] **P1** app.ts: extraction routes (1292 LOC → routes/ + middleware/)
  - [ ] Extraire `routes/personas.ts`
  - [ ] Extraire `routes/node-engine.ts`
  - [ ] Extraire `routes/chat.ts`
  - [ ] Extraire `middleware/auth.ts`
- [ ] **P2** writeFileSync → appendFile async dans ws-chat.ts (3 occurrences)
- [ ] **P2** console.log → logger structuré (apps/api, apps/worker)
- [ ] **P2** React.memo sur Chat, ChatHistory, VoiceChat, NodeEditor
- [ ] **P2** Lazy load: React.lazy + Suspense pour routes lourdes

### Phase C — Infrastructure

- [ ] SearXNG dans docker-compose (service searxng:8080, remplacer DuckDuckGo)
- [ ] MinerU/Docling dans docker-compose (remplacer pdf-parse)
- [ ] Spike BGE-M3 embeddings (upgrade nomic-embed-text)
- [ ] Déployer deep-audit.js sur kxkm-ai (cron quotidien)
- [ ] Créer utilisateur Discord **Pharmacius** (bot orchestrateur, bridge chat Discord ↔ KXKM)

### Phase D — Nouveaux node types

- [ ] `music_generation` node (ACE-Step 1.5, <4GB VRAM)
- [ ] `voice_clone` node (XTTS-v2, zero-shot 6s reference)
- [ ] `document_extraction` node (MinerU/Docling)

## P12 Lot 18 — Voice & MCP (futur)

- [ ] XTTS-v2 voice cloning par persona
- [ ] LLMRTC WebRTC streaming (TypeScript, VAD, barge-in)
- [ ] MCP SDK integration (personas = MCP servers)
- [ ] PCL + OpenCharacter pipeline fine-tune
- [ ] Chatterbox TTS evaluation

## P13 Lot 19 — Music & Creative (futur)

- [ ] ACE-Step 1.5 production
- [ ] `/compose` command (prompt → musique)
- [ ] Flux 2 dans ComfyUI
- [ ] A2A Protocol evaluation

## Lot 20 - Deep Analyse Continue & Execution Chainee `[en cours]`

A faire maintenant:
- [ ] Poursuivre extraction modulaire de `ws-chat.ts` (router, commandes, core).
- [ ] Decouper `app.ts` en routes + middleware sans regression.
- [ ] Ajouter instrumentation perf API/WS (latence/debit/memoire).
- [ ] Integrer SearXNG + Docling et valider le pipeline.

Fait sur ce lot:
- [x] Extraction modulaire du bloc upload/analyse de `ws-chat.ts` (`ws-upload-handler.ts`).
- [x] Refonte UI Minitel depuis la racine du site (`public/index.html`, `public/styles.css`, `public/app.js`).
- [x] Deep audit execute et relance apres correctifs.
- [x] Corrections context-store appliquees et validees.
- [x] check:v2 et test:v2 au vert.
- [x] Correctif anti-decrement TTS negatif (`ttsActive`).
- [x] Cleanup opportuniste des sessions expirees (mode memory).
- [x] Purge des logs vides/obsoletes `ops/v2/logs`.
- [x] Script `ops/v2/run-deep-cycle.sh` ajoute et execute.
- [x] Tests `apps/api/src/context-store.test.ts` ajoutes et valides.
- [x] Scoring de dette technique integre dans `ops/v2/deep-audit.js`.
- [x] Verification JSON dette: score 78/100 (niveau high).

## Phase Session 2026-03-19/20 — Lots 24-94

### Summary

71 lots completed (lot-24 through lot-94). Major achievements:

- [x] **Structured logging**: pino JSON logs, 43 console.log replaced, 0 remaining
- [x] **WS protocol hardening**: Promise chain per-connection, seq numbers, FIFO ordering, 6 integration tests
- [x] **Frontend perf**: 17 lazy routes (-53% initial JS), React.memo + useCallback stabilization
- [x] **CRT effect**: CSS-only (scanlines, vignette, phosphor glow, boot animation 0.8s)
- [x] **Systemd services**: kxkm-tts + kxkm-lightrag, auto-restart, deploy.sh migrated from tmux
- [x] **Tool-calling**: llama3.1:8b-instruct for Sherlock, benchmark 3 models
- [x] **Qwen3-TTS**: 0.6B deployed :9300, 9 speakers, on-demand VRAM
- [x] **Docling + Reranker**: PDF parsing :9400, BGE reranker :9500
- [x] **19 chat commands**: /help /nick /who /personas /web /clear /status /model /persona /reload /export /compose /imagine /voice /memory /context /rag /stats /uptime
- [x] **Markdown rendering**: marked + DOMPurify in chat
- [x] **Smart routing**: 5 topic domains (music, philosophy, tech, arts, science)
- [x] **Dynamic context**: 4k-32k adaptive window
- [x] **Perf instrumentation**: 6 labels, p50/p95/p99 endpoint
- [x] **Error telemetry**: 16 error labels, structured error logging
- [x] **Zod validation**: 19 schemas on all API routes
- [x] **MIME magic bytes**: file-type validation, SAFE_MIMES allowlist
- [x] **WS reconnect**: exponential backoff 1s-30s, seq gap detection
- [x] **CRT boot animation**: modem dial, phosphor warmup, scanline reveal
- [x] **Chat virtualization**: react-window, variable row heights
- [x] **425 tests, 0 failures** across all packages
- [x] **12 services** in production docker-compose
- [x] **MCP server**: 4 tools, stdio transport
- [x] **Discord bridge**: text + voice bot
- [x] **Timing-safe token**: crypto.timingSafeEqual for admin auth
- [x] **Audio size limit**: 50MB enforced
- [x] **Architecture docs**: 4 Mermaid diagrams
- [x] **Health check**: bash TUI, 19 service checks

### Future work (lots 95-100)

- [ ] **P1** lot-95: E2E Playwright tests (login, chat, upload, admin)
- [ ] **P2** lot-96: Persona DPO automation pipeline (feedback → pairs → training)
- [ ] **P2** lot-97: Multi-channel support (create/join channels)
- [ ] **P3** lot-98: File sharing between users (upload → gallery)
- [ ] **P2** lot-99: Mobile responsive deep pass (touch, bottom nav, viewport)
- [ ] **P3** lot-100: Public demo mode (read-only guest access)

## P14 Lot 24 — Deep Analyse 3 + Reactivity `[done]`

### Phase A — Fixes live session 2026-03-19

- [x] Cookie Secure retire (COOKIE_SECURE env, HTTP fonctionne)
- [x] ADMIN_TOKEN=kxkm dans docker-compose + AdminPage champ password
- [x] MediaExplorer fix reponse API ({ok,data} wrapper)
- [x] Historique 20 derniers messages a la connexion WS [HH:MM]
- [x] Streaming chunks temps reel (type "chunk", curseur clignotant)
- [x] Personas paralleles (Promise.all)
- [x] SearXNG JSON active + auto web_search (Sherlock)
- [x] pickResponders detecte mots-cles web → Sherlock
- [x] Timestamps HH:MM sur tous messages
- [x] TTS retire du chat
- [x] Delai inter-persona 2s → 500ms, timeout Ollama 5min → 2min
- [x] /compose progress ticker (feedback 5s, elapsed time, timeout handler)
- [x] /imagine progress ticker (feedback 5s)
- [x] Admin endpoints verifies OK (overview 5ms, personas 33, analytics 326 msgs)
- [x] /compose duration parsing (5-120s, plus hardcode 30s)
- [x] tts-server.py JSON parsing securise (try-catch)
- [x] Audio size limit 50MB (Python + Node)

### Phase B — Analyse approfondie

- [x] Analyse code complete: 33 personas, 8 services, 15+ node types, 135+ tests
- [x] 10 findings prioritaires identifies (P0 securite → P3 docs)
- [ ] Veille OSS web: projets similaires, libs integrables
- [ ] Audit docs/plans existants: coherence et lacunes
- [ ] Fix 6 tests en echec (rate limiting 429, EACCES, TTS)

### Phase C — Livrables

- [x] PLAN.md mis a jour (lots 21-29, statuts corriges)
- [x] TODO.md mis a jour (P14)
- [x] Memoire projet mise a jour
- [ ] ARCHITECTURE.md diagrammes Mermaid actualises
- [ ] README.md conforme au manifeste
- [ ] Script diagnostic TUI (health check complet)
- [ ] docs/OSS_VEILLE_2026-03-19.md (veille enrichie)

### Phase D — Prochaines priorites

- [ ] **P1** lot-25: Structured logging (pino, 39 console.log DEBUG → logger)
- [ ] **P2** lot-26: Tests integration (mocks HTTP, load test concurrence)
- [ ] **P2** lot-28: RAG configurable (chunk size, similarity, model env vars)
- [ ] **P2** lot-29: Systemd units (LightRAG + TTS, retirer tmux)
- [ ] **P3** lot-27: Effets CRT WebGL (MinitelFrame)