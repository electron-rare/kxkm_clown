# KXKM_Clown

Systeme de chat IA multi-personas au look IRC, opere en prive sur reseau local.
Chaque persona possede sa propre voix editoriale (ton, lexique, themes), alimentee par des sources web et affinee par feedback utilisateur.
Le Node Engine orchestre les workflows de donnees et de training via graphes DAG.

## Quick Start

```bash
npm install

# V1
node server.js

# V2
npm run dev:v2:api
npm run dev:v2:web
npm run dev:v2:worker

# Verification
npm run check
npm run smoke

# Build
npm run build

# Ops
npm run v2:init
npm run v2:status
npm run v2:next
```

## Etat V1 / V2

| Composant | V1 | V2 |
|---|---|---|
| Chat temps reel | operationnel | operationnel |
| Admin session | operationnel | operationnel |
| Personas + feedback | operationnel | operationnel |
| Node Engine | operationnel | operationnel |
| RBAC | n/a | operationnel |
| Frontend React | n/a | operationnel |

Notes runtime V2:
- API V2: postgres si DATABASE_URL est present, sinon fallback memory (dev)
- Worker V2: DATABASE_URL requis
- API V2 en production: DATABASE_URL requis

## Documentation

- docs/ARCHITECTURE.md
- docs/SPEC.md
- docs/FEATURE_MAP.md
- docs/NODE_ENGINE_ARCHITECTURE.md
- docs/OPS_TUI.md
- docs/AGENTS.md

## Invariants

- Identite IRC/scene/terminal preservee
- Tracabilite personas/source/feedback/proposals
- Separation chat runtime / worker runtime / training runtime
- Exploitation privee, pas d exposition internet publique
- Operations lisibles en TUI + logs, puis nettoyage controle
