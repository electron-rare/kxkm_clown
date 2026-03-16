import type { NodeEngineOverview } from "@kxkm/core";
import { createId, createIsoTimestamp } from "@kxkm/core";

export * from "./training.js";
export * from "./sandbox.js";

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
// A) Registry types and builder
// ---------------------------------------------------------------------------

export interface NodeParamDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "select";
  required: boolean;
  default?: unknown;
  options?: string[];
}

export interface NodeTypeDefinition {
  id: string;
  family: string;
  label: string;
  inputs: string[];
  outputs: string[];
  params: NodeParamDefinition[];
  runtimes: string[];
  description: string;
}

export interface FamilyMeta {
  id: string;
  label: string;
  description: string;
}

/**
 * Default node type definitions ported from V1 node-engine-registry.js.
 *
 * Each V1 entry is mapped as follows:
 *   type   -> id
 *   title  -> label
 *   inputs / outputs / runtimes / description -> kept as-is
 *   params -> empty array (V1 had no static param schema in the registry)
 */
const DEFAULT_NODE_TYPES: NodeTypeDefinition[] = [
  {
    id: "dataset_file",
    family: "dataset_source",
    label: "Dataset File",
    inputs: [],
    outputs: ["dataset"],
    params: [
      { name: "path", type: "string", required: true },
    ],
    runtimes: ["local_cpu", "local_gpu", "cloud_api"],
    description:
      "Load a local dataset from a JSON, JSONL, CSV or Parquet file.",
  },
  {
    id: "dataset_folder",
    family: "dataset_source",
    label: "Dataset Folder",
    inputs: [],
    outputs: ["dataset"],
    params: [
      { name: "path", type: "string", required: true },
    ],
    runtimes: ["local_cpu", "local_gpu"],
    description: "Aggregate a local directory of structured datasets.",
  },
  {
    id: "huggingface_dataset",
    family: "dataset_source",
    label: "HuggingFace Dataset",
    inputs: [],
    outputs: ["dataset"],
    params: [
      { name: "repo", type: "string", required: true },
    ],
    runtimes: ["cloud_api", "local_cpu", "local_gpu"],
    description: "Load a dataset from the Hugging Face Hub.",
  },
  {
    id: "web_scraper",
    family: "dataset_source",
    label: "Web Scraper",
    inputs: [],
    outputs: ["dataset"],
    params: [
      { name: "url", type: "string", required: true },
    ],
    runtimes: ["cloud_api", "local_cpu"],
    description: "Collect web documents and transform them into a dataset.",
  },
  {
    id: "clean_text",
    family: "data_processing",
    label: "Clean Text",
    inputs: ["dataset"],
    outputs: ["dataset"],
    params: [
      { name: "trim", type: "boolean", required: false, default: true },
    ],
    runtimes: ["local_cpu", "local_gpu", "cluster"],
    description: "Clean and normalise dataset text fields.",
  },
  {
    id: "remove_duplicates",
    family: "data_processing",
    label: "Remove Duplicates",
    inputs: ["dataset"],
    outputs: ["dataset"],
    params: [],
    runtimes: ["local_cpu", "local_gpu", "cluster"],
    description: "Deduplicate examples before preparation.",
  },
  {
    id: "split_dataset",
    family: "data_processing",
    label: "Split Dataset",
    inputs: ["dataset"],
    outputs: ["dataset"],
    params: [
      { name: "train", type: "number", required: false, default: 0.9 },
      { name: "test", type: "number", required: false, default: 0.1 },
    ],
    runtimes: ["local_cpu", "local_gpu", "cluster"],
    description: "Create train, validation and test splits.",
  },
  {
    id: "format_instruction_dataset",
    family: "dataset_builder",
    label: "Instruction Dataset",
    inputs: ["dataset"],
    outputs: ["dataset_ready"],
    params: [
      {
        name: "mode",
        type: "select",
        required: false,
        default: "chat",
        options: ["chat", "instruction"],
      },
    ],
    runtimes: ["local_cpu", "local_gpu", "cluster"],
    description: "Transform examples into an instruction/chat format.",
  },
  {
    id: "chat_dataset",
    family: "dataset_builder",
    label: "Chat Dataset",
    inputs: ["dataset"],
    outputs: ["dataset_ready"],
    params: [],
    runtimes: ["local_cpu", "local_gpu", "cluster"],
    description: "Build a multi-role message dataset.",
  },
  {
    id: "lora_training",
    family: "training",
    label: "LoRA Training",
    inputs: ["dataset_ready"],
    outputs: ["model"],
    params: [
      { name: "baseModel", type: "string", required: true },
    ],
    runtimes: ["local_gpu", "remote_gpu", "cluster"],
    description: "Run a LoRA fine-tuning pass on a base model.",
  },
  {
    id: "qlora_training",
    family: "training",
    label: "QLoRA Training",
    inputs: ["dataset_ready"],
    outputs: ["model"],
    params: [
      { name: "baseModel", type: "string", required: true },
    ],
    runtimes: ["local_gpu", "remote_gpu", "cluster"],
    description: "Run a QLoRA fine-tuning pass optimised for reduced VRAM.",
  },
  {
    id: "benchmark",
    family: "evaluation",
    label: "Benchmark",
    inputs: ["model", "dataset_ready"],
    outputs: ["evaluation"],
    params: [
      { name: "suite", type: "string", required: false, default: "smoke" },
    ],
    runtimes: ["local_cpu", "local_gpu", "cluster"],
    description: "Evaluate a model on a prompt set and metrics.",
  },
  {
    id: "prompt_test",
    family: "evaluation",
    label: "Prompt Test",
    inputs: ["model", "dataset_ready"],
    outputs: ["evaluation"],
    params: [
      { name: "prompt", type: "string", required: false },
      { name: "model", type: "string", required: false },
    ],
    runtimes: ["local_cpu", "local_gpu", "cloud_api"],
    description:
      "Test a model on a fixed prompt or a batch of prompts.",
  },
  {
    id: "register_model",
    family: "model_registry",
    label: "Register Model",
    inputs: ["model", "evaluation"],
    outputs: ["registered_model"],
    params: [
      { name: "alias", type: "string", required: false, default: "candidate" },
    ],
    runtimes: ["local_cpu", "cluster"],
    description:
      "Register a model with version, alias and metadata.",
  },
  {
    id: "deploy_api",
    family: "deployment",
    label: "Deploy API",
    inputs: ["registered_model"],
    outputs: ["deployment"],
    params: [
      {
        name: "target",
        type: "select",
        required: false,
        default: "local",
        options: ["local", "remote", "cluster", "cloud"],
      },
    ],
    runtimes: ["local_cpu", "remote_gpu", "cluster", "cloud_api"],
    description:
      "Publish a model via a local or remote API.",
  },
];

