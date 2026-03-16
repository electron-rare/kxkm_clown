#!/usr/bin/env node

/**
 * V2 DPO Training Pipeline
 *
 * Orchestrates the full DPO (Direct Preference Optimisation) training flow:
 *   1. Fetch DPO pairs from the V2 API → save as JSONL file
 *   2. Create a Node Engine graph with training stages
 *   3. Queue the run
 *   4. Wait for completion
 *   5. Log results
 *
 * Usage:
 *   node scripts/v2-dpo-pipeline.js [options]
 *
 * Options:
 *   --persona-id <id>    Filter DPO pairs for a specific persona
 *   --model <name>       Base model name (default: unsloth/Llama-3.2-1B-Instruct)
 *   --output-dir <dir>   Training output directory (default: data/training)
 *   --api-url <url>      V2 API base URL (default: http://localhost:4180)
 *   --dry-run            Print plan without executing
 *   --token <token>      Admin token for API auth
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { Pool } = require("pg");

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function readArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : "";
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ---------------------------------------------------------------------------
// HTTP fetch helper (no external deps)
// ---------------------------------------------------------------------------

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: headers || {} }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", reject);
  });
}

function httpPost(url, data, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const parsed = new URL(url);
    const payload = JSON.stringify(data);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...(headers || {}),
      },
    };
    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Step 1: Fetch DPO pairs from API and save as JSONL
// ---------------------------------------------------------------------------

async function fetchDPOPairs(apiUrl, personaId, token) {
  let url = `${apiUrl}/api/v2/export/dpo`;
  if (personaId) {
    url += `?persona_id=${encodeURIComponent(personaId)}`;
  }

  const headers = {};
  if (token) {
    headers["Cookie"] = `kxkm_v2_session=${token}`;
  }

  console.log("[dpo-pipeline] fetching DPO pairs from " + url);
  const res = await httpGet(url, headers);

  if (res.status !== 200) {
    throw new Error(
      `API returned status ${res.status}: ${res.body.slice(0, 200)}`
    );
  }

  const lines = res.body.trim().split("\n").filter(Boolean);
  const pairs = lines.map((line) => JSON.parse(line));
  console.log("[dpo-pipeline] received " + pairs.length + " DPO pairs");
  return { pairs, rawBody: res.body };
}

function saveDPODataset(outputDir, rawBody) {
  const ts = timestamp();
  const filename = `dpo-${ts}.jsonl`;
  const filePath = path.resolve(process.cwd(), outputDir, filename);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rawBody, "utf8");
  console.log("[dpo-pipeline] saved dataset to " + filePath);
  return filePath;
}

// ---------------------------------------------------------------------------
// Step 2-3: Create Node Engine graph and queue a run via DB
// ---------------------------------------------------------------------------

async function ensureTrainingGraph(pool, baseModel, datasetFile) {
  const graphId = "dpo_training_" + timestamp().replace(/-/g, "_");
  const description = [
    "DPO training pipeline",
    "model: " + baseModel,
    "dataset: " + path.basename(datasetFile),
  ].join(" | ");

  // Check if a recent DPO graph already exists
  const existing = await pool.query(
    `SELECT id, name FROM node_graphs
     WHERE name LIKE 'dpo_training_%'
     ORDER BY name DESC LIMIT 1`
  );

  if (existing.rows.length > 0) {
    console.log(
      "[dpo-pipeline] found existing graph: " + existing.rows[0].id
    );
  }

  // Create a new graph for this pipeline run
  await pool.query(
    `INSERT INTO node_graphs (id, name, description)
     VALUES ($1, $2, $3)`,
    [graphId, graphId, description]
  );

  console.log("[dpo-pipeline] created graph " + graphId);
  return graphId;
}

async function createQueuedRun(pool, graphId, params) {
  const runId = "run_dpo_" + Math.random().toString(36).slice(2, 10);
  const createdAt = nowIso();
  await pool.query(
    `INSERT INTO node_runs (id, graph_id, status, params, created_at, updated_at)
     VALUES ($1, $2, 'queued', $3::jsonb, $4, NOW())`,
    [runId, graphId, JSON.stringify(params), createdAt]
  );
  console.log("[dpo-pipeline] queued run " + runId);
  return runId;
}

// ---------------------------------------------------------------------------
// Step 4: Wait for completion
// ---------------------------------------------------------------------------

async function waitForTerminalStatus(pool, runId, timeoutMs, pollIntervalMs) {
  const terminal = new Set([
    "completed",
    "failed",
    "cancelled",
    "blocked",
    "not_configured",
  ]);
  const started = Date.now();

  while (true) {
    const result = await pool.query(
      "SELECT id, status FROM node_runs WHERE id = $1 LIMIT 1",
      [runId]
    );
    if (result.rows.length === 0) {
      throw new Error("Run not found: " + runId);
    }

    const status = String(result.rows[0].status);
    if (terminal.has(status)) {
      return { status, elapsedMs: Date.now() - started };
    }

    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) {
      await pool.query(
        `UPDATE node_runs SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND status IN ('queued', 'running')`,
        [runId]
      );
      return { status: "cancelled", elapsedMs: elapsed, timedOut: true };
    }

    await sleep(pollIntervalMs);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiUrl = readArg("--api-url") || "http://localhost:4180";
  const personaId = readArg("--persona-id") || "";
  const baseModel =
    readArg("--model") || "unsloth/Llama-3.2-1B-Instruct";
  const outputDir = readArg("--output-dir") || "data/training";
  const dryRun = hasFlag("--dry-run");
  const token = readArg("--token") || process.env.ADMIN_TOKEN || "";

  const runTimeoutMs = 30 * 60 * 1000; // 30 minutes
  const pollIntervalMs = 3000;

  console.log("[dpo-pipeline] === DPO Training Pipeline ===");
  console.log("[dpo-pipeline] api:       " + apiUrl);
  console.log("[dpo-pipeline] model:     " + baseModel);
  console.log("[dpo-pipeline] output:    " + outputDir);
  if (personaId) {
    console.log("[dpo-pipeline] persona:   " + personaId);
  }
  if (dryRun) {
    console.log("[dpo-pipeline] mode:      DRY RUN");
  }
  console.log("");

  // ---- Step 1: Fetch and save DPO dataset ----
  console.log("[dpo-pipeline] Step 1/5: Fetch DPO pairs from API");
  const { pairs, rawBody } = await fetchDPOPairs(apiUrl, personaId, token);

  if (pairs.length === 0) {
    console.log("[dpo-pipeline] No DPO pairs found — nothing to train on. Exiting.");
    return;
  }

  const datasetFile = saveDPODataset(outputDir, rawBody);

  if (dryRun) {
    console.log("");
    console.log("[dpo-pipeline] DRY RUN — planned steps:");
    console.log("  Step 2: Create Node Engine graph (stages: dataset_file -> format_instruction_dataset -> lora_training -> benchmark -> register_model)");
    console.log("  Step 3: Queue run with params:");
    console.log("    base_model:   " + baseModel);
    console.log("    dataset_file: " + datasetFile);
    console.log("    output_dir:   " + path.resolve(process.cwd(), outputDir));
    console.log("    pair_count:   " + pairs.length);
    console.log("  Step 4: Wait for terminal status (timeout: " + (runTimeoutMs / 1000) + "s)");
    console.log("  Step 5: Log results");
    console.log("");
    console.log("[dpo-pipeline] dry run complete");
    return;
  }

  // ---- Steps 2-5: DB-driven orchestration ----
  const connectionString =
    process.env.DATABASE_URL || "postgres://localhost:5432/kxkm_clown_v2";
  const pool = new Pool({ connectionString });

  try {
    // Step 2: Create graph
    console.log("");
    console.log("[dpo-pipeline] Step 2/5: Create Node Engine graph");
    const graphId = await ensureTrainingGraph(pool, baseModel, datasetFile);

    // Step 3: Queue the run
    console.log("[dpo-pipeline] Step 3/5: Queue training run");
    const runParams = {
      pipeline: "dpo_training",
      stages: [
        "dataset_file",
        "format_instruction_dataset",
        "lora_training",
        "benchmark",
        "register_model",
      ],
      config: {
        base_model: baseModel,
        dataset_file: datasetFile,
        output_dir: path.resolve(process.cwd(), outputDir),
        pair_count: pairs.length,
        persona_id: personaId || "all",
        created_by: "scripts/v2-dpo-pipeline.js",
        created_at: nowIso(),
      },
    };
    const runId = await createQueuedRun(pool, graphId, runParams);

    // Step 4: Wait
    console.log("[dpo-pipeline] Step 4/5: Waiting for run completion...");
    const outcome = await waitForTerminalStatus(
      pool,
      runId,
      runTimeoutMs,
      pollIntervalMs
    );

    // Step 5: Log results
    console.log("");
    console.log("[dpo-pipeline] Step 5/5: Results");
    console.log("  run_id:     " + runId);
    console.log("  graph_id:   " + graphId);
    console.log("  status:     " + outcome.status);
    console.log("  elapsed:    " + (outcome.elapsedMs / 1000).toFixed(1) + "s");
    console.log("  dataset:    " + datasetFile);
    console.log("  pairs:      " + pairs.length);
    if (outcome.timedOut) {
      console.log("  warning:    run timed out after " + (runTimeoutMs / 1000) + "s");
    }
    console.log("");

    if (outcome.status === "completed") {
      console.log("[dpo-pipeline] Pipeline completed successfully.");
    } else {
      console.log(
        "[dpo-pipeline] Pipeline ended with status: " + outcome.status
      );
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(
    "[dpo-pipeline] fatal",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
