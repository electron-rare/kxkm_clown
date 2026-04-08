# AGENTS.md — KXKM_Clown Monorepo

> "L'infrastructure est une decision politique deployee." -- electron rare

Multimodal AI chat system. Turborepo monorepo (npm workspaces): 3 apps + 8 packages + 42 scripts. 15+ service mesh. Single RTX 4090 GPU: `MAX_GPU_CONCURRENT=1`.

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | 12 services (postgres, searxng, docling, qdrant, ollama, tts, lightrag) with health checks |
| `turbo.json` | Build tasks, caching, workspace graph |
| `package.json` | Root: 15 npm scripts (dev, build, check, test, smoke, verify) |
| `.env.example` | LLM_URL, DATABASE_URL, ports, TTS, RAG model, etc. |

## Subdirectories

| Dir | Purpose | Ref |
|-----|---------|-----|
| `apps/` | 3 apps: api (77 TS), web (64 TS/TSX), worker (4 TS) | `apps/AGENTS.md` |
| `packages/` | 8 packages (core, auth, chat-domain, persona-domain, node-engine, storage, tui, ui) | `packages/AGENTS.md` |
| `scripts/` | 42 files: 20 Python, 22 Shell (ops, training, ingestion, voice, image, deploy) | `scripts/AGENTS.md` |
| `docs/` | 50+ specs, spikes, research, audits (SPEC_*.md, AUDIT_*.md, OSS_VEILLE_*.md) | — |
| `ops/` | Monitoring + ops/v2/ (systemd, TUI, health-check.sh, deep-audit.js) | — |
| `models/` | Fine-tuned + LoRA weights (base_models/, finetuned/, lora/, registry.json) | — |
| `data/` | Ephemeral: persona memory, chat logs, context, corpus (v2-local/, chat-logs/) | — |

## Agent Matrix

| Agent | Competences | Scope | Status |
|---|---|---|---|
| Coordinateur | Planning, arbitration, docs sync | PLAN.md, TODO.md, AGENTS.md, README.md | actif |
| Securite | Input validation, hardening, rate-limit, RBAC | apps/api, ws-chat, packages/auth | veille |
| Backend API | Express, WS, Ollama, RAG, multimodal pipeline | apps/api/src/ (77 TS + 27 tests) | actif |
| Node Engine | DAG, queue, runs, sandbox, training adapters | packages/node-engine, apps/worker | actif |
| Personas | Memory, DPO, pharmacius, coherence | packages/persona-domain, ws-chat (33 personas) | actif |
| Frontend | React/Vite, Minitel theme, React Flow, chat, voice | apps/web/src/ (64 TS/TSX + 10 tests) | actif |
| Ops/TUI | Monitoring, deploy, logs, health, audit | ops/v2/, scripts/, deep-audit.js | actif |
| Training | DPO, SFT, Unsloth, eval, autoresearch | scripts/, packages/node-engine | actif |
| Multimodal | STT, TTS, vision, PDF, RAG, web search | apps/api/src/ws-multimodal.ts | actif |
| Veille OSS | Benchmarks, new libs, licensing, interop | docs/OSS_WATCH, docs/HF_MODEL_RESEARCH | periodique |

## Message Flow

```
User WS → ws-chat.ts (rate-limit, multimodal dispatch)
  → ws-conversation-router.ts (persona routing, context assembly)
    → ws-persona-router.ts (memory extract/load, responder select)
      → inference-scheduler.ts (single-GPU queue, MAX_GPU_CONCURRENT=1)
        → ws-ollama.ts (token stream, tool-calling)
        → ws-multimodal.ts (TTS, vision, STT, file upload)
  → persona-memory-store.ts (nick-isolated file persist)
  → rag.ts (embedding + LightRAG dual-write)
  → context-store.ts (channel history + compaction)
```

## Services

| Service | Port | Notes |
|---------|------|-------|
| API (HTTP+WS) | 4180 | Node.js Express + ws |
| Frontend (Vite) | 5173 | React + 5 CSS themes |
| Ollama/vLLM | 11434 | LLM runtime + embeddings |
| PostgreSQL | 5432 | Chat, sessions, node-engine runs |
| SearXNG | 8080 | Self-hosted search (DuckDuckGo fallback) |
| Docling | 9400 | PDF extraction |
| LightRAG | 9621 | Graph-RAG, `LLM_MODEL=mistral:7b` to avoid `<think>` corruption |
| TTS (Piper/Chatterbox) | 9100 | Voice synthesis |
| Kokoro TTS | 9201 | Fast TTS, 12 voices |
| ComfyUI | 8188 | Image generation (32 checkpoints + 24 LoRAs) |
| Camoufox | 8091 | Stealth browser for bot-protected sites |

## GPU Constraint

All LLM calls → `inference-scheduler.ts`. No direct fetch() outside approved helpers. RTX 4090: `MAX_GPU_CONCURRENT=1`. Context compaction + persona extraction both via `scheduler.submit(priority: "low")`.

## Persona Memory (nick-isolated, 2026-04)

- **Path**: `data/v2-local/persona-memory/{personaId}/{nick}.json`
- **Modes**: `auto` (Pharmacius, Sherlock, Turing, Ikeda), `explicit` (artistic personas, `/remember` only)
- **Injection cap**: 8 facts max into system prompt
- **Anonymous relay**: `_anonymous` sentinel for unknown-nick chains

## Build & Dev

```bash
npm install                    # Install all workspaces
npm run dev                    # Turbo parallel (api, web, worker)
npm run dev:v2:api             # API :4180 (tsx watch)
npm run dev:v2:web             # Web :5173 (Vite)
npm run check:v2               # tsc --noEmit
npm run -w @kxkm/api test      # 278 unit tests
npm run -w @kxkm/web test      # 54 unit tests
npm run smoke:v2               # Integration smoke
npm run verify                 # check + smoke (full gate)
docker compose --profile v2 up -d
```

## Environment

```bash
LLM_URL=http://localhost:11434
LLM_MODEL=qwen-14b-awq
DATABASE_URL=postgres://kxkm:kxkm@localhost:5432/kxkm_clown
V2_API_PORT=4180
TTS_ENABLED=1
VISION_MODEL=qwen3-vl:8b
RAG_EMBEDDING_MODEL=nomic-embed-text
SEARXNG_URL=http://localhost:8080
KXKM_PERSONA_MEMORY_INJECTION_LIMIT=8
```

## Cycle State (2026-03-20)

- 130+ lots complete (lot-24 to lot-177)
- 425 tests, 0 failures
- 43 chat commands, 33 personas
- 5 CSS themes, 35 music styles (ACE-Step)
- 32 ComfyUI checkpoints + 24 LoRAs
- TTFC 284ms, guest mode, mobile responsive
- Structured logging (pino JSON)
- Systemd services (TTS, LightRAG)

## See Also

- `apps/AGENTS.md` — api, web, worker details
- `packages/AGENTS.md` — shared package breakdown
- `scripts/AGENTS.md` — deployment, training, ops scripts
- `CLAUDE.md` — Architecture, request paths, data directories
- `PLAN.md` / `TODO.md` / `FEATURE_MAP.md` — Roadmap (lots 178-200)
