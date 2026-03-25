# lot-207-memory-alignment

- Status: done
- Date: 2026-03-25
- Scope: nettoyer les artefacts generes evidents et aligner scripts/docs sur le store `data/v2-local/persona-memory`

## Actions

- restauration des artefacts generes `apps/api/data/channel-state.json` et `apps/web/tsconfig.tsbuildinfo`
- alignement de `scripts/cleanup-logs.sh` sur le store V2 avec support du miroir legacy
- suppression d une variable legacy morte dans `scripts/dpo-export.sh`
- synchronisation de `docs/ARCHITECTURE.md`, `docs/SPEC.md`, `docs/SPEC_PERSONAS.md`, `docs/FEATURE_MAP.md`, `docs/SPEC_INFRA.md`

## Validation

- `bash -n scripts/cleanup-logs.sh`
- `bash -n scripts/dpo-export.sh`
- `npm run check`
