# Ops TUI et Logs

## Objectif

La V2 privilégie des outils terminal avec logs lisibles pour piloter les lots, inspecter l'état et nettoyer proprement les traces opératoires.

## Orchestrateur batch

Scripts disponibles:
- `python3 scripts/orchestrate_batches.py init --root ops/v2`
- `python3 scripts/orchestrate_batches.py status --root ops/v2`
- `python3 scripts/orchestrate_batches.py run-next --root ops/v2`
- `python3 scripts/orchestrate_batches.py run-all --root ops/v2`

Raccourcis npm:
- `npm run v2:init`
- `npm run v2:status`
- `npm run v2:next`
- `npm run v2:all`

## Emplacement des traces

- état: `ops/v2/state.json`
- plan batch: `ops/v2/PLAN.md`
- todo batch: `ops/v2/TODO.md`
- logs: `ops/v2/logs/<batch>/<task>.log`
- outputs: `ops/v2/outputs/<batch>/<task>.csv`

## Règles d'exploitation

- lire les logs avant toute purge
- conserver les outputs utiles comme traces de lot
- supprimer les logs uniquement après synthèse dans `PLAN.md` / `TODO.md` / `PROJECT_MEMORY`
- ne jamais confondre logs opératoires et données métier runtime

## Étapes suivantes

- ajouter un TUI de suivi queue/runs/workers
- ajouter un TUI de suivi personas/sessions/logs
- formaliser rotation et purge automatique des logs opératoires
