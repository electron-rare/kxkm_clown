/**
 * KXKM_Clown V2 — Node Engine Worker
 *
 * Connects to Postgres, polls for queued runs, executes graph nodes in
 * topological order using stub executors, and updates run status in the DB.
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
  canDequeue,
  dequeue,
  enqueue,
  markComplete,
  topologicalSort,
  validateEdgeContracts,
  collectNodeInputs,
  resolveFinalStatus,
  listDefaultRuntimes,
  createRun,
  validateJobSpec,
  buildTrlCommand,
  DEFAULT_HYPERPARAMS,
  type TrainingJobSpec,
  type NodeRun,
  type RunStep,
  type GraphNode,
  type NodeGraph,
  type StepStatus,
  type RunStatus,
  type NodeEngineRegistry,
  type QueueState,
} from "@kxkm/node-engine";
import { createIsoTimestamp } from "@kxkm/core";
import { formatOverviewLine, ansi } from "@kxkm/tui";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

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

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function logError(msg: string, err?: unknown): void {
  const ts = new Date().toISOString();
  const detail = err instanceof Error ? err.message : String(err ?? "");
  console.error(`[${ts}] ERROR: ${msg}${detail ? " — " + detail : ""}`);
}

// ---------------------------------------------------------------------------
// Stub executors
// ---------------------------------------------------------------------------

type StubResult = Record<string, unknown>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeNodeStub(
  nodeType: string,
  inputs: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<StubResult> {
  await delay(STEP_DELAY_MS);

  switch (nodeType) {
    // Dataset sources — return a mock dataset
    case "dataset_file":
    case "dataset_folder":
    case "huggingface_dataset":
    case "web_scraper":
      return { dataset: { items: [], format: "stub" } };

    // Data processing — pass through inputs
    case "clean_text":
    case "remove_duplicates":
    case "split_dataset":
      return { dataset: inputs.dataset ?? { items: [], format: "stub" } };

    // Dataset builders — pass through as dataset_ready
    case "format_instruction_dataset":
    case "chat_dataset":
      return { dataset_ready: inputs.dataset ?? { items: [], format: "stub" } };

    // Evaluation — execute via eval_model.py
    case "prompt_test":
    case "benchmark": {
      const evalModel = typeof params.model === "string" && params.model
        ? params.model
        : (inputs.model as Record<string, unknown>)?.modelName as string || "unsloth/llama-3-8b";
      const adapterPath = (inputs.model as Record<string, unknown>)?.adapterPath as string || undefined;
      const promptsPath = typeof params.promptsPath === "string" ? params.promptsPath : "";
      const evalOutputPath = `/tmp/kxkm-eval-${Date.now()}.json`;

      if (DRY_RUN) {
        log(`    [dry-run] would evaluate model=${evalModel} adapter=${adapterPath || "none"}`);
        return { evaluation: { kind: "dry-run", score: 1 } };
      }

      if (!promptsPath) {
        // No prompts file — return stub score
        log(`    [eval] no promptsPath provided — returning stub evaluation`);
        return { evaluation: { kind: "stub", score: 1 } };
      }

      const scriptPath = path.join(SCRIPTS_DIR, "eval_model.py");
      const args = [
        scriptPath,
        "--model", evalModel,
        "--prompts", promptsPath,
        "--output", evalOutputPath,
      ];
      if (adapterPath) args.push("--adapter", adapterPath);

      log(`    [eval] ${PYTHON_BIN} ${args.join(" ")}`);

      try {
        const { stdout, stderr } = await execFileAsync(PYTHON_BIN, args, {
          timeout: TRAINING_TIMEOUT_MS,
          maxBuffer: 50 * 1024 * 1024,
        });
        if (stderr) log(`    [eval] stderr: ${stderr.slice(-500)}`);

        const jsonLine = stdout.trim().split("\n").pop() || "{}";
        const evalResult = JSON.parse(jsonLine);
        log(`    [eval] result: status=${evalResult.status} score=${evalResult.score}`);

        return {
          evaluation: {
            kind: "real",
            score: evalResult.score,
            metrics: evalResult.metrics,
            outputFile: evalOutputPath,
          },
        };
      } catch (err) {
        logError(`    [eval] failed`, err);
        return { evaluation: { kind: "error", score: 0, error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // Training — execute via train_unsloth.py
    case "sft_training":
    case "lora_training":
    case "qlora_training": {
      const baseModel = typeof params.baseModel === "string" && params.baseModel
        ? params.baseModel
        : "unsloth/llama-3-8b";
      const datasetPath = typeof params.datasetPath === "string" ? params.datasetPath : "";
      const outputDir = typeof params.outputDir === "string"
        ? params.outputDir
        : `/tmp/kxkm-training-${Date.now()}`;
      const hp = {
        ...DEFAULT_HYPERPARAMS,
        ...(params.hyperparams && typeof params.hyperparams === "object" ? params.hyperparams : {}),
      };

      if (DRY_RUN) {
        const jobSpec = validateJobSpec({
          type: nodeType as TrainingJobSpec["type"], baseModel,
          datasetPath: datasetPath || "/data/dataset.jsonl",
          outputDir, hyperparams: hp,
        });
        log(`    [dry-run] would execute: ${buildTrlCommand(jobSpec)}`);
        return { model: { kind: "dry-run", modelName: `${baseModel}-finetuned`, jobSpec } };
      }

      if (!datasetPath) {
        return { model: { kind: "error", error: "datasetPath is required for training" } };
      }

      const scriptPath = path.join(SCRIPTS_DIR, "train_unsloth.py");
      const args = [
        scriptPath,
        "--model", baseModel,
        "--data", datasetPath,
        "--output", outputDir,
        "--method", params.dpo === true ? "dpo" : nodeType === "qlora_training" ? "qlora" : nodeType === "sft_training" ? "sft" : "lora",
        "--lr", String(hp.learningRate),
        "--epochs", String(hp.epochs),
        "--batch-size", String(hp.batchSize),
        "--lora-rank", String(hp.loraRank),
        "--lora-alpha", String(hp.loraAlpha),
        "--warmup-steps", String(hp.warmupSteps),
        "--max-seq-length", String(hp.maxSeqLength),
      ];
      if (nodeType === "qlora_training") args.push("--quantize", "4bit");

      log(`    [training] ${PYTHON_BIN} ${args.join(" ")}`);

      try {
        const { stdout, stderr } = await execFileAsync(PYTHON_BIN, args, {
          timeout: TRAINING_TIMEOUT_MS,
          maxBuffer: 50 * 1024 * 1024,
        });
        if (stderr) log(`    [training] stderr: ${stderr.slice(-500)}`);

        const jsonLine = stdout.trim().split("\n").pop() || "{}";
        const trainResult = JSON.parse(jsonLine);
        log(`    [training] result: status=${trainResult.status} loss=${trainResult.metrics?.trainLoss}`);

        return {
          model: {
            kind: "trained",
            modelName: `${baseModel}-finetuned`,
            adapterPath: trainResult.adapterPath || outputDir,
            metrics: trainResult.metrics,
            status: trainResult.status,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`    [training] failed`, err);
        return { model: { kind: "error", error: msg } };
      }
    }

    // Registry
    case "register_model":
      return { registered_model: { id: "stub" } };

    // Deployment — import LoRA adapter into Ollama
    case "deploy_api": {
      const modelInput = inputs.registered_model as Record<string, unknown> || inputs.model as Record<string, unknown> || {};
      const adapterPath = modelInput.adapterPath as string || (typeof params.adapterPath === "string" ? params.adapterPath : "");
      const baseOllamaModel = typeof params.baseOllamaModel === "string" ? params.baseOllamaModel : "llama3.2:1b";
      const deployName = typeof params.deployName === "string" ? params.deployName : `kxkm-${Date.now()}`;

      if (DRY_RUN || !adapterPath) {
        log(`    [deploy] dry-run or no adapter: base=${baseOllamaModel} name=${deployName}`);
        return { deployment: { kind: DRY_RUN ? "dry-run" : "stub", id: deployName } };
      }

      const scriptPath = path.join(SCRIPTS_DIR, "ollama-import-adapter.sh");
      const args = [scriptPath, "--base-model", baseOllamaModel, "--adapter-path", adapterPath, "--name", deployName];

      log(`    [deploy] importing to Ollama: ${deployName} from ${baseOllamaModel} + ${adapterPath}`);

      try {
        const { stdout, stderr } = await execFileAsync("/bin/bash", args, { timeout: 300000 });
        if (stderr) log(`    [deploy] stderr: ${stderr.slice(-500)}`);
        const result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
        log(`    [deploy] result: ${JSON.stringify(result)}`);
        return { deployment: { kind: "ollama", id: deployName, ...result } };
      } catch (err) {
        logError(`    [deploy] failed`, err);
        return { deployment: { kind: "error", id: deployName, error: err instanceof Error ? err.message : String(err) } };
      }
    }

    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Run executor
// ---------------------------------------------------------------------------

async function executeRun(
  run: NodeRun,
  registry: NodeEngineRegistry,
  options: { shouldCancel?: () => boolean } = {},
): Promise<void> {
  const graph = run.graphSnapshot;
  const shouldCancel = options.shouldCancel ?? (() => false);

  // Validate edges against registry contracts
  validateEdgeContracts(graph, registry);

  // Get execution order
  const sorted = topologicalSort(graph);

  // Track outputs per node for input collection
  const outputsByNode = new Map<string, Record<string, unknown>>();

  // Mark run as running
  run.status = "running";
  run.startedAt = createIsoTimestamp();
  let cancelled = false;

  log(`  Executing ${sorted.length} node(s) in topological order`);

  // Restore already-completed steps (recovery support)
  for (const node of sorted) {
    const step = run.steps.find((s) => s.id === node.id);
    if (step?.status === "completed") {
      log(`    [${node.id}] ${node.type} — already completed (recovered)`);
    }
  }

  for (const node of sorted) {
    const step = run.steps.find((s) => s.id === node.id);
    if (!step) continue;
    if (step.status === "completed") continue; // skip recovered steps

    if (shouldCancel() || shutdownRequested) {
      cancelled = true;
      log(`    [${node.id}] ${node.type} — cancelled`);
      break;
    }

    step.status = "running";
    step.startedAt = createIsoTimestamp();

    log(`    [${node.id}] ${node.type} — running`);

    try {
      const inputs = collectNodeInputs(graph, node.id, outputsByNode);
      const result = await executeNodeStub(node.type, inputs, node.params);
      outputsByNode.set(node.id, result);

      step.status = "completed";
      step.finishedAt = createIsoTimestamp();
      step.outputs = Object.keys(result);

      log(`    [${node.id}] ${node.type} — completed`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      step.status = "failed";
      step.finishedAt = createIsoTimestamp();
      step.error = message;

      logError(`    [${node.id}] ${node.type} — failed`, err);
      break; // stop on first failure (like V1)
    }
  }

  // Resolve final status from step statuses
  const stepStatuses = run.steps.map((s) => s.status);
  run.status = resolveFinalStatus(stepStatuses, cancelled);
  run.finishedAt = createIsoTimestamp();
}

// ---------------------------------------------------------------------------
// Shutdown handling
// ---------------------------------------------------------------------------

let shutdownRequested = false;

function requestShutdown(): void {
  if (shutdownRequested) return;
  shutdownRequested = true;
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

  // 6. Graceful shutdown
  process.on("SIGTERM", requestShutdown);
  process.on("SIGINT", requestShutdown);

  // 7. Poll loop
  log(`Entering poll loop (interval=${POLL_INTERVAL_MS}ms)`);

  while (!shutdownRequested) {
    try {
      // Fetch queued runs from the DB
      const queuedDbRuns = await runRepo.listByStatus("queued", 20);

      // Sync DB queued runs into in-memory queue state
      for (const dbRun of queuedDbRuns) {
        enqueue(queueState, dbRun.id);
      }

      // Process runs while we have capacity
      while (canDequeue(queueState) && !shutdownRequested) {
        const runId = dequeue(queueState);
        if (!runId) break;

        log(`Dequeued run: ${runId}`);

        // Update status to running in DB
        await runRepo.updateStatus(runId, "running");

        // Look up the run from the DB
        const dbRun = await runRepo.findById(runId);
        if (!dbRun) {
          logError(`Run ${runId} not found in DB — skipping`);
          markComplete(queueState, runId);
          continue;
        }

        const graphRecord = await graphRepo.findById(dbRun.graphId);
        if (!graphRecord) {
          logError(`Graph ${dbRun.graphId} for run ${runId} not found — marking failed`);
          await runRepo.updateStatus(runId, "failed");
          markComplete(queueState, runId);
          continue;
        }

        // Build a NodeGraph from the record (minimal — no edges/nodes stored in DB yet,
        // so we create a stub graph from the record for now)
        const graph: NodeGraph = {
          id: graphRecord.id,
          name: graphRecord.name,
          description: graphRecord.description,
          nodes: [],
          edges: [],
          createdAt: createIsoTimestamp(),
          updatedAt: createIsoTimestamp(),
        };

        // Create an in-memory run with steps from the graph
        const nodeRun = createRun(graph, "worker");
        // Override the id to match the DB run
        (nodeRun as { id: string }).id = runId;

        try {
          await executeRun(nodeRun, registry, {
            shouldCancel: () => {
              // Check if run was cancelled in DB (async check would be better
              // but keeping it simple — the cancel is also checked via shutdownRequested)
              return shutdownRequested;
            },
          });

          // Persist final status
          await runRepo.updateStatus(runId, nodeRun.status);
          log(`Run ${runId} finished with status: ${nodeRun.status}`);
        } catch (err) {
          logError(`Run ${runId} failed unexpectedly`, err);
          await runRepo.updateStatus(runId, "failed");
        } finally {
          markComplete(queueState, runId);
        }
      }

      // Log overview periodically
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

      if (queuedDbRuns.length > 0) {
        log(`Poll status: ${overview}`);
      }
    } catch (err) {
      logError("Poll loop error", err);
    }

    // Wait before next poll (check shutdown frequently)
    if (!shutdownRequested) {
      await delay(POLL_INTERVAL_MS);
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
