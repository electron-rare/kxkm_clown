# KXKM_Clown

> "Saboteurs of big daddy mainframe." -- VNS Matrix, 1991
>
> Systeme de chat IA multimodal multi-personas, esthetique IRC, opere en local.
> Crypto-anarchiste dans l'infrastructure, musique concrete dans le traitement du signal,
> demoscene dans la contrainte technique.

Chaque persona possede sa propre voix editoriale (ton, lexique, themes), alimentee par des sources web et affinee par feedback utilisateur.
Le systeme traite texte, images, audio et PDF. Les personas repondent avec memoire persistante et contexte RAG.
Le Node Engine orchestre les workflows de training via graphes DAG.

## Quick Start (developpement)

```bash
npm install

# V2 (architecture primaire — monorepo TypeScript)
npm run dev:v2:api      # API Express (port 4180)
npm run dev:v2:web      # Frontend React/Vite (port 5173)
npm run dev:v2:worker   # Worker Node Engine (poll Postgres)

# V1 (monolithique, reference)
node server.js
```

## Deploiement Docker

```bash
# Copier et configurer les variables d'environnement
cp .env.example .env
# Editer .env (ADMIN_BOOTSTRAP_TOKEN, OLLAMA_URL, etc.)

# V2 uniquement (API + worker + Postgres)
docker compose --profile v2 up -d

# V1 + V2
docker compose --profile v1 --profile v2 up -d

# Avec Ollama en container (si pas installe nativement)
docker compose --profile v2 --profile ollama up -d
```

Par defaut, Ollama est attendu en natif sur le host (port 11434).

## Services (13)

| Service | Port | Description |
| --- | --- | --- |
| API V1 | 3333 | Monolithe Express (chat + admin) |
| API V2 | 4180 | API TypeScript (REST + WS) |
| Frontend | 5173 | React/Vite (dev) |
| Ollama | 11434 | LLM local (qwen3:8b, mistral:7b) |
| PostgreSQL | 5432 | Persistence (personas, runs, logs) |
| SearXNG | 8080 | Recherche web self-hosted |
| TTS Sidecar | 9100 | Piper + Chatterbox (dual backend) |
| Qwen3-TTS | 9300 | Qwen3-TTS 0.6B CustomVoice (9 speakers) |
| ACE-Step | 9400 | Generation musicale (35 styles, GPU) |
| Reranker | 8787 | BGE/Jina reranking |
| Docling | 5001 | Extraction PDF (tables, OCR) |
| ComfyUI | 8188 | Generation images (32 checkpoints + 24 LoRAs) |
| Worker | --- | Node Engine job processor (GPU) |
| Discord Bot | --- | Pharmacius bridge (2 salons) |

## Fonctionnalites

### Chat multimodal

