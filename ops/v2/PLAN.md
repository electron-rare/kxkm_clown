# PLAN (kxkm-clown-v2)

Updated: 2026-03-19T08:20:00Z

## lot-0-cadrage [done]
- Description: Docs, architecture, feature map, agents, invariants, orchestration
- Depends on: none
- Owner: Coordinateur
- Execution: managed
- Checks: docs-reviewed
- Summary: Cadrage historique clos, conserve comme base de référence.

## lot-1-socle [done]
- Description: Workspace V2, packages, scripts TUI, verification
- Depends on: lot-0-cadrage
- Owner: Coordinateur
- Execution: managed
- Checks: npm run check:v2, npm run test:v2
- Summary: Socle monorepo en place, scripts TUI et vérifications disponibles.

## lot-2-domaines [done]
- Description: Auth, chat, storage, personas, node engine
- Depends on: lot-1-socle
- Owner: Backend API
- Execution: managed
- Checks: npm run test:v2
- Summary: Domaines métier V2 en place, avec couverture de base et repos réels.

## lot-3-surfaces [done]
- Description: Shell React/Vite, admin, chat, node engine, ops
- Depends on: lot-2-domaines
- Owner: Frontend
- Execution: managed
- Checks: npm run -w @kxkm/web check
- Summary: Surfaces V2 disponibles, avec dette UI et duplication admin encore présentes.

## lot-4-bascule [done]
- Description: Migration, parité, rollback, bascule
- Depends on: lot-3-surfaces
- Owner: Coordinateur
- Execution: managed
- Checks: npm run smoke:v2
- Summary: Bascule initiale et outillage de migration réalisés.

## lot-12-deep-audit [done]
- Description: Deep analyse continue, refactoring, veille OSS, docs et infrastructure adjacente
- Depends on: lot-4-bascule
- Owner: Coordinateur
- Execution: manual
- Checks: npm run check:v2, npm run test:v2, npm run -w @kxkm/web test, node ops/v2/deep-audit.js --json
- Summary: Boucle deep-audit stabilisee: pipeline/docs/logs coherents, seams backend/frontend fermes et cycle ops industrialise.

## lot-13-voice-mcp [done]
- Description: Voice/WebRTC/MCP et convergence temps réel
- Depends on: lot-12-deep-audit
- Owner: Multimodal
- Execution: manual
- Checks: node scripts/mcp-server-smoke.js, npm run smoke:voice-mcp, npm run smoke:voice-clone, bash ops/v2/run-spike-checks.sh voice-clone --yes
- Summary: Spike voice/MCP stabilise: serveur MCP migre vers le SDK officiel, runtime XTTS valide sur kxkm-ai avec sample Piper genere, ffmpeg disponible et smoke non interactif vert sous COQUI_TOS_AGREED=1.

## lot-14-documents-search [done]
- Description: Services adjacents de recherche et document parsing
- Depends on: lot-12-deep-audit
- Owner: Ops/TUI
- Execution: manual
- Checks: docker compose --profile v2 config --services, bash scripts/health-doc-search.sh search --strict, npm run smoke:documents-search, npm run smoke:embeddings, bash ops/v2/run-spike-checks.sh embeddings --yes
- Summary: Seams search/doc consolides: SearXNG tourne localement avec format json actif et health check strict vert; le spike BGE-M3 est clos comme resultat negatif sur ce host Apple/Metal, avec maintien de la baseline actuelle.

## lot-15-hotspot-reduction [done]
- Description: Reduction chirurgicale des hotspots de domaine, moteur, tests storage et chat web
- Depends on: lot-13-voice-mcp, lot-14-documents-search
- Owner: Coordinateur
- Execution: manual
- Checks: npm run -w @kxkm/persona-domain check, npm run test:v2, bash ops/v2/run-deep-cycle.sh run --yes
- Summary: Lot 15 DONE: persona-domain seams, node-engine registry, storage-test-split (5 suites + helpers), web-chat-modularization (Chat.tsx 631→67 LOC, 5 modules). Cookie Secure flag + rate limit login. 210 tests, 0 fail.
