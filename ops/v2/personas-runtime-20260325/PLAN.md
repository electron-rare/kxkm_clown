# PLAN (kxkm-personas-runtime-20260325)

Updated: 2026-03-25T20:16:12Z

## lot-201-runtime-hardening [done]
- Description: Durcir le runtime personas local et basculer le store actif en per-file v2-local
- Depends on: none
- Owner: Personas
- Execution: manual
- Checks: npm run check, npm run test:v2
- Summary: Done: persistence per-file, merge legacy partiel -> per-file, loaders retryables, clones defensifs, tests de non-regression, scripts smoke/build alignes.

## lot-202-memory-schema [done]
- Description: Formaliser un schema memory persona v2 avec working memory et archival memory
- Depends on: lot-201-runtime-hardening
- Owner: Personas
- Execution: manual
- Checks: npm run check, npm run test:v2
- Summary: Done: store partage `persona-memory-store`, migration auto V1 -> V2 par personaId, miroir legacy de compat, commandes runtime basculees et tests cibles ajoutes.

## lot-203-memory-policy [pending]
- Description: Ajouter un moteur de policies pour extraction, summarization, pruning et evaluation memory
- Depends on: lot-202-memory-schema
- Owner: Backend API
- Execution: manual
- Checks: npm run check, npm run test:v2
- Summary: Pending.

## lot-204-oss-benchmark [in_progress]
- Description: Comparer patterns Letta LangGraph Mem0 et preparer un spike OpenCharacter PCL
- Depends on: lot-201-runtime-hardening
- Owner: Veille OSS
- Execution: manual
- Checks: docs-reviewed
- Summary: Veille documentee et plan benchmark poses; spike OpenCharacter/PCL encore pending.

## lot-205-store-audit [done]
- Description: Ajouter un audit TUI du store personas per-file, verifier les reliquats legacy et encadrer l archivage des fichiers globaux
- Depends on: lot-201-runtime-hardening
- Owner: Ops/TUI
- Execution: manual
- Checks: node --check ops/v2/persona-store-audit.js, node ops/v2/persona-store-audit.js --json
- Summary: Done: script TUI/JSON ajoute, fixture d archivage validee, audit du store reel documente, logs de travail lus puis purges.

## lot-206-feedback-convergence [done]
- Description: Converger le runtime feedback personas vers le repo per-file et supprimer le doublon DPO legacy
- Depends on: lot-201-runtime-hardening
- Owner: Backend API
- Execution: manual
- Checks: npm run check, npm run test:v2
- Summary: Done: votes structures, route feedback repo-backed, export DPO unique, compat query alias, frontend vote/signal normalise, tests de non-regression.

## lot-207-memory-alignment [done]
- Description: Nettoyer les artefacts generes evidents et realigner scripts/docs sur le store memoire personas V2
- Depends on: lot-202-memory-schema
- Owner: Coordinateur
- Execution: manual
- Checks: bash -n scripts/cleanup-logs.sh, bash -n scripts/dpo-export.sh, npm run check
- Summary: Done: cleanup du bruit genere, script de retention rendu V2-aware, specs/docs alignees sur `data/v2-local/persona-memory`, references legacy reduites au miroir de compatibilite.
