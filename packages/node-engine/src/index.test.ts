import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createNodeEngineRegistry,
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
import type { NodeGraph, GraphNode, GraphEdge, NodeTypeDefinition } from "./index.js";

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

describe("createNodeEngineRegistry", () => {
  it("lists built-in node types", () => {
    const reg = createNodeEngineRegistry();
    const types = reg.listNodeTypes();
    assert.ok(types.length > 0);
  });

  it("getNodeType returns a known type", () => {
    const reg = createNodeEngineRegistry();
    const nt = reg.getNodeType("dataset_file");
    assert.notEqual(nt, null);
    assert.equal(nt!.id, "dataset_file");
  });

  it("getNodeType returns null for unknown", () => {
    const reg = createNodeEngineRegistry();
    assert.equal(reg.getNodeType("nonexistent"), null);
  });

  it("register adds a custom node type", () => {
    const reg = createNodeEngineRegistry();
    const custom: NodeTypeDefinition = {
      id: "custom_node",
      family: "custom",
      label: "Custom",
      inputs: ["dataset"],
      outputs: ["dataset"],
      params: [],
      runtimes: ["local_cpu"],
      description: "A custom node",
    };
    reg.register(custom);
    const result = reg.getNodeType("custom_node");
    assert.notEqual(result, null);
    assert.equal(result!.label, "Custom");
  });

  it("listFamilies returns known families", () => {
    const reg = createNodeEngineRegistry();
    const families = reg.listFamilies();
    assert.ok(families.includes("dataset_source"));
    assert.ok(families.includes("training"));
  });
});

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
