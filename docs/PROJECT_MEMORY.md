# Mémoire Projet — KXKM_Clown

## Rôle

Ce document conserve les décisions qui doivent survivre à la bascule `V1 -> V2`.

## Intention centrale

KXKM_Clown n'est pas un simple chat multi-LLM. Le produit doit faire vivre:
- une troupe de personas éditorialisées
- une orchestration nodale traçable
- une esthétique IRC / scène / terminal assumée
- une exploitation privée, contrôlée, opérable

## Contrat produit retenu

La cible n'est plus seulement `LAN contrôlé` mono-opérateur.

Le cap V2 est:
- produit privé multi-utilisateur
- backend `Node.js`
- frontend `React/Vite`
- monorepo `apps/` + `packages/`
- `Node Engine` comme centre d'orchestration

Ce n'est toujours pas un produit à exposer publiquement sur Internet.

## V1 à préserver

La V1 reste la référence fonctionnelle jusqu'à la bascule:
- chat mIRC-like
- session admin cookie
- pipeline personas `source -> feedback -> proposal -> override`
- `Pharmacius` orchestrateur éditorial
- Node Engine local avec queue persistée, cancel et reprise
- uploads multimodaux
- scripts `check`, `smoke`, `build`

## Décisions de refonte verrouillées

- la V2 est développée en parallèle, sans démolition immédiate de la V1
- le frontend V2 part sur `React/Vite`
- le dépôt devient un monorepo `apps/` + `packages/`
- le `Node Engine` devient la colonne vertébrale des workflows chat, persona, eval et training
- la séparation `chat runtime` / `worker runtime` / `training runtime` est obligatoire
- l'exploitation doit privilégier des TUI et des logs lisibles
- le stockage cible V2 est `Postgres + filesystem`, même si le prototype initial d'API V2 tourne encore sur un adaptateur mémoire de dev

## Pipeline personas à préserver

Une persona doit rester composée de couches séparées:
- seed catalogue
- overrides actifs
- dossier source
- feedback append-only
- proposals append-only
- exports `training/` et `dpo/` séparés du runtime éditorial

Le sourcing web et le reinforce doivent rester traçables et réversibles.

## Rôle de Pharmacius

`Pharmacius` n'est pas une permission système.

Son rôle cible en V2:
- relire sources et feedback
- proposer ou appliquer des révisions bornées
- agir comme sous-système orchestré par le Node Engine
- laisser une trace complète avant/après

## Garde-fous à ne pas casser

- conserver l'identité visuelle et éditoriale du projet
- ne pas mélanger source web, feedback chat, training exports et overrides actifs
- ne pas réintroduire d'auto-restore implicite des snapshots de session
- ne pas supprimer le contrôle réseau et le bootstrap admin à l'ouverture de session
- garder les logs et les changements opératoires lisibles puis purgeables

## Chantiers structurants ouverts

- formaliser les contrats de domaines V2
- porter le Node Engine au centre de l'architecture
- préparer les rôles multi-utilisateur privés
- construire le shell React/Vite sans lisser le projet
- renforcer les tests et la stratégie de migration V1 -> V2
