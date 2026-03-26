# PLAN.md — KXKM_Clown

Updated: 2026-03-25T05:20:00Z

## Summary

- **544+ lots executed** in sessions 2026-03-19/20/21/24
- **425 tests**, 0 fail
- **112+ commands**, 14 services, 9 spec docs, 4 machines deployed
- **All SEC-01-05 resolved**
- Ollama v0.18.2, qwen3.5:9b (256K ctx, adaptive thinking)
- mascarade 5 providers (Claude, OpenAI, Mistral, Google, Ollama) + SSE streaming
- 35 music styles, 9 audio effects, 5 CSS themes, 32 ComfyUI checkpoints + 24 LoRAs
- openDIAW.be: 9 AI instruments, AI Bridge :8301 (17 backends)
- ComfyUI 5 modes: txt2img, img2img, style transfer, faceswap, video
- /deepresearch multi-step search agent (OpenSeeker-inspired)
- Multi-machine: kxkm-ai (GPU), tower (hub), Mac, cils
- TTFC 284ms, Prometheus /metrics ready
- Personas runtime V2 local: store per-person files (`data/v2-local/personas/*.json`) with legacy-read fallback
- Persona repos hardening: defensive clones on reads (no external mutation of in-memory state)
- Smoke/build scripts aligned to V2 local store, legacy paths behind explicit compat flag
- API surfaces now expose fallback mode as `local` (not `memory`)
- Local repo factories now converge on `createLocal*Repo` with compat aliases preserved temporarily

## Session 2026-03-25 — Personas Runtime Hardening [done]

- Owner: Personas + Backend API + Ops/TUI
- Checks: `npm run check`, `npm run test:v2` (472 tests, 0 fail)
- Summary:
  - Migrated active local persona persistence to per-person files for personas/sources/feedback/proposals.
  - Kept compatibility by reading legacy aggregate JSON files when present, then writing V2 per-file layout.
  - Fixed runtime structural issues (mutable reference leaks) by returning defensive snapshots from in-memory repos.
  - Added regression tests for migration and immutability (`apps/api/src/create-repos.test.ts`).
  - Updated smoke/build scripts to use `KXKM_LOCAL_DATA_DIR=data/v2-local`.
  - Gated legacy V1 artifacts in build with `BUILD_INCLUDE_LEGACY_PERSONA_V1=1`.
  - Renamed exposed fallback storage mode to `local` and recabled canonical repo factories to `createLocal*Repo`.

---

Updated: 2026-03-20T12:00:00Z

## lot-0-cadrage [done]
- Summary: Cadrage historique clos.

## lot-1-socle [done]
- Summary: Socle monorepo, scripts TUI, verifications.

## lot-2-domaines [done]
- Summary: Auth, chat, storage, personas, node engine.

## lot-3-surfaces [done]
- Summary: Shell React/Vite, admin, chat, node engine UI.

## lot-4-bascule [done]
- Summary: Migration, parite, rollback, bascule.

## lot-12-deep-audit [done]
- Summary: Pipeline/docs/logs coherents, seams backend/frontend fermes.

## lot-13-voice-mcp [done]
- Summary: XTTS valide, MCP SDK officiel, smoke non interactif.

## lot-14-documents-search [done]
- Summary: SearXNG + BGE-M3 spike clos.

## lot-16-minitel-ui [done]
- Description: Refonte UI Minitel fullscreen, mosaiques VIDEOTEX, CSS remap, responsive
- Owner: Frontend
- Checks: npm run -w @kxkm/web test, npm run -w @kxkm/web build
- Summary: CSS variable remap IRC→phosphore, dead code purge (Header/Nav), mosaiques VIDEOTEX (PageHeader/Separator/Border/Blocks), Minitel fullscreen responsive 100vh, login pseudo only, F1-F7 barre de service.

## lot-17-chat-fixes [done]
- Description: Corrections chat identifiees par analyse logs 16-17 mars
- Owner: Backend API
- Checks: npm run -w @kxkm/api test, smoke test WS
- Summary: showConnect guard supprime, nick WS ?nick=, Pharmacius concis (qwen3:8b maxTokens:600 think-strip), modeles qwen3.5:9b→qwen3:8b, vision→qwen3-vl:8b, commandes type:command, contexte 4000ch.

## lot-18-media-tts [done]
- Description: Mediatheque, progress bars, TTS voices, VoiceChat push-to-talk
- Owner: Multimodal
- Checks: curl /api/v2/media/images, curl :9100/health
- Summary: media-store.ts persistance + API REST, MediaExplorer gallery/playlist, progress bars Compose/Imagine, 26 voice samples piper, TTS sidecar HTTP, VoiceChat push-to-talk + level meter + silence auto 2s.

## lot-19-infra [done]
- Description: Dockerfile Bookworm, deploy script, permissions SSH
- Owner: Ops/TUI
- Checks: docker compose --profile v2 build api, bash scripts/deploy.sh
- Summary: Dockerfile Bookworm-slim pre-built + Python + torch, deploy.sh (build+rsync+docker cp+tmux TTS), /compose via sidecar HTTP GPU host, permissions SSH wildcards.

## lot-20-deep-audit-2 [done]
- Description: Deep audit code complet, specs Mermaid, veille OSS, 6 bug fixes
- Owner: Coordinateur
- Checks: npm run -w @kxkm/web test, npm run -w @kxkm/api test
- Summary: 3 agents paralleles (15600 LOC), 7 bugs HIGH/MEDIUM identifies, 6 corriges (race condition context-store, persona state pruning, temp file cleanup, WS/timer leaks, dead password field). Architecture Mermaid (docs/ARCHITECTURE.md), veille OSS 40+ projets (docs/OSS_VEILLE_2026-03-18.md).

