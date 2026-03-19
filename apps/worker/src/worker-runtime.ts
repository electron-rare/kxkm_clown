import type { ExecFileOptions } from "node:child_process";
import * as path from "node:path";
import { createIsoTimestamp } from "@kxkm/core";
import {
  DEFAULT_HYPERPARAMS,
  buildTrlCommand,
  createRun,
  canDequeue,
  collectNodeInputs,
  dequeue,
  enqueue,
  markComplete,
  resolveFinalStatus,
  topologicalSort,
  validateEdgeContracts,
  validateJobSpec,
  type NodeEngineRegistry,
  type NodeGraph,
  type NodeRun,
  type NodeRunRecord,
  type QueueState,
  type RunStatus,
  type TrainingJobSpec,
} from "@kxkm/node-engine";

export interface WorkerLogger {
  log(msg: string): void;
  error(msg: string, err?: unknown): void;
}

export interface WorkerConfig {
  dryRun: boolean;
  stepDelayMs: number;
  pythonBin: string;
  scriptsDir: string;
  trainingTimeoutMs: number;
}

export interface SubprocessRunner {
  (file: string, args: string[], options: ExecFileOptions): Promise<{ stdout: string; stderr: string }>;
}

export interface ShutdownController {
  requestShutdown(): void;
  isShutdownRequested(): boolean;
}

export interface GraphRecordLike {
  id: string;
  name: string;
  description: string;
}

export interface RunRepoLike {
  listByStatus(status: RunStatus, limit: number): Promise<NodeRunRecord[]>;
  findById(id: string): Promise<NodeRunRecord | null>;
  updateStatus(id: string, status: RunStatus): Promise<void>;
}

export interface GraphRepoLike {
  findById(id: string): Promise<GraphRecordLike | null>;
  list(): Promise<GraphRecordLike[]>;
}

export interface ExecuteNodeInputs {
  [key: string]: unknown;
}

export interface ExecuteNodeParams {
  [key: string]: unknown;
}

export type ExecuteNodeFn = (
  nodeType: string,
  inputs: ExecuteNodeInputs,
  params: ExecuteNodeParams,
) => Promise<Record<string, unknown>>;

export interface RunPollCycleResult {
  queuedDbRuns: number;
  processedRunIds: string[];
}

export interface ProcessDequeuedRunDeps {
  runId: string;
  runRepo: RunRepoLike;
  graphRepo: GraphRepoLike;
  registry: NodeEngineRegistry;
  executeNode: ExecuteNodeFn;
  logger: WorkerLogger;
  shouldCancel: () => boolean;
}

