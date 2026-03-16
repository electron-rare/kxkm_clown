# Runbook — Migration V1 -> V2 Postgres

> Date de reference : 2026-03-16
> Contexte : passage du stockage flat-file JSON/JSONL (V1) vers Postgres (V2).

---

## 0. Pre-requis

| Elément | Valeur attendue |
|---|---|
| Node.js | v22.x (`node --version`) |
| Postgres | v15+ en local ou distant, base `kxkm_clown_v2` creee |
| `DATABASE_URL` | `postgres://user:pass@localhost:5432/kxkm_clown_v2` |
| Acces V1 | répertoire `data/` present avec les JSONL/JSON intacts |
| Services arretes | API V1 et V2 stoppees avant migration |

```bash
# Verification rapide pre-vol
node --version
psql "$DATABASE_URL" -c "SELECT version();"
ls data/personas.jsonl data/graphs/ data/sessions/ 2>/dev/null
```

---

## 1. Snapshot V1 (sauvegarde prealable)

```bash
BACKUP_DIR="backups/v1-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r data/ "$BACKUP_DIR/data"
echo "Snapshot V1 dans $BACKUP_DIR"
```

Conserver ce dossier jusqu'a validation complete de la migration.

---

## 2. Rehearsal — dry-run avec verbosite

```bash
# Lecture + transform sans insertion en base
node scripts/migrate-v1-to-v2.js --dry-run --verbose 2>&1 | tee /tmp/migrate-dry-run.log
```

Inspecter la sortie :

- Chaque item doit afficher `[DRY-RUN] would insert ...`
- Aucune erreur de parsing ni d'exception
- Comptages `personas`, `graphs`, `runs` coherents avec `ls data/`

Si des erreurs apparaissent (JSONL corrompu, champ manquant), corriger les donnees source avant de continuer.

---

## 3. Baseline V1 avant migration

Lancer le parity-check avec l'API V1 active pour capturer l'etat de reference.

```bash
# V1 sur port 3333 (default), V2 pas encore lancee
node scripts/parity-check.js --v1-port 3333 2>&1 | tee /tmp/parity-baseline.log
```

Les checks V2 echoueront (SKIP/FAIL) — c'est normal. Conserver le log pour comparaison post-migration.

---

## 4. Migration reelle

```bash
export DATABASE_URL="postgres://user:pass@localhost:5432/kxkm_clown_v2"

node scripts/migrate-v1-to-v2.js --verbose 2>&1 | tee /tmp/migrate-real.log
```

Verifications immediates post-migration :

```bash
psql "$DATABASE_URL" -c "
  SELECT 'personas' AS tbl, count(*) FROM personas
  UNION ALL SELECT 'node_graphs', count(*) FROM node_graphs
  UNION ALL SELECT 'node_runs',   count(*) FROM node_runs
  UNION ALL SELECT 'sessions',    count(*) FROM sessions;
"
```

Les comptages doivent correspondre aux totaux affiches par le script.

---

## 5. Validation parity — V2 demarree

```bash
# Lancer l'API V2 (avec DATABASE_URL)
export NODE_ENV=production
export DATABASE_URL="postgres://user:pass@localhost:5432/kxkm_clown_v2"
node apps/api/dist/server.js &
V2_PID=$!
sleep 2

# Lancer le parity check
node scripts/parity-check.js --v1-port 3333 --v2-port 4180 2>&1 | tee /tmp/parity-post.log

grep -E "PASS|FAIL|WARN" /tmp/parity-post.log
```

Critere de succes : 0 FAIL, 0 WARN sur les checks personas/graphs/channels/API shapes.

---

## 6. Smoke test V2

```bash
npm run smoke:v2 2>&1 | tee /tmp/smoke-v2.log
```

22 tests sur 5 categories. Resultat attendu : 22/22 PASS.

En cas d'echec, consulter `smoke-v2.js` pour identifier le test exact avant de continuer.

---

## 7. Cutover

Une fois parity + smoke verts :

```bash
# 1. Couper V1
pkill -f "node server.js" || true

# 2. Variables d'environnement de prod
export NODE_ENV=production
export DATABASE_URL="postgres://user:pass@host:5432/kxkm_clown_v2"

# 3. Redemarrer V2 en production
kill $V2_PID 2>/dev/null || true
node apps/api/dist/server.js
```

Verification finale :

```bash
curl -s http://localhost:4180/api/v2/health | python3 -m json.tool
# Attendu : { "ok": true, "data": { "storage": "postgres", ... } }
```

---

## 8. Rollback — si anomalie detectee

### Truncate (garder le schema, rejouer la migration)

```bash
node scripts/rollback-v2.js --truncate --yes
```

Puis reprendre depuis l'etape 2.

### Drop complet (schema detruit)

```bash
node scripts/rollback-v2.js --yes
```

Puis restaurer V1 depuis le snapshot :

```bash
cp -r "$BACKUP_DIR/data" .
node server.js
```

### Rollback selectif (table specifique)

```bash
node scripts/rollback-v2.js --tables personas --truncate --yes
```

---

## 9. Checklist avant fermeture

- [ ] parity-baseline.log conserve dans ops/v2/outputs/lot-4-bascule/
- [ ] parity-post.log conserve dans ops/v2/outputs/lot-4-bascule/
- [ ] smoke-v2.log conserve dans ops/v2/outputs/lot-4-bascule/
- [ ] Snapshot V1 archive dans backups/
- [ ] ops/v2/state.json : lot-4-bascule -> done
- [ ] Variables DATABASE_URL / NODE_ENV=production persistees
- [ ] docs/PROJECT_MEMORY.md mis a jour (migration completee)

---

## References

| Fichier | Role |
|---|---|
| scripts/migrate-v1-to-v2.js | Migration personas/graphs/runs vers Postgres |
| scripts/parity-check.js | 10 checks parite V1/V2 |
| scripts/rollback-v2.js | Drop/truncate tables avec confirmation |
| scripts/smoke-v2.js | 22 tests smoke V2 (5 categories) |
| packages/storage/src/ | Repos Postgres + runMigrations() |
| apps/api/src/app.ts | Guard DATABASE_URL production |