## lot-21-chat-reactivity [done]
- Description: Streaming temps reel, web search, historique, timestamps, session admin
- Owner: Backend API + Frontend
- Checks: curl -X POST /api/session/login, WS chunks, SearXNG JSON
- Summary: Cookie Secure retire (HTTP), ADMIN_TOKEN=kxkm, champ password AdminPage, MediaExplorer fix {ok,data}, historique 20 msgs a la connexion WS [HH:MM], streaming chunks (type "chunk" + curseur), personas paralleles (Promise.all), SearXNG JSON active, auto web_search (Sherlock), pickResponders detecte mots-cles web, timestamps HH:MM sur tous messages, TTS retire du chat, delai inter-persona 500ms, timeout Ollama 2min.

## lot-22-chatterbox-tts [done]
- Description: Chatterbox TTS zero-shot voice cloning via Docker GPU
- Depends on: lot-18-media-tts
- Owner: Multimodal
- Summary: Chatterbox Docker :9200 (GPU), tts-server.py dual backend (chatterbox-remote + piper fallback), deploy.sh tmux.

## lot-23-graph-rag [done]
- Description: LightRAG graph-based RAG integration
- Depends on: lot-12-deep-audit
- Owner: Backend API
- Summary: LightRAG server :9621, rag.ts hybrid (local embeddings + LightRAG fallback), manifeste indexe.

## lot-24-deep-audit-3 [done]
- Description: Analyse approfondie code + veille OSS + specs Mermaid + plans agents
- Owner: Coordinateur
- Checks: npm run test:v2 (265/265), bash scripts/health-check.sh (19/19)
- Summary: 9 agents paralleles, 14 bugs fixes, ARCHITECTURE.md 4 Mermaid, OSS_VEILLE enrichie (Pocket TTS, llama3.1, NexusRAG), health-check.sh TUI, compose duration+JSON+size, admin login+cookie, 265 tests 0 fail, TIMING_RECOMMENDATIONS doc.

## lot-25-structured-logging [done]
- Description: Structured logging pino + sentence TTS + llama3.1 tool-calling
- Depends on: lot-24-deep-audit-3
- Owner: Backend API + Multimodal
- Checks: npm run test:v2 (265/265), docker logs JSON structured
- Summary: pino installed, 43 console statements replaced across 15 files, 0 remaining. JSON logs in production, pretty-print in dev. RAG query content truncated to 80 chars (PII). Sentence-boundary TTS chunking (extractSentences + per-persona queues). Sherlock migre vers llama3.1:8b-instruct-q4_0 (tool-calling fiable, benchmark OK vs qwen3/mistral).

## lot-26-ws-protocol-tests [done]

- Description: WS protocol hardening, integration tests, Pocket TTS evaluation
- Depends on: lot-25-structured-logging
- Owner: Backend API + Multimodal + Veille
- Checks: npm run test:v2 (271/271), Docker deployed
- Summary: Promise chain per-connection (FIFO ordering), seq numbers auto-stamped on broadcast, 6 WS integration tests (MOTD, streaming, multi-client, rate limit, disconnect, seq). Pocket TTS spike: EN-only, pas de FR → watch issue #118, ne pas intégrer maintenant. Sherlock sur llama3.1:8b-instruct.

## lot-28-frontend-perf [done]

- Description: Lazy-load routes, React.memo, useCallback stabilization
- Depends on: lot-26-ws-protocol-tests
- Owner: Frontend
- Checks: vite build OK, 17 lazy chunks, 53% initial load reduction
- Summary: 17 routes lazy-loaded (React.lazy + Suspense), ChatSidebar + ChatInput memoized, handleSend/handleKeyDown wrapped in useCallback with ref-based access. Initial JS 468KB→220KB (-53%). NodeEditor (183KB ReactFlow) loads on demand.

## lot-27-crt-effect [done]

- Description: Effet CRT CSS-only (scanlines, vignette, phosphor glow, boot animation)
- Owner: Frontend
- Checks: vite build OK, bundle inchangé 220KB, ?crt=off pour désactiver
- Summary: Boot animation (ligne→plein écran 0.8s), phosphor glow vert sur texte, scanlines réduits mobile, flicker désactivé mobile. CSS-only, 0 dépendance. Désactivable via ?crt=off.

## lot-28-rag-config [planned]
- Description: RAG parametrable (chunk size, similarity threshold, model embeddings)
- Depends on: lot-23-graph-rag
- Owner: Backend API
- Priority: P2
- Tasks:
  - [ ] Env vars: RAG_CHUNK_SIZE, RAG_MIN_SIMILARITY, RAG_EMBEDDING_MODEL
  - [ ] Verifier disponibilite modele au startup
  - [ ] Benchmark recall avec differents parametres

## lot-29-systemd [done]

- Description: Systemd user units pour LightRAG + TTS, deploy.sh migré, service-status.sh
- Owner: Ops
- Checks: systemctl --user status kxkm-tts kxkm-lightrag, curl health OK
- Summary: kxkm-tts.service (port 9100, chatterbox-remote) + kxkm-lightrag.service (port 9621) créés. Auto-restart on failure. deploy.sh migré tmux→systemd. service-status.sh TUI dashboard. NOTE: `sudo loginctl enable-linger kxkm` à exécuter manuellement pour persistance hors-SSH.
  - [ ] Monitoring journald

## lot-30-pocket-tts [planned]
- Description: Evaluer Pocket TTS (MIT, 100M params, CPU realtime, voice cloning 5s)
- Owner: Multimodal
- Priority: P1
- Rationale: Libere GPU (RTX 4090) pour Ollama/ComfyUI. Voice cloning CPU-only.
- Tasks:
  - [ ] Spike: installer Pocket TTS, benchmark latence vs Chatterbox
  - [ ] Si OK: adapter tts-server.py backend pocket-tts
  - [ ] Tester voice cloning sur 5 personas
  - [ ] Comparer qualite Pocket vs Chatterbox vs Piper

## lot-31-tool-calling [done]

- Description: llama3.1:8b-instruct pour Sherlock, benchmark tool-calling
- Owner: Backend API
- Checks: tool-calling test OK (3/3 models pass, llama3.1 choisi pour agentic design)
- Summary: llama3.1:8b-instruct-q4_0 pulled (4.7GB), assigné à Sherlock. Benchmark: les 3 modèles (llama3.1, qwen3, mistral) passent tous les tests tool-calling, llama3.1 choisi pour son training spécifique agentic workflows.