- **Interface Minitel** — Animation modem 3615 ULLA → login → chat (esthetique phosphore CRT)
- **Chat temps reel** — WebSocket `/ws`, streaming LLM, 33 personas
- **RAG local** — Embeddings Ollama (`nomic-embed-text`), contexte manifeste
- **Vision** — Analyse d'images via `qwen3-vl:8b` (upload dans le chat)
- **STT** — Transcription audio via `faster-whisper` (upload audio)
- **TTS** — Piper-tts + Chatterbox (dual backend via TTS sidecar HTTP :9100)
- **PDF** — Extraction via Docling/PyMuPDF (tables, layout, OCR)
- **Recherche web** — SearXNG self-hosted + DuckDuckGo fallback
- **Generation musicale** — `/compose` via ACE-Step 1.5 / MusicGen, 35 music styles
- **Composition pipeline** — Multi-track (`/layer`), voice (`/voice`), noise (`/noise` 5 types), ambient (`/ambient`), effects (`/fx` 9 effects: reverb, delay, chorus, flanger, distortion, bitcrusher, EQ, compressor, tremolo), mix (`/mix`). Timeline UI with 5 generation buttons (Musique, Voix, Drone, Pink, White)
- **Generation images** — `/imagine` via ComfyUI (32 checkpoints + 24 LoRAs, smart NLP selection)
- **Memoire persona** — Faits et resume persistants, compaction LLM auto (750 MB)
- **Inter-persona** — @mention directe, dialogue depth 3
- **55 commandes slash** — /help, /nick, /who, /personas, /web, /clear, /status, /compose, /imagine, /voice, /noise, /ambient, /fx, /layer, /mix, /comp, /memory, /context, /rag, /stats, /uptime, /model, /persona, /reload, /export, /changelog, /version, /dice, /roll, /flip, /ban, /unban, /mute, /unmute, /whisper, /history, /search, /react, /invite, /time, /date, /session, /speed, + more
- **Markdown chat** — Rendu Markdown (marked + DOMPurify) dans les messages
- **Smart routing** — 5 domaines thematiques (musique, philosophie, tech, arts, science)
- **Validation Zod** — 19 schemas sur toutes les routes API
- **Pino logging** — Logs structures JSON, rotation automatique
- **Dynamic ctx** — Contexte LLM adaptatif 4k-32k selon la conversation
- **Perf instrumentation** — 6 labels (http, ollama, rag, ws), p50/p95/p99, TTFC 284ms
- **Error telemetry** — 16 labels d'erreur, logging structure
- **5 CSS themes** — minitel (phosphore), crt (amber), hacker (matrix), synthwave (neon), default
- **Guest mode** — Acces lecture seule sans login, rate-limited
- **Mobile responsive** — Touch gestures, bottom nav, viewport units
- **MIME magic bytes** — Validation magic bytes sur uploads, allowlist SAFE_MIMES
- **WS reconnect** — Reconnexion auto (backoff 1s-30s), seq numbers, detection de gaps
- **CRT effect** — Phosphore vert, scanlines, flicker, boot animation modem
- **Chat virtualization** — react-window, hauteurs variables, auto-scroll

### Discord

- **Pharmacius#8988** — Bot texte bridge 2 salons Discord ↔ KXKM
- **Voice bot** — STT → personas → TTS en salon vocal Discord

### MCP (Model Context Protocol)

- **MCP Server** — stdio transport, 4 tools (kxkm_chat, kxkm_personas, kxkm_web_search, kxkm_status)
- Compatible Claude Desktop, mascarade, tout client MCP

### Training & DPO

- **Pipeline DPO** — Export paires chosen/rejected depuis feedback, format JSONL
- **Training** — TRL + Unsloth, execution via Python venv, GPU passthrough RTX 4090
- **Autoresearch** — Boucle d'experimentation automatisee avec mutations et scoring
- **Ollama import** — Import LoRA adapter dans Ollama comme nouveau modele
- **Training dashboard** — Visualisation React Flow des graphes et runs

### Personas

- 33 personas (musique, arts, sciences, philosophie, ecologie, tech, cinema)
- Streaming chunks (token-by-token), Zod validation, pino structured logging
- Pipeline editorial: source → feedback → proposals → apply/revert
- Pharmacius: routeur principal (qwen3:8b, maxTokens:600, think-strip)
- Inter-persona @mention depth 3, 2s delay
- Modeles: qwen3:8b x28, mistral:7b x5, qwen3-vl:8b (vision)

## Variables d'environnement

| Variable | Default | Description |
| --- | --- | --- |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | URL du serveur Ollama |
| `DATABASE_URL` | (auto via compose) | Connexion PostgreSQL |
| `APP_PORT` | `3333` | Port V1 |
| `API_PORT` | `4180` | Port V2 API |
| `ADMIN_BOOTSTRAP_TOKEN` | (vide) | Token admin initial (V1) |
| `ADMIN_TOKEN` | (vide) | Token admin (V2) |
| `ADMIN_ALLOWED_SUBNETS` | (vide) | CIDR autorise pour admin V1 |
| `ADMIN_SUBNET` | (vide) | CIDR autorise pour admin V2 |
| `RERANKER_URL` | `http://localhost:8787` | URL du serveur reranker (BGE/Jina) |
| `DOCLING_URL` | `http://localhost:5001` | URL du serveur Docling (extraction PDF) |
| `QWEN3_TTS_URL` | (vide) | URL du serveur TTS Qwen3 |
| `RAG_TOP_K` | `5` | Nombre de chunks RAG retournes |
| `RAG_MIN_SCORE` | `0.3` | Score minimum de similarite RAG |
| `MAX_GENERAL_RESPONDERS` | `4` | Nombre max de personas repondant dans #general |
| `OWNER_NICK` | (vide) | Pseudo du proprietaire |
| `VISION_MODEL` | `qwen3-vl:8b` | Modele Ollama pour analyse d'images |
| `TTS_ENABLED` | `0` | Activer la synthese vocale (`1` pour activer) |
| `WEB_SEARCH_API_BASE` | (vide) | Endpoint API de recherche web custom |
| `PYTHON_BIN` | `python3` | Python avec libs ML (PyTorch, faster-whisper, piper-tts) |
| `SCRIPTS_DIR` | `./scripts` | Chemin vers les scripts Python (TTS, STT, training) |

