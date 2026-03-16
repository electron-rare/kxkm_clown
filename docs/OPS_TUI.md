# Ops TUI et Logs

## Objectif

Piloter les lots V2 via terminal, lire les logs, analyser, puis purger proprement les traces temporaires.

## Commandes principales

```bash
npm run v2:init
npm run v2:status
npm run v2:next
npm run v2:all

node ops/v2/health-check.js --json
node ops/v2/queue-viewer.js --json
node ops/v2/persona-manager.js --json
node ops/v2/log-rotate.js --dry-run
```

## Incident corrige (2026-03-16)

- Symptom: lot-2-domaines en failed
- Cause: PATH non quote dans task_command_template (espaces dans chemin utilisateur)
- Fix: PATH="/tmp/node-local/bin:$PATH" dans ops/v2/pipeline.json
- Resultat: lot-2-domaines passe en done

## Hygiene logs

- Lire et resumer les logs avant purge
- Conserver outputs CSV dans ops/v2/outputs
- Supprimer les logs temporaires du lot une fois analyse terminee
- Ne jamais purger les donnees metier runtime (data/)