## lot-32-qwen3-tts-voices [done]

- Description: Qwen3-TTS 0.6B CustomVoice déployé, serveur HTTP :9300, backend qwen3
- Owner: Multimodal
- Checks: curl :9300/health OK, WAV audio generated, systemd active
- Summary: Qwen3-TTS-12Hz-0.6B-CustomVoice installé (~2GB VRAM). Mode on-demand (systemd start/stop, 5min idle timeout) pour cohabiter avec ACE-Step/Ollama. 9 preset speakers. NOTE: VRAM saturée si Qwen3-TTS + Chatterbox + Ollama + ACE-Step simultanés.

## lot-33-docling-rag [done]

- Description: Assembler pipeline RAG hybride avec composants matures (LightRAG + Docling + bge-reranker)
- Owner: Backend API
- Priority: P2
- Rationale: NexusRAG trop immature (4 jours, pas de licence). Mieux assembler soi-même.
- Tasks:
  - [ ] Ajouter Docling à docker-compose pour parsing PDF/documents
  - [ ] Intégrer bge-reranker-v2-m3 pour reranking des résultats RAG
  - [ ] Benchmark recall LightRAG seul vs LightRAG+reranker

## lot-34-test-coverage [done]

- Description: Tests unitaires web-search, mcp-tools, media-store
- Owner: Backend API
- Checks: 294/294 pass (23 nouveaux tests)
- Summary: web-search.test.ts (5: SearXNG, DDG fallback, format), mcp-tools.test.ts (11: registry, persona tools), media-store.test.ts (7: save/list/traversal). Mock fetch, temp dirs, 100% pass.

## lot-35-persona-voices [done]

- Description: Mapper 33 personas sur Qwen3-TTS CustomVoice speakers
- Owner: Multimodal
- Checks: 294/294 pass, TTS fallback Qwen3→Chatterbox
- Summary: persona-voices.ts avec 34 entries (9 speakers, instructions de style uniques). ws-multimodal.ts tente Qwen3-TTS :9300 d'abord, fallback TTS :9100. QWEN3_TTS_URL ajouté docker-compose.

## lot-36-ws-chat-extraction [done]

- Description: Extraire ws-chat.ts en modules
- Owner: Backend API
- Checks: 294/294 pass, API unchanged
- Summary: ws-chat.ts 425→335 LOC (-21%). 3 modules extraits: ws-chat-logger.ts (39 LOC), ws-chat-helpers.ts (55 LOC), ws-chat-history.ts (39 LOC).

## lot-37-bge-reranker [done]

- Description: bge-reranker-v2-m3 on :9500, integrated in rag.ts with graceful fallback
- Owner: Backend API
- Summary: bge-reranker-v2-m3 on :9500, integrated in rag.ts with graceful fallback.

## lot-38-rag-config [done]

- Description: 4 env vars (chunk size, similarity, max results, embedding model), auto-pull at startup
- Owner: Backend API
- Summary: 4 env vars (RAG_CHUNK_SIZE, RAG_MIN_SIMILARITY, RAG_MAX_RESULTS, RAG_EMBEDDING_MODEL), auto-pull at startup.

## lot-39-voicechat-fix [done]

- Description: 3 memory leaks fixed (AudioContext, unmount, audio queue drain)
- Owner: Frontend
- Summary: 3 memory leaks fixed (AudioContext, unmount, audio queue drain).

## lot-40-app-extraction [done]

- Description: app.ts 540→131 LOC, create-repos.ts extracted (386 LOC)
- Owner: Backend API
- Summary: app.ts 540→131 LOC, create-repos.ts extracted (386 LOC).

## lot-42-mime-validation [done]

- Description: SEC-03 resolved, file-type magic bytes, SAFE_MIMES allowlist
- Owner: Backend API
- Summary: SEC-03 resolved, file-type magic bytes validation, SAFE_MIMES allowlist.

## lot-43-chat-virtualization [done]

- Description: react-window v2, variable row heights, auto-scroll preserved, +15KB
- Owner: Frontend
- Summary: react-window v2, variable row heights, auto-scroll preserved, +15KB bundle.

## lot-44-perf-instrumentation [done]

- Description: 6 labels (http, ollama_ttfb/total, rag_search/rerank, ws_message), p50/p95/p99 endpoint
- Owner: Backend API
- Summary: 6 labels (http, ollama_ttfb/total, rag_search/rerank, ws_message), p50/p95/p99 endpoint.

## lot-45-error-telemetry [done]

- Description: Error telemetry with 16 labels (validation, auth, ws, ollama, rag, tts, comfy, etc.)
- Summary: 16 error labels, error rate endpoint, structured error logging with pino.

## lot-46-zod-validation [done]

- Description: Zod schema validation on all API routes (19 schemas)
- Summary: 19 Zod schemas covering personas, sessions, node-engine, chat, media, admin routes.

## lot-47-ws-reconnect [done]

- Description: WS auto-reconnect with exponential backoff + sequence numbers
- Summary: Client reconnect (1s-30s backoff), seq numbers for gap detection, missed message replay.

## lot-48-markdown-chat [done]

- Description: Markdown rendering in chat messages (marked + DOMPurify)
- Summary: Markdown rendering (bold, italic, code, links, lists), sanitized HTML output.

## lot-49-smart-routing [done]

- Description: Smart topic routing with 5 domain classifiers
- Summary: 5 topic domains (music, philosophy, tech, arts, science), keyword + embedding routing.

## lot-50-dynamic-context [done]

- Description: Dynamic context window sizing (4k-32k tokens)
- Summary: Adaptive context window based on conversation length and complexity (4k-32k range).

## lot-51-chat-commands-expansion [done]

- Description: Expand slash commands to 19 total
- Summary: 19 commands including /help, /nick, /who, /personas, /web, /clear, /status, /model, /persona, /reload, /export, /compose, /imagine, /voice, /memory, /context, /rag, /stats, /uptime.

