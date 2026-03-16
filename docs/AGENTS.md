# Agents, Sous-agents, Competences

## Orchestration

- Agent racine: Coordinateur
- Sous-agent analyse code: Explore (thorough)
- Sous-agent veille OSS: Explore + fetch web
- Cadence: synchroniser PLAN.md + TODO.md + docs/PROJECT_MEMORY.md apres chaque lot

## Matrice des agents

| Agent | Competences | Taches actives | Etat |
|---|---|---|---|
| Coordinateur | planification, arbitrage, docs de pilotage | aligner plan/todo/docs avec etat reel | en cours |
| Securite | validation input, hardening runtime, limites | verifier invariants runtime + rate-limit scope | en cours |
| Backend V1/V2 | express/ws/api contracts, ollama integration | contrat storage API/worker, health contract | en cours |
| Node Engine | DAG, queue, runs, sandbox | robustesse pipeline + test parite schema | a enchainer |
| Personas | source/feedback/proposals/pharmacius | clarifier trace editoriale et exports training | a enchainer |
| Frontend | React/Vite, UX IRC, React Flow | consolidations surfaces chat/admin/engine | a enchainer |
| Ops/TUI | scripts, logs, rotate/purge, observabilite | run lot suivant + hygiene logs | en cours |
| Migration | parity, migrate, rollback | rehearsal migration V1->V2 sur Postgres local | a enchainer |

## Sous-agents et skill routing

- Explore (audit): differences docs vs code, quick wins, risques
- Explore (veille): OSS comparables (ollama-js, bullmq, rete, flowise, node-red, localai)
- Skill resume issue/pr: a utiliser pour synthese PR/issue
- Skill suggest-fix-issue: a utiliser pour proposition de correction ciblee

## Todo agents immediats

- Coordinateur:
  - fermer incoherences TODO/PLAN/README
  - maintenir priorites lot-3 et lot-4
- Backend:
  - maintenir garde-fou DB en prod
  - harmoniser communication contrat storage
- Ops/TUI:
  - executer lot-3
  - analyser logs puis purger logs temporaires
