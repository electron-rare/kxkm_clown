# PLAN (kxkm-personas-runtime-20260325)

Updated: 2026-03-25T06:00:30Z

## lot-201-runtime-hardening [done]
- Description: Durcir le runtime personas local et basculer le store actif en per-file v2-local
- Depends on: none
- Owner: Personas
- Execution: manual
- Checks: npm run check, npm run test:v2
- Summary: Done: persistence per-file, merge legacy partiel -> per-file, clones defensifs, tests de non-regression, scripts smoke/build alignes.

## lot-202-memory-schema [pending]
- Description: Formaliser un schema memory persona v2 avec working memory et archival memory
- Depends on: lot-201-runtime-hardening
- Owner: Personas
- Execution: manual
- Checks: npm run check, npm run test:v2
- Summary: A lancer apres hardening du store local.

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