## Commandes slash (55)

| Commande | Description | Admin |
| --- | --- | --- |
| `/help` | Aide | non |
| `/nick <nom>` | Changer pseudo | non |
| `/who` | Liste des connectes | non |
| `/personas` | Liste des personas actives | non |
| `/web <query>` | Recherche web + commentaire personas | non |
| `/clear` | Effacer le chat | non |
| `/status` | Statut systeme | non |
| `/compose <prompt>` | Generation musicale (ACE-Step, 35 styles) | non |
| `/imagine <prompt>` | Generation image (ComfyUI, smart selection) | non |
| `/voice` | Toggle TTS voix | non |
| `/memory` | Afficher memoire persona | non |
| `/context` | Afficher contexte conversation | non |
| `/rag <query>` | Recherche RAG directe | non |
| `/stats` | Statistiques chat | non |
| `/uptime` | Temps de fonctionnement | non |
| `/changelog` | Historique git recent | non |
| `/version` | Version et info app | non |
| `/dice NdS` | Lancer des des | non |
| `/roll` | Lancer 1d6 | non |
| `/flip` | Pile ou face | non |
| `/whisper <persona>` | Message prive a une persona | non |
| `/history N` | Historique N derniers messages | non |
| `/search <mot>` | Recherche dans le contexte | non |
| `/react <emoji>` | Reaction emoji broadcast | non |
| `/invite <persona>` | Inviter persona dans le canal | non |
| `/time` | Heure (Europe/Paris) | non |
| `/date` | Date (FR locale) | non |
| `/session` | Info session courante | non |
| `/speed` | Diagnostics latence (TTFC, p50/p95) | non |
| `/layer <prompt>` | Ajouter une couche audio a la composition | non |
| `/mix` | Mixer les couches de la composition | non |
| `/comp` | Gerer la composition (structure, info) | non |
| `/noise <type>` | Generer bruit ambiant (white/pink/brown/rain/wind) | non |
| `/ambient <scene>` | Scene ambiante (forest/ocean/city/space/cave) | non |
| `/fx <effect>` | Appliquer effet audio (reverb/delay/chorus/flanger/distortion/bitcrusher/eq/compressor/tremolo) | non |
| `/model` | Changer modele | oui |
| `/persona` | Gerer personas | oui |
| `/reload` | Recharger config | oui |
| `/export` | Exporter donnees | oui |
| `/ban <nick>` | Bannir un utilisateur | oui |
| `/unban <nick>` | Debannir un utilisateur | oui |
| `/mute <persona>` | Muter une persona | non |
| `/unmute <persona>` | Demuter une persona | non |

Mention directe: `@Schaeffer ta question` pour s'adresser a une persona specifique.

## Verification

```bash
npm run check        # Lint V1 + TypeScript V2
npm run check:v2     # TypeScript V2 uniquement
npm run smoke        # Tests d'integration V1
npm run smoke:v2     # Tests d'integration V2 (22 tests)
npm run test:v2      # Tests unitaires V2 (425 tests)
npm run turbo:build  # Build complet
```

## Administration

### Chat

- Ouvrir `http://<host>:4180` (V2 prod) ou `http://<host>:5173` (V2 dev)
- V1: `http://<host>:3333`
- Upload fichiers: images, audio, PDF, texte — analyse automatique

### Admin personas

- V2: `http://<host>:4180/api/v2/personas` (API REST)
- V1: `http://<host>:3333/admin/personas.html`
- Pipeline editorial: source → feedback → proposals → apply/revert

