import type { NodeEngineOverview } from "@kxkm/core";
import { createId, createIsoTimestamp } from "@kxkm/core";

export * from "./training.js";
export * from "./sandbox.js";
export * from "./registry.js";
import type { NodeEngineRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// Existing V2 types (preserved)
// ---------------------------------------------------------------------------

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "not_configured"
  | "blocked";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "not_configured";

export interface NodeGraphRecord {
  id: string;
  name: string;
  description: string;
}

export interface NodeRunRecord {
  id: string;
  graphId: string;
  status: RunStatus;
  createdAt: string;
}

export interface ModelRegistryRecord {
  id: string;
  label: string;
  runtime: "local_cpu" | "local_gpu" | "remote_gpu";
}

export function createNodeGraph(
  name: string,
  description: string,
): NodeGraphRecord {
  return {
    id: createId("graph"),
    name,
    description,
  };
}

export function createNodeRun(
  graphId: string,
  status: RunStatus = "queued",
): NodeRunRecord {
  return {
    id: createId("run"),
    graphId,
    status,
    createdAt: createIsoTimestamp(),
  };
}

export function createNodeEngineOverview(input: {
  graphs: number;
  models: number;
  queuedRuns: number;
  runningRuns: number;
  desiredWorkers?: number;
  activeWorkers?: number;
}): NodeEngineOverview {
  return {
    queue: {
      desiredWorkers: input.desiredWorkers ?? 1,
      activeWorkers: input.activeWorkers ?? 1,
      queuedRuns: input.queuedRuns,
      runningRuns: input.runningRuns,
    },
    registry: {
      graphs: input.graphs,
      models: input.models,
    },
    storage: {
      backend: "postgres",
      artifacts: "filesystem",
    },
  };
}

// ---------------------------------------------------------------------------
// A) Graph types and pure operations
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  type: string;
  runtime: string;
  params: Record<string, unknown>;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  from: { node: string; output: string };
  to: { node: string; input: string };
}

export interface NodeGraph {
  id: string;
  name: string;
  description: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Kahn's algorithm for topological sort with cycle detection.
 * Ported from V1 node-engine-runner.js `topologicalSort`.
 */
export function topologicalSort(graph: NodeGraph): GraphNode[] {
  const nodesById = new Map<string, GraphNode>(
    graph.nodes.map((node) => [node.id, node]),
  );
  const incoming = new Map<string, number>(
    graph.nodes.map((node) => [node.id, 0]),
  );
  const outgoing = new Map<string, string[]>(
    graph.nodes.map((node) => [node.id, []]),
  );

  for (const edge of graph.edges) {
    incoming.set(edge.to.node, (incoming.get(edge.to.node) ?? 0) + 1);
    const out = outgoing.get(edge.from.node);
    if (out) out.push(edge.to.node);
  }

  const queue: string[] = graph.nodes
    .filter((node) => incoming.get(node.id) === 0)
    .map((node) => node.id);
  const sorted: GraphNode[] = [];

  while (queue.length) {
    const nodeId = queue.shift()!;
    const node = nodesById.get(nodeId);
    if (node) sorted.push(node);

    for (const nextId of outgoing.get(nodeId) ?? []) {
      const count = (incoming.get(nextId) ?? 1) - 1;
      incoming.set(nextId, count);
      if (count === 0) queue.push(nextId);
    }
  }

  if (sorted.length !== graph.nodes.length) {
    throw new Error("Invalid node engine graph: cycle detected");
  }

  return sorted;
}

/**
 * Validate that every edge references valid outputs and inputs according to
 * the registry definitions.
 * Ported from V1 node-engine-runner.js `validateEdgeContracts`.
 */
export function validateEdgeContracts(
  graph: NodeGraph,
  registry: NodeEngineRegistry,
): void {
  const nodesById = new Map<string, GraphNode>(
    graph.nodes.map((node) => [node.id, node]),
  );

  for (const edge of graph.edges) {
    const fromNode = nodesById.get(edge.from.node);
    const toNode = nodesById.get(edge.to.node);
    const fromType = fromNode ? registry.getNodeType(fromNode.type) : null;
    const toType = toNode ? registry.getNodeType(toNode.type) : null;

    if (!fromType?.outputs?.includes(edge.from.output)) {
      throw new Error(
        `Invalid output: ${edge.from.node}.${edge.from.output}`,
      );
    }
    if (!toType?.inputs?.includes(edge.to.input)) {
      throw new Error(
        `Invalid input: ${edge.to.node}.${edge.to.input}`,
      );
    }
  }
}

/**
 * Collect all inputs for a given node by walking edges and reading upstream
 * outputs.
 * Ported from V1 node-engine-runner.js `collectNodeInputs`.
 */
export function collectNodeInputs(
  graph: NodeGraph,
  nodeId: string,
  outputsByNode: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};

