# PLAN

## Objectif courant

Stabiliser KXKM_Clown comme chat multi-personas exploitable en `LAN contrôlé`, avec une surface admin cohérente, une persistance éditoriale traçable, et un filet de vérification local.

## État réellement atteint

Les lots suivants sont déjà livrés:
- backend modulaire: `server.js` est un point d'assemblage
- registre dynamique des personas + overrides locaux
- `Pharmacius` comme orchestrateur éditorial hors `#general`
- pipeline personas: source, feedback, proposals, auto-apply, revert
- choix explicite de persona sur sessions single-model
- admin personas nodal en vanilla + Drawflow
- frontend admin global sous `/admin/index.html`
- contrôle runtime des personas: disable/enable immédiat
- topics persistés, recherche d'historique, export HTML, résumé logs
- vue multi-canaux enrichie côté chat
- scripts `npm run check`, `npm run smoke`, `npm run build`
- V1 multimodale:
  - upload texte/image/son lié à la session chat
  - analyse locale normalisée
  - brief Pharmacius injecté dans le routing
  - cartes de pièces jointes côté frontend
- mode réseau `LAN contrôlé`:
  - chat et pages `/admin/*` accessibles en LAN
  - bootstrap admin et `/api/admin/*` protégés par token + allowlist réseau
- cohérence des données persistées:
  - `/sessions restore <id>` restaure explicitement un snapshot sur la session courante
  - aucun auto-restore des snapshots au démarrage
  - purge effective des snapshots `>7 jours` et logs `>30 jours` au boot puis périodiquement
  - mémoire conversationnelle bornée par config (`100` interactions par défaut)
  - `training/` et `dpo/` relus seulement comme signaux bornés lors d'un `reinforce` explicite
- Node Engine V1:
  - module admin `#/node-engine` branché dans l'admin global
  - stockage local dédié `data/node-engine/{graphs,runs,artifacts,cache}`
  - registry backend de nodes IA
  - endpoints admin pour overview, graphes et runs
  - seed graph local `starter_llm_training`
  - exécution V1 simulée et traçable pour préparer le vrai runner

## Phases closes

### Phase 0 — Documentation minimale
- spec, mémoire, plan et backlog existent

### Phase 1 — Sécurité et contrat d'usage
- bootstrap admin protégé
- pseudo `saisail` réservé
- contrat réseau explicite

### Phase 2 — Modularisation backend
- séparation config, runtime, commandes, stockage, HTTP, WebSocket

### Phase 3 — Surface produit/admin
- admin global livré
- nodal personas livré
- outils runtime/canaux/données livrés

## Prochains lots

### Lot B — Fiabilité métier
À livrer:
- tests unitaires sur pseudos, sanitation, canaux
- tests de routing `@mention` et `#general`
- tests DPO
- tests fallback `session.persona` / modèle par défaut
- tests API admin personas et overrides

### Lot C — Performance runtime
À livrer:
- sortie progressive des `fs.*Sync` des hot paths
- déchargement GPU après 10 minutes sans interaction
- visibilité runtime claire sur l'état `loaded / idle / unloaded`

### Lot D — Produit
À livrer:
- adaptateurs vision / transcription pour enrichir la V1 multimodale
- politique de rétention des uploads et métadonnées
- responsive mobile si le besoin devient prioritaire

### Lot E — Node Engine
À cadrer puis livrer par étapes:
- extraire un vrai runner backend dédié, séparé du store
- exécuter réellement les nodes de processing et training, pas seulement les décrire
- supporter des familles complètes `dataset -> processing -> builder -> training -> evaluation -> registry -> deployment`
- séparer techniquement et opérationnellement `chat runtime` et `training runtime`
- préparer des runtimes `local_cpu`, `local_gpu`, `remote_gpu`, `cluster`, `cloud_api`

Référence d'architecture:
- `docs/NODE_ENGINE_ARCHITECTURE.md`
- `docs/NODE_ENGINE_RESEARCH.md`

## Définition de "stabilisé"

Le projet pourra être considéré comme stabilisé quand:
- les formats de données auront un rôle clair
- l'accès admin sera explicite et vérifié
- les principales règles métier seront testées
- la charge runtime sera mieux maîtrisée
- les prochaines features produit n'obligeront plus à recasser le socle
