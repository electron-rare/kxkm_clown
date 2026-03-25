# V2 Execution Root

Ce dossier héberge l'orchestration batch de la refonte V2.

Fichiers attendus:
- `pipeline.json`
- `state.json`
- `PLAN.md`
- `TODO.md`
- `logs/`
- `outputs/`

L'orchestrateur n'écrit pas dans les données métier du runtime; il tient seulement le suivi des lots V2.

Scripts ops utiles:
- `node ops/v2/health-check.js`
- `node ops/v2/persona-manager.js`
- `node ops/v2/persona-store-audit.js`

Audit store personas:
- `node ops/v2/persona-store-audit.js --json`
- `node ops/v2/persona-store-audit.js --archive`
- Log de travail: `ops/v2/logs/persona-store-audit.jsonl`
- Trace durable a consigner dans `ops/v2/personas-runtime-20260325/outputs/`
