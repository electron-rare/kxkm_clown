# lot-206-feedback-convergence

- Date: 2026-03-25T19:34:59Z
- Owner: Backend API
- Status: done

## Objectif

Converger les feedbacks personas vers une seule source de verite repo-backed et supprimer le doublon JSONL legacy qui polluait l export DPO.

## Correctifs

- `packages/persona-domain/src/editorial.ts`
  - votes structures `JSON`
  - parser compatible legacy
  - `extractDPOPairs()` base sur `prompt`, `chosen`, `rejected`
- `apps/api/src/routes/personas.ts`
  - nouveau `POST /api/v2/feedback` repo-backed avec validation Zod
- `apps/api/src/routes/session.ts`
  - suppression de l ancien writer `data/feedback/*.jsonl`
  - suppression du vieux `GET /api/v2/export/dpo`
- `apps/api/src/routes/chat-history.ts`
  - export DPO unique, compat `persona_id` et alias `persona`
- `apps/web/src/components/Chat.tsx`
  - recuperation du prompt utilisateur precedent au vote
- `apps/web/src/components/ChatMessage.tsx`
  - `signal: "react" | "pin"` au lieu de surcharger `vote`

## Validation

- test domaine `packages/persona-domain/src/index.test.ts` OK
- test API cible `apps/api/src/app.test.ts` OK
- `npm run check` OK
- `npm run test:v2` OK

## Impact

- plus de split-brain entre feedback repo et JSONL legacy
- export DPO alimente par les vraies paires `prompt/chosen/rejected`
- les reactions et pins n injectent plus de faux votes dans le corpus DPO
