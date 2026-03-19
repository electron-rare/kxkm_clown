import { useEffect, useState, useCallback, useMemo } from "react";
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type OnConnect,
} from "@xyflow/react";

import { api, type GraphNodeRecord, type GraphEdgeRecord } from "../api";
import type { EngineNodeData } from "../components/EngineNode";

// ---------------------------------------------------------------------------
// Node type registry
// ---------------------------------------------------------------------------

export interface NodeTypeDef {
  id: string;
  family: string;
  label: string;
  inputs: string[];
  outputs: string[];
  runtimes: string[];
}

export const NODE_TYPES: NodeTypeDef[] = [
  { id: "dataset_file", family: "dataset_source", label: "Dataset File", inputs: [], outputs: ["dataset"], runtimes: ["local_cpu", "local_gpu", "cloud_api"] },
  { id: "dataset_folder", family: "dataset_source", label: "Dataset Folder", inputs: [], outputs: ["dataset"], runtimes: ["local_cpu", "local_gpu"] },
  { id: "huggingface_dataset", family: "dataset_source", label: "HuggingFace Dataset", inputs: [], outputs: ["dataset"], runtimes: ["cloud_api", "local_cpu", "local_gpu"] },
  { id: "web_scraper", family: "dataset_source", label: "Web Scraper", inputs: [], outputs: ["dataset"], runtimes: ["cloud_api", "local_cpu"] },
  { id: "clean_text", family: "data_processing", label: "Clean Text", inputs: ["dataset"], outputs: ["dataset"], runtimes: ["local_cpu", "local_gpu", "cluster"] },
  { id: "remove_duplicates", family: "data_processing", label: "Remove Duplicates", inputs: ["dataset"], outputs: ["dataset"], runtimes: ["local_cpu", "local_gpu", "cluster"] },
  { id: "split_dataset", family: "data_processing", label: "Split Dataset", inputs: ["dataset"], outputs: ["dataset"], runtimes: ["local_cpu", "local_gpu", "cluster"] },
  { id: "format_instruction_dataset", family: "dataset_builder", label: "Instruction Dataset", inputs: ["dataset"], outputs: ["dataset_ready"], runtimes: ["local_cpu", "local_gpu", "cluster"] },
  { id: "chat_dataset", family: "dataset_builder", label: "Chat Dataset", inputs: ["dataset"], outputs: ["dataset_ready"], runtimes: ["local_cpu", "local_gpu", "cluster"] },
  { id: "lora_training", family: "training", label: "LoRA Training", inputs: ["dataset_ready"], outputs: ["model"], runtimes: ["local_gpu", "remote_gpu", "cluster"] },
  { id: "qlora_training", family: "training", label: "QLoRA Training", inputs: ["dataset_ready"], outputs: ["model"], runtimes: ["local_gpu", "remote_gpu", "cluster"] },
  { id: "benchmark", family: "evaluation", label: "Benchmark", inputs: ["model", "dataset_ready"], outputs: ["evaluation"], runtimes: ["local_cpu", "local_gpu", "cluster"] },
  { id: "prompt_test", family: "evaluation", label: "Prompt Test", inputs: ["model", "dataset_ready"], outputs: ["evaluation"], runtimes: ["local_cpu", "local_gpu", "cloud_api"] },
  { id: "register_model", family: "model_registry", label: "Register Model", inputs: ["model", "evaluation"], outputs: ["registered_model"], runtimes: ["local_cpu", "cluster"] },
  { id: "deploy_api", family: "deployment", label: "Deploy API", inputs: ["registered_model"], outputs: ["deployment"], runtimes: ["local_cpu", "remote_gpu", "cluster", "cloud_api"] },
];

export const FAMILY_COLORS: Record<string, string> = {
  dataset_source: "#4a90d9",
  data_processing: "#50b83c",
  dataset_builder: "#9c6ade",
  training: "#de3618",
  evaluation: "#f49342",
  model_registry: "#47c1bf",
  registry: "#47c1bf",
  deployment: "#212b36",
};

