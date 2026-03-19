/**
 * KXKM_Clown V2 — Node Engine Worker
 *
 * Connects to Postgres, polls for queued runs, executes graph nodes in
 * topological order using stub executors, and updates run status in the DB.
 */

import { promisify } from "node:util";
import { execFile } from "node:child_process";
import * as path from "node:path";
import {
  loadDatabaseConfig,
  createPostgresPool,
  createNodeGraphRepo,
  createNodeRunRepo,
  runMigrations,
} from "@kxkm/storage";
import {
  createNodeEngineRegistry,
  createQueueState,
  listDefaultRuntimes,
  createNodeEngineOverview,
} from "@kxkm/node-engine";
import { formatOverviewLine } from "@kxkm/tui";
import {
  createShutdownController,
  createNodeExecutor,
  executeRun,
  runPollCycle,
  waitForNextPollTick,
  type WorkerLogger,
} from "./worker-runtime.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2000;
const MAX_CONCURRENCY = Number(process.env.NODE_ENGINE_MAX_CONCURRENCY) || 1;
const STEP_DELAY_MS = 100;
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
const PYTHON_BIN = process.env.PYTHON_BIN || "/home/kxkm/venv/bin/python3";
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.resolve(process.cwd(), "scripts");
const TRAINING_TIMEOUT_MS = Number(process.env.TRAINING_TIMEOUT_MS) || 60 * 60 * 1000; // 1h

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";

function log(msg: string): void {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] ${msg}\n`);
}

function logError(msg: string, err?: unknown): void {
  const ts = new Date().toISOString();
  const detail = err instanceof Error ? err.message : String(err ?? "");
  process.stderr.write(`[${ts}] ERROR: ${msg}${detail ? " — " + detail : ""}\n`);
}

const workerLogger: WorkerLogger = {
  log,
  error: logError,
};

// ---------------------------------------------------------------------------
// Shutdown handling
// ---------------------------------------------------------------------------

const shutdown = createShutdownController();

function requestShutdown(): void {
  if (shutdown.isShutdownRequested()) return;
  shutdown.requestShutdown();
  log("Shutdown requested — finishing current work...");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.warn(
      "WARNING: DATABASE_URL is not set. " +
        "The worker requires a Postgres connection. Exiting.",
    );
    process.exit(1);
  }

  log("Starting KXKM_Clown V2 worker");

  // 1. Connect to DB
  const dbConfig = loadDatabaseConfig();
  const pool = createPostgresPool(dbConfig);
  log(`Connected to database: ${dbConfig.connectionString.replace(/\/\/.*@/, "//***@")}`);

  // 2. Run migrations
  log("Running database migrations...");
  await runMigrations(pool);
  log("Migrations complete");

  // 3. Create repos
  const graphRepo = createNodeGraphRepo(pool);
  const runRepo = createNodeRunRepo(pool);

  // 4. Create registry with all built-in node types
  const registry = createNodeEngineRegistry();
  const nodeTypes = registry.listNodeTypes();
  const runtimes = listDefaultRuntimes();
  log(`Registry loaded: ${nodeTypes.length} node types, ${runtimes.length} runtimes`);

  // 5. Create queue state
  const queueState = createQueueState({ maxConcurrency: MAX_CONCURRENCY });
  log(`Queue state initialised: maxConcurrency=${MAX_CONCURRENCY}`);

  // 5b. Recovery — re-queue runs that were running when worker last crashed
  const recovered = await runRepo.recoverStaleRuns();
  if (recovered.length > 0) {
    log(`Recovered ${recovered.length} stale run(s): ${recovered.map((r) => r.id).join(", ")}`);
  }

  const executeNode = createNodeExecutor(
    {
      dryRun: DRY_RUN,
      stepDelayMs: STEP_DELAY_MS,
      pythonBin: PYTHON_BIN,
      scriptsDir: SCRIPTS_DIR,
      trainingTimeoutMs: TRAINING_TIMEOUT_MS,
    },
    execFileAsync,
    workerLogger,
  );

  // 6. Graceful shutdown
  process.on("SIGTERM", requestShutdown);
  process.on("SIGINT", requestShutdown);

  // 7. Poll loop
  log(`Entering poll loop (interval=${POLL_INTERVAL_MS}ms)`);

  while (!shutdown.isShutdownRequested()) {
    try {
      const cycle = await runPollCycle({
        queueState,
        runRepo,
        graphRepo,
        registry,
        executeNode,
        shutdown,
        logger: workerLogger,
      });

      const overview = formatOverviewLine(
        createNodeEngineOverview({
          graphs: (await graphRepo.list()).length,
          models: 0,
          queuedRuns: queueState.queued.length,
          runningRuns: queueState.running.length,
          desiredWorkers: MAX_CONCURRENCY,
          activeWorkers: queueState.running.length,
        }),
      );

      if (cycle.queuedDbRuns > 0) {
        log(`Poll status: ${overview}`);
      }
    } catch (err) {
      logError("Poll loop error", err);
    }

    if (!shutdown.isShutdownRequested()) {
      await waitForNextPollTick(POLL_INTERVAL_MS);
    }
  }

  // Cleanup
  log("Shutting down...");
  await pool.end();
  log("Worker stopped");
}

main().catch((err) => {
  logError("Fatal error in worker", err);
  process.exit(1);
});
