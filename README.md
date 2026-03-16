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

## Fonctionnalites

### Chat multimodal

- **Chat temps reel** — WebSocket `/ws`, streaming LLM, esthetique IRC
- **Multi-personas** — Schaeffer, Batty, Radigue... chacun avec sa voix et son modele
- **RAG local** — Embeddings Ollama (`nomic-embed-text`), contexte manifeste injecte automatiquement
- **Vision** — Analyse d'images via `minicpm-v` (upload dans le chat)
- **STT** — Transcription audio via `faster-whisper` (upload audio)
- **TTS** — Synthese vocale via `piper-tts`, voix distincte par persona
- **PDF** — Extraction texte automatique des PDF uploades
- **Recherche web** — `/web <query>` via DuckDuckGo Lite ou API custom
- **Memoire persona** — Faits et resume persistants, mis a jour toutes les 5 interactions

### Training & DPO

- **Pipeline DPO** — Export paires chosen/rejected depuis feedback, format JSONL
- **Training** — TRL + Unsloth, execution via Python venv, GPU passthrough
- **Autoresearch** — Boucle d'experimentation automatisee avec mutations et scoring
- **Ollama import** — Import LoRA adapter dans Ollama comme nouveau modele
- **Training dashboard** — Visualisation React Flow des graphes et runs

### Personas

- Pipeline editorial: source → feedback → proposals → apply/revert
- Pharmacius: orchestrateur editorial automatique
- Activation/desactivation a chaud, overrides runtime

## Variables d'environnement

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_URL` | `http://host.docker.internal:11434` | URL du serveur Ollama |
| `DATABASE_URL` | (auto via compose) | Connexion PostgreSQL |
| `APP_PORT` | `3333` | Port V1 |
| `API_PORT` | `4180` | Port V2 API |
| `ADMIN_BOOTSTRAP_TOKEN` | (vide) | Token admin initial (V1) |
| `ADMIN_TOKEN` | (vide) | Token admin (V2) |
| `ADMIN_ALLOWED_SUBNETS` | (vide) | CIDR autorise pour admin V1 |
| `ADMIN_SUBNET` | (vide) | CIDR autorise pour admin V2 |
| `MAX_GENERAL_RESPONDERS` | `4` | Nombre max de personas repondant dans #general |
| `OWNER_NICK` | (vide) | Pseudo du proprietaire |
| `VISION_MODEL` | `minicpm-v` | Modele Ollama pour analyse d'images |
| `TTS_ENABLED` | `0` | Activer la synthese vocale (`1` pour activer) |
| `WEB_SEARCH_API_BASE` | (vide) | Endpoint API de recherche web custom |
| `PYTHON_BIN` | `python3` | Python avec libs ML (PyTorch, faster-whisper, piper-tts) |
| `SCRIPTS_DIR` | `./scripts` | Chemin vers les scripts Python (TTS, STT, training) |

## Commandes slash

| Commande | Description | Admin |
|----------|-------------|-------|
| `/help` | Aide | non |
| `/nick <nom>` | Changer pseudo | non |
| `/who` | Liste des connectes | non |
| `/personas` | Liste des personas actives | non |
| `/web <query>` | Recherche web + commentaire personas | non |
| `/clear` | Effacer le chat | non |
| `/status` | Statut systeme | non |
| `/model` | Changer modele | oui |
| `/persona` | Gerer personas | oui |
| `/reload` | Recharger config | oui |
| `/export` | Exporter donnees | oui |

Mention directe: `@Schaeffer ta question` pour s'adresser a une persona specifique.

## Verification

```bash
npm run check        # Lint V1 + TypeScript V2
npm run check:v2     # TypeScript V2 uniquement
npm run smoke        # Tests d'integration V1
npm run smoke:v2     # Tests d'integration V2 (22 tests)
npm run test:v2      # Tests unitaires V2 (102 tests)
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
│   ├── api/        # Express REST + WebSocket + RAG + multimodal (TypeScript)
│   ├── web/        # React/Vite frontend
│   └── worker/     # Job processor (poll Postgres)
├── packages/
│   ├── core/       # Types, IDs, permissions
│   ├── auth/       # RBAC, crypto, sessions
│   ├── chat-domain/    # Messages, channels
│   ├── persona-domain/ # Personas, Pharmacius, DPO
│   ├── node-engine/    # DAG, runs, queue, training
│   ├── storage/    # Postgres repos + migrations
│   ├── ui/         # Composants React partages
│   └── tui/        # Helpers terminal ANSI
├── scripts/
│   ├── tts_synthesize.py      # Piper TTS
│   ├── transcribe_audio.py    # faster-whisper STT
│   ├── ollama-import.js       # Import adapter CLI
│   └── ollama-import-adapter.sh
├── public/         # Frontend V1 + admin HTML
├── ops/v2/         # Orchestration, monitoring TUI
├── data/
│   ├── manifeste.md           # Ame du projet
│   ├── chat-logs/             # JSONL quotidien
│   ├── persona-memory/        # Memoire persistante par persona
│   └── node-engine/           # Graphes, runs, registry
└── docs/           # Architecture, specs, runbooks
```

## Etat V1 / V2

| Composant | V1 | V2 |
| --- | --- | --- |
| Chat temps reel | operationnel | operationnel |
| RAG local | n/a | operationnel |
| Vision (minicpm-v) | n/a | operationnel |
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
| Tests (135+) | smoke | unit + component + smoke |

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