### Node Engine

- V2 API: `http://<host>:4180/api/admin/node-engine/graphs`
- 15+ types de noeuds, 7 familles
- Editeur visuel React Flow dans le frontend V2
- Worker consomme la queue Postgres et execute les runs

### Autoresearch

```bash
npm run v2:autoresearch    # Boucle autoresearch continue
# ou execution unique:
node scripts/v2-autoresearch-loop.js --config ops/v2/autoresearch.example.json --once
```

### Ollama import (deploiement modele fine-tune)

```bash
node scripts/ollama-import.js --base llama3.2:1b --adapter /path/to/adapter --name kxkm-my-model
```

### Ops TUI

```bash
node ops/v2/health-check.js          # Sante des services
node ops/v2/health-check.js --watch  # Monitoring continu
node ops/v2/queue-viewer.js          # Queue Node Engine
node ops/v2/persona-manager.js       # Vue personas
node ops/v2/log-rotate.js --dry-run  # Rotation logs
```

## Architecture

```text
kxkm_clown/
├── apps/
│   ├── api/src/
│   │   ├── server.ts           # Entry point (HTTP + WS + RAG)
│   │   ├── app.ts              # Express app factory + middleware
│   │   ├── ws-chat.ts          # WebSocket core (broadcast, rate limit, dispatch)
│   │   ├── ws-ollama.ts        # Ollama streaming + tool-calling
│   │   ├── ws-multimodal.ts    # TTS (Piper + XTTS-v2), STT, vision
│   │   ├── ws-persona-router.ts # Persona memory + routing
│   │   ├── ws-upload-handler.ts # File upload pipeline (PDF, audio, images)
│   │   ├── routes/             # Express route modules
│   │   │   ├── session.ts      # Auth, health, status, analytics
│   │   │   ├── personas.ts     # Persona CRUD, feedback, proposals
│   │   │   ├── node-engine.ts  # Graphs, runs, models
│   │   │   └── chat-history.ts # Export, search, retention
│   │   ├── rag.ts              # Local RAG (nomic-embed-text)
│   │   ├── context-store.ts    # Conversation memory (750 MB, LLM compaction)
│   │   ├── comfyui.ts          # Image generation (SDXL + Flux 2)
│   │   ├── web-search.ts       # SearXNG + DuckDuckGo fallback
│   │   └── mcp-tools.ts        # Tool definitions per persona
│   ├── web/src/                # React/Vite frontend (Minitel UI)
│   └── worker/                 # Node Engine job processor (GPU)
├── packages/
│   ├── core/                   # Types, IDs, permissions
│   ├── auth/                   # RBAC, crypto, sessions
│   ├── chat-domain/            # Messages, channels, slash commands
│   ├── persona-domain/         # Personas, Pharmacius, DPO, patches
│   ├── node-engine/            # DAG, runs, queue, sandbox, training
│   ├── storage/                # Postgres repos + migrations
│   ├── ui/                     # Theme constants
│   └── tui/                    # ANSI terminal helpers
├── scripts/
│   ├── compose_music.py        # ACE-Step 1.5 / MusicGen
│   ├── tts_clone_voice.py      # XTTS-v2 voice cloning
│   ├── tts_synthesize.py       # Piper TTS
│   ├── transcribe_audio.py     # faster-whisper STT
│   ├── discord-pharmacius.js   # Discord text bridge (2 salons)
│   ├── discord-voice.js        # Discord voice bot (STT→LLM→TTS)
│   ├── mcp-server.js           # MCP Server (stdio, 4 tools)
│   ├── bench-embeddings.js     # Benchmark nomic vs BGE-M3
│   └── generate-voice-samples.js # XTTS reference samples generator
├── ops/v2/
│   ├── deep-audit.js           # Security/perf/complexity TUI
│   ├── perf-monitor.js         # Latency/memory/status TUI
│   ├── health-check.js         # Service health TUI
│   ├── queue-viewer.js         # Node Engine queue TUI
│   └── persona-manager.js      # Persona overview TUI
├── data/
│   ├── manifeste.md            # Ame du projet
│   ├── chat-logs/              # JSONL quotidien
│   ├── persona-memory/         # Memoire persistante par persona
│   ├── voice-samples/          # XTTS reference WAV per persona
│   └── node-engine/            # Graphes, runs, registry
└── docs/                       # Architecture, specs, audit, OSS watch
```

