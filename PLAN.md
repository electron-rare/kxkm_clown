# PLAN (kxkm-clown-v2)

Updated: 2026-03-18T21:30:00Z

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

## lot-21-chatterbox-tts [planned]
- Description: Remplacer piper-tts par Chatterbox (zero-shot voice cloning, MIT, sub-200ms)
- Depends on: lot-18-media-tts
- Owner: Multimodal
- Priority: P1
- Tasks:
  - [ ] Installer Chatterbox sur kxkm-ai (pip install chatterbox-tts)
  - [ ] Adapter tts-server.py pour utiliser Chatterbox comme backend principal
  - [ ] Tester qualite vocale vs piper sur les 33 personas
  - [ ] Benchmark latence (cible: <500ms pour 100 chars)

## lot-22-graph-rag [planned]
- Description: Remplacer RAG cosine par LightRAG (graph-based, knowledge graphs)
- Depends on: lot-12-deep-audit
- Owner: Backend API
- Priority: P2
- Tasks:
  - [ ] Evaluer LightRAG vs txtai vs RAGatouille
  - [ ] Integrer le gagnant dans rag.ts
  - [ ] Indexer le manifeste + lore personas
  - [ ] Benchmark recall vs baseline cosine

## lot-23-crt-webgl [planned]
- Description: Effets CRT WebGL (vault66-crt-effect ou cool-retro-term-webgl)
- Depends on: lot-16-minitel-ui
- Owner: Frontend
- Priority: P3
- Tasks:
  - [ ] Evaluer vault66-crt-effect (npm install) vs shaders custom
  - [ ] Integrer dans MinitelFrame
  - [ ] Tester perf mobile (FPS target: 30+)

## lot-24-tests-integration [planned]
- Description: Tests integration pour RAG, ComfyUI, web-search, TTS, Ollama
- Depends on: lot-20-deep-audit-2
- Owner: Backend API
- Priority: P2
- Tasks:
  - [ ] Mock HTTP pour Ollama (streaming + tools)
  - [ ] Mock ComfyUI workflow + polling
  - [ ] Mock SearXNG + DuckDuckGo fallback
  - [ ] Mock TTS sidecar HTTP
  - [ ] Test context-store concurrent writes
  - [ ] Test media-store path traversal