export const FAMILY_LABELS: Record<string, string> = {
  dataset_source: "Dataset Source",
  data_processing: "Data Processing",
  dataset_builder: "Dataset Builder",
  training: "Training",
  evaluation: "Evaluation",
  model_registry: "Model Registry",
  deployment: "Deployment",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByFamily(types: NodeTypeDef[]): Map<string, NodeTypeDef[]> {
  const map = new Map<string, NodeTypeDef[]>();
  for (const t of types) {
    const list = map.get(t.family) || [];
    list.push(t);
    map.set(t.family, list);
  }
  return map;
}

function graphNodeToFlowNode(node: GraphNodeRecord): Node {
  const def = NODE_TYPES.find((t) => t.id === node.type);
  const data: EngineNodeData = {
    label: def?.label || node.type,
    family: def?.family || "unknown",
    runtime: node.runtime,
    inputs: def?.inputs || [],
    outputs: def?.outputs || [],
    params: node.params || {},
  };
  return {
    id: node.id,
    type: "engineNode",
    position: { x: node.x ?? 0, y: node.y ?? 0 },
    data,
  };
}

function graphEdgeToFlowEdge(edge: GraphEdgeRecord, index: number): Edge {
  return {
    id: `e-${edge.from.node}-${edge.from.output}-${edge.to.node}-${edge.to.input}-${index}`,
    source: edge.from.node,
    sourceHandle: edge.from.output,
    target: edge.to.node,
    targetHandle: edge.to.input,
    animated: true,
    style: { stroke: "#c84c0c", strokeWidth: 2 },
  };
}

function flowNodesToGraphNodes(nodes: Node[]): GraphNodeRecord[] {
  return nodes.map((n) => {
    const d = n.data as unknown as EngineNodeData;
    const def = NODE_TYPES.find((t) => t.label === d.label);
    return {
      id: n.id,
      type: def?.id || "unknown",
      runtime: d.runtime,
      params: d.params || {},
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
    };
  });
}

function flowEdgesToGraphEdges(edges: Edge[]): GraphEdgeRecord[] {
  return edges.map((e) => ({
    from: { node: e.source, output: e.sourceHandle || "dataset" },
    to: { node: e.target, input: e.targetHandle || "dataset" },
  }));
}

export function isValidConnection(connection: Edge | Connection): boolean {
  if (connection.source === connection.target) return false;
  if (connection.sourceHandle && connection.targetHandle) {
    return connection.sourceHandle === connection.targetHandle;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

let nodeCounter = 0;

export function useNodeEditor(graphId: string) {
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const [graphName, setGraphName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);

  const families = useMemo(() => groupByFamily(NODE_TYPES), []);

  // Load graph
  useEffect(() => {
    loadGraph();
  }, [graphId]);

  async function loadGraph() {
    setLoading(true);
    setError("");
    try {
      let graph;
      try {
        graph = await api.getGraph(graphId);
      } catch {
        const graphs = await api.listGraphs();
        graph = graphs.find((g) => g.id === graphId);
      }
      if (!graph) {
        setError("Graph not found");
        setLoading(false);
        return;
      }
      setGraphName(graph.name || graph.id);
      setNodes((graph.nodes || []).map(graphNodeToFlowNode));
      setEdges((graph.edges || []).map(graphEdgeToFlowEdge));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }

  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (!isValidConnection(connection)) return;
      setEdges((eds) =>
        addEdge(connection, eds).map((e) =>
          e.source === connection.source && e.target === connection.target
            ? { ...e, animated: true, style: { stroke: "#c84c0c", strokeWidth: 2 } }
            : e,
        ),
      );
    },
    [setEdges],
  );

  function handleAddNode(typeDef: NodeTypeDef) {
    nodeCounter++;
    const newId = `node_${Date.now()}_${nodeCounter}`;
    const data: EngineNodeData = {
      label: typeDef.label,
      family: typeDef.family,
      runtime: typeDef.runtimes[0] || "local_cpu",
      inputs: typeDef.inputs,
      outputs: typeDef.outputs,
      params: {},
    };
    const newNode: Node = {
      id: newId,
      type: "engineNode",
      position: { x: 200 + nodeCounter * 30, y: 100 + nodeCounter * 30 },
      data,
    };
    setNodes((nds) => [...nds, newNode]);
    setPanelOpen(false);
    setStatus(`Added ${typeDef.label}`);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const graphNodes = flowNodesToGraphNodes(nodes);
      const graphEdges = flowEdgesToGraphEdges(edges);
      await api.updateGraph(graphId, { nodes: graphNodes, edges: graphEdges });
      setStatus("Saved successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    setError("");
    setStatus("");
    try {
      const run = await api.startRun(graphId);
      setStatus(`Run started: ${run.id} (${run.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  return {
    nodes, edges, onNodesChange, onEdgesChange, onConnect,
    graphName, loading, saving, running, error, status, setStatus,
    panelOpen, setPanelOpen, families,
    handleAddNode, handleSave, handleRun,
  };
}
