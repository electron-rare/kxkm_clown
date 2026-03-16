# KXKM_Clown

Systeme de chat IA multi-personas au look IRC, opere en prive sur reseau local.
Chaque persona possede sa propre voix editoriale (ton, lexique, themes), alimentee par des sources web et affinee par feedback utilisateur.
Le Node Engine orchestre les workflows de donnees et de training via graphes DAG.

## Quick Start (developpement)

```bash
npm install

# V1 (monolithique)
node server.js

# V2 (monorepo TypeScript)
npm run dev:v2:api      # API Express (port 4180)
npm run dev:v2:web      # Frontend React/Vite (port 5173)
npm run dev:v2:worker   # Worker Node Engine (poll Postgres)
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
Configurer `OLLAMA_URL` dans `.env` pour changer.

## Variables d'environnement

| Variable | Default | Description |
| --- | --- | --- |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | URL du serveur Ollama |
| `DATABASE_URL` | (auto via compose) | Connexion PostgreSQL |
| `APP_PORT` | `3333` | Port V1 |
| `API_PORT` | `4180` | Port V2 API |
| `ADMIN_BOOTSTRAP_TOKEN` | (vide) | Token admin initial |
| `ADMIN_ALLOWED_SUBNETS` | (vide) | CIDR autorise pour admin (ex: `192.168.1.0/24`) |
| `MAX_GENERAL_RESPONDERS` | `4` | Nombre max de personas repondant dans #general |
| `OWNER_NICK` | (vide) | Pseudo du proprietaire |

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

- Ouvrir `http://<host>:3333` (V1) ou `http://<host>:5173` (V2 dev)
- Commandes slash: `/help`, `/clear`, `/nick`, `/join`, `/msg`, `/web`, `/status`, `/model`, `/persona`, `/reload`, `/export`
- Tab pour completer nicks et commandes
- ArrowUp/Down pour naviguer l'historique des messages envoyes

### Admin personas

- V1: `http://<host>:3333/admin/personas.html`
- V2: `http://<host>:4180/api/v2/personas` (API REST)
- Pipeline editorial: source -> feedback -> proposals -> apply/revert
- Pharmacius: orchestrateur editorial automatique

### Node Engine

- V2 API: `http://<host>:4180/api/v2/node-engine/graphs`
- 15+ types de noeuds, 7 familles (dataset, processing, training, evaluation, registry, deployment)
- Editeur visuel React Flow dans le frontend V2
- Worker consomme la queue Postgres et execute les runs

### Ops TUI

```bash
node ops/v2/health-check.js          # Sante des services
node ops/v2/health-check.js --watch  # Monitoring continu
node ops/v2/queue-viewer.js          # Queue Node Engine
node ops/v2/persona-manager.js       # Vue personas
node ops/v2/log-rotate.js --dry-run  # Rotation logs
```

### Autoresearch

```bash
npm run v2:autoresearch    # Boucle autoresearch continue
# ou execution unique:
node scripts/v2-autoresearch-loop.js --config ops/v2/autoresearch.example.json --once
```

Prerequis: Postgres + worker actif + graph existant.

## Architecture

```text
kxkm_clown/
├── apps/
│   ├── api/        # Express REST + WebSocket (TypeScript)
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
├── public/         # Frontend V1 + admin HTML
├── scripts/        # Build, migration, smoke tests
├── ops/v2/         # Orchestration, monitoring TUI
└── docs/           # Architecture, specs, runbooks
```

## Etat V1 / V2

| Composant | V1 | V2 |
| --- | --- | --- |
| Chat temps reel | operationnel | operationnel |
| Admin session | operationnel | operationnel |
| Personas + feedback | operationnel | operationnel |
| Node Engine | operationnel | operationnel |
| RBAC | n/a | operationnel |
| Frontend React | n/a | operationnel |
| Training (TRL/Unsloth) | n/a | operationnel |
| Tests (135+) | smoke | unit + component + smoke |

Notes runtime V2:

- API V2: postgres si DATABASE_URL est present, sinon fallback local (personas persistes sur disque + runtime memory)
- Worker V2: DATABASE_URL requis (demarrage refuse sans DB)
- API V2 en production: DATABASE_URL obligatoire (throw au boot)

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Architecture systeme
- [docs/SPEC.md](docs/SPEC.md) — Specification fonctionnelle
- [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md) — Carte fonctionnelle et matrice de parite
- [docs/NODE_ENGINE_ARCHITECTURE.md](docs/NODE_ENGINE_ARCHITECTURE.md) — Node Engine DAG
- [docs/AUTORESEARCH_MODE.md](docs/AUTORESEARCH_MODE.md) — Mode autoresearch
- [docs/OPS_TUI.md](docs/OPS_TUI.md) — Operations et monitoring TUI
- [docs/RUNBOOK_MIGRATION_V1_V2.md](docs/RUNBOOK_MIGRATION_V1_V2.md) — Migration V1 vers V2

## Invariants

- Identite IRC/scene/terminal preservee
- Tracabilite personas/source/feedback/proposals
- Separation chat runtime / worker runtime / training runtime
- Exploitation privee, pas d exposition internet publique
- Operations lisibles en TUI + logs, puis nettoyage controle
