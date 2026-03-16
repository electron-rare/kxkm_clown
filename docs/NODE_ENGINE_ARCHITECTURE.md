# Node Engine — Architecture cible

## Positionnement

Le Node Engine n'est plus un simple module admin. En V2, il devient le cœur d'orchestration du produit.

Direction cible:
- unifier workflows chat, personas, datasets, fine-tuning, évaluation et déploiement
- sortir du couplage `vanilla + Drawflow` en allant vers une surface `React/Vite`
- conserver les bonnes propriétés déjà livrées: traçabilité, runs persistés, annulation, reprise

Le produit visé est un `apps/web + apps/api + apps/worker`, où le Node Engine pilote les tâches longues et les workflows structurants.

## Pipeline cible

Le pipeline IA complet suit cette chaîne:

`Dataset Source -> Data Processing -> Dataset Builder -> Training / Fine-tuning -> Evaluation -> Model Registry -> Deployment`

Chaque bloc correspond à une famille de nodes.

## Familles de nodes

### Dataset Source

But:
- charger ou collecter les données brutes

Types initiaux:
- `dataset_file`
- `dataset_folder`
- `huggingface_dataset`
- `web_scraper`
- `database_query`

Sortie attendue:
- artefact `dataset`

### Data Processing

But:
- nettoyer, normaliser, filtrer, découper

Types initiaux:
- `clean_text`
- `remove_duplicates`
- `split_dataset`
- `tokenize`
- `format_instruction_dataset`

Sortie attendue:
- artefact `dataset`

### Dataset Builder

But:
- préparer un dataset exploitable par les LLM

Types initiaux:
- `instruction_dataset`
- `chat_dataset`
- `completion_dataset`
- `preference_dataset`

Sortie attendue:
- artefact `dataset_ready`

### Training / Fine-tuning

But:
- lancer les jobs d'entraînement et produire un modèle exploitable

Types initiaux:
- `llm_finetune`
- `lora_training`
- `qlora_training`
- `embedding_training`

Sortie attendue:
- artefact `model`

### Evaluation

But:
- mesurer, comparer et valider

Types initiaux:
- `benchmark`
- `prompt_test`
- `score_dataset`
- `human_review`

Sorties attendues:
- artefacts `evaluation`, `benchmark_report`, `review`

### Model Registry

But:
- stocker les modèles, métriques et métadonnées de training

Types initiaux:
- `register_model`
- `tag_model`
- `compare_models`

Sortie attendue:
- artefact `registered_model`

### Deployment

But:
- publier le modèle sur une cible d'exécution

Types initiaux:
- `deploy_api`
- `deploy_local`
- `deploy_gpu_cluster`
- `deploy_edge`

Sortie attendue:
- artefact `deployment`

## Contrat d'exécution

Le moteur doit exécuter un graphe comme un DAG orienté artefacts.

Chaque node a:
- `id`
- `type`
- `version`
- `params`
- `inputs`
- `outputs`
- `runtime`
- `status`
- `artifacts`

Chaque edge relie:
- une sortie typée
- à une entrée typée

Règles:
- validation statique du graphe avant exécution
- exécution topologique
- cache optionnel par hash d'inputs
- journal de job pour chaque node exécuté
- reprise possible si un node a déjà produit un artefact valide
- cycle de vie de run explicite: `draft -> validated -> queued -> running -> completed|failed|cancelled|blocked|not_configured`
- la création d'un run ne doit pas supposer une complétion immédiate; l'admin doit toujours pouvoir relire l'état via `GET /runs/:id`

État réellement livré:
- validation statique des graphes et exécution topologique locale
- exécution réelle des nodes dataset/processing/evaluation/registry/deploy
- queue persistée avec reprise automatique des runs `queued/running`
- annulation coopérative au step boundary
- training via adaptateurs externes ou statut `not_configured`
- persistance des runs, étapes, artefacts et modèles enregistrés
- prochaine étape: adaptateurs training réels et runtimes distants branchés

## Intégration V2

### Frontend

La surface cible vit dans `apps/web` et doit offrir:
- palette de nodes
- éditeur de graphe
- inspecteur de node
- vue runs / queue / workers
- panneau artifacts / models
- workflows spécialisés personas

### Backend API

La couche HTTP/WS vit dans `apps/api` et branche:
- `packages/node-engine` pour registry, graphes, runs et queue
- `packages/auth` pour permissions
- `packages/storage` pour persistance et rétention

