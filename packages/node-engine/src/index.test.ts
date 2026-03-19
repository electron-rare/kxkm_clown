import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  topologicalSort,
  validateEdgeContracts,
  collectNodeInputs,
  createRun,
  resolveFinalStatus,
  createQueueState,
  enqueue,
  dequeue,
  canDequeue,
  markComplete,
  listDefaultRuntimes,
} from "./index.js";
import type { NodeGraph, GraphNode, GraphEdge } from "./index.js";
import { createNodeEngineRegistry } from "./registry.js";
import {
  validateSandboxConfig,
  wrapCommand,
  DEFAULT_SANDBOX,
} from "./sandbox.js";
import type { SandboxConfig } from "./sandbox.js";
import {
  buildTrlCommand,
  buildUnslothCommand,
  validateJobSpec,
  parseTrainingMetrics,
  DEFAULT_HYPERPARAMS,
} from "./training.js";
import type { TrainingJobSpec } from "./training.js";

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): NodeGraph {
  return {
    id: "g1",
    name: "test-graph",
    description: "test",
    nodes,
    edges,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

describe("topologicalSort", () => {
  it("sorts a linear graph A -> B -> C", () => {
    const graph = makeGraph(
      [
        { id: "a", type: "dataset_file", runtime: "local_cpu", params: {} },
        { id: "b", type: "clean_text", runtime: "local_cpu", params: {} },
        { id: "c", type: "remove_duplicates", runtime: "local_cpu", params: {} },
      ],
      [
        { from: { node: "a", output: "dataset" }, to: { node: "b", input: "dataset" } },
        { from: { node: "b", output: "dataset" }, to: { node: "c", input: "dataset" } },
      ],
    );

    const sorted = topologicalSort(graph);
    assert.equal(sorted.length, 3);
    const ids = sorted.map((n) => n.id);
    assert.ok(ids.indexOf("a") < ids.indexOf("b"));
    assert.ok(ids.indexOf("b") < ids.indexOf("c"));
  });

  it("detects a cycle", () => {
    const graph = makeGraph(
      [
        { id: "a", type: "clean_text", runtime: "local_cpu", params: {} },
        { id: "b", type: "clean_text", runtime: "local_cpu", params: {} },
      ],
      [
        { from: { node: "a", output: "dataset" }, to: { node: "b", input: "dataset" } },
        { from: { node: "b", output: "dataset" }, to: { node: "a", input: "dataset" } },
      ],
    );

    assert.throws(() => topologicalSort(graph), { message: /cycle detected/ });
  });
});

describe("validateEdgeContracts", () => {
  it("validates correct edges", () => {
    const reg = createNodeEngineRegistry();
    const graph = makeGraph(
      [
        { id: "a", type: "dataset_file", runtime: "local_cpu", params: {} },
        { id: "b", type: "clean_text", runtime: "local_cpu", params: {} },
      ],
      [
        { from: { node: "a", output: "dataset" }, to: { node: "b", input: "dataset" } },
      ],
    );

    assert.doesNotThrow(() => validateEdgeContracts(graph, reg));
  });

  it("rejects edge with invalid output", () => {
    const reg = createNodeEngineRegistry();
    const graph = makeGraph(
      [
        { id: "a", type: "dataset_file", runtime: "local_cpu", params: {} },
        { id: "b", type: "clean_text", runtime: "local_cpu", params: {} },
      ],
      [
        { from: { node: "a", output: "nonexistent" }, to: { node: "b", input: "dataset" } },
      ],
    );

    assert.throws(() => validateEdgeContracts(graph, reg), { message: /Invalid output/ });
  });
});

describe("collectNodeInputs", () => {
  it("collects inputs from upstream nodes", () => {
    const graph = makeGraph(
      [
        { id: "a", type: "dataset_file", runtime: "local_cpu", params: {} },
        { id: "b", type: "clean_text", runtime: "local_cpu", params: {} },
      ],
      [
        { from: { node: "a", output: "dataset" }, to: { node: "b", input: "dataset" } },
      ],
    );

    const outputsByNode = new Map<string, Record<string, unknown>>();
    outputsByNode.set("a", { dataset: [1, 2, 3] });

    const inputs = collectNodeInputs(graph, "b", outputsByNode);
    assert.deepEqual(inputs, { dataset: [1, 2, 3] });
  });

  it("returns empty when no upstream edges", () => {
    const graph = makeGraph(
      [{ id: "a", type: "dataset_file", runtime: "local_cpu", params: {} }],
      [],
    );
    const inputs = collectNodeInputs(graph, "a", new Map());
    assert.deepEqual(inputs, {});
  });
});

describe("createRun", () => {
  it("creates a valid run with steps for each node", () => {
    const graph = makeGraph(
      [
        { id: "a", type: "dataset_file", runtime: "local_cpu", params: {} },
        { id: "b", type: "clean_text", runtime: "local_cpu", params: {} },
      ],
      [
        { from: { node: "a", output: "dataset" }, to: { node: "b", input: "dataset" } },
      ],
    );

    const run = createRun(graph, "testuser");
    assert.ok(run.id.startsWith("run_"));
    assert.equal(run.graphId, "g1");
    assert.equal(run.status, "queued");
    assert.equal(run.actor, "testuser");
    assert.equal(run.steps.length, 2);
    assert.equal(run.steps[0].status, "pending");
    assert.equal(run.steps[1].status, "pending");
    assert.equal(typeof run.createdAt, "string");
  });
});

describe("resolveFinalStatus", () => {
  it("returns completed when all steps completed", () => {
    assert.equal(resolveFinalStatus(["completed", "completed"]), "completed");
  });

  it("returns failed when any step failed", () => {
    assert.equal(resolveFinalStatus(["completed", "failed"]), "failed");
  });

  it("returns cancelled when cancelled flag is set", () => {
    assert.equal(resolveFinalStatus(["completed", "completed"], true), "cancelled");
  });

  it("returns not_configured when a step is not_configured", () => {
    assert.equal(resolveFinalStatus(["completed", "not_configured"]), "not_configured");
  });

  it("returns blocked when a step is blocked", () => {
    assert.equal(resolveFinalStatus(["completed", "blocked"]), "blocked");
  });
});

describe("Queue operations", () => {
  it("createQueueState initializes empty queue", () => {
    const q = createQueueState({ maxConcurrency: 2 });
    assert.equal(q.queued.length, 0);
    assert.equal(q.running.length, 0);
    assert.equal(q.maxConcurrency, 2);
  });

  it("enqueue adds a run id", () => {
    const q = createQueueState({ maxConcurrency: 2 });
    enqueue(q, "run_1");
    assert.equal(q.queued.length, 1);
    assert.equal(q.queued[0], "run_1");
  });

  it("enqueue does not add duplicates", () => {
    const q = createQueueState({ maxConcurrency: 2 });
    enqueue(q, "run_1");
    enqueue(q, "run_1");
    assert.equal(q.queued.length, 1);
  });

  it("canDequeue returns true when slots available and queue non-empty", () => {
    const q = createQueueState({ maxConcurrency: 2 });
    enqueue(q, "run_1");
    assert.equal(canDequeue(q), true);
  });

  it("canDequeue returns false when at max concurrency", () => {
    const q = createQueueState({ maxConcurrency: 1 });
    enqueue(q, "run_1");
    dequeue(q);
    assert.equal(canDequeue(q), false);
  });

  it("dequeue moves run from queued to running", () => {
    const q = createQueueState({ maxConcurrency: 2 });
    enqueue(q, "run_1");
    const id = dequeue(q);
    assert.equal(id, "run_1");
    assert.equal(q.queued.length, 0);
    assert.equal(q.running.length, 1);
  });

  it("dequeue returns null when cannot dequeue", () => {
    const q = createQueueState({ maxConcurrency: 1 });
    assert.equal(dequeue(q), null);
  });

  it("markComplete removes run from running", () => {
    const q = createQueueState({ maxConcurrency: 2 });
    enqueue(q, "run_1");
    dequeue(q);
    markComplete(q, "run_1");
    assert.equal(q.running.length, 0);
  });
});

describe("listDefaultRuntimes", () => {
  it("returns 5 runtimes", () => {
    const runtimes = listDefaultRuntimes();
    assert.equal(runtimes.length, 5);
  });

  it("each runtime has required fields", () => {
    for (const rt of listDefaultRuntimes()) {
      assert.equal(typeof rt.id, "string");
      assert.equal(typeof rt.mode, "string");
      assert.equal(typeof rt.configured, "boolean");
      assert.equal(typeof rt.description, "string");
    }
  });
});

// =========================================================================
// sandbox.ts tests
// =========================================================================

describe("validateSandboxConfig", () => {
  it("throws on null input", () => {
    assert.throws(() => validateSandboxConfig(null), {
      message: /non-null object/,
    });
  });

  it("throws on non-object input", () => {
    assert.throws(() => validateSandboxConfig("string"), {
      message: /non-null object/,
    });
  });

  it("returns defaults for empty object", () => {
    const cfg = validateSandboxConfig({});
    assert.equal(cfg.mode, DEFAULT_SANDBOX.mode);
    assert.equal(cfg.timeoutMs, DEFAULT_SANDBOX.timeoutMs);
    assert.equal(cfg.memoryLimitMb, DEFAULT_SANDBOX.memoryLimitMb);
    assert.equal(cfg.networkAccess, DEFAULT_SANDBOX.networkAccess);
    assert.equal(cfg.workDir, DEFAULT_SANDBOX.workDir);
  });

  it("accepts valid overrides", () => {
    const cfg = validateSandboxConfig({
      mode: "container",
      timeoutMs: 5000,
      memoryLimitMb: 512,
      networkAccess: true,
      workDir: "/my/dir",
    });
    assert.equal(cfg.mode, "container");
    assert.equal(cfg.timeoutMs, 5000);
    assert.equal(cfg.memoryLimitMb, 512);
    assert.equal(cfg.networkAccess, true);
    assert.equal(cfg.workDir, "/my/dir");
  });

  it("falls back to defaults for invalid field types", () => {
    const cfg = validateSandboxConfig({
      mode: 42,
      timeoutMs: -1,
      memoryLimitMb: "big",
      networkAccess: "yes",
      workDir: "",
    });
    assert.equal(cfg.mode, DEFAULT_SANDBOX.mode);
    assert.equal(cfg.timeoutMs, DEFAULT_SANDBOX.timeoutMs);
    assert.equal(cfg.memoryLimitMb, DEFAULT_SANDBOX.memoryLimitMb);
    assert.equal(cfg.networkAccess, DEFAULT_SANDBOX.networkAccess);
    assert.equal(cfg.workDir, DEFAULT_SANDBOX.workDir);
  });

  it("accepts mode 'none'", () => {
    const cfg = validateSandboxConfig({ mode: "none" });
    assert.equal(cfg.mode, "none");
  });
});

describe("wrapCommand", () => {
  const baseCfg: SandboxConfig = {
    mode: "none",
    timeoutMs: 60_000,
    memoryLimitMb: 2048,
    networkAccess: false,
    workDir: "/tmp/test",
  };

  it("mode=none returns command unchanged", () => {
    const cmd = wrapCommand("echo hello", { ...baseCfg, mode: "none" });
    assert.equal(cmd, "echo hello");
  });

  it("mode=subprocess wraps with timeout and ulimit", () => {
    const cmd = wrapCommand("echo hello", { ...baseCfg, mode: "subprocess" });
    assert.ok(cmd.startsWith("timeout 60 bash -c"));
    assert.ok(cmd.includes("ulimit -v 2097152"));
    assert.ok(cmd.includes("echo hello"));
  });

  it("mode=subprocess rounds timeout up", () => {
    const cmd = wrapCommand("ls", { ...baseCfg, mode: "subprocess", timeoutMs: 500 });
    assert.ok(cmd.startsWith("timeout 1 "));
  });

  it("mode=container builds docker run command", () => {
    const cmd = wrapCommand("train.py", { ...baseCfg, mode: "container" });
    assert.ok(cmd.startsWith("docker run --rm"));
    assert.ok(cmd.includes("--memory=2048m"));
    assert.ok(cmd.includes("--network=none"));
    assert.ok(cmd.includes("kxkm-worker:latest"));
    assert.ok(cmd.includes("train.py"));
  });

  it("mode=container includes network when networkAccess=true", () => {
    const cmd = wrapCommand("curl http://x", {
      ...baseCfg,
      mode: "container",
      networkAccess: true,
    });
    assert.ok(!cmd.includes("--network=none"));
  });

  it("mode=container mounts workDir", () => {
    const cmd = wrapCommand("ls", {
      ...baseCfg,
      mode: "container",
      workDir: "/data/work",
    });
    assert.ok(cmd.includes("'/data/work':/work"));
  });

  it("escapes single quotes in command for subprocess", () => {
    const cmd = wrapCommand("echo 'hi'", { ...baseCfg, mode: "subprocess" });
    assert.ok(cmd.includes("echo '\\''hi'\\''"));
  });
});

// =========================================================================
// training.ts tests
// =========================================================================

function makeJobSpec(overrides: Partial<TrainingJobSpec> = {}): TrainingJobSpec {
  return {
    type: "lora_training",
    baseModel: "meta-llama/Llama-3-8B",
    datasetPath: "/data/train.jsonl",
    outputDir: "/output/lora",
    hyperparams: { ...DEFAULT_HYPERPARAMS },
    ...overrides,
  };
}

describe("buildTrlCommand", () => {
  it("builds a basic TRL SFT command", () => {
    const spec = makeJobSpec({ type: "sft_training" });
    const cmd = buildTrlCommand(spec);
    assert.ok(cmd.startsWith("python -m trl sft"));
    assert.ok(cmd.includes("--model_name"));
    assert.ok(cmd.includes("--dataset_path"));
    assert.ok(cmd.includes("--output_dir"));
    assert.ok(cmd.includes("--learning_rate 0.0002"));
    assert.ok(cmd.includes("--num_train_epochs 3"));
    assert.ok(cmd.includes("--per_device_train_batch_size 4"));
  });

  it("adds LoRA flags for lora_training", () => {
    const cmd = buildTrlCommand(makeJobSpec({ type: "lora_training" }));
    assert.ok(cmd.includes("--lora_r 16"));
    assert.ok(cmd.includes("--lora_alpha 32"));
    assert.ok(!cmd.includes("--load_in_4bit"));
  });

  it("adds LoRA flags and 4bit for qlora_training", () => {
    const cmd = buildTrlCommand(makeJobSpec({ type: "qlora_training" }));
    assert.ok(cmd.includes("--lora_r 16"));
    assert.ok(cmd.includes("--lora_alpha 32"));
    assert.ok(cmd.includes("--load_in_4bit"));
  });

  it("does not add LoRA flags for sft_training", () => {
    const cmd = buildTrlCommand(makeJobSpec({ type: "sft_training" }));
    assert.ok(!cmd.includes("--lora_r"));
    assert.ok(!cmd.includes("--lora_alpha"));
    assert.ok(!cmd.includes("--load_in_4bit"));
  });

  it("shell-escapes model name with quotes", () => {
    const spec = makeJobSpec({ baseModel: "user's-model" });
    const cmd = buildTrlCommand(spec);
    assert.ok(cmd.includes("'user'\\''s-model'"));
  });
});

describe("buildUnslothCommand", () => {
  it("builds a basic Unsloth command", () => {
    const cmd = buildUnslothCommand(makeJobSpec());
    assert.ok(cmd.startsWith("python scripts/train_unsloth.py"));
    assert.ok(cmd.includes("--model"));
    assert.ok(cmd.includes("--data"));
    assert.ok(cmd.includes("--output"));
    assert.ok(cmd.includes("--lr 0.0002"));
    assert.ok(cmd.includes("--epochs 3"));
    assert.ok(cmd.includes("--batch-size 4"));
    assert.ok(cmd.includes("--lora-rank 16"));
    assert.ok(cmd.includes("--lora-alpha 32"));
  });

  it("adds --quantize 4bit for qlora_training", () => {
    const cmd = buildUnslothCommand(makeJobSpec({ type: "qlora_training" }));
    assert.ok(cmd.includes("--quantize 4bit"));
  });

  it("does not add --quantize for lora_training", () => {
    const cmd = buildUnslothCommand(makeJobSpec({ type: "lora_training" }));
    assert.ok(!cmd.includes("--quantize"));
  });
});

describe("validateJobSpec", () => {
  it("throws on null input", () => {
    assert.throws(() => validateJobSpec(null), {
      message: /non-null object/,
    });
  });

  it("throws on invalid type", () => {
    assert.throws(
      () =>
        validateJobSpec({
          type: "invalid",
          baseModel: "m",
          datasetPath: "d",
          outputDir: "o",
        }),
      { message: /type must be one of/ },
    );
  });

  it("throws on missing baseModel", () => {
    assert.throws(
      () =>
        validateJobSpec({
          type: "lora_training",
          baseModel: "",
          datasetPath: "d",
          outputDir: "o",
        }),
      { message: /baseModel/ },
    );
  });

  it("throws on missing datasetPath", () => {
    assert.throws(
      () =>
        validateJobSpec({
          type: "lora_training",
          baseModel: "m",
          datasetPath: "",
          outputDir: "o",
        }),
      { message: /datasetPath/ },
    );
  });

  it("throws on missing outputDir", () => {
    assert.throws(
      () =>
        validateJobSpec({
          type: "lora_training",
          baseModel: "m",
          datasetPath: "d",
          outputDir: "",
        }),
      { message: /outputDir/ },
    );
  });

  it("applies default hyperparams when none provided", () => {
    const spec = validateJobSpec({
      type: "sft_training",
      baseModel: "m",
      datasetPath: "d",
      outputDir: "o",
    });
    assert.deepEqual(spec.hyperparams, DEFAULT_HYPERPARAMS);
  });

  it("merges partial hyperparams with defaults", () => {
    const spec = validateJobSpec({
      type: "lora_training",
      baseModel: "m",
      datasetPath: "d",
      outputDir: "o",
      hyperparams: { epochs: 10, batchSize: 8 },
    });
    assert.equal(spec.hyperparams.epochs, 10);
    assert.equal(spec.hyperparams.batchSize, 8);
    assert.equal(spec.hyperparams.learningRate, DEFAULT_HYPERPARAMS.learningRate);
    assert.equal(spec.hyperparams.loraRank, DEFAULT_HYPERPARAMS.loraRank);
  });

  it("ignores non-numeric hyperparam values", () => {
    const spec = validateJobSpec({
      type: "lora_training",
      baseModel: "m",
      datasetPath: "d",
      outputDir: "o",
      hyperparams: { epochs: "many", batchSize: null },
    });
    assert.equal(spec.hyperparams.epochs, DEFAULT_HYPERPARAMS.epochs);
    assert.equal(spec.hyperparams.batchSize, DEFAULT_HYPERPARAMS.batchSize);
  });
});

describe("parseTrainingMetrics", () => {
  it("parses JSON-dict format with train_loss", () => {
    const result = parseTrainingMetrics("{'train_loss': 0.1234, 'epoch': 3}");
    assert.notEqual(result, null);
    assert.equal(result!.trainLoss, 0.1234);
    assert.equal(result!.evalLoss, undefined);
  });

  it("parses JSON-dict format with loss and eval_loss", () => {
    const result = parseTrainingMetrics(
      '{"loss": 0.05, "eval_loss": 0.12, "epoch": 2}',
    );
    assert.notEqual(result, null);
    assert.equal(result!.trainLoss, 0.05);
    assert.equal(result!.evalLoss, 0.12);
  });

  it("parses plain key: value format", () => {
    const result = parseTrainingMetrics("train_loss: 0.321\neval_loss: 0.456");
    assert.notEqual(result, null);
    assert.equal(result!.trainLoss, 0.321);
    assert.equal(result!.evalLoss, 0.456);
  });

  it("parses key=value format", () => {
    const result = parseTrainingMetrics("train_loss=0.99");
    assert.notEqual(result, null);
    assert.equal(result!.trainLoss, 0.99);
  });

  it("parses scientific notation", () => {
    const result = parseTrainingMetrics("{'train_loss': 2.5e-3}");
    assert.notEqual(result, null);
    assert.ok(Math.abs(result!.trainLoss - 0.0025) < 1e-10);
  });

  it("returns null for unrelated output", () => {
    const result = parseTrainingMetrics("Epoch 1/3 - no loss info here");
    assert.equal(result, null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseTrainingMetrics(""), null);
  });
});
