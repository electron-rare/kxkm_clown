#!/usr/bin/env node
// Drops V2 Postgres tables (with confirmation)
// Usage: node scripts/rollback-v2.js [--yes] [--tables sessions,personas,node_graphs,node_runs] [--help]
// Useful for clean re-migration

const readline = require("readline");
const { Pool } = require("pg");

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const NO_COLOR = !!process.env.NO_COLOR;
const c = {
  green:  (s) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  red:    (s) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
${c.bold("KXKM Rollback V2 — Drop Postgres Tables")}

Usage: node scripts/rollback-v2.js [options]

Options:
  --yes              Skip confirmation prompt
  --tables LIST      Comma-separated list of tables to drop
                     (default: node_runs,node_graphs,sessions,personas,users)
  --truncate         Truncate tables instead of dropping them
  --help             Show this help message

Environment:
  DATABASE_URL   Postgres connection string (default: postgres://localhost:5432/kxkm_clown_v2)

${c.yellow("WARNING: This is a destructive operation. All data in the specified tables will be lost.")}
`);
  process.exit(0);
}

function getArgValue(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

const SKIP_CONFIRM = args.includes("--yes") || args.includes("-y");
const TRUNCATE_MODE = args.includes("--truncate");

// Order matters: drop children before parents (FK constraints)
const ALL_TABLES = ["node_runs", "node_graphs", "sessions", "personas", "users"];
const TABLES_ARG = getArgValue("--tables", null);
const TARGET_TABLES = TABLES_ARG
  ? TABLES_ARG.split(",").map((t) => t.trim()).filter(Boolean)
  : ALL_TABLES;

// Validate table names (prevent SQL injection)
const ALLOWED_TABLES = new Set(ALL_TABLES);
for (const table of TARGET_TABLES) {
  if (!ALLOWED_TABLES.has(table)) {
    console.error(c.red(`  [err] Unknown table: "${table}"`));
    console.error(c.dim(`  Allowed tables: ${ALL_TABLES.join(", ")}`));
    process.exit(1);
  }
}

// Sort tables to respect FK constraints (children first)
const TABLE_ORDER = new Map(ALL_TABLES.map((t, i) => [t, i]));
const SORTED_TABLES = [...TARGET_TABLES].sort(
  (a, b) => (TABLE_ORDER.get(a) || 0) - (TABLE_ORDER.get(b) || 0)
);

// ---------------------------------------------------------------------------
// Confirmation prompt
// ---------------------------------------------------------------------------

function askConfirmation(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

// ---------------------------------------------------------------------------
// Table info
// ---------------------------------------------------------------------------

async function getTableRowCounts(pool, tables) {
  const counts = {};
  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT COUNT(*) AS cnt FROM ${table}`);
      counts[table] = Number(result.rows[0].cnt);
    } catch {
      counts[table] = null; // table doesn't exist
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("");
  console.log(c.bold("KXKM Rollback V2"));
  console.log("");

  const connectionString = process.env.DATABASE_URL || "postgres://localhost:5432/kxkm_clown_v2";
  console.log(c.dim(`  database: ${connectionString.replace(/:[^:@]+@/, ":***@")}`));
  console.log(c.dim(`  mode: ${TRUNCATE_MODE ? "TRUNCATE" : "DROP"}`));
  console.log(c.dim(`  tables: ${SORTED_TABLES.join(", ")}`));
  console.log("");

  // Connect
  const pool = new Pool({ connectionString });

  try {
    const client = await pool.connect();
    client.release();
  } catch (err) {
    console.error(c.red(`  [err] Cannot connect to Postgres: ${err.message}`));
    process.exit(1);
  }

  // Show current row counts
  console.log(c.cyan("  Current table state:"));
  const counts = await getTableRowCounts(pool, SORTED_TABLES);
  const pad = (s) => s.padEnd(18);

  for (const table of SORTED_TABLES) {
    const count = counts[table];
    if (count === null) {
      console.log(`    ${pad(table)} ${c.dim("(does not exist)")}`);
    } else {
      console.log(`    ${pad(table)} ${count} rows`);
    }
  }

  console.log("");

  // Check if there's anything to do
  const existingTables = SORTED_TABLES.filter((t) => counts[t] !== null);
  if (existingTables.length === 0) {
    console.log(c.green("  Nothing to do — no target tables exist."));
    await pool.end();
    return;
  }

  // Confirmation
  if (!SKIP_CONFIRM) {
    const action = TRUNCATE_MODE ? "TRUNCATE" : "DROP";
    console.log(c.yellow(`  This will ${action} the following tables: ${existingTables.join(", ")}`));
    console.log(c.red("  ALL DATA IN THESE TABLES WILL BE PERMANENTLY LOST."));
    console.log("");

    const confirmed = await askConfirmation(`  Type "yes" to proceed: `);
    if (!confirmed) {
      console.log(c.dim("\n  Cancelled."));
      await pool.end();
      process.exit(0);
    }
    console.log("");
  }

  // Execute
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const table of SORTED_TABLES) {
      if (counts[table] === null) {
        console.log(`  ${c.dim("skip")}  ${pad(table)} ${c.dim("(not found)")}`);
        continue;
      }

      if (TRUNCATE_MODE) {
        await client.query(`TRUNCATE TABLE ${table} CASCADE`);
        console.log(`  ${c.green("ok")}    ${pad(table)} truncated (was ${counts[table]} rows)`);
      } else {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`  ${c.green("ok")}    ${pad(table)} dropped (was ${counts[table]} rows)`);
      }
    }

    await client.query("COMMIT");
    console.log(c.green(`\n  Rollback complete. ${existingTables.length} table(s) ${TRUNCATE_MODE ? "truncated" : "dropped"}.`));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(c.red(`\n  [err] Rollback failed: ${err.message}`));
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }

  console.log("");
}

main().catch((err) => {
  console.error(c.red(`\n  [fatal] ${err.message}`));
  process.exit(1);
});
