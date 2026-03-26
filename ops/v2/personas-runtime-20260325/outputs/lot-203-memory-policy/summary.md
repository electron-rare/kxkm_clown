# lot-203-memory-policy

- Status: in_progress
- Date: 2026-03-25
- Scope: introduire un moteur de policy partage pour l extraction, la cadence d update et le pruning de la memoire personas V2

## Actions

- ajout de `apps/api/src/persona-memory-policy.ts`
- centralisation des caps runtime et des overrides `KXKM_PERSONA_MEMORY_*`
- integration de la policy dans `persona-memory-store.ts`, `ws-persona-router.ts` et `ws-conversation-router.ts`
- ajout de tests cibles sur la policy, le store et le routeur conversationnel
- correction de l invalidation du cache memoire apres mise a jour en arriere-plan
- correction du marquage des rebounds inter-persona pour ne plus les serialiser comme des messages user
- alignement de `scripts/cleanup-logs.sh` sur les overrides runtime de la policy memoire

## Reste a faire

- telemetry memory drift / recall / write-rate
- eval harness de coherence memory

## Validation

- `npm run check`
- `npm run test:v2`
