# Veille — Node Engine

## Objectif

Ancrer le futur `Node Engine` de KXKM_Clown sur des références produit et techniques déjà éprouvées, sans copier leur architecture aveuglément.

## Sources officielles consultées

- ComfyUI documentation:
  - https://docs.comfy.org/development/core-concepts/nodes
  - https://docs.comfy.org/custom-nodes/overview
- Langflow documentation:
  - https://docs.langflow.org/concepts-overview
- Hugging Face documentation:
  - https://huggingface.co/docs/datasets/process
  - https://huggingface.co/docs/transformers/trainer
  - https://huggingface.co/docs/peft/main/en/conceptual_guides/lora
- MLflow documentation:
  - https://mlflow.org/docs/latest/ml/model-registry/
- Kubeflow Pipelines documentation:
  - https://www.kubeflow.org/docs/components/pipelines/overview/
- MDN documentation:
  - https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
- OWASP guidance:
  - https://owasp.org/www-community/attacks/csrf

## Ce qui en ressort pour KXKM_Clown

### 1. Le graphe doit rester centré sur des nodes typés

Point retenu depuis ComfyUI et Langflow:
- un node n'est pas un simple bloc visuel
- il porte un type, des entrées/sorties et un contrat de données

Décision pour KXKM_Clown:
- `node-engine-registry.js` porte le catalogue de types
- les edges doivent relier des artefacts typés

### 2. Dataset et transformation doivent être des étapes de premier rang

Point retenu depuis Hugging Face Datasets:
- l'ingestion et le processing ne sont pas des détails de préambule
- ce sont des étapes structurantes du pipeline

Décision pour KXKM_Clown:
- familles distinctes `dataset_source`, `data_processing`, `dataset_builder`
- les premiers nodes V1 couvrent déjà ce socle

### 3. Fine-tuning et LoRA demandent un runtime séparé

Point retenu depuis Transformers Trainer et PEFT:
- training, fine-tuning et LoRA ne relèvent pas du même runtime que l'inférence chat

Décision pour KXKM_Clown:
- séparation explicite `chat runtime` / `training runtime`
- le Node Engine V1 n'exécute pas encore un vrai training; il prépare cette séparation

### 4. Runs, registry et modèles doivent rester traçables

Point retenu depuis MLflow:
- un pipeline utile doit laisser une trace de run, d'artefacts, de métriques et de version de modèle

Décision pour KXKM_Clown:
- stockage dédié `data/node-engine/{graphs,runs,artifacts,cache}`
- les runs sont journalisés séparément du chat

### 5. L'orchestration doit être pensée comme un DAG exécutable

Point retenu depuis Kubeflow Pipelines:
- exécution topologique
- cache possible
- reprise partielle
- séparation nette entre définition et exécution

Décision pour KXKM_Clown:
- le Node Engine V2 a maintenant un vrai runner dédié
- l'étape suivante n'est plus "avoir un runner", mais "avoir une vraie asynchronie, des runtimes distants et des adaptateurs training branchés"

### 6. Un run utile n'est pas forcément synchrone

Point retenu depuis Kubeflow et MLflow:
- création de run et complétion de run ne sont pas forcément le même événement
- l'état doit rester relisible pendant `queued`, `running`, puis dans un état terminal

Décision pour KXKM_Clown:
- le smoke et les contrats admin ne doivent pas figer le Node Engine sur un `completed` immédiat
- la V2 devra exposer des runs persistés consultables via `overview`, `runs` et `runs/:id`

### 7. L'auth admin doit devenir une vraie session HTTP, pas un simple stockage frontend

Point retenu depuis MDN et OWASP:
- un cookie `HttpOnly` et `SameSite=Strict` est un meilleur transport de session qu'un secret conservé en JS
- le passage au cookie ne dispense pas d'un garde-fou réseau ni de contrôles `Origin/Referer` sur les écritures

Décision pour KXKM_Clown:
- ouverture de session admin par bootstrap token sur réseau autorisé
- portage ensuite par cookie `HttpOnly`
- écriture admin bornée par same-origin
- le fallback legacy header doit rester transitoire et être retiré une fois la migration totalement stabilisée

## Conclusion

La bonne trajectoire pour KXKM_Clown n'est pas:
- un simple nouvel écran admin
- ni un faux moteur de training caché derrière quelques boutons

La bonne trajectoire est:
- un `Node Engine` traçable
- intégré à l'admin global
- alimenté par un registry de nodes
- séparé du runtime temps réel du chat
- extensible ensuite vers training réel, benchmark et déploiement
