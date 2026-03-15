# Node Engine — Architecture cible

## Positionnement

Le moteur nodal de KXKM_Clown ne doit plus rester limité à l'édition des personas.

Direction cible:
- unifier édition de personas, pipelines datasets, fine-tuning, évaluation et déploiement
- garder la stack actuelle `vanilla + Drawflow + event bus`
- faire du nodal un orchestrateur de jobs IA traçables, pas un simple canvas décoratif

Le produit visé est un `admin global + node engine`, où la carte personas actuelle devient un premier sous-ensemble d'un moteur de graphes plus large.

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

## Intégration au projet actuel

### Frontend admin

Le point d'entrée reste `/admin/index.html`.

Ajouter un module:
- `#/node-engine`

Structure frontend cible:
- `public/admin/modules/node-engine.js`
- `public/admin/modules/node-engine-nodes.js`
- `public/admin/modules/node-engine-store.js`
- `public/admin/modules/node-engine-api.js`

La vue Drawflow personas reste en place, mais le moteur nodal doit converger vers:
- palette de nodes
- graphe éditable
- inspecteur de node
- panneau d'artefacts
- vue jobs / logs
- vue exécutions passées

### Backend

Ajouter une couche dédiée, séparée du runtime chat:
- `node-engine-registry.js` pour enregistrer les types de nodes
- `node-engine-runner.js` pour résoudre et exécuter les graphes
- `node-engine-store.js` pour stocker graphes, runs, artefacts et états
- `node-engine-runtimes.js` pour les adaptateurs `cpu`, `gpu`, `remote`, `cluster`

### API admin

Famille d'API cible:
- `GET /api/admin/node-engine/graphs`
- `POST /api/admin/node-engine/graphs`
- `GET /api/admin/node-engine/graphs/:id`
- `PUT /api/admin/node-engine/graphs/:id`
- `POST /api/admin/node-engine/graphs/:id/run`
- `GET /api/admin/node-engine/runs/:id`
- `GET /api/admin/node-engine/artifacts/:id`
- `POST /api/admin/node-engine/nodes/preview`

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

### V1 — Fondation nodale
- schéma de graphe
- registry de nodes
- stockage graph/runs
- module admin `#/node-engine`
- nodes de dataset source et processing simples

### V2 — Training local
- `lora_training`
- `qlora_training`
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
