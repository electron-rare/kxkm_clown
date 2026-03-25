# OSS Veille — Personas Runtime & Memory (2026-03-25)

## Objectif

Identifier des briques OSS directement exploitables pour renforcer le runtime personas sur 3 axes:

- memoire runtime et persistence
- coherence/persona drift
- benchmark produit et training offline

## Shortlist operationnel

| Projet | Type | Fit principal | Decision |
|---|---|---|---|
| Letta | runtime agents stateful | separation memory working vs archival, blocs explicites | adopter les patterns |
| LangGraph + LangMem | patterns memory | profil, store, semantic recall, policies d ecriture | adopter les patterns |
| Mem0 + OpenMemory | memory layer | benchmark retrieval/write-back contre store local | bench court terme |
| Graphiti (Zep) | temporal knowledge graph | relations temporelles et faits relies | spike optionnel |
| LibreChat / Open WebUI | reference produit | benchmark UX/admin/persona tooling | benchmark uniquement |
| OpenCharacter + PCL | R&D training | generation profils synthetiques et coherence | spike offline |

## Resultats detailles

### 1. Letta

- Apport:
  architecture memory explicite, stateful, avec blocs de memoire durables plutot qu un simple append de contexte.
- Ce qui nous interesse:
  modeliser par persona une `working_memory` courte et une `archival_memory` stabilisee.
- Reuse concret:
  reprendre la separation entre blocs visibles en permanence et memoire archivee interrogee a la demande.
- Cout integration:
  moyen.
- Sources:
  - https://docs.letta.com/guides/agents/memory
  - https://github.com/letta-ai/letta

### 2. LangGraph + LangMem

- Apport:
  patterns concrets pour profil utilisateur, memoire longue duree, extraction structuree et semantic search.
- Ce qui nous interesse:
  un write-back explicite depuis les echanges vers des facts structurés ou des summaries.
- Reuse concret:
  re-implementer en TypeScript des stores `profile`, `episodes`, `facts`, sans adopter tout le framework.
- Cout integration:
  faible a moyen.
- Sources:
  - https://langchain-ai.github.io/langgraph/how-tos/memory/add-memory/
  - https://github.com/langchain-ai/langmem

### 3. Mem0 + OpenMemory

- Apport:
  couche memory orientee extraction et recall, deja pensee pour usage production.
- Ce qui nous interesse:
  comparaison directe de recall et precision vs notre store local per-file.
- Reuse concret:
  benchmarker un adaptateur minimal avant toute integration profonde.
- Cout integration:
  moyen.
- Sources:
  - https://docs.mem0.ai/open-source/openmemory/overview
  - https://github.com/mem0ai/mem0

### 4. Graphiti / Zep

- Apport:
  knowledge graph temporel pour memories relationnelles, utile si les personas doivent conserver des faits lies dans le temps.
- Ce qui nous interesse:
  episodes, entites, relations, resolution des contradictions et faits datees.
- Reuse concret:
  pas pour le chemin critique immediat, mais pertinent si la memoire persona sort du simple KV/profile.
- Cout integration:
  moyen a eleve.
- Sources:
  - https://github.com/getzep/graphiti
  - https://docs.getzep.com/graphiti

### 5. LibreChat / Open WebUI

- Apport:
  references produit solides pour agents, prompts, knowledge, outils, administration self-hosted.
- Ce qui nous interesse:
  benchmark des flows admin/editor pour `persona-source-feedback-proposal`.
- Reuse concret:
  benchmark UX/admin, pas une dependance runtime cible.
- Cout integration:
  faible en veille, eleve si adoption produit.
- Sources:
  - https://github.com/danny-avila/LibreChat
  - https://docs.openwebui.com/
  - https://github.com/open-webui/open-webui

### 6. OpenCharacter + PCL

- Apport:
  generation de profils synthetiques et amelioration de coherence persona sans gros volume d annotations manuelles.
- Ce qui nous interesse:
  pipeline offline pour enrichir ou evaluer les personas existantes, pas le runtime temps reel.
- Reuse concret:
  spike training/eval sur 5 personas avec score de coherence et drift.
- Cout integration:
  moyen a eleve.
- Sources:
  - https://arxiv.org/abs/2501.15427
  - https://arxiv.org/abs/2503.17662

## Decision engineering

### A adopter maintenant

- schema `working_memory` / `archival_memory`
- policies d ecriture explicites depuis chat/feedback/proposals
- separation entre source editoriale, memoire runtime, et evaluations

### A benchmarker tout de suite

- Mem0/OpenMemory contre le store local per-file
- patterns Letta vs LangGraph sur 3 cas:
  - fait stable
  - preference volatile
  - resume de session

### A garder hors chemin critique

- Graphiti tant que la memoire n exige pas de raisonnement relationnel temporel
- OpenCharacter + PCL tant que le runtime n est pas stabilise
- adoption produit complete LibreChat/Open WebUI

## Plan benchmark minimal

### Baseline actuelle

- store local per-file sous `data/v2-local`
- sources separees de feedback et proposals
- migration legacy lecture seule encore presente

### Mesures

- TTFC avant et apres recall memory
- precision factuelle sur 20 prompts controles
- taux de drift persona sur 20 prompts controles
- write-rate memory et taille moyenne des objets persistés

### Harness propose

- 5 personas fixes
- 20 prompts par persona:
  - faits biographiques
  - preferences stylistiques
  - contradiction volontaire
  - rappel a long terme
- 3 strategies:
  - baseline locale
  - baseline + policies type LangGraph
  - baseline + adaptateur Mem0/OpenMemory

## Recommandation execution

- lot-202:
  schema memory v2 avec `working_memory`, `archival_memory`, `policy_state`
- lot-203:
  policy engine `extract -> summarize -> prune -> persist`
- lot-204:
  benchmark Letta/LangGraph/Mem0 documente et harness local
- lot-205:
  spike offline OpenCharacter/PCL sur 5 personas
