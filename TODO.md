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
- [x] Tab completion chat V2 — fuzzy matching 108+ commands + @mentions
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
- [x] Documentation utilisateur — UserGuide.tsx (8 sections accordion, lot 472)
- [x] Performance profiling — deep analysis API (21 findings) + frontend (15 findings), 9 fixes applied

## P11 Lot 17 — Deep Audit & Refactoring

### Phase A — Analyse & documentation

- [x] Script TUI deep-audit.js (security, perf, complexity, deps) — `ops/v2/deep-audit.js`
- [x] Veille OSS enrichie 2026-03-17 (10 nouvelles catégories) — `docs/OSS_WATCH_2026-03-16.md`
- [x] Diagrammes Mermaid (Context Store, Docker, Inter-persona) — `docs/ARCHITECTURE.md`
- [x] AGENTS.md refondu (matrice 10 agents, Mermaid routing, pipeline) — `docs/AGENTS.md`
- [x] PLAN.md consolidé avec lots 17-19
- [x] TODO.md consolidé avec backlog Phase 6+
- [x] Deep analyse — API 21 findings + frontend 15 findings, 9 fixes applied

### Phase B — Refactoring code

- [x] **P1** ws-chat.ts: extraction modules (523 LOC core + 5 modules extracted)
  - [x] `ws-upload-handler.ts` (241 LOC)
  - [x] `ws-conversation-router.ts` (583 LOC)
  - [x] `ws-commands-chat.ts` (885 LOC)
  - [x] `ws-commands-generate.ts` (1841 LOC)
  - [x] `ws-commands-info.ts` (876 LOC)
- [x] **P1** app.ts: extraction — server.ts 300 LOC + app.ts 131 LOC (already modular)
  - [ ] Extraire `routes/personas.ts`
  - [ ] Extraire `routes/node-engine.ts`
  - [ ] Extraire `routes/chat.ts`
  - [ ] Extraire `middleware/auth.ts`
- [x] **P2** writeFileSync — composition-store async (lot 461)
- [x] **P2** console.log — all migrated to pino structured logging
- [x] **P2** React.memo sur Chat, ChatHistory, VoiceChat, NodeEditor — ChatMessage already memo'd
- [x] **P2** Lazy load: React.lazy + Suspense pour routes lourdes — 17 lazy routes + WaveformPlayer

### Phase C — Infrastructure

- [x] SearXNG dans docker-compose — kxkm_clown-searxng-1 :8080 (healthy)
- [x] MinerU/Docling dans docker-compose — kxkm_clown-docling-1 :9400 (healthy)
- [x] Spike BGE-M3 embeddings — default changed to bge-m3 (lot 471)
- [x] Déployer deep-audit.js sur kxkm-ai — cron 3am daily (lot 469)
- [x] Créer utilisateur Discord **Pharmacius** — kxkm_clown-discord-bot-1 (up 4 days)

### Phase D — Nouveaux node types

- [x] `music_generation` node (ACE-Step 1.5 + AI Bridge 17 backends)
- [x] `voice_clone` — XTTS-v2 via AI Bridge /generate/voice-clone (lot 504)
- [x] `document_extraction` node (Docling :9400)

## P12 Lot 18 — Voice & MCP (futur)

- [ ] XTTS-v2 voice cloning par persona
- [ ] LLMRTC WebRTC streaming (TypeScript, VAD, barge-in)
- [x] MCP SDK integration — 6 MCP tools (chat, personas, search, status, music_generate, ai_bridge_health)
- [ ] PCL + OpenCharacter pipeline fine-tune
- [x] Chatterbox TTS evaluation — deployed as fallback TTS, remote backend on :9100

## P13 Lot 19 — Music & Creative (futur)

- [x] ACE-Step 1.5 production — AI Bridge /generate/music-ai + openDIAW.be AceStep instrument
- [x] `/compose` command (prompt → musique) — lots 320+, full composition pipeline
- [ ] Flux 2 dans ComfyUI (blocked — needs 12GB checkpoint download)
- [x] A2A Protocol — Agent Card + JSON-RPC /a2a endpoint (lot 502)

## Lot 20 - Deep Analyse Continue & Execution Chainee `[en cours]`

A faire maintenant:
- [x] Poursuivre extraction modulaire — ws-chat 523 LOC + 5 modules
- [x] Decouper app.ts — already 300+131 LOC modular
- [x] Instrumentation perf — Prometheus /metrics + ws_message latency (lot 501)
- [x] SearXNG :8080 + Docling :9400 (Docker compose, healthy)

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

