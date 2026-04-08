# AGENTS.md — apps/

<!-- Parent: ../AGENTS.md -->

Three applications in Turborepo workspace: api (backend), web (frontend), worker (background jobs).

## api/ — Backend (77 TS files + 27 tests)

Node.js Express + WebSocket on port 4180. Single process: HTTP + WS.

### WebSocket Handlers

| File | Purpose |
|------|---------|
| `ws-chat.ts` | Entry point: rate-limit, broadcast, multimodal dispatch |
| `ws-conversation-router.ts` | Persona routing, context assembly, TTS chunking, inter-persona depth-3 relay |
| `ws-ollama.ts` | Runtime streaming, tool-calling, `<think>` tag stripping |
| `ws-persona-router.ts` | Memory extract/save, responder selection, InferenceScheduler submit |
| `ws-multimodal.ts` | TTS streaming, vision, STT, file upload, ComfyUI integration |
| `ws-upload-handler.ts` | Media ingestion, storage, gallery |
| `ws-chat-helpers.ts` | Utilities: formatting, logging, metrics |
| `ws-chat-logger.ts` | Structured logging (pino JSON) |
| `ws-chat-history.ts` | Per-channel conversation memory, compaction |
| `ws-chat-state.test.ts` | State machine tests |

### Commands (5 handlers)

| File | Purpose |
|------|---------|
| `ws-commands.ts` | Router: dispatch to handlers by `/command` |
| `ws-commands-chat.ts` | `/chat`, `/speed`, `/help` |
| `ws-commands-info.ts` | `/personas`, `/commands`, `/status` |
| `ws-commands-generate.ts` | `/imagine`, `/compose`, `/music` (ACE-Step, ComfyUI) |
| `ws-commands-compose.ts` | DAW composition: `/layer`, `/fx`, `/voice`, `/mix`, `/export` |

### Personas (33 definitions + memory)

| File | Purpose |
|------|---------|
| `personas-default.ts` | 33 personas: Pharmacius, Sherlock, Turing, Ikeda, Schaeffer, Merzbow, Pina, etc. (memoryMode, corpus[], relations[]) |
| `persona-runtime.ts` | Runtime: load, extract, save; DPO feedback pipeline |
| `persona-memory-store.ts` | Per-nick isolated storage: `data/v2-local/persona-memory/{personaId}/{nick}.json` |
| `persona-memory-policy.ts` | auto/explicit/off modes, injectionFactsLimit (default 8) |
| `persona-voices.ts` | Voice config per persona |
| `persona-memory-telemetry.ts` | Metrics: extraction time, injection count, memory size |

### RAG & Inference

| File | Purpose |
|------|---------|
| `rag.ts` | Local embedding store, per-persona namespaces, LightRAG dual-write |
| `inference-scheduler.ts` | Single-GPU queue: `MAX_GPU_CONCURRENT=1`, all LLM calls must go through it |
| `llm-client.ts` | Ollama API wrapper, streaming, tool-calling |
| `deep-research.ts` | Multi-turn research loop via scheduler |

### Storage & Context

| File | Purpose |
|------|---------|
| `context-store.ts` | Per-channel conversation memory, LLM compaction via scheduler |
| `chat-types.ts` | All shared types: ChatPersona, PersonaMemoryMode, ClientInfo, message union |
| `composition-store.ts` | Multi-track composition state (tracks, clips, markers) |
| `media-store.ts` | File storage, gallery, cleanup |

### Services

| File | Purpose |
|------|---------|
| `web-search.ts` | SearXNG → DuckDuckGo fallback; discovered URLs → `data/sherlock-discovered-urls.jsonl` |
| `comfyui.ts` | Image generation: checkpoint + LoRA selection, prompt injection |
| `comfyui-models.ts` | 32 checkpoints + 24 LoRAs registry |
| `voice-samples.ts` | Voice clone sample management |
| `mcp-tools.ts` | Tool definitions injected per persona (web_search, rag_search, compose, imagine, etc.) |

### Routes (6 REST files + bootstrap)

| File | Purpose |
|------|---------|
| `routes/chat-history.ts` | GET/POST chat logs, export |
| `routes/media.ts` | GET/POST media, gallery |
| `routes/personas.ts` | GET personas, memory, feedback |
| `routes/session.ts` | Auth, session mgmt, guest mode |
| `routes/node-engine.ts` | DAG runs, node types, training |
| `media-shared-routes.ts` | Shared media endpoints |
| `app.ts` | Express setup, middleware, WS upgrade |
| `app-bootstrap.ts` | Corpus load, DAW samples, systemd startup |
| `app-middleware.ts` | Auth, CORS, error handlers |

### Server & Infrastructure

| File | Purpose |
|------|---------|
| `server.ts` | HTTP + WS bootstrap, DAW sample routes, corpus boot |
| `create-repos.ts` | DB repo initialization |
| `schemas.ts` | Zod validation: 19 route schemas + command input schemas |
| `error-tracker.ts` | Error telemetry (16 labels) |
| `perf.ts` | Perf instrumentation (6 labels, p50/p95/p99) |
| `logger.ts` | Pino JSON logger config |

### Tests (27 files)