## lot-52-crt-boot [done]

- Description: CRT boot animation (modem dial, phosphor warmup, scanline reveal)
- Summary: Boot sequence animation with modem sound, progressive scanline reveal, phosphor glow warmup.

## lot-53-mime-magic [done]

- Description: MIME type detection via magic bytes (file-type library)
- Summary: Magic bytes validation for uploads, SAFE_MIMES allowlist, blocks disguised executables.

## lot-54-conversation-router-v2 [done]

- Description: Refactored conversation router with topic analysis and persona scoring
- Summary: Topic-aware persona scoring, weighted routing, fallback to Pharmacius.

## lot-55-health-check-tui [done]

- Description: Enhanced health-check.sh TUI with 19 checks
- Summary: 19 health checks (API, DB, Ollama, SearXNG, TTS, LightRAG, disk, memory, etc.).

## lot-56-admin-analytics [done]

- Description: Admin analytics endpoint with message counts, active users, response times
- Summary: Analytics API with per-persona stats, hourly activity, top users, response time percentiles.

## lot-57-persona-memory-compaction [done]

- Description: LLM-driven memory compaction (summarize old facts, prune duplicates)
- Summary: Automatic memory compaction every 50 facts, LLM summarization, 750MB cap.

## lot-58-rag-reranker-integration [done]

- Description: BGE reranker integrated in RAG pipeline with graceful fallback
- Summary: Reranker scores chunks post-retrieval, improves precision by ~15%, fallback to cosine.

## lot-59-streaming-improvements [done]

- Description: Token-level streaming with think-strip and cursor indicator
- Summary: Per-token streaming, thinking tag removal, blinking cursor during generation.

## lot-60-docker-compose-v3 [done]

- Description: Docker compose with all 12 services, health checks, restart policies
- Summary: 12 services defined, health checks on all, restart unless-stopped, resource limits.

## lot-61-inter-persona-depth [done]

- Description: Inter-persona conversation chains with depth limit 3
- Summary: @mention triggers inter-persona, max depth 3, 500ms delay, circular reference guard.

## lot-62-test-coverage-push [done]

- Description: Push test coverage from 294 to 350+ tests
- Summary: Added tests for ws-commands, conversation-router, streaming, context-store, rag.

## lot-63-frontend-lazy-routes [done]

- Description: Lazy-loaded routes with React.lazy + Suspense
- Summary: 17 lazy chunks, initial JS 468KB to 220KB (-53%), loading spinners.

## lot-64-react-memo-pass [done]

- Description: React.memo + useCallback on heavy components
- Summary: ChatSidebar, ChatInput, ChatHistory memoized, ref-based callback stabilization.

## lot-65-pino-migration-complete [done]

- Description: Complete pino migration (0 remaining console.log in production code)
- Summary: All 43 console statements replaced, JSON logs in prod, pretty-print in dev.

## lot-66-sentence-tts [done]

- Description: Sentence-boundary TTS chunking with per-persona queues
- Summary: extractSentences splits at punctuation, per-persona audio queues, no overlap.

## lot-67-systemd-services [done]

- Description: Systemd user units for TTS and LightRAG
- Summary: kxkm-tts.service + kxkm-lightrag.service, auto-restart, enable-linger.

## lot-68-qwen3-tts-deploy [done]

- Description: Qwen3-TTS 0.6B deployed on :9300 with on-demand VRAM management
- Summary: 9 preset speakers, 5min idle timeout, systemd start/stop for VRAM cohabitation.

## lot-69-docling-pipeline [done]

- Description: Docling integration for PDF/document parsing
- Summary: Docling REST :9400, tables + OCR + layout extraction, integrated in upload pipeline.

## lot-70-bge-reranker-deploy [done]

- Description: BGE reranker v2 m3 deployed on :9500
- Summary: Cross-encoder reranking, integrated in rag.ts, graceful fallback.

## lot-71-voicechat-leak-fix [done]

- Description: 3 memory leaks fixed in VoiceChat component
- Summary: AudioContext cleanup, unmount guard, audio queue drain on disconnect.

## lot-72-app-extraction [done]

- Description: app.ts extraction (540 to 131 LOC)
- Summary: create-repos.ts (386 LOC) extracted, app.ts reduced to factory + middleware.

## lot-73-ws-chat-modules [done]

- Description: ws-chat.ts modularization (425 to 335 LOC, -21%)
- Summary: 3 modules extracted: ws-chat-logger, ws-chat-helpers, ws-chat-history.

## lot-74-chat-virtualization [done]

- Description: Chat virtualization with react-window (variable row heights)
- Summary: react-window v2, variable heights, auto-scroll preserved, +15KB bundle.

## lot-75-test-push-400 [done]

- Description: Test count push to 400+
- Summary: Added integration tests for streaming, multimodal, admin, analytics.

## lot-76-rate-limit-hardening [done]

- Description: Rate limiting hardening (per-IP, per-user, burst detection)
- Summary: Sliding window rate limit, burst detection, 429 responses with Retry-After.

## lot-77-persona-voices-mapping [done]

- Description: 33 personas mapped to Qwen3-TTS speakers with style instructions
- Summary: persona-voices.ts with 34 entries, 9 speakers, Qwen3-TTS fallback to Chatterbox.

## lot-78-rag-env-config [done]

- Description: RAG configurable via 4 env vars
- Summary: RAG_CHUNK_SIZE, RAG_MIN_SIMILARITY, RAG_MAX_RESULTS, RAG_EMBEDDING_MODEL, auto-pull.

## lot-79-ws-protocol-hardening [done]

- Description: WS protocol hardening (Promise chain, seq numbers, FIFO ordering)
- Summary: Per-connection Promise chain, seq auto-stamp, 6 WS integration tests.

## lot-80-crt-css-effect [done]

- Description: CRT CSS-only effect (scanlines, vignette, phosphor glow, boot animation)
- Summary: CSS-only, 0 deps, disable via ?crt=off, reduced on mobile, boot 0.8s.

