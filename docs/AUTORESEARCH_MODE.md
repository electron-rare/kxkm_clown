# Autoresearch Mode V2

Ce document decrit une integration minimale de la logique autoresearch dans KXKM_Clown V2.

## Objectif

Automatiser des cycles d'experiences Node Engine avec un budget fixe par run, puis appliquer une decision keep/discard basee sur une politique de score deterministe.

Le mode actuel automatise l'orchestration des runs et leur selection. Il ne modifie pas le code des nodes.

## Ce qui est implemente

- script: scripts/v2-autoresearch-loop.js
- config exemple: ops/v2/autoresearch.example.json
- sortie TSV append-only: data/node-engine/autoresearch/results.tsv

Boucle executee:
1. creer un run queued sur un graph existant
2. attendre un statut terminal
3. calculer un score
4. marquer keep/discard par rapport au meilleur score courant
5. journaliser la ligne dans results.tsv

## Prerequis

- Postgres accessible via DATABASE_URL
- migrations V2 executees (tables node_graphs et node_runs)
- worker V2 actif (npm run dev:v2:worker) pour consommer la queue
- un graph existant dans node_graphs

## Utilisation

1. definir graphId dans ops/v2/autoresearch.example.json
2. lancer:

```bash
npm run v2:autoresearch
```

Execution unique:

```bash
node scripts/v2-autoresearch-loop.js --config ops/v2/autoresearch.example.json --once
```

## Politique de score

Le score par defaut est derive du statut terminal, avec bonus de vitesse pour les runs completes:

- completed: 1 + bonus
- failed: 0
- cancelled, blocked, not_configured: -1

La table statusScores du JSON permet d'ajuster le comportement sans changer le script.

## Limites actuelles

- pas encore de metriques metier (qualite persona, cout tokens, latence p95)
- keep/discard est une decision de session, pas encore un alias model registry
- pas de mutation automatique des graphes ou hyperparametres

## Etape suivante recommandee

Ajouter un node d'evaluation canonique qui produit un score metier dans un artefact persiste, puis brancher ce score comme source principale de decision dans la boucle autoresearch.