## Etat V1 / V2

| Composant | V1 | V2 |
| --- | --- | --- |
| Chat temps reel | operationnel | operationnel |
| RAG local | n/a | operationnel |
| Vision (qwen3-vl:8b) | n/a | operationnel |
| STT (faster-whisper) | n/a | operationnel |
| TTS (piper-tts) | n/a | operationnel |
| PDF extraction | n/a | operationnel |
| Recherche web | operationnel | operationnel |
| Memoire persona | n/a | operationnel |
| Chat history (logs) | n/a | operationnel |
| Admin session | operationnel | operationnel |
| Personas + feedback | operationnel | operationnel |
| Node Engine | operationnel | operationnel |
| DPO pipeline | operationnel | operationnel |
| Autoresearch | n/a | operationnel |
| Ollama import | n/a | operationnel |
| RBAC | n/a | operationnel |
| Frontend React | n/a | operationnel |
| Training (TRL/Unsloth) | n/a | operationnel |
| Composition pipeline | n/a | operationnel |
| Tests (425+) | smoke | unit + component + smoke (425+ pass) |
| VoiceChat push-to-talk | n/a | operationnel |
| Mediatheque gallery/playlist | n/a | operationnel |
| UI Minitel VIDEOTEX | n/a | operationnel |
| Deploy tmux (deploy.sh) | n/a | operationnel |

Notes runtime V2:

- API V2: postgres si DATABASE_URL est present, sinon fallback local
- Worker V2: DATABASE_URL requis
- API V2 en production: DATABASE_URL obligatoire

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Architecture systeme et diagrammes
- [docs/SPEC.md](docs/SPEC.md) — Specification fonctionnelle et protocole WebSocket
- [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md) — Carte fonctionnelle et matrice de parite
- [docs/NODE_ENGINE_ARCHITECTURE.md](docs/NODE_ENGINE_ARCHITECTURE.md) — Node Engine DAG
- [docs/AUTORESEARCH_MODE.md](docs/AUTORESEARCH_MODE.md) — Mode autoresearch
- [docs/OPS_TUI.md](docs/OPS_TUI.md) — Operations et monitoring TUI
- [docs/RUNBOOK_MIGRATION_V1_V2.md](docs/RUNBOOK_MIGRATION_V1_V2.md) — Migration V1 vers V2

## Manifeste

Ce projet porte une identite. Le manifeste (`data/manifeste.md`) ancre KXKM_Clown dans une lignee culturelle precise: musique concrete (Schaeffer, Radigue, Oliveros), cyberfeminisme (VNS Matrix, Haraway), crypto-anarchisme (Swartz, Cypherpunks), afrofuturisme (Sun Ra, Jemisin, Okofor), demoscene (cracktros, contraintes 4K), situationnisme (detournement computationnel).

Un LLM local qui refuse le cloud centralise est un acte politique. L'esthetique IRC/terminal n'est pas un choix retro -- c'est une declaration: le medium est le message.

> "Le vrai voyage, c'est le retour: du cloud vers le local." -- electron rare

## Invariants

- Identite IRC/scene/terminal preservee
- Tracabilite personas/source/feedback/proposals
- Separation chat runtime / worker runtime / training runtime
- Exploitation privee, pas d'exposition internet publique
- Operations lisibles en TUI + logs, puis nettoyage controle

## Mode operatoire agents + TUI

Boucle d'execution recommandee pour avancer par lots sans derive:

```bash
# 1) Audit signal
node ops/v2/deep-audit.js

# 2) Validation technique
npm run check:v2
npm run test:v2

# 3) Monitoring TUI
node ops/v2/health-check.js --watch
node ops/v2/queue-viewer.js --watch

# 4) Hygiene logs
node ops/v2/log-rotate.js --max-age-days 7
```

Principes:
- Mode chirurgical: petites corrections, verification immediate, documentation synchronisee.
- TUI-first pour l'operabilite: observer, corriger, reverifier, purger.
- Respect manifeste: esthetique radicale, execution propre, local-first, souverainete outillage.