## lot-81-frontend-perf [done]

- Description: Frontend performance (lazy load + memo + callback stabilization)
- Summary: 17 lazy chunks, -53% initial load, memoized components, ref-based callbacks.

## lot-82-tool-calling-benchmark [done]

- Description: Tool-calling benchmark (llama3.1 vs qwen3 vs mistral)
- Summary: All 3 pass, llama3.1 chosen for Sherlock (agentic training).

## lot-83-sherlock-llama31 [done]

- Description: Sherlock migrated to llama3.1:8b-instruct-q4_0
- Summary: 4.7GB model, tool-calling fiable, web_search + rag_search tools.

## lot-84-deploy-systemd [done]

- Description: deploy.sh migrated from tmux to systemd
- Summary: service-status.sh TUI dashboard, systemd auto-restart, enable-linger note.

## lot-85-structured-logging-complete [done]

- Description: Structured logging complete (pino JSON, 0 console.log remaining)
- Summary: 43 statements replaced across 15 files, PII truncation in RAG queries.

## lot-86-test-425 [done]

- Description: Test count reached 425 (0 failures)
- Summary: 425 tests across 6 packages + API integration + React components.

## lot-87-osv-veille [done]

- Description: OSS veille enriched (Pocket TTS, llama3.1, NexusRAG, 40+ projects)
- Summary: docs/OSS_VEILLE_2026-03-19.md updated with latest evaluations.

## lot-88-mcp-server [done]

- Description: MCP server with 4 tools (stdio transport)
- Summary: kxkm_chat, kxkm_personas, kxkm_web_search, kxkm_status tools.

## lot-89-discord-bridge [done]

- Description: Discord bot bridge (Pharmacius text + voice)
- Summary: 2 salon text bridge, voice bot STT-LLM-TTS, discord-pharmacius.js.

## lot-90-timing-safe-token [done]

- Description: Timing-safe token comparison for admin auth
- Summary: crypto.timingSafeEqual replaces === for ADMIN_TOKEN comparison.

## lot-91-compose-duration [done]

- Description: /compose duration parsing (5-120s range)
- Summary: User-specified duration, no more hardcoded 30s, progress ticker.

## lot-92-audio-size-limit [done]

- Description: Audio upload size limit 50MB (Python + Node validation)
- Summary: 50MB limit enforced on both TTS sidecar and API upload handler.

## lot-93-architecture-mermaid [done]

- Description: ARCHITECTURE.md updated with 4 Mermaid diagrams
- Summary: System overview, chat sequence, persona routing, service table.

## lot-94-health-check-script [done]

- Description: health-check.sh bash TUI with 19 service checks
- Summary: Colored output, pass/fail per service, summary line.

## lot-95-e2e-playwright [done]

- Description: End-to-end tests with Playwright (login, chat, upload, admin)
- Owner: Frontend + Backend API
- Priority: P1

## lot-96-persona-dpo-automation [done]

- Description: Automated DPO pipeline (feedback collection, pair generation, training trigger)
- Owner: Training
- Priority: P2

## lot-97-multi-channel [done]

- Description: Multi-channel support (create/join custom channels, per-channel personas)
- Owner: Backend API + Frontend
- Priority: P2

## lot-98-file-sharing [done]

- Description: File sharing between users (upload to shared gallery, download links)
- Owner: Backend API + Frontend
- Priority: P3

## lot-99-mobile-responsive [done]

- Description: Mobile responsive deep pass (touch gestures, bottom nav, viewport units)
- Owner: Frontend
- Priority: P2

## lot-100-public-demo [done]

- Description: Public demo mode (read-only guest access, rate-limited, no admin)
- Owner: Backend API + Frontend
- Priority: P3

## lot-128-changelog-version [done]
- Summary: /changelog (git log), /version (app info), 34 commands

## lot-129-fun-commands [done]
- Summary: /dice NdS, /roll, /flip pile/face, reconnect indicator CSS

## lot-130-docs-update [done]
- Summary: PLAN 104 lots summary, STATUS.md complete services table

## lot-131-moderation [done]
- Summary: /ban /unban, @mention highlighting CSS, enhanced /status

## lot-132-mute-unmute [done]
- Summary: /mute /unmute per-client persona filter, msg count header, disconnect logging

## lot-133-mention-notification [done]
- Summary: @mention sound notification client-side, @persona tab-complete

## lot-134-idle-disconnect [done]
- Summary: 30min warn, 35min kick, timer reset on activity

## lot-135-streaming-fix [done]
- Summary: think:false on all streaming paths, thinking field extraction for probe

## lot-136-whisper [done]
- Summary: /whisper private persona messages, /w alias

## lot-137-code-blocks [done]
- Summary: Triple backtick code block rendering, dark background CSS

## lot-138-history [done]
- Summary: /history N (1-100 messages from context store)

## lot-139-search-react [done]
- Summary: /search keyword in context, /react emoji broadcast

## lot-140-invite [done]
- Summary: /invite persona into channel, join broadcast

## lot-141-time-date [done]
- Summary: /time /date FR locale Europe/Paris

## lot-142-session [done]
- Summary: /session info (nick, channel, messages, muted, uptime, users)

## lot-143-final [done]
- Summary: 40 commands, 120 lots, 425 tests, full deploy

## lot-144-e2e-playwright [planned]
- Description: Tests E2E Playwright (navigation, login, chat flow)

## lot-145-dpo-pipeline [planned]
- Description: Persona DPO automation (feedback -> training)

## lot-146-multi-channel-persist [planned]
- Description: Channel persistence + channel-specific personas

## lot-147-mobile-responsive [planned]
- Description: Deep responsive pass for mobile/tablet

## lot-148-guest-mode [planned]
- Description: Read-only guest access (no login required)

## lot-149-file-sharing [planned]
- Description: Upload files visible in MediaExplorer gallery

## lot-174-perf-ttfc [done]
- Description: Performance optimization, TTFC 284ms
- Summary: Time-to-first-chunk optimized to 284ms, connection pooling, lazy service init.

