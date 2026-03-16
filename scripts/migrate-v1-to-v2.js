#!/usr/bin/env node
// Migrates V1 flat-file data to V2 Postgres
// Usage: node scripts/migrate-v1-to-v2.js [--dry-run] [--verbose] [--help]
//
// Steps:
// 1. Connect to Postgres (DATABASE_URL env var)
// 2. Run migrations (create tables)
// 3. Read V1 data from data/ directory
// 4. Transform and insert into V2 tables
// 5. Report results
//
// Supports: --dry-run (read and transform but don't insert)
//           --verbose (log each item)
//           --help

const fs = require("fs");
const path = require("path");
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
${c.bold("KXKM Migrate V1 → V2")}

Usage: node scripts/migrate-v1-to-v2.js [options]

Options:
  --dry-run   Read and transform V1 data but do not insert into Postgres
  --verbose   Log each migrated item
  --help      Show this help message

Environment:
  DATABASE_URL   Postgres connection string (default: postgres://localhost:5432/kxkm_clown_v2)
`);
  process.exit(0);
}

const DRY_RUN = args.includes("--dry-run");
const VERBOSE = args.includes("--verbose");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const PERSONAS_FILE = path.join(ROOT_DIR, "personas.js");
const GRAPHS_DIR = path.join(DATA_DIR, "node-engine", "graphs");
const RUNS_DIR = path.join(DATA_DIR, "node-engine", "runs");
const SOURCES_DIR = path.join(DATA_DIR, "persona-sources");
const FEEDBACK_DIR = path.join(DATA_DIR, "persona-feedback");
const PROPOSALS_DIR = path.join(DATA_DIR, "persona-proposals");
const OVERRIDES_FILE = path.join(DATA_DIR, "personas.overrides.json");

// ---------------------------------------------------------------------------
// SQL schemas (mirrored from packages/storage)
// ---------------------------------------------------------------------------

const CORE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(36) PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const PERSONA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS personas (
  id VARCHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  summary TEXT NOT NULL,
  editable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
`;

const NODE_ENGINE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS node_graphs (
  id VARCHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS node_runs (
  id VARCHAR(36) PRIMARY KEY,
  graph_id VARCHAR(36) NOT NULL REFERENCES node_graphs(id),
  status TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function readJsonlFile(file) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, "utf-8").trim();
  if (!content) return [];
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

// ---------------------------------------------------------------------------
// Data readers — V1
// ---------------------------------------------------------------------------

function readV1Personas() {
  // Load persona definitions from personas.js
  let definitions = {};
  try {
    const mod = require(PERSONAS_FILE);
    definitions = mod.PERSONA_DEFINITIONS || {};
  } catch (err) {
    console.error(c.yellow(`  [warn] Could not load personas.js: ${err.message}`));
    return [];
  }

  // Load overrides
  const overrides = readJsonFile(OVERRIDES_FILE, { personas: {}, customPersonas: {} });
  const overridePersonas = overrides.personas || {};
  const customPersonas = overrides.customPersonas || {};

  const results = [];

  // Built-in personas
  for (const [baseName, def] of Object.entries(definitions)) {
    const override = overridePersonas[def.id] || {};
    results.push({
      id: def.id,
      name: override.name || baseName,
      model: override.model || def.model,
      summary: def.identity?.desc || `${baseName} persona`,
      editable: true,
    });
  }

  // Custom personas from overrides
  for (const [id, entry] of Object.entries(customPersonas)) {
    results.push({
      id: id,
      name: entry.name || id,
      model: entry.model || "unknown",
      summary: entry.desc || `${entry.name || id} — custom persona`,
      editable: true,
    });
  }

  return results;
}

function readV1Graphs() {
  const files = listJsonFiles(GRAPHS_DIR);
  const results = [];

  for (const file of files) {
    const graph = readJsonFile(file, null);
    if (!graph || !graph.id) continue;

    results.push({
      id: graph.id,
      name: cleanText(graph.name, 120) || "Untitled Graph",
      description: cleanText(graph.description, 600) || "",
      metadata: {
        runtime: graph.runtime || "local_cpu",
        tags: graph.tags || [],
        version: graph.version || 1,
        status: graph.status || "draft",
        nodeCount: (graph.nodes || []).length,
        edgeCount: (graph.edges || []).length,
        nodes: (graph.nodes || []).map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          runtime: n.runtime,
        })),
      },
      createdAt: graph.createdAt || null,
      updatedAt: graph.updatedAt || null,
    });
  }

  return results;
}

