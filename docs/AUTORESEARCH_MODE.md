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

## Score metier via artefacts

Le script extrait automatiquement les scores depuis les artefacts d'evaluation du run.
Les metriques supportees (par ordre de priorite) :

- `score` — score generique (0-1)
- `eval_score` — score d'evaluation
- `accuracy` — precision
- `f1` — F1 score
- `bleu` — score BLEU (traduction/generation)
- `perplexity` — perplexite (inversee: 1/(1+p), plus bas = mieux)

Pour qu'un run produise un score metier, le graph doit inclure un node `benchmark` ou `prompt_test` qui ecrit un artefact de type `evaluation` avec une de ces metriques dans le champ `data`.

Si aucun artefact d'evaluation n'est trouve, le fallback est le score base sur le statut terminal.

## Limites actuelles

- keep/discard est une decision de session, pas encore un alias model registry
- pas de mutation automatique des graphes ou hyperparametres

## Etapes suivantes

1. Brancher keep/discard comme alias dans le model registry (register_model node)
2. Ajouter mutation automatique des hyperparametres entre experiments
3. Integrer les metriques cout tokens et latence p95