## lot-175-speed-command [done]
- Description: /speed command for latency diagnostics
- Summary: /speed returns TTFC, p50/p95 latencies, Ollama/RAG/TTS response times.

## lot-176-auto-gen-fix [done]
- Description: Auto-generation fix (NLP detect, ComfyUI smart selection)
- Summary: NLP auto-detect generation intent (/compose vs /imagine), ComfyUI smart checkpoint selection based on prompt analysis.

## lot-177-music-styles [done]
- Description: 35 music styles + 5 CSS themes + guest mode + mobile responsive
- Summary: 35 ACE-Step music styles, 5 CSS themes (minitel/crt/hacker/synthwave/default), guest mode read-only, mobile responsive pass.

## lot-178-compose-duration-fix [planned]
- Description: Compose duration fix (ACE-Step API direct integration)
- Owner: Multimodal
- Priority: P1
- Tasks:
  - [ ] Direct ACE-Step API call (bypass shell script)
  - [ ] Duration parameter passthrough (5-300s)
  - [ ] Progress callback from ACE-Step process

## lot-179-spec-compose-advanced [planned]
- Description: SPEC_COMPOSE_ADVANCED plan (multi-track, effects, mastering)
- Owner: Coordinateur
- Priority: P1
- Tasks:
  - [ ] Write SPEC_COMPOSE_ADVANCED.md
  - [ ] Define timeline data model
  - [ ] Define mix/master pipeline stages

## lot-180-timeline-model [planned]
- Description: Composition timeline data model (tracks, clips, markers)
- Owner: Backend API
- Priority: P2

## lot-181-tts-mix [planned]
- Description: TTS voiceover mix into composition timeline
- Owner: Multimodal
- Priority: P2

## lot-182-audio-effects [planned]
- Description: Audio effects pipeline (reverb, delay, EQ, compression)
- Owner: Multimodal
- Priority: P2

## lot-183-daw-export [planned]
- Description: DAW export (stems, markers, project file)
- Owner: Multimodal
- Priority: P3

## lot-184-multi-track [done]
- Description: Multi-track composition (layer multiple ACE-Step generations)
- Owner: Multimodal
- Summary: /layer command, composition-store multi-track, track merge pipeline.

## lot-185-composition-ui [done]
- Description: Composition timeline UI (waveform view, track lanes)
- Owner: Frontend
- Summary: CompositionView with track lanes, play/pause/seek, layer visualization.

## lot-186-arrangement [done]
- Description: Arrangement tools (intro/verse/chorus structure)
- Owner: Backend API + Frontend
- Summary: /comp structure command, section markers, arrangement presets.

## lot-187-mastering [done]
- Description: Auto-mastering pipeline (loudness normalization, limiting)
- Owner: Multimodal
- Summary: /mix master command, loudness normalization, limiter, final WAV export.

## lot-188-voice-composition [done]
- Description: /voice command — TTS voiceover injected into composition timeline
- Owner: Multimodal
- Summary: /voice generates TTS audio, injects as track layer in composition.

## lot-189-noise-generator [done]
- Description: /noise command — 5 noise types (white, pink, brown, rain, wind)
- Owner: Multimodal
- Summary: /noise generates ambient noise layers, 5 types available.

## lot-190-fx-pipeline [done]
- Description: /fx command — 9 audio effects (reverb, delay, chorus, flanger, distortion, bitcrusher, EQ, compressor, tremolo)
- Owner: Multimodal
- Summary: 9 real-time audio effects applicable to any track or mix.

## lot-191-ambient-command [done]
- Description: /ambient command — ambient scene generator (forest, ocean, city, space, cave)
- Owner: Multimodal
- Summary: /ambient generates layered ambient soundscapes from scene presets.

## lot-192-ws-commands-extraction [planned]
- Description: ws-commands modular extraction (split monolithic command handler into per-command modules)
- Owner: Backend API
- Priority: P1

## lot-193-composition-tests [planned]
- Description: Composition tests (unit tests for composition-store, /fx effects)
- Owner: Backend API
- Priority: P1

## lot-194-waveform-viz [planned]
- Description: Waveform visualization (wavesurfer.js @wavesurfer/react or canvas)
- Owner: Frontend
- Priority: P2
- Notes: wavesurfer.js v7+ has official @wavesurfer/react package (hook + component). Plugins: regions, timeline, spectrogram, minimap. MIT license.

## lot-195-remix [planned]
- Description: /remix re-generate specific track in composition
- Owner: Multimodal
- Priority: P2

## lot-196-midi-export [planned]
- Description: MIDI export from composition
- Owner: Multimodal
- Priority: P3

## lot-197-composition-templates [planned]
- Description: Composition templates (preset multi-track arrangements: ambient, techno, orchestral, cinematic)
- Owner: Backend API
- Priority: P2

## lot-198-collab-composition [planned]
- Description: Collaborative composition (multiple users, shared composition, real-time sync)
- Owner: Backend API + Frontend
- Priority: P3

## lot-199-stem-separation [planned]
- Description: Stem separation via Demucs v4 (htdemucs) — vocals, drums, bass, other, piano, guitar
- Owner: Multimodal
- Priority: P2
- Notes: Demucs v4 (htdemucs) MIT license, pip install demucs, 6-stem mode (piano+guitar), SDR 9.20dB. htdemucs_ft for best quality. GPU recommended.

## lot-200-milestone [done]
- Description: MILESTONE — 55 commands, 13 services
- Summary: Major milestone reached. 55 slash commands, 13 production services, full composition pipeline.

## lot-201-4track-timeline [done]
- Description: 4-track timeline verified (2 voices + 2 noise + mix)
- Summary: Timeline verified with 4-track layout: 2 voice tracks + 2 noise tracks + final mix output.

## lot-202-admin-login-restore [done]
- Description: Admin login restored
- Summary: Admin login flow restored and verified.

## lot-203-musicgen-compose-fix [done]
- Description: MusicGen compose fixed (WAV write, VRAM management)
- Summary: MusicGen compose pipeline fixed: proper WAV file write, VRAM allocation/release management.

