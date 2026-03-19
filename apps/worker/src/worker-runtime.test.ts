import assert from "node:assert/strict";
import test from "node:test";
import {
  createRun,
  createNodeEngineRegistry,
  createQueueState,
  type NodeRunRecord,
  type RunStatus,
} from "@kxkm/node-engine";
import {
  createNodeExecutor,
  createShutdownController,
  executeRun,
  parseLastJsonLine,
  runPollCycle,
} from "./worker-runtime.js";

function createLogger() {
  const logs: string[] = [];
  const errors: Array<{ msg: string; err?: unknown }> = [];
  return {
    logs,
    errors,
    logger: {
      log(msg: string) {
        logs.push(msg);
      },
      error(msg: string, err?: unknown) {
        errors.push({ msg, err });
      },
    },
  };
}

type BenchmarkResult = {
  evaluation?: {
    kind?: string;
    score?: number;
    error?: string;
  };
};

type DeployResult = {
  deployment?: {
    kind?: string;
    id?: string;
    error?: string;
  };
};

test("parseLastJsonLine parses the final JSON line and rejects invalid output", () => {
  const parsed = parseLastJsonLine("noise\n{\"status\":\"ok\",\"score\":7}\n");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("expected parsed json");
  assert.equal(parsed.value.status, "ok");
  assert.equal(parsed.value.score, 7);

  const invalid = parseLastJsonLine("noise\nnot-json\n");
  assert.equal(invalid.ok, false);
  if (invalid.ok) throw new Error("expected parse failure");
  assert.equal(invalid.rawLine, "not-json");
  assert.equal(invalid.value && Object.keys(invalid.value).length, 0);
});

test("createShutdownController is idempotent", () => {
  const controller = createShutdownController();
  assert.equal(controller.isShutdownRequested(), false);
  controller.requestShutdown();
  controller.requestShutdown();
  assert.equal(controller.isShutdownRequested(), true);
});

test("executeRun completes steps in order and forwards upstream outputs", async () => {
  const registry = createNodeEngineRegistry();
  const graph = {
    id: "graph-1",
    name: "Graph",
    description: "Test graph",
    nodes: [
      { id: "n1", type: "dataset_file", runtime: "local_cpu", params: {} },
      { id: "n2", type: "clean_text", runtime: "local_cpu", params: {} },
    ],
    edges: [
      { from: { node: "n1", output: "dataset" }, to: { node: "n2", input: "dataset" } },
    ],
    createdAt: "2026-03-17T00:00:00Z",
    updatedAt: "2026-03-17T00:00:00Z",
  };
  const run = createRun(graph, "worker");
  const seenInputs: Record<string, unknown>[] = [];
  const { logger } = createLogger();

  await executeRun(run, registry, {
    executeNode: async (nodeType, inputs) => {
      seenInputs.push(inputs);
      if (nodeType === "dataset_file") return { dataset: { items: ["hello"], format: "stub" } };
      return { dataset: inputs.dataset };
    },
    logger,
  });

  assert.equal(run.status, "completed");
  assert.equal(run.steps[0]?.status, "completed");
  assert.equal(run.steps[1]?.status, "completed");
  assert.deepEqual(run.steps[0]?.outputs, ["dataset"]);
  assert.deepEqual(run.steps[1]?.outputs, ["dataset"]);
  assert.deepEqual(seenInputs[1]?.dataset, { items: ["hello"], format: "stub" });
});

test("executeRun cancels before the second step when cancellation is requested", async () => {
  const registry = createNodeEngineRegistry();
  const graph = {
    id: "graph-2",
    name: "Graph",
    description: "Test graph",
    nodes: [
      { id: "n1", type: "dataset_file", runtime: "local_cpu", params: {} },
      { id: "n2", type: "clean_text", runtime: "local_cpu", params: {} },
    ],
    edges: [
      { from: { node: "n1", output: "dataset" }, to: { node: "n2", input: "dataset" } },
    ],
    createdAt: "2026-03-17T00:00:00Z",
    updatedAt: "2026-03-17T00:00:00Z",
  };
  const run = createRun(graph, "worker");
  let executions = 0;
  const { logger } = createLogger();

  await executeRun(run, registry, {
    executeNode: async () => {
      executions += 1;
      return { dataset: { items: [], format: "stub" } };
    },
    shouldCancel: () => executions > 0,
    logger,
  });

  assert.equal(executions, 1);
  assert.equal(run.status, "cancelled");
  assert.equal(run.steps[0]?.status, "completed");
  assert.equal(run.steps[1]?.status, "pending");
});

test("runPollCycle dequeues queued runs and persists the final status", async () => {
  const queueState = createQueueState({ maxConcurrency: 1 });
  const queuedRuns: NodeRunRecord[] = [
    { id: "run-1", graphId: "graph-1", status: "queued", createdAt: "2026-03-17T00:00:00Z" },
  ];
  const statusUpdates: Array<[string, string]> = [];
  const { logger } = createLogger();

  const runRepo = {
    async listByStatus(status: RunStatus, limit: number) {
      assert.equal(status, "queued");
      assert.equal(limit, 20);
      return queuedRuns;
    },
    async findById(id: string) {
      return id === "run-1" ? queuedRuns[0] : null;
    },
    async updateStatus(id: string, status: RunStatus) {
      statusUpdates.push([id, status]);
    },
  };

  const graphRepo = {
    async findById(id: string) {
      return id === "graph-1"
        ? { id: "graph-1", name: "Graph", description: "Empty graph" }
        : null;
    },
    async list() {
      return [];
    },
  };

  const result = await runPollCycle({
    queueState,
    runRepo,
    graphRepo,
    registry: createNodeEngineRegistry(),
    executeNode: async () => ({}),
    shutdown: createShutdownController(),
    logger,
  });

  assert.equal(result.queuedDbRuns, 1);
  assert.deepEqual(result.processedRunIds, ["run-1"]);
  assert.deepEqual(statusUpdates, [
    ["run-1", "running"],
    ["run-1", "completed"],
  ]);
  assert.deepEqual(queueState.queued, []);
  assert.deepEqual(queueState.running, []);
});

test("createNodeExecutor tolerates invalid JSON from subprocesses", async () => {
  const { logger, errors } = createLogger();
  const executor = createNodeExecutor(
    {
      dryRun: false,
      stepDelayMs: 0,
      pythonBin: "python3",
      scriptsDir: "/tmp/scripts",
      trainingTimeoutMs: 1000,
    },
    async () => ({ stdout: "garbage\n", stderr: "" }),
    logger,
  );

  const benchmark = (await executor(
    "benchmark",
    { model: { modelName: "demo-model", adapterPath: "/tmp/adapter" } },
    { promptsPath: "/tmp/prompts.json" },
  )) as BenchmarkResult;

  assert.equal(benchmark.evaluation?.kind, "real");
  assert.equal(benchmark.evaluation?.score, undefined);
  assert.ok(errors.some((entry) => entry.msg.includes("Failed to parse JSON output")));

  const deploy = (await executor(
    "deploy_api",
    { registered_model: { adapterPath: "/tmp/adapter" } },
    { deployName: "demo-deploy" },
  )) as DeployResult;

  assert.equal(deploy.deployment?.kind, "error");
  assert.equal(deploy.deployment?.error, "invalid_json_output");
});