- [x] **P1** E2E Playwright — 14 tests instruments + commands + DAW (lot 401)
- [x] **P2** Persona DPO — scripts/dpo-pipeline.js (lot 510)
- [x] **P2** lot-97: Multi-channel support (/join, /channels, channel selector UI)
- [x] **P3** lot-98: File sharing — POST/GET/DELETE /api/v2/media/shared (lot 536)
- [x] **P2** Mobile responsive — safe-area-inset, 44px tap targets, 380px/landscape
- [x] **P3** lot-100: Public demo mode — guest_N auto-nick, read-only until /nick

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
- [x] Veille OSS — reference_oss_audio_2026.md + reference_mcp_agents_2026.md
- [x] Audit docs — TODO.md 244 done, FEATURE_MAP + ARCHITECTURE updated
- [x] Fix tests — 265 pass, 0 fail (lot 506)

### Phase C — Livrables

- [x] PLAN.md mis a jour (lots 21-29, statuts corriges)
- [x] TODO.md mis a jour (P14)
- [x] Memoire projet mise a jour
- [x] ARCHITECTURE.md — DAW/AI Bridge subgraph added (lot 507)
- [x] README.md — 17+ services, 112+ cmds, openDIAW.be, MCP, A2A (lot 507)
- [x] Script diagnostic TUI — scripts/health-check.sh (19 checks)
- [x] docs/OSS — 25+ projets documentes (Chatterbox, Stable Audio, RAVE, etc.)

### Phase D — Prochaines priorites

- [x] **P1** Structured logging — pino, all console.log migrated
- [x] **P2** Tests integration — integration.test.ts (7 tests, perf/a2a/mcp/rag)
- [x] **P2** lot-28: RAG configurable — 4 env vars (CHUNK_SIZE, MIN_SIMILARITY, MAX_RESULTS, EMBEDDING_MODEL)
- [x] **P2** lot-29: Systemd units — 12 user units on kxkm-ai
- [x] **P3** lot-27: CRT effects — CSS barrel distortion + vignette + phosphor glow (lot 538)

## Phase Session 2026-03-20 (lots 128-143)
- [x] /changelog, /version commands
- [x] /dice, /roll, /flip fun commands
- [x] /ban, /unban moderation
- [x] /mute, /unmute per-client persona filter
- [x] @mention notification + @persona tab-complete
- [x] Idle auto-disconnect (30min warn, 35min kick)
- [x] Streaming think:false fix
- [x] /whisper private persona, /w alias
- [x] Code block rendering (triple backtick)
- [x] /history, /search, /react commands
- [x] /invite persona, /time, /session commands
- [x] Connection quality indicator (reconnect status)
- [x] IP connection limit (max 5/IP)
- [x] Ollama model fallback (qwen3:4b)
- [x] Persona cooldown (3s inter-persona)
- [x] qwen3.5:9b migration (256K ctx, adaptive thinking)
- [x] ComfyUI local :8189
- [x] Auto-detect image/music generation in natural language

## Lot 424-427 — Deep Analysis Fixes (session 2026-03-21)

- [x] Persona memory cache (30s TTL, LRU 50 entries) — ws-conversation-router.ts
- [x] RAG reranker circuit breaker (2s timeout, skip after 2 consecutive fails for 60s)
- [x] Silent catch → logger.warn on channel state save
- [x] Upload binary detection (null bytes in first 512 bytes)
- [x] JSON streaming chunk size guard (100KB max)
- [x] Mention regex depth limit (10 max per message)
- [x] Mascarade circuit breaker exponential backoff (5s/15s/60s)
- [x] Accessibility: aria-labels on vote/reaction/copy/pin buttons
- [x] Accessibility: role="listbox" + role="option" on autocomplete dropdowns
- [x] VoiceChat audio queue cap (10 max, prevents memory leak)
- [x] Reconnect countdown UX ("dans Xs, tentative N/20")
- [x] Wavesurfer.js waveform player in chat audio messages
- [x] Tab completion V2 (fuzzy match 108+ commands + @mentions)
- [x] Mobile responsive deep pass (touch targets 44px, 360px breakpoint)
- [x] E2E Playwright tests (commands + DAW)
- [x] Feature map + Architecture Mermaid updated with DAW/AI Bridge
- [x] TTS sentence-boundary chunking + cleanForTTS
- [x] /translate /tr /collab /persona-create /radio /summarize /mood commands
- [x] openDIAW.be: 9 instruments (Drone/Grain/Glitch/Circus/Honk/Magenta/AceStep/KokoroTTS/Piper)
- [x] AI Bridge: 5 new ffmpeg instrument endpoints
- [x] DawAIPanel: Kokoro TTS + Instruments AI sections