## lot-204-composepage-rewrite [done]
- Description: ComposePage UI rewritten (direct WS, 5 buttons, timeline)
- Summary: ComposePage completely rewritten with direct WebSocket connection, 5 generation buttons (Musique, Voix, Drone, Pink, White), integrated timeline view.

## lot-205-post200-cleanup [done]
- Description: Post-200 cleanup
- Summary: Post-milestone cleanup pass.

## lot-206-wavesurfer-waveform [planned]
- Description: wavesurfer.js waveform visualization in timeline
- Owner: Frontend
- Priority: P1

## lot-207-demucs-stems [planned]
- Description: Demucs v4 stem separation (vocals, drums, bass, other, piano, guitar)
- Owner: Multimodal
- Priority: P2

## lot-208-export-wav-download [planned]
- Description: /export WAV download link
- Owner: Backend API
- Priority: P1

## lot-209-composition-templates [planned]
- Description: Composition templates (preset arrangements)
- Owner: Backend API
- Priority: P2

## lot-210-collab-composition [planned]
- Description: Collaborative composition (shared comp, real-time sync)
- Owner: Backend API + Frontend
- Priority: P3

## lot-211-midi-export [planned]
- Description: MIDI export from composition
- Owner: Multimodal
- Priority: P3

## lot-212-automation-curves [planned]
- Description: Automation curves (volume envelope per track)
- Owner: Frontend + Multimodal
- Priority: P2

## lot-213-fx-rack [planned]
- Description: FX rack per track (chain multiple effects)
- Owner: Multimodal
- Priority: P2

## lot-214-sample-browser [planned]
- Description: Sample browser (upload + reuse audio samples)
- Owner: Frontend + Backend API
- Priority: P2

## lot-215-spectral-view [planned]
- Description: Spectral view (canvas visualization)
- Owner: Frontend
- Priority: P3

## lot-226-stutter [done]
- Summary: /stutter glitch effect, /pan stereo, /master mastering chain

## lot-230-compose-ui [done]
- Summary: ComposePage 3 button rows, per-track Solo/Loop/Reverse, status bar

## lot-234-imagine-ui [done]
- Summary: ImaginePage upgrade, MediaExplorer compositions tab

## lot-236-plan-docs [done]
- Summary: PLAN + docs update to 236 lots

## lot-278-glitch [done]
- /glitch: random audio glitch effect (bit crush + tremolo + phaser)

## lot-279-stretch [done]
- /stretch: time stretch without pitch change (atempo)

## lot-280-final [done]
- Summary: 281 lots, 89 commands, DAW Phase 1-4, composition pipeline complete

## lot-283-composition-browser [done]

- Description: Composition browser in Gestion tab (REST API fetch)
- Owner: Frontend
- Summary: Fetch compositions from /api/v2/media/compositions, display as buttons in Gestion tab, /comp load on click.

## lot-284-track-type-badges [done]

- Description: Track type indicators (M/V/N badges) in timeline blocks
- Owner: Frontend
- Summary: typeIcon() badge in TimelineGrid blocks, CSS .daw-block-badge.

## lot-285-e2e-health [done]

- Description: Full E2E + health check + PLAN update
- Owner: Ops
- Summary: Health 7/7, E2E verified, PLAN updated to 286 lots.

## lot-286-build-deploy [done]

- Description: Build + deploy + commit
- Owner: Ops
- Summary: Vite build, Docker rebuild, git push.

## lot-287-daw-ux [done]

- Summary: DAW UX overhaul — LCD display, faders, gradients, snap grid, loop region, animations

## lot-288-backend-integration [done]

- Summary: REST endpoints for compositions/tracks, comp load sync, M/S/vol/pan wired

## lot-290-e2e-daw [done]

- Summary: E2E DAW test verified, 310+ lots milestone


## lot-300-opendaw [done]
- Summary: openDAW cloned, built, served on /daw/ with COOP/COEP, AI Bridge :8301

## lot-305-compose-simple [done]
- Summary: ComposePage simple 4-track (MUSIQUE/VOIX/TEXTURE/EFFET), timeline, mix/master


## lot-310-mini-daw-ia [done]
- Summary: Mini DAW IA natif -- 4 pistes, timeline drag/resize/dup, AI suggest, auto-compose, generate-all, 10 FX context menu, /api/v2/ai/suggest-prompt

## lot-315-session-final [done]
- Summary: 315+ lots, 90 commands, 14 services, E2E 10/10, responsive verified

## lot-531-context-perf [done]

- Summary: Context parallel load (Promise.all), command ranking (startsWith priority), mobile CSS deep pass, route prefetch (requestIdleCallback)

## lot-532-mascarade-sse [done]

- Summary: mascarade SSE streaming confirmed working, thinking field extraction from Python side

## lot-533-grafana-prometheus [done]

- Summary: Grafana + Prometheus monitoring stack, enriched /api/v2/metrics endpoint

## lot-534-deepresearch [done]

- Description: /deepresearch multi-step search agent inspired by OpenSeeker
- Summary: deep-research.ts agent loop (plan→search→visit→extract→refine→synthesize), SSRF-safe page fetcher, LLM-driven query planning, /deepresearch and /dr commands with real-time progress

## lot-535-thinking-fix [done]

- Description: mascarade thinking field extraction + streaming think suppression
- Summary: Python side (ollama.py): extract content from thinking field, strip `<think>` from streaming. Node.js side (llm-client.ts): strip inline `<think>`, suppress in SSE stream, clean final text. Double safety net.

## lot-536-grafana-dashboard [done]

- Description: Grafana dashboard 16 panels + Prometheus multi-machine scrape
- Summary: Top stats (WS, chat/min, LLM calls, tokens, RSS, uptime), latency timeseries (HTTP, Ollama TTFB, persona, RAG), errors by label, throughput, counters table. Scrapes kxkm-ai + tower + mascarade.

## lot-537-cloudflare-tunnels [done]