const DEFAULT_FAMILY_META: FamilyMeta[] = [
  {
    id: "dataset_source",
    label: "Dataset Source",
    description: "Loading and collecting raw data.",
  },
  {
    id: "data_processing",
    label: "Data Processing",
    description: "Cleaning, deduplication, splitting and transformations.",
  },
  {
    id: "dataset_builder",
    label: "Dataset Builder",
    description: "Preparing LLM training formats.",
  },
  {
    id: "training",
    label: "Training",
    description:
      "Fine-tuning, LoRA and QLoRA on a dedicated runtime target.",
  },
  {
    id: "evaluation",
    label: "Evaluation",
    description: "Benchmarks, prompt tests and human validation.",
  },
  {
    id: "model_registry",
    label: "Model Registry",
    description: "Versioning, traceability and model metadata.",
  },
  {
    id: "deployment",
    label: "Deployment",
    description: "Local, API, cluster or edge publication.",
  },
];

export interface NodeEngineRegistry {
  register(def: NodeTypeDefinition): void;
  getNodeType(id: string): NodeTypeDefinition | null;
  listNodeTypes(): NodeTypeDefinition[];
  listFamilies(): string[];
  getFamily(family: string): NodeTypeDefinition[];
}

export function createNodeEngineRegistry(): NodeEngineRegistry {
  const nodeTypes = new Map<string, NodeTypeDefinition>();
  const familyMeta = new Map<string, FamilyMeta>();

  // Seed with built-in definitions
  for (const def of DEFAULT_NODE_TYPES) {
    nodeTypes.set(def.id, { ...def });
  }
  for (const fm of DEFAULT_FAMILY_META) {
    familyMeta.set(fm.id, { ...fm });
  }

  function register(def: NodeTypeDefinition): void {
    nodeTypes.set(def.id, { ...def });
    // Auto-register family if not already known
    if (!familyMeta.has(def.family)) {
      familyMeta.set(def.family, {
        id: def.family,
        label: def.family,
        description: "",
      });
    }
  }

  function getNodeType(id: string): NodeTypeDefinition | null {
    return nodeTypes.get(id) ?? null;
  }

  function listNodeTypes(): NodeTypeDefinition[] {
    return Array.from(nodeTypes.values()).map((d) => ({ ...d }));
  }

  function listFamilies(): string[] {
    return Array.from(familyMeta.keys());
  }

  function getFamily(family: string): NodeTypeDefinition[] {
    return Array.from(nodeTypes.values())
      .filter((d) => d.family === family)
      .map((d) => ({ ...d }));
  }

  return { register, getNodeType, listNodeTypes, listFamilies, getFamily };
}

// ---------------------------------------------------------------------------
// B) Graph types and pure operations
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
// C) Run state machine
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
// D) Queue logic (pure state, no timers)
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
// E) Runtime definitions
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
