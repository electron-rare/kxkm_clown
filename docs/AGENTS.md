# Agents et Compétences

## Coordinateur

Compétences:
- pilotage de projet, arbitrage des priorités
- maintenance `PLAN.md`, `TODO.md`, `docs/PROJECT_MEMORY.md`
- orchestration batch (`scripts/orchestrate_batches.py`, `ops/v2/pipeline.json`)

Backlog:
- synchroniser les documents de suivi à chaque fin de lot
- arbitrer les dépendances inter-agents
- journaliser les opérations batch dans `ops/v2/logs`

Dépendances: aucune (agent racine)

## Agent Sécurité

Compétences:
- analyse de vulnérabilités
- validation d'entrées, sanitisation
- rate limiting, auth hardening

Backlog:
- corriger l'injection bash dans `node-engine-runtimes.js`
- ajouter timeout sur les appels Ollama
- validation des messages WebSocket (longueur max, sanitisation)
- rate limiting par user/IP sur chat et uploads
- corriger la validation d'origine `postMessage` dans le bridge iframe

Dépendances: aucune (priorité absolue, peut intervenir sur tout le code)

## Agent Backend V1

Compétences:
- Express / WebSocket
- intégration Ollama
- pipeline de fichiers (attachments)
- audit et journalisation

Backlog:
- migrer vers le SDK officiel `ollama-js`
- ajouter un audit logging pour les actions admin
- implémenter l'analyse image/audio dans `attachment-pipeline.js`
- ajouter la déduplication de requêtes dans `admin-api.js`
- sortir des `fs.*Sync` sur les hot paths

Dépendances: Agent Sécurité (les fixes P0 doivent précéder la migration ollama-js)

## Agent Node Engine

Compétences:
- DAG runtime, exécution de graphes
- queue, workers, registry, artifacts
- sandboxing de processus
- adaptateurs d'entraînement ML

Backlog:
- ajouter la validation de tri topologique
- ajouter un timeout d'exécution par nœud
- porter `node-engine-store.js` → `packages/node-engine`
- porter `node-engine-runner.js` → `packages/node-engine`
- porter `node-engine-queue.js` → `packages/node-engine`
- isoler les runtimes avec sandboxing approprié
- adaptateurs d'entraînement (LoRA, QLoRA, SFT)

Dépendances: Agent Sécurité (sandboxing runtimes dépend du fix injection bash)

## Agent Personas

Compétences:
- prompting et tuning de personas
- sourcing web, feedback loops
- reinforce/revert pipeline
- Pharmacius (auto-apply, limites)

Backlog:
- cadrer les limites d'auto-apply de Pharmacius
- porter `persona-domain` complet dans `packages/persona-domain`
- brancher le sourcing web comme workflow Node Engine
- exposer les signaux training/DPO comme entrées de reinforce
- pipeline de feedback V2

Dépendances: Agent Node Engine (sourcing web = workflow Node Engine)

## Agent Frontend

Compétences:
- React / Vite / TypeScript
- shell admin/chat
- éditeur visuel (Drawflow)
- design system, états temps réel

Backlog:
- interface chat React
- surfaces admin dashboard
- éditeur visuel Node Engine (intégration Drawflow)
- design tokens et bibliothèque de composants
- préserver l'identité visuelle IRC/scène/terminal

Dépendances: Agent Backend V1 (API endpoints), Agent Node Engine (API Node Engine V2)

## Agent Ops/TUI

Compétences:
- CLI / TUI (Ink, blessed)
- logs, rotation, monitoring
- scripts d'exploitation
- CI pipeline, build/check/smoke

Backlog:
- TUI viewer queue/runs
- TUI manager personas
- rotation et nettoyage des logs
- endpoints health check
- monitoring et alerting
- CI pipeline V2

Dépendances: Agent Node Engine (données queue/runs), Agent Personas (données personas)

## Agent Migration

Compétences:
- parité fonctionnelle V1/V2
- scripts de migration de données
- smoke tests, validation
- rollback et reprise

Backlog:
- construire la matrice de parité V1 → V2
- écrire les scripts de migration de données
- smoke tests complets pour V2
- procédure de rollback documentée et testée

Dépendances: tous les agents domaine (la migration intervient une fois les domaines V2 stables)

## Cadence

- fin de lot: mettre à jour `PLAN.md`, `TODO.md`, `docs/PROJECT_MEMORY.md`
- toute dérive technique: écrire une note ADR ou mémoire
- toute opération batch: journaliser dans `ops/v2/logs`
