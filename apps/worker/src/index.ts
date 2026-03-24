/**
 * KXKM_Clown V2 — Node Engine Worker
 *
 * Thin orchestrator that delegates to worker-runtime.ts for all logic.
 */

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
} from "@kxkm/node-engine";
import { formatOverviewLine } from "@kxkm/tui";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

import {
  createShutdownController,
  createNodeExecutor,
  runPollCycle,
  waitForNextPollTick,
  type WorkerLogger,
  type WorkerConfig,
} from "./worker-runtime.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2000;
const MAX_CONCURRENCY = Number(process.env.NODE_ENGINE_MAX_CONCURRENCY) || 1;
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";

const config: WorkerConfig = {
  dryRun: DRY_RUN,
  stepDelayMs: 100,
  pythonBin: process.env.PYTHON_BIN || "/home/kxkm/venv/bin/python3",
  scriptsDir: process.env.SCRIPTS_DIR || path.resolve(process.cwd(), "scripts"),
  trainingTimeoutMs: Number(process.env.TRAINING_TIMEOUT_MS) || 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger: WorkerLogger = {
  log(msg: string): void {
    if (!DEBUG) return;
    console.log(`[${new Date().toISOString()}] ${msg}`);
  },
  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? err.message : String(err ?? "");
    console.error(`[${new Date().toISOString()}] ERROR: ${msg}${detail ? " — " + detail : ""}`);
  },
};

// ---------------------------------------------------------------------------
// Global error handlers
// ---------------------------------------------------------------------------

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception — shutting down", err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("WARNING: DATABASE_URL is not set. The worker requires a Postgres connection. Exiting.");
    process.exit(1);
  }

  logger.log("Starting KXKM_Clown V2 worker");

  // Connect to DB
  const dbConfig = loadDatabaseConfig();
  const pool = createPostgresPool(dbConfig);
  logger.log(`Connected to database: ${dbConfig.connectionString.replace(/\/\/.*@/, "//***@")}`);

  // Run migrations
  logger.log("Running database migrations...");
  await runMigrations(pool);
  logger.log("Migrations complete");

  // Create repos + registry + queue
  const graphRepo = createNodeGraphRepo(pool);
  const runRepo = createNodeRunRepo(pool);
  const registry = createNodeEngineRegistry();
  const runtimes = listDefaultRuntimes();
  logger.log(`Registry loaded: ${registry.listNodeTypes().length} node types, ${runtimes.length} runtimes`);

  const queueState = createQueueState({ maxConcurrency: MAX_CONCURRENCY });
  logger.log(`Queue state initialised: maxConcurrency=${MAX_CONCURRENCY}`);

  // Recovery
  const recovered = await runRepo.recoverStaleRuns();
  if (recovered.length > 0) {
    logger.log(`Recovered ${recovered.length} stale run(s): ${recovered.map((r) => r.id).join(", ")}`);
  }

  // Shutdown handling
  const shutdown = createShutdownController();
  const SHUTDOWN_TIMEOUT_MS = 30_000;
  function handleShutdownSignal(signal: string) {
    logger.log(`${signal} received`);
    shutdown.requestShutdown();
    setTimeout(() => {
      logger.error(`Forced exit after ${SHUTDOWN_TIMEOUT_MS}ms timeout`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  }
  process.on("SIGTERM", () => handleShutdownSignal("SIGTERM"));
  process.on("SIGINT", () => handleShutdownSignal("SIGINT"));

  // Create node executor
  const executeNode = createNodeExecutor(config, execFileAsync, logger);

  // Poll loop
  logger.log(`Entering poll loop (interval=${POLL_INTERVAL_MS}ms)`);

  while (!shutdown.isShutdownRequested()) {
    try {
      const result = await runPollCycle({
        queueState,
        runRepo,
        graphRepo,
        registry,
        executeNode,
        shutdown,
        logger,
      });

      if (result.queuedDbRuns > 0) {
        const overview = formatOverviewLine({
          queue: {
            desiredWorkers: MAX_CONCURRENCY,
            activeWorkers: queueState.running.length,
            queuedRuns: queueState.queued.length,
            runningRuns: queueState.running.length,
          },
          registry: {
            graphs: (await graphRepo.list()).length,
            models: 0,
          },
          storage: {
            backend: "postgres",
            artifacts: "filesystem",
          },
        });
        logger.log(`Poll status: ${overview}`);
      }
    } catch (err) {
      logger.error("Poll loop error", err);
    }

    if (!shutdown.isShutdownRequested()) {
      await waitForNextPollTick(POLL_INTERVAL_MS);
    }
  }

  // Cleanup
  logger.log("Shutting down...");
  await pool.end();
  logger.log("Worker stopped");
}

main().catch((err) => {
  logger.error("Fatal error in worker", err);
  process.exit(1);
});