export interface RunExecutionOptions {
  shouldCancel?: () => boolean;
  executeNode: ExecuteNodeFn;
  logger: WorkerLogger;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createShutdownController(): ShutdownController {
  let shutdownRequested = false;
  return {
    requestShutdown(): void {
      shutdownRequested = true;
    },
    isShutdownRequested(): boolean {
      return shutdownRequested;
    },
  };
}

export function syncQueuedRuns(queueState: QueueState, queuedDbRuns: NodeRunRecord[]): number {
  let added = 0;
  for (const dbRun of queuedDbRuns) {
    const before = queueState.queued.length;
    enqueue(queueState, dbRun.id);
    if (queueState.queued.length > before) added++;
  }
  return added;
}

export function buildWorkerGraph(graphRecord: GraphRecordLike): NodeGraph {
  const now = createIsoTimestamp();
  return {
    id: graphRecord.id,
    name: graphRecord.name,
    description: graphRecord.description,
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createWorkerRun(graph: NodeGraph, runId: string, actor = "worker"): NodeRun {
  const run = createRun(graph, actor);
  run.id = runId;
  return run;
}

export type JsonParseResult =
  | { ok: true; rawLine: string; value: Record<string, unknown> }
  | { ok: false; rawLine: string; value: Record<string, never>; error: Error };

export function parseLastJsonLine(stdout: string): JsonParseResult {
  const rawLine = stdout.trim().split("\n").pop() || "{}";
  try {
    return { ok: true, rawLine, value: JSON.parse(rawLine) as Record<string, unknown> };
  } catch (err) {
    return {
      ok: false,
      rawLine,
      value: {},
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export function createNodeExecutor(
  config: WorkerConfig,
  runner: SubprocessRunner,
  logger: WorkerLogger,
): ExecuteNodeFn {
  return async function executeNodeStub(
    nodeType: string,
    inputs: ExecuteNodeInputs,
    params: ExecuteNodeParams,
  ): Promise<Record<string, unknown>> {
    await delay(config.stepDelayMs);

    switch (nodeType) {
      case "dataset_file":
      case "dataset_folder":
      case "huggingface_dataset":
      case "web_scraper":
        return { dataset: { items: [], format: "stub" } };

      case "clean_text":
      case "remove_duplicates":
      case "split_dataset":
        return { dataset: inputs.dataset ?? { items: [], format: "stub" } };

      case "format_instruction_dataset":
      case "chat_dataset":
        return { dataset_ready: inputs.dataset ?? { items: [], format: "stub" } };

      case "prompt_test":
      case "benchmark": {
        const evalModel = typeof params.model === "string" && params.model
          ? params.model
          : ((inputs.model as Record<string, unknown> | undefined)?.modelName as string | undefined) || "unsloth/llama-3-8b";
        const adapterPath = (inputs.model as Record<string, unknown> | undefined)?.adapterPath as string | undefined;
        const promptsPath = typeof params.promptsPath === "string" ? params.promptsPath : "";
        const evalOutputPath = `/tmp/kxkm-eval-${Date.now()}.json`;

        if (config.dryRun) {
          logger.log(`    [dry-run] would evaluate model=${evalModel} adapter=${adapterPath || "none"}`);
          return { evaluation: { kind: "dry-run", score: 1 } };
        }

        if (!promptsPath) {
          logger.log("    [eval] no promptsPath provided — returning stub evaluation");
          return { evaluation: { kind: "stub", score: 1 } };
        }

        const scriptPath = path.join(config.scriptsDir, "eval_model.py");
        const args = [
          scriptPath,
          "--model",
          evalModel,
          "--prompts",
          promptsPath,
          "--output",
          evalOutputPath,
        ];
        if (adapterPath) args.push("--adapter", adapterPath);

        logger.log(`    [eval] ${config.pythonBin} ${args.join(" ")}`);

        try {
          const { stdout, stderr } = await runner(config.pythonBin, args, {
            timeout: config.trainingTimeoutMs,
            maxBuffer: 50 * 1024 * 1024,
          });
          if (stderr) logger.log(`    [eval] stderr: ${stderr.slice(-500)}`);

          const parsed = parseLastJsonLine(stdout);
          if (!parsed.ok) logger.error("    [eval] Failed to parse JSON output", parsed.error);
          const evalResult = parsed.value;
          logger.log(`    [eval] result: status=${evalResult.status} score=${evalResult.score}`);

          return {
            evaluation: {
              kind: "real",
              score: evalResult.score,
              metrics: evalResult.metrics,
              outputFile: evalOutputPath,
            },
          };
        } catch (err) {
          logger.error("    [eval] failed", err);
          return {
            evaluation: {
              kind: "error",
              score: 0,
              error: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }

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

        if (config.dryRun) {
          const jobSpec = validateJobSpec({
            type: nodeType as TrainingJobSpec["type"],
            baseModel,
            datasetPath: datasetPath || "/data/dataset.jsonl",
            outputDir,
            hyperparams: hp,
          });
          logger.log(`    [dry-run] would execute: ${buildTrlCommand(jobSpec)}`);
          return {
            model: {
              kind: "dry-run",
              modelName: `${baseModel}-finetuned`,
              jobSpec,
            },
          };
        }

        if (!datasetPath) {
          return { model: { kind: "error", error: "datasetPath is required for training" } };
        }

        const scriptPath = path.join(config.scriptsDir, "train_unsloth.py");
        const method = params.dpo === true ? "dpo" : nodeType === "qlora_training" ? "qlora" : nodeType === "sft_training" ? "sft" : "lora";
        const args = [
          scriptPath,
          "--model",
          baseModel,
          "--data",
          datasetPath,
          "--output",
          outputDir,
          "--method",
          method,
          "--lr",
          String((hp.learningRate as number) ?? ""),
          "--epochs",
          String((hp.epochs as number) ?? ""),
          "--batch-size",
          String((hp.batchSize as number) ?? ""),
          "--lora-rank",
          String((hp.loraRank as number) ?? ""),
          "--lora-alpha",
          String((hp.loraAlpha as number) ?? ""),
          "--warmup-steps",
          String((hp.warmupSteps as number) ?? ""),
          "--max-seq-length",
          String((hp.maxSeqLength as number) ?? ""),
        ];
        if (nodeType === "qlora_training") args.push("--quantize", "4bit");

        logger.log(`    [training] ${config.pythonBin} ${args.join(" ")}`);

        try {
          const { stdout, stderr } = await runner(config.pythonBin, args, {
            timeout: config.trainingTimeoutMs,
            maxBuffer: 50 * 1024 * 1024,
          });
          if (stderr) logger.log(`    [training] stderr: ${stderr.slice(-500)}`);

          const parsed = parseLastJsonLine(stdout);
          if (!parsed.ok) logger.error("    [training] Failed to parse JSON output", parsed.error);
          const trainResult = parsed.value;
          logger.log(
            `    [training] result: status=${trainResult.status} loss=${(trainResult.metrics as Record<string, unknown> | undefined)?.trainLoss}`,
          );

          return {
            model: {
              kind: "trained",
              modelName: `${baseModel}-finetuned`,
              adapterPath: (trainResult.adapterPath as string | undefined) || outputDir,
              metrics: trainResult.metrics,
              status: trainResult.status,
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("    [training] failed", err);
          return { model: { kind: "error", error: msg } };
        }
      }

      case "register_model":
        return { registered_model: { id: "stub" } };

      case "deploy_api": {
        const modelInput = (inputs.registered_model as Record<string, unknown> | undefined) || (inputs.model as Record<string, unknown> | undefined) || {};
        const adapterPath = (modelInput.adapterPath as string | undefined) || (typeof params.adapterPath === "string" ? params.adapterPath : "");
        const baseOllamaModel = typeof params.baseOllamaModel === "string" ? params.baseOllamaModel : "llama3.2:1b";
        const deployName = typeof params.deployName === "string" ? params.deployName : `kxkm-${Date.now()}`;

        if (config.dryRun || !adapterPath) {
          logger.log(`    [deploy] dry-run or no adapter: base=${baseOllamaModel} name=${deployName}`);
          return { deployment: { kind: config.dryRun ? "dry-run" : "stub", id: deployName } };
        }

        const scriptPath = path.join(config.scriptsDir, "ollama-import-adapter.sh");
        const args = [
          scriptPath,
          "--base-model",
          baseOllamaModel,
          "--adapter-path",
          adapterPath,
          "--name",
          deployName,
        ];

        logger.log(`    [deploy] importing to Ollama: ${deployName} from ${baseOllamaModel} + ${adapterPath}`);

        try {
          const { stdout, stderr } = await runner("/bin/bash", args, { timeout: 120_000 });
          if (stderr) logger.log(`    [deploy] stderr: ${stderr.slice(-500)}`);
          const parsed = parseLastJsonLine(stdout);
          if (!parsed.ok) {
            logger.error("    [deploy] invalid JSON", parsed.error);
            return { deployment: { kind: "error", id: deployName, error: "invalid_json_output" } };
          }
          const result = parsed.value;
          logger.log(`    [deploy] result: ${JSON.stringify(result)}`);
          return { deployment: { kind: "ollama", id: deployName, ...result } };
        } catch (err) {
          logger.error("    [deploy] failed", err);
          return {
            deployment: {
              kind: "error",
              id: deployName,
              error: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }

      default:
        return {};
    }
  };
}

export interface ExecuteRunDeps {
  executeNode: ExecuteNodeFn;
  logger: WorkerLogger;
  shouldCancel?: () => boolean;
}

export async function executeRun(
  run: NodeRun,
  registry: NodeEngineRegistry,
  deps: ExecuteRunDeps,
): Promise<void> {
  const shouldCancel = deps.shouldCancel ?? (() => false);
  validateEdgeContracts(run.graphSnapshot, registry);

  const sorted = topologicalSort(run.graphSnapshot);
  const outputsByNode = new Map<string, Record<string, unknown>>();

  run.status = "running";
  run.startedAt = createIsoTimestamp();
  let cancelled = false;

  deps.logger.log(`  Executing ${sorted.length} node(s) in topological order`);

  for (const node of sorted) {
    const step = run.steps.find((entry) => entry.id === node.id);
    if (step?.status === "completed") {
      deps.logger.log(`    [${node.id}] ${node.type} — already completed (recovered)`);
    }
  }

  for (const node of sorted) {
    const step = run.steps.find((entry) => entry.id === node.id);
    if (!step) continue;
    if (step.status === "completed") continue;

    if (shouldCancel()) {
      cancelled = true;
      deps.logger.log(`    [${node.id}] ${node.type} — cancelled`);
      break;
    }

    step.status = "running";
    step.startedAt = createIsoTimestamp();
    deps.logger.log(`    [${node.id}] ${node.type} — running`);

    try {
      const inputs = collectNodeInputs(run.graphSnapshot, node.id, outputsByNode);
      const result = await deps.executeNode(node.type, inputs, node.params);
      outputsByNode.set(node.id, result);
      step.status = "completed";
      step.finishedAt = createIsoTimestamp();
      step.outputs = Object.keys(result);
      deps.logger.log(`    [${node.id}] ${node.type} — completed`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      step.status = "failed";
      step.finishedAt = createIsoTimestamp();
      step.error = message;
      deps.logger.error(`    [${node.id}] ${node.type} — failed`, err);
      break;
    }
  }

  const stepStatuses = run.steps.map((entry) => entry.status);
  run.status = resolveFinalStatus(stepStatuses, cancelled);
  run.finishedAt = createIsoTimestamp();
}

export async function persistRunStatus(
  runRepo: RunRepoLike,
  runId: string,
  status: RunStatus,
): Promise<void> {
  await runRepo.updateStatus(runId, status);
}

export async function processDequeuedRun(
  deps: ProcessDequeuedRunDeps,
): Promise<{ kind: "completed" | "missing-run" | "missing-graph" | "failed"; status?: RunStatus }> {
  await deps.runRepo.updateStatus(deps.runId, "running");

  const dbRun = await deps.runRepo.findById(deps.runId);
  if (!dbRun) {
    deps.logger.error(`Run ${deps.runId} not found in DB — skipping`);
    return { kind: "missing-run" };
  }

  const graphRecord = await deps.graphRepo.findById(dbRun.graphId);
  if (!graphRecord) {
    deps.logger.error(`Graph ${dbRun.graphId} for run ${deps.runId} not found — marking failed`);
    await persistRunStatus(deps.runRepo, deps.runId, "failed");
    return { kind: "missing-graph", status: "failed" };
  }

  const graph = buildWorkerGraph(graphRecord);
  const nodeRun = createWorkerRun(graph, deps.runId, "worker");

  try {
    await executeRun(nodeRun, deps.registry, {
      executeNode: deps.executeNode,
      logger: deps.logger,
      shouldCancel: deps.shouldCancel,
    });
    await persistRunStatus(deps.runRepo, deps.runId, nodeRun.status);
    return { kind: "completed", status: nodeRun.status };
  } catch (err) {
    deps.logger.error(`Run ${deps.runId} failed unexpectedly`, err);
    await persistRunStatus(deps.runRepo, deps.runId, "failed");
    return { kind: "failed", status: "failed" };
  }
}

export async function runPollCycle(
  params: {
    queueState: QueueState;
    runRepo: RunRepoLike;
    graphRepo: GraphRepoLike;
    registry: NodeEngineRegistry;
    executeNode: ExecuteNodeFn;
    shutdown: ShutdownController;
    logger: WorkerLogger;
  },
): Promise<RunPollCycleResult> {
  const queuedDbRuns = await params.runRepo.listByStatus("queued", 20);
  syncQueuedRuns(params.queueState, queuedDbRuns);

  const processedRunIds: string[] = [];
  while (canDequeue(params.queueState) && !params.shutdown.isShutdownRequested()) {
    const runId = dequeue(params.queueState);
    if (!runId) break;

    processedRunIds.push(runId);
    params.logger.log(`Dequeued run: ${runId}`);

    try {
      await processDequeuedRun({
        runId,
        runRepo: params.runRepo,
        graphRepo: params.graphRepo,
        registry: params.registry,
        executeNode: params.executeNode,
        logger: params.logger,
        shouldCancel: () => params.shutdown.isShutdownRequested(),
      });
    } finally {
      markComplete(params.queueState, runId);
    }
  }

  return { queuedDbRuns: queuedDbRuns.length, processedRunIds };
}

export async function waitForNextPollTick(ms: number): Promise<void> {
  await delay(ms);
}