## Backlog (from analysis)

- [x] Chat virtualization — 500-msg cap + React.memo (adequate)
- [x] Route prefetch — requestIdleCallback for Compose/Imagine/DAW/Gallery
- [x] WS batching — React built-in batching + processingChain serialization
- [x] Form labels htmlFor — PersonaList (lot 465)
- [x] Admin health — error details + AI Bridge card (lot 463)
- [x] AI suggestion ranking — startsWith priority in command completion
- [x] Media search — text filter on title/source/type in MediaGallery (lot 539)
- [x] Maps LRU — userStats 1000->500, channelSeq 30min cleanup
- [x] Context store — parallel Promise.all for summary + entries
- [x] ws-chat.ts extraction — 523 LOC + 5 modules (4980 LOC total)
- [x] Chatterbox TTS — already primary backend (chatterbox-remote)
- [x] Transformers.js — BrowserSTT whisper-tiny ONNX (lot 432)
- [x] Sound design endpoint — /generate/sound-design (lot 433)
- [x] Claude Agent SDK — scripts/claude-agent.js (5 tools, interactive mode, lot 533)
- [ ] IndexTTS-2 emotion control (theater-grade expressiveness)
- [ ] RAVE real-time audio style transfer (IRCAM)

## Session 2026-03-24 — Lots 534-540+

### Fait

- [x] **Lot 531** — Context parallel load, command ranking, mobile CSS, route prefetch
- [x] **Lot 532** — mascarade SSE streaming + thinking field extraction
- [x] **Lot 533** — Grafana + Prometheus monitoring stack, enriched metrics
- [x] **Lot 534** — /deepresearch multi-step search agent (OpenSeeker-inspired)
- [x] **Lot 535** — mascarade thinking field fix (Python + Node.js double safety net)

- [x] **Lot 536** — Grafana dashboard 16 panels + Prometheus multi-machine
- [x] **Lot 537** — Cloudflare Tunnel kxkm-ai (remplace lots 538-540)

### URLs live

- `https://kxkm.saillant.cc` — 3615 J'ai pété (kxkm-ai GPU)
- `https://kxkm-api.saillant.cc` — API directe
- `https://kxkm-mascarade.saillant.cc` — mascarade LLM orchestrator
- `https://kxkm-comfy.saillant.cc` — ComfyUI (image gen)
- `https://kxkm-tower.saillant.cc` — instance tower (hub)
- `https://kxkm-grafana.saillant.cc` — Grafana dashboards
- `https://mascarade.saillant.cc` — mascarade tower (Authentik SSO)

## Execution Queue 2026-03-24 (P0/P1)

### Sprint court (ordre strict)
- [ ] lot-541: Corriger regex extraction prompt auto image/musique dans apps/api/src/ws-conversation-router.ts
- [ ] lot-541: Ajouter tests non-regression pour detectGenerationIntent (cas FR/EN, prompts courts/longs)
- [ ] lot-542: Remplacer appels ffmpeg synchrones critiques par flux asynchrone dans apps/api/src/ws-commands-generate.ts
- [ ] lot-542: Ajouter test de non blocage WS pendant mix/export (smoke/integration)
- [ ] lot-543: Centraliser execution worker sur worker-runtime.ts et simplifier index.ts
- [ ] lot-543: Etendre tests worker runtime pour garantir parite fonctionnelle
- [ ] lot-544: Memoizer calculs derives couteux dans apps/web/src/components/Chat.tsx (compteur mots/highlights)
- [ ] lot-544: Valider absence de regression UX chat (scroll, search, voicechat, typing)

### Definition of Done (globale)
- [ ] npm run -w @kxkm/api test
- [ ] npm run -w @kxkm/worker test
- [ ] npm run -w @kxkm/web test
- [ ] npm run -w @kxkm/web build
- [ ] smoke WS compose/mix sans freeze perceptible

### Notes execution
- Prioriser lot-541 avant toute autre tache (P0).
- Fusionner par commit atomique (1 lot = 1 commit).
- En cas d echec test, corriger dans le meme lot avant de passer au suivant.
- Mettre a jour PLAN.md et TODO.md apres chaque lot termine (trace continue).