  for (const edge of graph.edges) {
    if (edge.to.node !== nodeId) continue;
    const source = outputsByNode.get(edge.from.node) ?? {};
    if (Object.prototype.hasOwnProperty.call(source, edge.from.output)) {
      inputs[edge.to.input] = source[edge.from.output];
    }
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// B) Run state machine
// ---------------------------------------------------------------------------

export interface RunStep {
  id: string;
  nodeType: string;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  outputs: string[];
  runtimeMeta: unknown;
}

export interface NodeRun {
  id: string;
  graphId: string;
  graphSnapshot: NodeGraph;
  status: RunStatus;
  actor: string;
  steps: RunStep[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * Create a new run from a graph, initialising all steps to "pending".
 * Ported from V1 node-engine-store.js `createRun`.
 */
export function createRun(graph: NodeGraph, actor = "admin"): NodeRun {
  const now = createIsoTimestamp();
  return {
    id: createId("run"),
    graphId: graph.id,
    graphSnapshot: structuredClone(graph),
    status: "queued",
    actor,
    steps: graph.nodes.map((node) => ({
      id: node.id,
      nodeType: node.type,
      status: "pending" as StepStatus,
      startedAt: null,
      finishedAt: null,
      error: null,
      outputs: [],
      runtimeMeta: null,
    })),
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };
}

/**
 * Determine the overall run status from individual step statuses.
 * Ported from V1 node-engine-runner.js `resolveFinalStatus`.
 */
export function resolveFinalStatus(
  stepStatuses: StepStatus[],
  cancelled = false,
): RunStatus {
  if (cancelled) return "cancelled";
  if (stepStatuses.includes("failed")) return "failed";
  if (stepStatuses.includes("not_configured")) return "not_configured";
  if (stepStatuses.includes("blocked")) return "blocked";
  return "completed";
}

// ---------------------------------------------------------------------------
// C) Queue logic (pure state, no timers)
// ---------------------------------------------------------------------------

export interface QueueConfig {
  maxConcurrency: number;
}

export interface QueueState {
  queued: string[];
  running: string[];
  maxConcurrency: number;
}

export function createQueueState(config: QueueConfig): QueueState {
  return {
    queued: [],
    running: [],
    maxConcurrency: config.maxConcurrency,
  };
}

export function canDequeue(state: QueueState): boolean {
  return state.running.length < state.maxConcurrency && state.queued.length > 0;
}

export function enqueue(state: QueueState, runId: string): void {
  if (!state.queued.includes(runId) && !state.running.includes(runId)) {
    state.queued.push(runId);
  }
}

export function dequeue(state: QueueState): string | null {
  if (!canDequeue(state)) return null;
  const runId = state.queued.shift()!;
  state.running.push(runId);
  return runId;
}

export function markComplete(state: QueueState, runId: string): void {
  state.running = state.running.filter((id) => id !== runId);
}

// ---------------------------------------------------------------------------
// D) Runtime definitions
// ---------------------------------------------------------------------------

export type RuntimeMode = "direct" | "mixed" | "adapter";

export interface RuntimeDefinition {
  id: string;
  mode: RuntimeMode;
  configured: boolean;
  description: string;
}

/**
 * Default runtime definitions ported from V1 node-engine-runtimes.js.
 * The `configured` flag is set statically here; the app layer can override
 * based on environment variables.
 */
export function listDefaultRuntimes(): RuntimeDefinition[] {
  return [
    {
      id: "local_cpu",
      mode: "direct",
      configured: true,
      description: "Local CPU execution, built into the server.",
    },
    {
      id: "local_gpu",
      mode: "mixed",
      configured: true,
      description:
        "Local GPU execution with optional training adapters.",
    },
    {
      id: "remote_gpu",
      mode: "adapter",
      configured: false,
      description: "Remote GPU via external command/adapter.",
    },
    {
      id: "cluster",
      mode: "adapter",
      configured: false,
      description: "Cluster execution via external adapter.",
    },
    {
      id: "cloud_api",
      mode: "adapter",
      configured: false,
      description: "Cloud API via external adapter.",
    },
  ];
}