function readV1Runs() {
  const files = listJsonFiles(RUNS_DIR);
  const results = [];

  for (const file of files) {
    const run = readJsonFile(file, null);
    if (!run || !run.id) continue;

    results.push({
      id: run.id,
      graphId: run.graphId || "",
      status: run.status || "unknown",
      params: {
        actor: run.actor || "admin",
        runtime: run.runtime || "local_cpu",
        graphName: run.graphName || "",
        graphVersion: run.graphVersion || 1,
        stepCount: run.stepCount || 0,
      },
      createdAt: run.createdAt || run.queuedAt || null,
      updatedAt: run.finishedAt || run.startedAt || null,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Migration actions
// ---------------------------------------------------------------------------

async function runSchemaCreation(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(CORE_SCHEMA_SQL);
    await client.query(PERSONA_SCHEMA_SQL);
    await client.query(NODE_ENGINE_SCHEMA_SQL);
    await client.query("COMMIT");
    console.log(c.green("  [ok] Schema tables created / verified"));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function migratePersonas(pool, personas) {
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const persona of personas) {
    try {
      if (VERBOSE) {
        console.log(c.dim(`    persona: ${persona.id} (${persona.name}) → ${persona.model}`));
      }

      if (!DRY_RUN) {
        await pool.query(
          `INSERT INTO personas (id, name, model, summary, editable, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             model = EXCLUDED.model,
             summary = EXCLUDED.summary,
             editable = EXCLUDED.editable,
             updated_at = NOW()`,
          [persona.id, persona.name, persona.model, persona.summary, persona.editable]
        );
      }
      inserted++;
    } catch (err) {
      errors++;
      console.error(c.red(`    [err] persona ${persona.id}: ${err.message}`));
    }
  }

  return { inserted, skipped, errors };
}

async function migrateGraphs(pool, graphs) {
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const graph of graphs) {
    try {
      if (VERBOSE) {
        console.log(c.dim(`    graph: ${graph.id} (${graph.name})`));
      }

      if (!DRY_RUN) {
        await pool.query(
          `INSERT INTO node_graphs (id, name, description, metadata, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             metadata = EXCLUDED.metadata,
             updated_at = EXCLUDED.updated_at`,
          [
            graph.id,
            graph.name,
            graph.description,
            JSON.stringify(graph.metadata),
            graph.createdAt || new Date().toISOString(),
            graph.updatedAt || null,
          ]
        );
      }
      inserted++;
    } catch (err) {
      errors++;
      console.error(c.red(`    [err] graph ${graph.id}: ${err.message}`));
    }
  }

  return { inserted, skipped, errors };
}

async function migrateRuns(pool, runs, graphIds) {
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const run of runs) {
    // Skip runs referencing non-existent graphs (FK constraint)
    if (!graphIds.has(run.graphId)) {
      if (VERBOSE) {
        console.log(c.yellow(`    run: ${run.id} — skipped (graph ${run.graphId} not found)`));
      }
      skipped++;
      continue;
    }

    try {
      if (VERBOSE) {
        console.log(c.dim(`    run: ${run.id} (${run.status}) → graph ${run.graphId}`));
      }

      if (!DRY_RUN) {
        await pool.query(
          `INSERT INTO node_runs (id, graph_id, status, params, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             status = EXCLUDED.status,
             params = EXCLUDED.params,
             updated_at = EXCLUDED.updated_at`,
          [
            run.id,
            run.graphId,
            run.status,
            JSON.stringify(run.params),
            run.createdAt || new Date().toISOString(),
            run.updatedAt || null,
          ]
        );
      }
      inserted++;
    } catch (err) {
      errors++;
      console.error(c.red(`    [err] run ${run.id}: ${err.message}`));
    }
  }

  return { inserted, skipped, errors };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(results) {
  console.log("");
  console.log(c.bold("  Migration Report"));
  console.log(c.dim("  " + "─".repeat(50)));

  const pad = (label) => label.padEnd(16);

  for (const [entity, counts] of Object.entries(results)) {
    const status = counts.errors > 0
      ? c.yellow("partial")
      : c.green("ok");
    const parts = [
      `inserted=${c.green(String(counts.inserted))}`,
      `skipped=${c.yellow(String(counts.skipped))}`,
      `errors=${counts.errors > 0 ? c.red(String(counts.errors)) : c.dim("0")}`,
    ];
    console.log(`  ${pad(entity)} ${status}  ${parts.join("  ")}`);
  }

  const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors, 0);
  const totalInserted = Object.values(results).reduce((sum, r) => sum + r.inserted, 0);

  console.log(c.dim("  " + "─".repeat(50)));
  console.log(`  ${c.bold("Total:")} ${totalInserted} items migrated, ${totalErrors} errors`);

  if (DRY_RUN) {
    console.log(c.yellow("\n  [dry-run] No data was written to Postgres"));
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("");
  console.log(c.bold("KXKM Migrate V1 → V2"));
  console.log(c.dim(`  data dir: ${DATA_DIR}`));
  if (DRY_RUN) console.log(c.yellow("  mode: dry-run"));
  console.log("");

  // Check data dir exists
  if (!fs.existsSync(DATA_DIR)) {
    console.error(c.red("  [err] data/ directory not found — nothing to migrate"));
    process.exit(1);
  }

  // 1. Read V1 data
  console.log(c.cyan("  [1/4] Reading V1 data..."));

  const personas = readV1Personas();
  console.log(`    ${personas.length} personas found`);

  const graphs = readV1Graphs();
  console.log(`    ${graphs.length} graphs found`);

  const runs = readV1Runs();
  console.log(`    ${runs.length} runs found`);

  console.log(c.dim("    (sessions skipped — ephemeral)"));

  // 2. Connect to Postgres
  const connectionString = process.env.DATABASE_URL || "postgres://localhost:5432/kxkm_clown_v2";

  let pool = null;
  if (!DRY_RUN) {
    console.log(c.cyan("\n  [2/4] Connecting to Postgres..."));
    console.log(c.dim(`    ${connectionString.replace(/:[^:@]+@/, ":***@")}`));

    pool = new Pool({ connectionString });

    try {
      const client = await pool.connect();
      client.release();
      console.log(c.green("    connected"));
    } catch (err) {
      console.error(c.red(`    [err] Cannot connect: ${err.message}`));
      process.exit(1);
    }

    // 3. Run schema migrations
    console.log(c.cyan("\n  [3/4] Creating schema..."));
    await runSchemaCreation(pool);
  } else {
    console.log(c.dim("\n  [2/4] Skipping Postgres connection (dry-run)"));
    console.log(c.dim("  [3/4] Skipping schema creation (dry-run)"));
  }

  // 4. Migrate data
  console.log(c.cyan("\n  [4/4] Migrating data..."));

  const results = {};

  console.log(c.dim("    → personas"));
  results.personas = await migratePersonas(pool, personas);

  console.log(c.dim("    → graphs"));
  results.graphs = await migrateGraphs(pool, graphs);

  // Build set of graph IDs that exist (for FK validation on runs)
  const graphIds = new Set(graphs.map((g) => g.id));
  // Also include any graphs already in DB if not dry run
  if (pool) {
    try {
      const existing = await pool.query("SELECT id FROM node_graphs");
      for (const row of existing.rows) graphIds.add(row.id);
    } catch { /* ignore */ }
  }

  console.log(c.dim("    → runs"));
  results.runs = await migrateRuns(pool, runs, graphIds);

  // 5. Report
  printReport(results);

  // Cleanup
  if (pool) await pool.end();
}

main().catch((err) => {
  console.error(c.red(`\n  [fatal] ${err.message}`));
  if (VERBOSE) console.error(err.stack);
  process.exit(1);
});
