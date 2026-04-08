# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev (V2)
npm run dev:v2:api       # API on :4180 (tsx watch)
npm run dev:v2:web       # Frontend on :5173 (Vite)
npm run dev:v2:worker    # Background job processor

# Build
npm run build:v2         # TypeScript compile (all workspaces)
npm run turbo:build      # Full monorepo build

# Type-check
npm run check:v2         # tsc --noEmit (fast check)
npm run -w @kxkm/api check

# Tests
npm run -w @kxkm/api test          # 278 unit tests
npm run -w @kxkm/web test          # 54 unit tests
npm run smoke:v2                   # Integration smoke
npm run verify                     # check + smoke (full gate)

# Run a single test file (after build)
cd apps/api && node --experimental-test-module-mocks --test dist/persona-memory-store.test.js

# Docker
docker compose --profile v2 up -d
docker compose --profile v2 --profile ollama up -d  # with bundled embeddings backend
```

## Architecture

**Monorepo** (npm workspaces + Turborepo): `apps/` + `packages/`

### API (`apps/api/src/`)

The V2 API is a single Node.js process combining Express (HTTP) and `ws` (WebSocket) on port 4180.

**Request path for a chat message:**
```
ws-chat.ts (WS handler, rate-limit, routing)
  → ws-conversation-router.ts (pick responder personas, build context)
    → ws-ollama.ts (stream tokens from vLLM/TurboQuant runtime, tool-calling)
    → ws-multimodal.ts (TTS streaming, vision, STT, file upload)
  → ws-persona-router.ts (memory load/update, responder selection)
```

**Key files:**
| File | Purpose |
|------|---------|
| `server.ts` | HTTP+WS bootstrap, DAW sample routes, corpus boot |
| `ws-chat.ts` | WS entry — broadcast, rate-limit, multimodal dispatch |
| `ws-conversation-router.ts` | Persona routing, context assembly, TTS chunking, inter-persona depth-3 relay |
| `ws-ollama.ts` | Runtime streaming, tool-calling, `<think>` tag stripping |
| `ws-persona-router.ts` | Memory extract/save, responder selection, InferenceScheduler |
| `personas-default.ts` | 33 persona definitions (`memoryMode`, `corpus[]`, `relations[]`) |
| `persona-memory-store.ts` | Per-nick isolated storage at `data/v2-local/persona-memory/{personaId}/{nick}.json` |
| `persona-memory-policy.ts` | auto/explicit/off modes, `injectionFactsLimit` (default 8) |
| `rag.ts` | Local embedding store, per-persona namespaces, LightRAG dual-write |
| `context-store.ts` | Per-channel conversation memory, LLM compaction via InferenceScheduler |
| `inference-scheduler.ts` | Single-GPU queue (`MAX_GPU_CONCURRENT=1`), all LLM calls must go through it |
| `chat-types.ts` | All shared types: `ChatPersona`, `PersonaMemoryMode`, `ClientInfo`, message union |
| `mcp-tools.ts` | Tool definitions injected per persona (web_search, rag_search, etc.) |
| `web-search.ts` | SearXNG → DuckDuckGo fallback; discovered URLs enqueued to `data/sherlock-discovered-urls.jsonl` |

### Persona Memory (nick-isolated, 2026-04 design)

Memory is keyed by `(personaId, nick)` — one file per user per persona.

- `memoryMode: 'auto'` → Pharmacius, Sherlock, Turing, Ikeda (LLM extraction every 5 responses)
- `memoryMode: 'explicit'` → all artistic personas (Schaeffer, Merzbow, Pina, etc.) — only via `/remember`
- `/remember [@persona|@all] <text>` — direct fact insert, no LLM call
- Injection cap: 8 facts max into system prompt (`injectionFactsLimit`)
- `_anonymous` sentinel for unknown-nick relay chains

### Packages

| Package | Contents |
|---------|---------|
| `core` | Shared types, IDs, permissions |
| `auth` | RBAC, sessions, crypto |
| `chat-domain` | Message types, channels, slash command registry |
| `persona-domain` | Persona model, DPO pairs, feedback pipeline |
| `node-engine` | DAG execution, GPU job queue, 15+ node types |
| `storage` | Postgres repositories, migrations |

### Services & Ports

| Service | Port | Notes |
|---------|------|-------|
| API V2 | 4180 | HTTP + WS |
| Frontend | 5173 | Vite dev |
| vLLM | 8000 | Primary OpenAI-compatible text runtime (qwen-32b-awq) |
| TEI | 9500 | Dedicated embedding server (BAAI/bge-m3, CPU) |
| PostgreSQL | 5432 | V2 persistence (optional for API, required for worker) |
| LightRAG | 9621 | Graph-RAG; `LLM_MODEL=mistral:7b` to avoid `<think>` JSON corruption |
| SearXNG | 8080 | Self-hosted search |
| TTS | 9100 | Piper + Chatterbox |
| Kokoro TTS | 9201 | Fast TTS, 12 voices |
| AI Bridge | 8301 | 19 audio backends |
| ComfyUI | 8188 | Image generation |
| Docling | 9400 | PDF extraction |
| Camoufox | 8091 | Stealth browser fetch (venv, `kxkm-camoufox.service`) |

### InferenceScheduler constraint

**All LLM calls must go through `inference-scheduler.ts`** — no direct `fetch()` to the runtime outside approved helpers. The RTX 4090 has `MAX_GPU_CONCURRENT=1`. `context-store.ts` compaction and `ws-persona-router.ts` extraction both use `scheduler.submit()` with `priority: "low"`.

### Corpus ingestion pipeline

`scripts/ingest_spectacle_corpus.py` ingests domain content into LightRAG:
- Seed URLs + SearXNG discovery + `data/sherlock-discovered-urls.jsonl` (live Sherlock search discoveries)
- Camoufox server (`:8091`) used for bot-protected sites (`artcena.fr`, `culture.gouv.fr`, etc.)

### Data directories

```
data/
  v2-local/persona-memory/{personaId}/{nick}.json   # Per-user persona memory
  context/{channel}.jsonl                            # Conversation history
  sherlock-discovered-urls.jsonl                     # Corpus queue from web searches
  chat-logs/                                         # Daily JSONL chat logs
  manifeste.md                                       # Project philosophy (injected at boot)
```

## Environment Variables

```bash
LLM_URL=http://localhost:8000           # vLLM OpenAI-compatible endpoint
LLM_MODEL=qwen-32b-awq
LLM_API_KEY=vllm-er-2026               # Bearer token for vLLM --api-key
OLLAMA_URL=http://localhost:9500        # TEI embedding server
EMBEDDING_BACKEND=tei                   # "tei" or "ollama"
RAG_EMBEDDING_MODEL=BAAI/bge-m3
DATABASE_URL=postgres://kxkm:kxkm@localhost:5432/kxkm_clown
V2_API_PORT=4180
TTS_ENABLED=1
VISION_MODEL=qwen3-vl:8b
SEARXNG_URL=http://localhost:8080
KXKM_PERSONA_MEMORY_INJECTION_LIMIT=8   # Max facts injected into system prompt
CHAT_PAUSED=1                            # Or create data/chat-paused file
```
