# TODO

## Fait dans ce tour

- [x] passer le runtime en mode `LAN contrôlé`
- [x] rendre le chat et les pages `/admin/*` accessibles sur le LAN
- [x] protéger le bootstrap admin et `/api/admin/*` par token + allowlist réseau
- [x] remplacer le garde-fou `localhost only` par une politique réseau explicite
- [x] protéger aussi les exports `training` et `dpo` derrière l'accès admin
- [x] exposer l'état réseau côté runtime admin
- [x] réaligner `docs/PROJECT_MEMORY.md`, `PLAN.md`, `TODO.md` et `docs/SPEC.md` sur l'état réel
- [x] ajouter une V1 multimodale: upload texte/image/son, analyse locale et brief Pharmacius
- [x] intégrer les pièces jointes au flux de conversation côté routing et frontend chat
- [x] couvrir le flux multimodal dans `npm run smoke`
- [x] verrouiller la règle: snapshots de session = restauration manuelle uniquement, sans auto-restore au boot
- [x] verrouiller le rôle de `training/conversations.jsonl` et `dpo/pairs.jsonl` comme exports append-only
- [x] réserver l'alimentation de `Pharmacius` depuis `training/` et `dpo/` au reinforce explicite
- [x] verrouiller la politique de rétention par défaut: sessions `7 jours`, logs `30 jours`, mémoire `100 interactions`
- [x] exclure `uploads/`, `uploads-meta/` et les données personas de la rétention dans le périmètre Lot A
- [x] ajouter `/sessions restore <id>` pour restaurer explicitement un snapshot local
- [x] brancher la purge effective des sessions et logs selon la policy Lot A (`7 jours` / `30 jours`)
- [x] relire `training/` et `dpo/` comme signaux bornés lors d'un reinforce explicite
- [x] couvrir le lot cohérence des données dans `npm run smoke`
- [x] cadrer le Node Engine comme extension du moteur nodal existant
- [x] ajouter une note de veille sourcée pour le Node Engine
- [x] créer le module admin global `#/node-engine`
- [x] définir un schéma minimal de graphe pour nodes, edges, artefacts et runs
- [x] créer un registry de nodes côté backend
- [x] séparer le stockage `data/node-engine/{graphs,runs,artifacts,cache}`
- [x] exposer des endpoints admin `overview / graphs / runs` pour le Node Engine
- [x] livrer un graphe seed `starter_llm_training`
- [x] couvrir le Node Engine V1 dans `npm run smoke`

## P1 — Cohérence fonctionnelle

- [x] décider que les snapshots de session restent des archives manuelles, sans restauration automatique au démarrage
- [x] clarifier que `training/conversations.jsonl` et `dpo/pairs.jsonl` sont des exports append-only
- [x] décider que `training/` et `dpo/` ne nourrissent `Pharmacius` que lors d'un reinforce explicite
- [x] restaurer explicitement un snapshot via `/sessions restore <id>`

## P2 — Fiabilité

- [ ] ajouter des tests unitaires pour pseudos, sanitation et canaux
- [ ] ajouter des tests sur le routing `@mention` et `#general`
- [ ] ajouter des tests sur la logique DPO
- [ ] ajouter des tests sur le fallback `session.persona` / modèle par défaut
- [ ] ajouter des tests sur l'API admin des personas et les overrides

## P2 — Performance et I/O

- [ ] sortir progressivement des `fs.*Sync` sur les hot paths
- [ ] décharger la RAM GPU au bout de 10 minutes sans interaction sur le chat
- [ ] ajouter un test dédié pour la borne mémoire conversationnelle à `100 interactions`
- [ ] prévoir pagination ou bornes sur les exports REST

## P3 — Produit

- [ ] brancher de vrais adaptateurs vision / transcription sur la pipeline de fichiers
- [ ] définir une politique de rétention dédiée pour `data/uploads` et `data/uploads-meta`
- [ ] stocker le token bootstrap admin dans un cookie de session côté frontend admin
- [ ] ajouter un favicon clown cohérent avec l'identité du projet
- [ ] travail mobile responsive si ce support devient un vrai besoin

## P4 — Node Engine

- [x] créer le module admin global `#/node-engine`
- [x] définir un schéma minimal de graphe pour nodes, edges, artefacts et runs
- [x] créer un registry de nodes côté backend
- [ ] extraire un vrai runner de graphes côté backend
- [x] séparer stockage `data/node-engine/{graphs,runs,artifacts,cache}`
- [x] livrer une première palette déclarative `dataset_file`, `dataset_folder`, `clean_text`, `split_dataset`, `format_instruction_dataset`
- [x] préparer déclarativement les nodes de training `lora_training`, `qlora_training`
- [x] préparer déclarativement les nodes d'évaluation `benchmark`, `prompt_test`
- [ ] créer un model registry local (`models/base_models`, `models/finetuned`, `models/lora`)
- [ ] définir le contrat de déploiement nodal `deploy_api`, `deploy_local`, `deploy_gpu_cluster`, `deploy_edge`
- [ ] séparer proprement `chat runtime` et `training runtime`
- [ ] définir les runtimes `local_cpu`, `local_gpu`, `remote_gpu`, `cluster`, `cloud_api`

## Questions encore ouvertes

- [ ] les personas doivent-elles être toutes résidentes ou sélectionnées dynamiquement selon la charge ?
- [ ] quel niveau d'automatisation est acceptable pour créer une persona depuis le web sur une personne réelle ?
- [ ] quels signaux du chat sont suffisamment fiables pour modifier une persona sans dérive ?
