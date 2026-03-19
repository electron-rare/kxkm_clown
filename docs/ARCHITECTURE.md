# Architecture 3615-KXKM

> "Le medium est le message, et ton terminal a deja compris." -- electron rare
>
> "Saboteurs of big daddy mainframe" -- VNS Matrix, 1991

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

    subgraph API["API Express + WebSocket :3333"]
        WS[ws-chat.ts — Handler WS]
        CMD[ws-commands.ts — /compose /imagine /web]
        ROUTER[ws-conversation-router.ts — pickResponders + @mention]
        LLM[ws-ollama.ts — Stream + Tools + Think-strip]
        MULTI[ws-multimodal.ts — TTS HTTP + Vision]
        TOOLS[mcp-tools.ts — web_search, image_generate, rag_search]
        MSTORE[media-store.ts — Persistance media]
        CTX[context-store.ts — Contexte JSONL 4000ch]
        RAG[rag.ts — LightRAG + local fallback]
        REST[Routes REST — session, personas, media]
    end

    subgraph Infra["Services Infrastructure"]
        OLLAMA["Ollama natif :11434\nqwen3:8b · mistral:7b · qwen3-vl:8b"]
        PG[(PostgreSQL 16 :5432)]
        SEARX[SearXNG :8080]
    end

    subgraph MLStack["ML / Génération"]
        TTS[TTS Sidecar :9100\nproxy Chatterbox + Piper fallback]
        CBOX[Chatterbox Docker :9200\nGPU voice cloning]
        LRAG[LightRAG :9621\nGraph RAG knowledge graph]
        COMFY[ComfyUI SDXL\nstable2.kxkm.net]
    end

    subgraph Worker["Worker GPU"]
        ENGINE[Node Engine — DAG exec]
        TRAIN[Training Unsloth/TRL]
    end

    subgraph External["Hors cluster"]
        STABLE[StableView :3000\ninterface séparée]
    end

    Chat -- "WS message/command" --> WS
    Voice -- "WS upload audio" --> WS
    Compose -- "WS /compose" --> CMD
    Imagine -- "WS /imagine" --> CMD
    Media -- "REST /api/v2/media" --> REST

    WS --> ROUTER --> LLM --> OLLAMA
    ROUTER --> CTX
    ROUTER --> RAG
    LLM -- "tool_call web_search" --> TOOLS --> SEARX
    LLM -- "tool_call image_generate" --> TOOLS --> COMFY
    LLM -- "tool_call rag_search" --> TOOLS --> LRAG
    LLM -- "TTS" --> MULTI --> TTS --> CBOX
    LLM -- "Vision qwen3-vl:8b" --> MULTI --> OLLAMA
    RAG -- "query hybrid" --> LRAG --> OLLAMA
    CMD -- "/imagine" --> COMFY
    CMD -- "/web" --> SEARX
    CMD -- "save" --> MSTORE
    REST --> PG
    ENGINE --> TRAIN --> OLLAMA
```

## Flux chat — séquence complète

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant WS as WebSocket Server
    participant PR as pickResponders
    participant Ph as Pharmacius (routeur)
    participant Sh as Sherlock (web_search)
    participant Sp as Spécialiste @mention
    participant CTX as ContextStore
    participant RAG as RAG (LightRAG)
    participant TTS as TTS Sidecar :9100
    participant OL as Ollama

    U->>WS: message "cherche des infos sur Xenakis"
    WS->>WS: broadcast user message to all clients
    WS->>CTX: addToContext(channel, user, text)

    Note over WS,PR: pickResponders: @mention direct → persona mentionnée<br/>sinon → Pharmacius (routeur par défaut)

    WS->>PR: pickResponders(text, personas)
    PR-->>WS: [Pharmacius]

    WS->>CTX: getContextString(channel)
    CTX-->>WS: contexte conversationnel (4000 chars)
    WS->>RAG: search(text, 2 results)
    RAG-->>WS: chunks pertinents du manifeste

    WS->>OL: streamOllamaChat(Pharmacius, enrichedText)
    Note over Ph,OL: Pharmacius: max 2 phrases, no tools<br/>Routage → @Sherlock pour recherche web
    OL-->>WS: stream chunks
    WS->>WS: stripThinking + broadcast "message" (final replaces chunks)
    WS->>CTX: addToContext(channel, Pharmacius, fullText)

    Note over WS: Détecte @Sherlock → inter-persona chain<br/>depth+1, délai 2000ms, max depth=3

    WS->>OL: streamOllamaChatWithTools(Sherlock, contextMessage, [web_search, rag_search])
    OL-->>WS: tool_call: web_search("Xenakis")
    WS->>Sh: executeTool(web_search)
    Sh->>WS: SearXNG query → 5 résultats
    WS->>OL: tool result → continue generation
    OL-->>WS: stream chunks (analyse des résultats)
    WS->>WS: broadcast final message to all clients
    WS->>CTX: addToContext(channel, Sherlock, fullText)

    Note over WS,CTX: Memory update: every 5 messages per persona<br/>LLM extracts facts + summary → persona-memory/{nick}.json

    opt TTS_ENABLED=1
        WS->>TTS: POST /synthesize {nick, text}
        TTS->>TTS: Chatterbox GPU :9200 (voice cloning)
        TTS-->>WS: audio WAV
        WS->>U: audio base64 broadcast
    end
```

## Routing Pharmacius → Spécialistes

