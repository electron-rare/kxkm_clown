# KXKM_Clown v0.3.0 — Spécification vérifiée

## Statut

Ce document décrit l'état réel du projet tel qu'il ressort d'une lecture du code et des scripts locaux de vérification au 14 mars 2026.

Vérifications disponibles:
- `npm run check`
- `npm run smoke`
- `npm run build`

## Positionnement

KXKM_Clown est un chat web multi-LLM au look mIRC:
- backend Node.js avec Express et WebSocket
- intégration directe à Ollama en streaming
- stockage local JSON / JSONL dans `data/`
- personas culturelles pilotées par modèles locaux
- surface admin locale dédiée au runtime et aux personas

Le contrat actuel n'est plus `local-only strict`.

Le produit fonctionne en `LAN contrôlé`:
- chat et pages publiques accessibles sur le LAN
- pages `/admin/*` lisibles sur le LAN
- bootstrap admin et routes `/api/admin/*` protégés par `x-admin-bootstrap-token + allowlist réseau`
- allowlist par défaut: loopback + IPv4 privées RFC1918 + plage overlay `100.64.0.0/10`

Ce n'est toujours pas une application à exposer sur Internet.

## Architecture actuelle

### Backend

- `server.js` assemble les modules
- `config.js` centralise les variables runtime
- `network-policy.js` porte la politique réseau admin
- `http-api.js` expose les routes HTTP/admin
- `websocket.js` gère le chat temps réel
- `commands.js` porte les commandes IRC-like
- `chat-routing.js` orchestre les réponses IA
- `runtime-state.js` gère canaux, personas actives et runtime map
- `persona-registry.js` + `persona-store.js` gèrent personas seed, overrides, feedback et proposals
- `attachment-store.js` + `attachment-pipeline.js` + `attachment-service.js` gèrent les pièces jointes

### Frontend

- `public/index.html` + `public/app.js` + `public/styles.css` pour le chat principal
- `public/admin/index.html` pour l'admin global
- modules admin: `dashboard`, `personas`, `runtime`, `channels`, `data`
- `public/admin/personas.html` reste disponible comme surface personas dédiée
- l'admin personas utilise Drawflow pour une vue nodale éditoriale

### Build

- `npm run build` produit `dist/`
- le build embarque le runtime, le frontend et les données seed nécessaires, sans embarquer les données éphémères générées au fil de l'eau

## Personas et pipeline éditorial

Le catalogue seed contient actuellement 16 personas, dont `Pharmacius`.

Capacités livrées:
- sélection explicite de persona via `/persona`
- personas custom créées depuis une source locale
- overrides actifs dans `data/personas.overrides.json`
- dossier source dans `data/persona-sources/*.json`
- feedback dans `data/persona-feedback/*.jsonl`
- proposals et reverts dans `data/persona-proposals/*.jsonl`

Règles importantes:
- `Pharmacius` est hors `#general`
- les personas seed ne sont pas réécrites directement
- une persona active = seed + overrides locaux + état runtime
- `training/` et `dpo/` restent distincts du pipeline éditorial

## Canaux et runtime

Canaux garantis:
- `#general`
- `#admin`

Canaux dédiés:
- un canal par préfixe de modèle normalisé

Comportement:
- `#general`: sous-ensemble borné de personas actives
- `#admin`: choix libre du modèle puis de la persona
- canal dédié: modèle imposé par le canal, persona choisie dans le groupe du modèle

Le runtime admin permet aussi:
- disable/enable immédiat d'une persona
- topics persistés
- lecture d'état modèles/canaux/sessions
- recherche d'historique et export HTML
- upload texte/image/son avec analyse locale et brief Pharmacius

## Commandes présentes

Commandes serveur principales:
- `/nick`
- `/join`
- `/model`
- `/persona`
- `/memory`
- `/sessions`
- `/sessions restore <id>`
- `/vote`
- `/msg`
- `/topic`
- `/stop`
- `/kick`
- `/op`
- `/deop`
- `/whois`
- `/notice`
- `/quit`
- `/help`
- `/saisail <token>` si `ADMIN_BOOTSTRAP_TOKEN` est configuré

Note de sécurité:
- le pseudo `saisail` est réservé
- `/saisail <token>` n'est accepté que depuis un réseau admin autorisé
- l'API admin exige aussi le token bootstrap

## Persistance locale

Le dossier `data/` contient notamment:
- `users.json`
- `memory/*.json`
- `sessions/*.json`
- `channels.json`
- `personas.overrides.json`
- `persona-sources/*.json`
- `persona-feedback/*.jsonl`
- `persona-proposals/*.jsonl`
- `uploads/<yyyy>/<mm>/*`
- `uploads-meta/*.json`
- `logs/*.log`
- `training/conversations.jsonl`
- `dpo/pairs.jsonl`

État connu:
- les sessions sont sérialisées sur disque
- elles ne sont pas rechargées automatiquement au démarrage
- les snapshots de session sont considérés comme des archives / restaurations manuelles uniquement
- `/sessions restore <id>` recharge explicitement un snapshot dans la session chat courante
- `training/conversations.jsonl` et `dpo/pairs.jsonl` sont des exports append-only
- ces exports peuvent nourrir `Pharmacius` uniquement lors d'un reinforce explicite, sous forme de signaux bornés
- les proposals issues de `reinforce` exposent ces signaux dans leurs métadonnées
- rétention runtime effective:
  - sessions: `7 jours`
  - logs: `30 jours`
  - mémoire conversationnelle: `100 interactions` max
- purge des sessions/logs au démarrage puis périodiquement
- `uploads/`, `uploads-meta/` et les données personas (`overrides`, `sources`, `feedback`, `proposals`) ne sont pas touchés par la rétention dans ce lot

## Garde-fous réellement en place

- `MAX_GENERAL_RESPONDERS=4` par défaut
- `MAX_RESPONSE_TOKENS=150`
- `MAX_RESPONSE_TOKENS_SMALL=80`
- `MAX_RESPONSE_CHARS=600`
- `MAX_MESSAGE_LENGTH=4096`
- `SESSION_TTL_MS=30 min`
- `INACTIVITY_TIMEOUT_MS=1 h`
- bootstrap admin par token
- accès admin par token + allowlist réseau
- snapshots de session non restaurés automatiquement au boot
- `training/` et `dpo/` réservés au rôle d'exports append-only

## Surfaces admin HTTP

Public:
- `GET /api/status`
- `GET /api/personas`
- `GET /api/models`
- `GET /api/channels`
- `POST /api/chat/attachments`
- `GET /api/chat/attachments/:id`
- `GET /api/chat/attachments/:id/blob`

Admin:
- `GET /api/admin/runtime`
- `GET /api/admin/channels`
- `GET/PUT /api/admin/personas/...`
- `POST /api/admin/personas/:id/disable`
- `POST /api/admin/personas/:id/enable`
- `GET /api/admin/history/search`
- `GET /api/admin/export/html`
- `GET /api/admin/logs/summary`
- `GET /api/training/export`
- `GET /api/dpo/export`

## Limites restantes

- pas encore de tests unitaires métier
- encore des `fs.*Sync` sur des hot paths
- pas de déchargement GPU automatique après inactivité
- image/audio restent en fallback métadonnées tant qu'aucun adaptateur vision / STT n'est configuré

## Priorités ouvertes

Voir:
- `PLAN.md` pour l'ordre des lots
- `TODO.md` pour le backlog encore ouvert
- `docs/PROJECT_MEMORY.md` pour les invariants produit à préserver
