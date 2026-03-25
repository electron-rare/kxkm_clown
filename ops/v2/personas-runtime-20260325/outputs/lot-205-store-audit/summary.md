# lot-205-store-audit

- Date: 2026-03-25T19:34:59Z
- Owner: Ops/TUI
- Status: done

## Commandes

```bash
node ops/v2/persona-store-audit.js --json
node ops/v2/persona-store-audit.js --json --archive --target-dir <fixture>/data/v2-local --legacy-data-dir <fixture>/data
```

## Constat

- Store actif detecte sous `data/v2-local` en per-file:
  - `personas`: 17 fichiers / 17 enregistrements
  - `persona-sources`: 1 fichier / 1 enregistrement
  - `persona-feedback`: 16 fichiers / 45 enregistrements
  - `persona-proposals`: 1 fichier / 2 enregistrements
- Aucun fichier global V2 restant dans `data/v2-local`:
  - `personas.json`
  - `persona-sources.json`
  - `persona-feedback.json`
  - `persona-proposals.json`
- Restes legacy V1 encore presents sous `data/`:
  - `personas.overrides.json`
  - `persona-sources/`
  - `persona-feedback/`
  - `persona-proposals/`

## Validation

- `node --check ops/v2/persona-store-audit.js` OK
- `node ops/v2/persona-store-audit.js --help` OK
- Execution reelle `--json` OK
- Fixture `--archive` OK, 2 fichiers globaux archives en `.migrated-<timestamp>.bak`

## Decision

- Le runtime V2 est bien per-file.
- Les reliquats V1 restent en mode compat/migration uniquement.
- Les logs de travail du lot sont purges apres synthese documentaire.