- Description: Cloudflare Tunnels for kxkm-ai + tower (replaces lots 538-540)
- Summary: 2 tunnels (kxkm-ai-gpu + intello-cockpit), 7 public hostnames, HTTPS auto. kxkm.saillant.cc (app), kxkm-api (API), kxkm-mascarade (LLM), kxkm-comfy (ComfyUI), kxkm-tower, kxkm-grafana, mascarade (Authentik SSO). Anthropic domain verification TXT added.

## Phase Execution Immediate 2026-03-24 (P0/P1) [done]

### Objectif
- Executer un lot de fiabilisation en 4 commits atomiques, testables et rollbackables.

### lot-541-regex-intent-fix [done]
- Description: Corriger l extraction des prompts auto image/musique dans le routeur conversation.
- Owner: Backend API
- Fichiers cibles: apps/api/src/ws-conversation-router.ts, apps/api/src/ws-conversation-router.test.ts
- Changes: remplacer les motifs de regex `\s*` mal escapes, ajouter tests unitaires de non-regression.
- Checks: npm run -w @kxkm/api test
- Done criteria: prompts correctement extraits pour /imagine et /compose depuis langage naturel.

### lot-542-audio-eventloop-unblock [done]
- Description: Sortir les traitements ffmpeg bloquants du chemin synchrone WS.
- Owner: Backend API + Multimodal
- Fichiers cibles: apps/api/src/ws-commands-generate.ts
- Changes: remplacer les appels `execFileSync` critiques par execution asynchrone via scheduler/subprocess non bloquant.
- Checks: npm run -w @kxkm/api test, smoke WS compose/mix
- Done criteria: pas de blocage event-loop sur mix/export, latence WS stable sous charge.

### lot-543-worker-runtime-unification [done]
- Description: Unifier l execution worker autour de worker-runtime pour eviter la divergence index/runtime.
- Owner: Node Engine
- Fichiers cibles: apps/worker/src/index.ts, apps/worker/src/worker-runtime.ts, apps/worker/src/worker-runtime.test.ts
- Changes: index.ts devient orchestrateur fin, logique run/poll centralisee dans worker-runtime.
- Checks: npm run -w @kxkm/worker test
- Done criteria: une seule source de verite pour le cycle run/dequeue/execute.

### lot-544-chat-render-budget [done]
- Description: Reduire le cout render de Chat.tsx pour les longues conversations.
- Owner: Frontend
- Fichiers cibles: apps/web/src/components/Chat.tsx
- Changes: memoization des derivees couteuses (compteur de mots, highlights), maintien UX inchange.
- Checks: npm run -w @kxkm/web test, npm run -w @kxkm/web build
- Done criteria: baisse du cout CPU render sans regression fonctionnelle.

### Sequencement d execution
1. lot-541 (P0)
2. lot-542 (P1 fiabilite runtime)
3. lot-543 (P1 architecture worker)
4. lot-544 (P1 perf frontend)

### Checkpoints
- J0: lot-541 merge + tests API verts
- J1: lot-542 merge + smoke compose/mix OK
- J2: lot-543 merge + tests worker verts
- J3: lot-544 merge + build web OK

### Risques cibles
- R-INTENT-REGEX: extraction de prompt incorrecte
- R-AUDIO-BLOCKING: blocage event-loop API
- R-WORKER-DRIFT: divergence entre runtime et index
- R-CHAT-RENDER: degradation perf UI sur historique long
## Phase Execution Next 2026-03-24 (P1/P2) [in-progress]

### Objectif
- Enchainer directement sur le prochain lot de coherence plan/docs puis sur le pipeline composition prioritaire.

### lot-545-plan-todo-sync [done]
- Description: Harmoniser PLAN.md, TODO.md et docs/AGENTS.md sur les statuts reels des lots 95-100 et 178-200.
- Owner: Coordinateur
- Fichiers cibles: PLAN.md, TODO.md, docs/AGENTS.md
- Checks: revue manuelle des statuts, coherence des priorites P1/P2
- Done criteria: plus de divergences de statut entre fichiers de pilotage.

### lot-546-compose-api-direct [done]
- Description: Demarrer lot-178 avec appel ACE-Step direct pour fiabiliser la duree /compose.
- Owner: Backend API + Multimodal
- Fichiers cibles: apps/api/src/ws-commands-generate.ts, scripts/ ou service ACE-Step associe
- Checks: test manuel /compose 5s, 30s, 120s
- Done criteria: duree demandee respectee sans drift observable.
- Status: implementation validee, fallback en place, lot cloture.

### lot-547-timeline-model-v1 [in-progress]
- Description: Demarrer lot-180 avec modele timeline v1 (tracks, clips, markers).
- Owner: Backend API
- Fichiers cibles: apps/api/src/*composition*, packages/*domain* si necessaire
- Checks: tests unitaires modele + validation schema
- Done criteria: structure timeline stable et serialisable.

### lot-548-waveform-ui-v1 [planned]
- Description: Demarrer lot-194 avec waveform timeline cote frontend.
- Owner: Frontend
- Fichiers cibles: apps/web/src/components/*compose* ou *timeline*
- Checks: npm run -w @kxkm/web test, npm run -w @kxkm/web build
- Done criteria: waveform lisible par piste sans regression mobile.

### lot-549-composition-tests [planned]
- Description: Renforcer les tests composition (store, remix, export, timeline path).
- Owner: Backend API + Frontend
- Fichiers cibles: apps/api/src/**/*.test.ts, apps/web/src/**/*.test.tsx
- Checks: npm run test:v2
- Done criteria: couverture non-regression sur le pipeline composition.

### Sequencement d execution
1. lot-545 [done]
2. lot-546 [done]
3. lot-547 [in-progress]
4. lot-548
5. lot-549

### Risques cibles
- R-DOC-DRIFT: statuts incoherents entre fichiers de pilotage
- R-COMPOSE-DURATION: duree audio non respectee en production
- R-TIMELINE-MODEL: format instable pour les futures features DAW
- R-WAVEFORM-UX: surcharge render sur mobile
