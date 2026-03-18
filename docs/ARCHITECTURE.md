# Architecture 3615-KXKM

> "Le medium est le message, et ton terminal a deja compris." -- electron rare

## Vue d'ensemble

```mermaid
graph TB
    subgraph Client["Frontend React/Vite — UI Minitel 3615"]
        UI[MinitelFrame CRT]
        Chat[Chat.tsx]
        Voice[VoiceChat push-to-talk]
        Compose[ComposePage + progress bar]
        Imagine[ImaginePage + viewer]
        Media[MediaExplorer gallery/playlist]
        Admin[AdminPage]
    end

    subgraph API["API Node.js Express + WebSocket"]
        WS[ws-chat.ts — Handler WS]
        CMD[ws-commands.ts — /compose /imagine /web]
        ROUTER[ws-conversation-router.ts — Routing @mention]
        LLM[ws-ollama.ts — Stream + Tools + Think-strip]
        MULTI[ws-multimodal.ts — TTS HTTP + Vision]
        MSTORE[media-store.ts — Persistance media]
        CTX[context-store.ts — Contexte JSONL 4000ch]
        RAG[rag.ts — Embeddings cosine]
        REST[Routes REST — session, personas, media]
    end

    subgraph Services["Services"]
        OLLAMA[Ollama — qwen3:8b mistral gemma3]
        TTS[TTS Server piper :9100]
        COMFY[ComfyUI SDXL]
        SEARX[SearXNG :8080]
        PG[(PostgreSQL 16)]
    end

    subgraph Worker["Worker GPU"]
        ENGINE[Node Engine — DAG exec]
        TRAIN[Training Unsloth/TRL]
    end

    Chat -- "WS message/command" --> WS
    Voice -- "WS upload audio" --> WS
    Compose -- "WS command /compose" --> CMD
    Imagine -- "WS command /imagine" --> CMD
    Media -- "REST /api/v2/media" --> REST

    WS --> ROUTER --> LLM --> OLLAMA
    ROUTER --> CTX
    ROUTER --> RAG
    LLM -- "TTS" --> MULTI --> TTS
    LLM -- "Vision" --> MULTI --> OLLAMA
    CMD -- "/imagine" --> COMFY
    CMD -- "/web" --> SEARX
    CMD -- "save" --> MSTORE
    REST --> PG
    ENGINE --> TRAIN --> OLLAMA
```

## Flux chat avec routing personas

```mermaid
sequenceDiagram
    participant U as User
    participant WS as WebSocket
    participant Ph as Pharmacius (routeur)
    participant Sp as Spécialiste @mention
    participant TTS as TTS Server

    U->>WS: message "parle-moi de noise"
    WS->>WS: broadcast + log + context
    WS->>Ph: streamOllamaChat (maxTokens:600)
    Ph-->>WS: "Le noise art... @Merzbow peut approfondir."
    WS->>WS: stripThinking + broadcast texte
    WS->>TTS: POST /synthesize (Pharmacius)
    TTS-->>WS: audio WAV
    WS->>U: audio base64

    Note over WS: Détecte @Merzbow → inter-persona (depth+1, 2s delay)
    WS->>Sp: streamOllamaChat (Merzbow, maxTokens:500)
    Sp-->>WS: "Le bruit est une matière vivante..."
    WS->>TTS: POST /synthesize (Merzbow)
    TTS-->>WS: audio WAV
    WS->>U: texte + audio
```

## Feature Map

```mermaid
mindmap
  root((3615 KXKM))
    Chat
      WebSocket temps réel
      33 personas IA
      Routing @mention inter-persona
      Contexte conversationnel 4000ch
      RAG manifeste
      Historique JSONL
      Tab-completion nicks/commands
      Sidebar personas collapsible
    Voix
      Push-to-talk (maintenir)
      STT faster-whisper
      TTS piper-tts 26 voix
      Level meter temps réel
      Auto-stop silence 2s
      Audio queue + replay
    Génération
      /compose ACE-Step musique
      /imagine ComfyUI SDXL
      Progress bars animées
      Persistance media (disk)
      Médiathèque gallery/playlist
    Admin
      Node Engine (DAG graphs)
      Training LoRA/QLoRA
      DPO pipeline
      Analytics chat
      Persona CRUD + feedback
    Infrastructure
      Docker Bookworm + Python
      Ollama natif (RTX 4090)
      PostgreSQL 16
      SearXNG self-hosted
      TTS sidecar HTTP
      Discord bot bridge
    UI
      Minitel 1B fullscreen
      Mosaïques VIDEOTEX
      CRT scanlines + vignette
      Raccourcis F1-F7
      Responsive 4 breakpoints
      Animation modem 3615
```

## Modules (LOC)

| Module | LOC | Tests | Rôle |
|--------|-----|-------|------|
| apps/api | 5200 | 1000 | Backend API + WebSocket |
| apps/web | 4800 | 800 | Frontend React |
| apps/worker | 956 | 230 | Worker GPU Node Engine |
| packages/core | 172 | 86 | Types, IDs, permissions |
| packages/auth | 159 | 157 | Scrypt, sessions, RBAC |
| packages/chat-domain | 262 | 279 | Messages, channels, commands |
| packages/persona-domain | 988 | 259 | Personas, feedback, editorial |
| packages/node-engine | 1499 | 605 | DAG execution, training |
| packages/storage | 1219 | 669 | PostgreSQL repos |
| packages/ui | 134 | 0 | Theme, colors, CSS vars |
| packages/tui | 209 | 108 | ANSI formatting, tables |
| scripts | 37 fichiers | - | TTS, training, migration |
| **Total** | **~15600** | **~3200** | |

## Bugs critiques identifiés (audit 2026-03-18)

| # | Sévérité | Module | Description |
|---|----------|--------|-------------|
| 1 | HIGH | context-store.ts | Race condition sur enforceLimits pendant compaction |
| 2 | MEDIUM | ws-conversation-router.ts | Maps persona unbounded (memory leak) |
| 3 | MEDIUM | ws-commands.ts | Temp files non nettoyés si compose timeout |
| 4 | MEDIUM | Chat.tsx | Memory leak /ulla (setTimeout non tracked) |
| 5 | MEDIUM | ComposePage/ImaginePage | WebSocket non fermé au unmount |
| 6 | LOW | AdminPage.tsx | Champ password UI mort (jamais envoyé) |
| 7 | LOW | routes/session.ts | Token comparison timing-attack (===) |

## Env vars

| Variable | Default | Requis |
|----------|---------|--------|
| V2_API_PORT | 3333 | Non |
| OLLAMA_URL | localhost:11434 | Non |
| DATABASE_URL | - | Prod only |
| TTS_ENABLED | 0 | Non |
| TTS_URL | localhost:9100 | Non |
| VISION_MODEL | qwen3-vl:8b | Non |
| COMFYUI_URL | stable2.kxkm.net | Non |
| SEARXNG_URL | localhost:8080 | Non |
| PYTHON_BIN | python3 | Non |
| MAX_OLLAMA_CONCURRENT | 3 | Non |
| ADMIN_BOOTSTRAP_TOKEN | - | Non |