| File | Purpose |
|------|---------|
| `app.test.ts` | HTTP routes, middleware, health checks |
| `ws-chat.test.ts` | WS broadcast, rate-limit, multimodal dispatch |
| `ws-conversation-router.test.ts` | Persona routing, context assembly |
| `ws-ollama.test.ts` | Token streaming, tool-calling, think tag |
| `ws-multimodal.test.ts` | TTS, vision, STT, file upload |
| `ws-upload-handler.test.ts` | Media ingestion |
| `ws-commands.test.ts` | Command routing |
| `persona-memory-store.test.ts` | Nick isolation, file persistence |
| `persona-memory-policy.test.ts` | auto/explicit modes |
| `persona-memory-telemetry.test.ts` | Metrics tracking |
| `persona-runtime.test.ts` | Runtime load/save |
| `rag.test.ts` | Embedding, LightRAG sync |
| `context-store.test.ts` | Channel history, compaction |
| `composition-store.test.ts` | Multi-track state |
| `media-store.test.ts` | File storage |
| `web-search.test.ts` | SearXNG, DuckDuckGo fallback |
| `voice-samples.test.ts` | Voice sample mgmt |
| `mcp-tools.test.ts` | Tool definitions |
| `mcp-server.test.ts` | MCP server integration |
| `chat-history-routes.test.ts` | Chat log routes |
| `media-shared-routes.test.ts` | Media endpoints |
| `ws-chat-smoke.test.ts` | End-to-end smoke |
| `ws-integration.test.ts` | Full integration flow |
| `ws-chat-state.test.ts` | State machine |
| `create-repos.test.ts` | DB setup |
| `app.test.ts` | Bootstrap |
| `integration.test.ts` | Full system |

### Run

```bash
npm run dev:v2:api        # tsx watch (localhost:4180)
npm run -w @kxkm/api test # 278 unit tests
cd apps/api && npm test   # From api dir
```

## web/ — Frontend (64 TS/TSX files + 10 tests)

React + Vite on port 5173. 5 CSS themes (minitel, crt, hacker, synthwave, default). React.memo + useCallback optimized. 17 lazy-loaded routes (-53% initial JS). Chat virtualization (react-window). CRT boot animation.

### Pages (10)

| Component | Purpose |
|-----------|---------|
| `Chat.tsx` | Main chat interface (virtualized history, input, sidebar) |
| `ImaginePage.tsx` | Image generation (ComfyUI) |
| `ComposePage.tsx` | DAW composition (timeline, tracks, effects) |
| `DawAIPanel.tsx` | AI composition sidebar |
| `LiveFXPage.tsx` | Real-time audio effects |
| `UllaPage.tsx` | Ulla (experimental) |
| `NodeEngineOverview.tsx` | DAG editor, run status |
| `AdminPage.tsx` | Admin dashboard, user management |
| `TrainingDashboard.tsx` | Training runs, metrics |
| `Collectif.tsx` | Multi-user collaboration |

### Components (15+)

| Component | Purpose |
|-----------|---------|
| `ChatMessage.tsx` | Message render, markdown, media player |
| `ChatInput.tsx` | Text input, voice record, file upload, rate-limit indicator |
| `ChatHistory.tsx` | Virtualized scroll (react-window) |
| `ChatSidebar.tsx` | Channel list, persona selector, theme toggle |
| `Header.tsx` | Title, menu, auth |
| `Nav.tsx` | Route navigation |
| `ErrorBoundary.tsx` | Error UI |
| `VoiceChat.tsx` | Push-to-talk, level meter, silence auto-detect |
| `MediaGallery.tsx` | Image/audio gallery, fullscreen player |
| `MediaExplorer.tsx` | File browser, upload |
| `TimelineView.tsx` | DAW track lanes, waveform, play/pause/seek |
| `EngineNode.tsx` | DAG node visual |
| `NodeEditor.tsx` | DAG editor (React Flow) |
| `PersonaList.tsx` | Persona selector with memory stats |
| `PersonaDetail.tsx` | Persona info, memory injection preview |

### Hooks (7)

| Hook | Purpose |
|------|---------|
| `useWebSocket.ts` | WS connection, auto-reconnect, message dispatch |
| `useAppSession.ts` | Session state, auth, guest mode |
| `useChatState.ts` | Chat history, selected persona, channel |
| `useGenerationCommand.ts` | /imagine, /compose submission, progress tracking |
| `useNodeEditor.ts` | DAG state (nodes, edges, zoom) |
| `useHashRoute.ts` | Client-side routing via hash |
| `useKeyboardShortcuts.ts` | Ctrl+K palette, theme toggle, etc. |
| `useMinitelSounds.ts` | 8-bit Minitel UI sounds |

### Library

| File | Purpose |
|------|---------|
| `lib/websocket-url.ts` | WS URL construction (dev vs prod) |
| `api.ts` | HTTP client for REST routes |
| `chat-types.ts` | Frontend message/persona types |

### Tests (10 files)

| File | Purpose |
|------|---------|
| `components/Chat*.test.tsx` | Component render, interaction |
| `components/Header.test.tsx` | Header UI |
| `components/Login.test.tsx` | Auth flow |
| `components/ChannelList.test.tsx` | Channel selector |
| `components/PersonaList.test.tsx` | Persona list |
| `components/RunStatus.test.tsx` | Run status display |
| `components/Nav.test.tsx` | Route nav |
| `hooks/*.test.ts` | Hook logic |
| `App.test.tsx` | App bootstrap |

### Styles

| File | Purpose |
|------|---------|
| `styles.css` | Base theme variables (colors, fonts, spacing) |
| `styles 2.css` | Alternative theme (legacy) |

### Run

```bash
npm run dev:v2:web        # Vite (localhost:5173)
npm run -w @kxkm/web test # 54 unit tests
```

## worker/ — Background Jobs (4 TS files)

Node.js background processor. Handles async tasks (training, data ingestion, composition rendering, etc.).

| File | Purpose |
|------|---------|
| `index.ts` | Entry point, job queue setup |
| `worker-runtime.ts` | Job executor: training jobs, DPO pipeline, node runs |
| `logger.ts` | Structured logging |
| `worker-runtime.test.ts` | Runtime tests |

### Run

```bash
npm run dev:v2:worker     # Background processor
npm run -w @kxkm/worker test
```
