# PLAN (kxkm-clown-v2)

Updated: 2026-03-19T23:00:00Z

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