```mermaid
graph LR
    Ph((Pharmacius<br/>routeur))

    subgraph Son["Son / Musique"]
        Schaeffer[Schaeffer<br/>musique concrète]
        Radigue[Radigue<br/>drones]
        Oliveros[Oliveros<br/>deep listening]
        Eno[Eno<br/>composition]
    end

    subgraph Pensee["Pensée / Philosophie"]
        Batty[Batty<br/>existentiel]
        Foucault[Foucault<br/>pouvoir]
        Deleuze[Deleuze<br/>concepts]
    end

    subgraph Politique["Politique / Résistance"]
        Swartz[Swartz<br/>hacktivisme]
        Bookchin[Bookchin<br/>écologie]
        LeGuin[LeGuin<br/>SF/utopie]
    end

    subgraph Tech["Tech / Science"]
        Turing[Turing<br/>code/hack]
        Hypatia[Hypatia<br/>science]
        Curie[Curie<br/>science]
        Sherlock[Sherlock<br/>web_search]
    end

    subgraph Arts["Arts vivants / Visuels"]
        Merzbow[Merzbow<br/>noise/glitch]
        Cage[Cage<br/>silence]
        Ikeda[Ikeda<br/>data art]
        Picasso[Picasso<br/>image_generate]
        TeamLab[TeamLab<br/>immersif]
        Demoscene[Demoscene<br/>demoscene]
    end

    subgraph Scene["Scène / Corps"]
        RoyalDeLuxe[RoyalDeLuxe<br/>arts de la rue]
        Decroux[Decroux<br/>mime]
        Mnouchkine[Mnouchkine<br/>théâtre]
        Pina[Pina<br/>danse]
        Grotowski[Grotowski<br/>rituel]
        Fratellini[Fratellini<br/>clown]
    end

    subgraph Transversal["Transversal"]
        Haraway[Haraway<br/>cyborg/féminisme]
        SunRa[SunRa<br/>afrofuturisme]
        Bjork[Bjork<br/>pop/nature]
        Fuller[Fuller<br/>design]
        Tarkovski[Tarkovski<br/>cinéma]
        Oram[Oram<br/>électronique/DIY]
    end

    Ph --> Son
    Ph --> Pensee
    Ph --> Politique
    Ph --> Tech
    Ph --> Arts
    Ph --> Scene
    Ph --> Transversal

    style Ph fill:#00e676,color:#000
    style Sherlock fill:#ff7043,color:#000
    style Picasso fill:#ffd54f,color:#000
```

## Services production (kxkm-ai)

| Service | Port | Docker Profile | Stack | Health | Rôle |
| ------- | ---- | ------------- | ----- | ------ | ---- |
| **API V2** | `:3333` | `v2` | Node.js (network_mode: host) | `GET /api/v2/health` | Express + WebSocket chat + React SPA |
| **PostgreSQL** | `:5432` | *(always)* | postgres:16-alpine | `pg_isready` | Persistence sessions, personas, graphs |
| **SearXNG** | `:8080` | `v2` | searxng/searxng | `wget /` | Recherche web self-hosted (Google, Bing, DDG) |
| **Chatterbox** | `:9200` | `v2` | Docker GPU (ghcr.io/devnen/chatterbox-tts-server) | `GET /get_predefined_voices` | TTS voice cloning GPU |
| **TTS Sidecar** | `:9100` | `v2` | Python (network_mode: host) | — | Proxy Chatterbox + Piper fallback |
| **LightRAG** | `:9621` | `v2` | Python 3.12 (lightrag-hku, network_mode: host) | `GET /health` | Graph RAG, knowledge graph (Ollama backend) |
| **Ollama** | `:11434` | `ollama` *(opt)* | Natif RTX 4090 | `GET /api/tags` | LLM inference: qwen3:8b, mistral:7b, qwen3-vl:8b |
| **Worker** | host | `v2` | Node.js (GPU passthrough) | — | Node Engine DAG execution, training |
| **Docling** | `:9400` | `v2` | Python (Docling REST) | `GET /health` | PDF/document parsing (tables, layout, OCR) |
| **Reranker** | `:9500` | `v2` | Python (bge-reranker-v2-m3) | `GET /health` | Cross-encoder reranking for RAG results |
| **ComfyUI** | ext | — | stable2.kxkm.net | — | Image gen SDXL |
| **StableView** | `:3000` | — | Séparé | — | Interface visualisation (hors cluster) |
| **Discord Bot** | — | `discord` | Node.js (network_mode: host) | — | Bridge chat KXKM → Discord |
| **Discord Voice** | — | `discord-voice` | Node.js + Python STT | — | STT → Personas → TTS en vocal |

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
| ------ | --- | ----- | ---- |
| apps/api | 5200 | 1000 | Backend API + WebSocket |
| apps/web | 4800 | 800 | Frontend React |
| apps/worker | 956 | 230 | Worker GPU Node Engine |
| packages/core | 172 | 86 | Types, IDs, permissions |
| packages/auth | 159 | 157 | Scrypt, sessions, RBAC |
| packages/chat-domain | 262 | 279 | Messages, channels, commands |
| packages/persona-domain | 988 | 259 | Personas, feedback, editorial |
| packages/node-engine | 1499 | 605 | DAG execution, training |
| packages/storage | 1219 | 669 | PostgreSQL repos |
| packages/ui | 134 | 29 | Theme, colors, CSS vars |
| packages/tui | 209 | 108 | ANSI formatting, tables |
| scripts | 37 fichiers | - | TTS, training, migration |
| **Total** | **~15600** | **417 tests** | |

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
| LIGHTRAG_URL | localhost:9621 | Non |
| PYTHON_BIN | python3 | Non |
| MAX_OLLAMA_CONCURRENT | 3 | Non |
| ADMIN_BOOTSTRAP_TOKEN | - | Non |
