# KXKM_Clown

Systeme de chat IA multi-personas au look IRC, opere en prive sur reseau local. Chaque persona possede sa propre voix editoriale (ton, lexique, themes), alimentee par des sources web et affinee par un pipeline de feedback utilisateur. Un Node Engine orchestre les workflows de traitement de donnees et d'entrainement de modeles sous forme de graphes DAG.

## Quick Start

```bash
# Installation
npm install

# Demarrage V1
node server.js

# Validation
npm run check        # Syntaxe V1 + TypeScript V2
npm run smoke        # 30+ tests d'integration

# Build
npm run build        # Dist V1 + compilation V2

# V2 (monorepo en cours)
npm run dev:v2:api   # API V2
npm run dev:v2:web   # Shell React/Vite
npm run v2:init      # Init workspace V2
npm run v2:status    # Etat de la migration
```

## Architecture

Le projet suit une architecture modulaire documentee dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**V1** -- Serveur Node.js monolithique : WebSocket chat, HTTP API admin, persona runtime, Node Engine, persistance flat-file JSON/JSONL.

**V2** -- Monorepo TypeScript avec workspaces : `apps/` (api, web, worker) et `packages/` (domaines partages). Migration progressive depuis V1.

## Fonctionnalites principales

- **Chat IRC-style** -- WebSocket temps reel, multi-canaux, streaming LLM, upload fichiers, commandes slash
- **Personas editoriales** -- Sources web, ton/lexique/themes, feedback utilisateur, proposals auto, Pharmacius orchestrateur
- **Admin dashboard** -- Auth session cookie, modules switchables, status temps reel, overrides runtime
- **Node Engine** -- Graphes DAG, 7 familles / 16+ types de noeuds, queue async, artifacts, registry modeles
- **Stockage** -- JSON/JSONL flat-file, memoire conversation bornee, DPO logging, export HTML/training
- **Securite** -- Subnet gate admin, cookies HttpOnly, same-origin checks, RBAC (V2)

Voir la carte complete : [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md)

## Etat V1 / V2

| Composant | V1 | V2 |
|---|---|---|
| Chat temps reel | operationnel | prevu |
| Admin session | operationnel | operationnel |
| Personas + feedback | operationnel | prevu |
| Node Engine | operationnel | prevu |
| RBAC | -- | prevu |
| Frontend React | -- | bootstrap |

## Structure du depot

```
server.js                 # Point d'entree V1
config.js                 # Configuration
public/                   # Frontend V1 (chat + admin)
  admin/                  # Dashboard admin
apps/                     # V2 monorepo
  api/                    # Backend API V2
  web/                    # Shell React/Vite
  worker/                 # Worker Node Engine
packages/                 # Domaines partages V2
  auth/                   # Authentification
  chat-domain/            # Domaine chat
  core/                   # Utilitaires communs
  node-engine/            # Domaine Node Engine
  persona-domain/         # Domaine personas
  storage/                # Couche persistance
  tui/                    # Interface terminal
  ui/                     # Composants UI
ops/v2/                   # Orchestration batch/logs
scripts/                  # Build, check, smoke, batch
docs/                     # Specs, architecture, cartes
data/                     # Donnees persistees (runtime)
```

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) -- Vue d'ensemble technique
- [SPEC.md](docs/SPEC.md) -- Specification fonctionnelle
- [FEATURE_MAP.md](docs/FEATURE_MAP.md) -- Carte fonctionnelle et matrice de statut
- [NODE_ENGINE_ARCHITECTURE.md](docs/NODE_ENGINE_ARCHITECTURE.md) -- Architecture Node Engine
- [PROJECT_MEMORY.md](docs/PROJECT_MEMORY.md) -- Memoire projet et decisions
- [OPS_TUI.md](docs/OPS_TUI.md) -- Interface operateur TUI
- [AGENTS.md](docs/AGENTS.md) -- Guide agents IA

## Invariants

- **Identite IRC** -- Preserver le look terminal/scene/IRC dans toutes les interfaces
- **Tracabilite personas** -- Chaque persona, source, feedback et proposal est traçable de bout en bout
- **Separation des runtimes** -- Chat runtime, training runtime et Node Engine worker restent distincts
- **Prive et controle** -- Pas d'exposition Internet publique ; acces restreint au reseau local
