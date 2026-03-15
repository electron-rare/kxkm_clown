# Mémoire Projet — KXKM_Clown

## Rôle

Ce document conserve les intentions produit et les décisions d'architecture qui doivent survivre aux refactors et aux itérations UI.

## Intention centrale

KXKM_Clown n'est pas seulement un chat multi-LLM. Le projet cherche à faire vivre une troupe de personas éditorialisées, pilotables et renforçables, sans perdre son identité IRC / scène / terminal.

## Contrat produit actuel

Le runtime n'est plus à considérer comme `local-only strict`.

Le contrat courant est:
- chat et pages publiques accessibles en `LAN contrôlé`
- pages `/admin/*` lisibles sur le LAN
- bootstrap admin et routes `/api/admin/*` protégés par `bootstrap token + allowlist réseau`
- allowlist par défaut: loopback + IPv4 privées RFC1918 + plage overlay `100.64.0.0/10`
- surcharge possible par variables d'environnement

Ce n'est toujours pas une application destinée à être exposée sur Internet ou à des utilisateurs non contrôlés.

## État réellement livré

Le projet dispose déjà de:
- un backend modulaire autour de `server.js`
- un shell admin global sous `/admin/index.html`
- une surface nodale personas en vanilla + Drawflow
- un pipeline personas local: `source -> feedback -> proposal -> override actif`
- `Pharmacius` comme orchestrateur éditorial
- une V1 multimodale: upload texte/image/son, analyse locale et cartes d'attachments
- une vue multi-canaux plus lisible côté chat
- des scripts `npm run check`, `npm run smoke` et `npm run build`

Le projet n'est donc plus un simple prototype monolithique. Il a déjà une vraie surface d'admin, une persistance éditoriale, et un cycle minimal de vérification locale.

## Direction nouvelle — Node Engine

Le moteur nodal ne doit plus être pensé comme un outil réservé aux personas.

Direction produit retenue:
- le nodal devient une surface générique d'orchestration IA
- les personas en deviennent un sous-système spécialisé
- l'admin global devra accueillir un module `#/node-engine`
- ce module doit pouvoir orchestrer dataset, preprocessing, dataset building, fine-tuning, évaluation, registry et déploiement

Invariant important:
- ne jamais confondre `chat runtime` et `training runtime`
- les jobs de training, benchmark et déploiement doivent rester isolés du moteur temps réel du chat

État réellement livré à ce stade:
- un module `#/node-engine` existe déjà dans l'admin global
- il s'appuie sur un stockage local dédié `data/node-engine/*`
- il expose un registry déclaratif de nodes et un graphe seed
- l'exécution V1 reste simulée et traçable: ce n'est pas encore un vrai runtime training

## Pipeline personas à préserver

Une persona peut désormais:
1. naître d'un dossier source issu du web
2. être éditée localement dans l'admin
3. recevoir du feedback depuis le chat ou l'admin
4. produire des proposals journalisées
5. être révisée ou revertée sans toucher au catalogue seed

Les couches à garder séparées:
- catalogue seed dans `personas.js`
- overrides actifs dans `data/personas.overrides.json`
- dossier source dans `data/persona-sources/*.json`
- feedback dans `data/persona-feedback/*.jsonl`
- proposals dans `data/persona-proposals/*.jsonl`
- exports `training/` et `dpo/` append-only, hors source de vérité runtime

## Décisions Lot A verrouillées

- les snapshots de session sont des archives / points de restauration manuelle uniquement
- aucun snapshot n'est rechargé automatiquement au boot
- la restauration explicite se fait via `/sessions restore <id>` sur la session courante
- `training/conversations.jsonl` et `dpo/pairs.jsonl` restent des exports append-only
- ces exports peuvent être relus pour nourrir `Pharmacius` seulement lors d'un reinforce explicite
- ces signaux sont bornés et journalisés dans les métadonnées des proposals
- rétention par défaut:
  - sessions: `7 jours`
  - logs: `30 jours`
  - mémoire conversationnelle: `100 interactions` max
- `uploads/`, `uploads-meta/` et les données personas (`overrides`, `sources`, `feedback`, `proposals`) restent hors périmètre de rétention dans ce lot

Effet runtime désormais livré:
- purge des snapshots et logs expirés au démarrage
- sweep périodique de rétention côté serveur
- absence d'auto-restore vérifiée par le smoke

## Rôle de Pharmacius

`Pharmacius` n'est pas une permission système.

Son rôle cible et déjà partiellement livré est:
- comparer les personas
- proposer des ajustements de nom, modèle et style
- exploiter les sources et le feedback
- laisser une trace réversible des modifications

## Garde-fous à ne pas casser

- Une recherche web doit rester traçable et sourcée.
- Le feedback chat ne doit pas réécrire une persona sans journal.
- `training/` et `dpo/` ne doivent pas devenir la mémoire éditoriale des personas.
- les snapshots de session ne doivent pas redevenir une restauration implicite au démarrage.
- la rétention Lot A ne doit pas toucher aux uploads ni aux données personas.
- Les décisions d'accès admin doivent rester explicites: token + réseau autorisé.
- Une pièce jointe doit rester séparée de son paquet d'analyse et de son brief Pharmacius.

## Chantiers encore structurants

Les prochaines zones à stabiliser restent:
- les tests unitaires métier
- la sortie progressive des `fs.*Sync` sur les hot paths
- le déchargement GPU après inactivité
- les adaptateurs vision / transcription et la rétention des uploads
- l'architecture et la fondation du node engine
- le vrai runner Node Engine et la séparation opérationnelle des runtimes
