#!/usr/bin/env node

/**
 * V2 Autoresearch Loop (minimal, DB-driven)
 *
 * Runs fixed-budget experiment cycles on an existing Node Engine graph by:
 * - creating queued runs
 * - waiting for terminal status
 * - scoring outcomes with a deterministic policy
 * - tracking best candidate across the session
 *
 * This script does not mutate graph code. It automates run orchestration and
 * keep/discard decisions at the run level.
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

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

function loadConfig(configPath) {
  const resolved = path.resolve(process.cwd(), configPath);
  const raw = fs.readFileSync(resolved, "utf8");
  const cfg = JSON.parse(raw);

  if (!cfg || typeof cfg !== "object") {
    throw new Error("Invalid config: expected object");
  }
  if (typeof cfg.graphId !== "string" || !cfg.graphId) {
    throw new Error("Invalid config: graphId is required");
  }

  return {
    graphId: cfg.graphId,
    maxExperiments: Number.isFinite(cfg.maxExperiments) ? cfg.maxExperiments : 12,
    runTimeoutMs: Number.isFinite(cfg.runTimeoutMs) ? cfg.runTimeoutMs : 5 * 60 * 1000,
    pollIntervalMs: Number.isFinite(cfg.pollIntervalMs) ? cfg.pollIntervalMs : 2000,
    statusScores: cfg.statusScores && typeof cfg.statusScores === "object"
      ? cfg.statusScores
      : {
          completed: 1,
          failed: 0,
          cancelled: -1,
          blocked: -1,
          not_configured: -1,
        },
    outputFile: typeof cfg.outputFile === "string" && cfg.outputFile
      ? cfg.outputFile
      : "data/node-engine/autoresearch/results.tsv",
    tag: typeof cfg.tag === "string" ? cfg.tag : "default",
    mutations: cfg.mutations && typeof cfg.mutations === "object" ? cfg.mutations : null,
  };
}

function scoreRun(status, elapsedMs, statusScores, artifactScore) {
  // If an artifact-based metric score exists, use it as primary
  if (Number.isFinite(artifactScore) && artifactScore > 0) {
    const speedBonus = Math.max(0, 1 - elapsedMs / (10 * 60 * 1000));
    return artifactScore + speedBonus * 0.1;
  }
  // Fallback: status-based scoring
  const base = Number(statusScores[status]);
  const safeBase = Number.isFinite(base) ? base : -1;
  const speedBonus = safeBase > 0 ? Math.max(0, 1 - elapsedMs / (10 * 60 * 1000)) : 0;
  return safeBase + speedBonus;
}

function mutateParams(mutations, experimentIndex) {
  if (!mutations || typeof mutations !== "object") return {};
  const params = {};
  for (const [key, spec] of Object.entries(mutations)) {
    if (!spec || typeof spec !== "object") continue;
    if (spec.strategy === "random" && Number.isFinite(spec.min) && Number.isFinite(spec.max)) {
      params[key] = spec.min + Math.random() * (spec.max - spec.min);
    } else if (Array.isArray(spec.values) && spec.values.length > 0) {
      params[key] = spec.values[experimentIndex % spec.values.length];
    }
  }
  return params;
}

function ensureTsvHeader(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      [
        "timestamp\texperiment\trun_id\tgraph_id\tstatus\telapsed_ms\tartifact_score\tscore\tdecision\ttag\tmutated_params",
      ].join("\n") + "\n",
      "utf8",
    );
  }
}

function appendTsv(filePath, row) {
  fs.appendFileSync(filePath, row.join("\t") + "\n", "utf8");
}

async function extractArtifactScore(pool, runId) {
  // Look for evaluation artifacts that contain a metric score
  try {
    const result = await pool.query(
      `SELECT data FROM node_run_artifacts
       WHERE run_id = $1 AND type = 'evaluation'
       ORDER BY created_at DESC LIMIT 1`,
      [runId],
    );
    if (result.rows.length === 0) return NaN;
    const data = result.rows[0].data;
    if (!data || typeof data !== "object") return NaN;
    // Support multiple metric names: score, eval_score, accuracy, f1, bleu
    for (const key of ["score", "eval_score", "accuracy", "f1", "bleu", "perplexity"]) {
      if (Number.isFinite(data[key])) {
        // For perplexity, lower is better — invert it
        if (key === "perplexity") return 1 / (1 + data[key]);
        return data[key];
      }
    }
    return NaN;
  } catch {
    return NaN;
  }
}

async function registerBestModel(pool, bestRunId, bestScore, tag) {
  try {
    const result = await pool.query(
      `SELECT id, type, data FROM node_run_artifacts
       WHERE run_id = $1 AND type = 'model'
       ORDER BY created_at DESC LIMIT 1`,
      [bestRunId],
    );
    if (result.rows.length === 0) {
      console.log("[autoresearch] no model artifact found for run " + bestRunId + ", skipping registration");
      return null;
    }
    const artifact = result.rows[0];
    const data = artifact.data || {};
    const adapterPath = data.adapterPath || data.adapter_path || data.path || null;

    const registryEntry = {
      runId: bestRunId,
      artifactId: artifact.id,
      score: bestScore,
      tag,
      adapterPath,
      registeredAt: nowIso(),
      data,
    };

    const registryDir = path.resolve(process.cwd(), "data/node-engine/registry");
    fs.mkdirSync(registryDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const registryFile = path.join(registryDir, tag + "-" + timestamp + ".json");
    fs.writeFileSync(registryFile, JSON.stringify(registryEntry, null, 2), "utf8");

    console.log("[autoresearch] model registered: " + registryFile);
    return registryFile;
  } catch (err) {
    console.error("[autoresearch] registry error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function ensureGraphExists(pool, graphId) {
  const result = await pool.query(
    "SELECT id, name FROM node_graphs WHERE id = $1 LIMIT 1",
    [graphId],
  );
  if (result.rows.length === 0) {
    throw new Error("Graph not found: " + graphId);
  }
  return result.rows[0];
}

async function createQueuedRun(pool, graphId, params) {
  const runId = "run_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  const createdAt = nowIso();
  await pool.query(
    `INSERT INTO node_runs (id, graph_id, status, params, created_at, updated_at)
     VALUES ($1, $2, 'queued', $3::jsonb, $4, NOW())`,
    [runId, graphId, JSON.stringify(params || {}), createdAt],
  );
  return { id: runId, createdAt };
}

async function getRunStatus(pool, runId) {
  const result = await pool.query(
    "SELECT id, status, created_at, updated_at FROM node_runs WHERE id = $1 LIMIT 1",
    [runId],
  );
  if (result.rows.length === 0) {
    throw new Error("Run not found: " + runId);
  }
  return result.rows[0];
}

async function cancelRun(pool, runId) {
  await pool.query(
    `UPDATE node_runs
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status IN ('queued', 'running')`,
    [runId],
  );
}

async function waitForTerminalStatus(pool, runId, timeoutMs, pollIntervalMs) {
  const terminal = new Set(["completed", "failed", "cancelled", "blocked", "not_configured"]);
  const started = Date.now();

  while (true) {
    const row = await getRunStatus(pool, runId);
    const status = String(row.status);
    if (terminal.has(status)) {
      return {
        status,
        elapsedMs: Date.now() - started,
        timedOut: false,
      };
    }

    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) {
      await cancelRun(pool, runId);
      return {
        status: "cancelled",
        elapsedMs: elapsed,
        timedOut: true,
      };
    }

    await sleep(pollIntervalMs);
  }
}

async function main() {
  const configPath = readArg("--config") || "ops/v2/autoresearch.example.json";
  const once = hasFlag("--once");

  const config = loadConfig(configPath);
  const outputPath = path.resolve(process.cwd(), config.outputFile);
  ensureTsvHeader(outputPath);

  const connectionString = process.env.DATABASE_URL || "postgres://localhost:5432/kxkm_clown_v2";
  const pool = new Pool({ connectionString });

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestRunId = "";

  try {
    const graph = await ensureGraphExists(pool, config.graphId);
    console.log("[autoresearch] graph=" + graph.id + " name=" + graph.name);

    const total = once ? 1 : config.maxExperiments;
    for (let i = 1; i <= total; i += 1) {
      const experimentTag = "exp_" + String(i).padStart(3, "0");
      const mutated = mutateParams(config.mutations, i - 1);

      const run = await createQueuedRun(pool, config.graphId, {
        autoresearch: {
          tag: config.tag,
          experiment: experimentTag,
          createdBy: "scripts/v2-autoresearch-loop.js",
        },
        ...mutated,
      });

      console.log("[autoresearch] queued " + run.id + " (" + experimentTag + ")");

      const outcome = await waitForTerminalStatus(
        pool,
        run.id,
        config.runTimeoutMs,
        config.pollIntervalMs,
      );

      const artifactScore = await extractArtifactScore(pool, run.id);
      const score = scoreRun(outcome.status, outcome.elapsedMs, config.statusScores, artifactScore);
      const isBest = score > bestScore;
      const decision = isBest ? "keep" : "discard";

      if (isBest) {
        bestScore = score;
        bestRunId = run.id;
      }

      const mutatedJson = Object.keys(mutated).length > 0 ? JSON.stringify(mutated) : "";
      appendTsv(outputPath, [
        nowIso(),
        experimentTag,
        run.id,
        config.graphId,
        outcome.status,
        String(outcome.elapsedMs),
        Number.isFinite(artifactScore) ? artifactScore.toFixed(6) : "",
        score.toFixed(6),
        decision,
        config.tag,
        mutatedJson,
      ]);

      const suffix = outcome.timedOut ? " timeout" : "";
      const metricInfo = Number.isFinite(artifactScore) ? " metric=" + artifactScore.toFixed(4) : "";
      console.log(
        "[autoresearch] " + run.id + " status=" + outcome.status +
          metricInfo + " score=" + score.toFixed(4) + " decision=" + decision + suffix,
      );
    }

    console.log(
      "[autoresearch] done best_run=" + (bestRunId || "none") +
      " best_score=" + (Number.isFinite(bestScore) ? bestScore.toFixed(4) : "n/a"),
    );
    console.log("[autoresearch] results=" + outputPath);

    if (bestRunId && Number.isFinite(bestScore) && bestScore > 0) {
      await registerBestModel(pool, bestRunId, bestScore, config.tag);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[autoresearch] fatal", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