### Worker

L'exécution des tâches longues vit dans `apps/worker`:
- preview
- évaluation
- fine-tuning
- déploiement
- runtimes distants

### API admin

Famille d'API cible:
- `GET /api/admin/node-engine/overview`
- `GET/POST/PUT /api/admin/node-engine/graphs`
- `POST /api/admin/node-engine/graphs/:id/run`
- `GET /api/admin/node-engine/runs/:id`
- `POST /api/admin/node-engine/runs/:id/cancel`
- `GET /api/admin/node-engine/artifacts/:id`
- `POST /api/admin/node-engine/nodes/preview`
- `GET /api/admin/node-engine/models`

## Stockage local

Séparer clairement les données du node engine du reste du chat:

- `data/node-engine/graphs/*.json`
- `data/node-engine/runs/*.json`
- `data/node-engine/artifacts/<run-id>/...`
- `data/node-engine/cache/...`
- `data/node-engine/registry.json`

Pour les modèles:
- `models/base_models/`
- `models/finetuned/`
- `models/lora/`

Chaque run doit stocker:
- graphe résolu
- paramètres effectifs
- runtime choisi
- timestamps
- logs
- statut final
- références d'artefacts

## Runtimes

Le moteur doit pouvoir cibler plusieurs environnements:
- `local_cpu`
- `local_gpu`
- `remote_gpu`
- `cluster`
- `cloud_api`

Chaque node peut déclarer:
- runtime préféré
- runtime minimum
- besoins GPU/VRAM
- temps limite
- accès réseau requis

## Sécurité et garde-fous

Le node engine ouvre une surface beaucoup plus sensible que l'admin personas.

Invariants:
- aucune exécution de training sans route admin protégée
- séparation stricte entre runtime chat et runtime training
- quotas, limites taille dataset et durée de job
- journal complet des runs
- pas d'écriture implicite sur les personas runtime depuis un pipeline training
- les modèles déployés doivent passer par le registry, pas par un chemin libre

## Ordre de livraison recommandé

### Phase 1
- porter le runtime actuel dans `packages/node-engine`
- formaliser types et contrats
- garder la V1 comme oracle comportemental

### Phase 2
- brancher le worker séparé
- porter la queue et la reprise
- isoler les runtimes de training

### Phase 3
- livrer la surface React/Vite complète
- brancher les adaptateurs training réels
- brancher les runtimes distants
- module admin `#/node-engine`
- nodes de dataset source et processing simples

État:
- livré

### V2 — Training local
- `lora_training`
- `qlora_training`
- `node-engine-runner.js` et `node-engine-runtimes.js`
- runs persistés et relisibles, y compris quand l'exécution devient asynchrone
- statuts `queued`, `running`, `completed`, `failed`

État:
- partiellement livré
- runner local réel, queue async persistée et runtimes déclarés en place
- training encore dépendant d'adaptateurs externes
- asynchronie de base livrée; orchestration avancée encore ouverte

### V3 — Runtimes distants et déploiement
- `remote_gpu`, `cluster`, `cloud_api`
- contrats `deploy_local`, `deploy_gpu_cluster`, `deploy_edge`
- séparation opérationnelle durcie entre runtime chat et runtime training
- reprise partielle et cache plus robustes
- résumés d'artefacts et journaux de run exploitables par le shell admin
- suivi de jobs
- registry modèles
- benchmark minimal

### V3 — Évaluation et déploiement
- nœuds benchmark / human review
- comparaison de modèles
- déploiement local / API

### V4 — Exécution distribuée
- runtime remote GPU / cluster
- scheduling
- cache distribué
- monitoring approfondi

## Relation avec l'existant

Le pipeline personas actuel n'est pas à jeter.

Il doit être requalifié comme un sous-système nodal spécialisé:
- `persona source`
- `persona feedback`
- `persona proposal`
- `persona runtime`

Le node engine général doit donc réutiliser:
- les principes de traçabilité déjà posés
- le modèle `source -> transformation -> sortie active`
- les garde-fous `pas d'auto-écriture opaque`

## Décision produit

Le node engine est une extension stratégique du frontend admin global, pas un produit séparé.

Conséquence:
- même shell admin
- même politique réseau/admin
- même philosophie locale et traçable
- mais séparation technique nette entre `chat runtime` et `training runtime`

## Veille liée

Voir:
- `docs/NODE_ENGINE_RESEARCH.md`
