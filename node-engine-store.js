const fs = require("fs");
const path = require("path");

function cleanText(value, maxLength = 400) {
  return String(value || "").trim().slice(0, maxLength);
}

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createNodeEngineStore({
  dataDir,
  registry,
}) {
  const rootDir = path.join(dataDir, "node-engine");
  const graphsDir = path.join(rootDir, "graphs");
  const runsDir = path.join(rootDir, "runs");
  const artifactsDir = path.join(rootDir, "artifacts");
  const cacheDir = path.join(rootDir, "cache");

  for (const dir of [rootDir, graphsDir, runsDir, artifactsDir, cacheDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  function graphPath(id) {
    return path.join(graphsDir, `${id}.json`);
  }

  function runPath(id) {
    return path.join(runsDir, `${id}.json`);
  }

  function artifactSummaryPath(runId) {
    return path.join(artifactsDir, runId, "summary.json");
  }

  function readJson(file, fallback = null) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  }

  function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
  }

  function normalizeNode(node, index) {
    return {
      id: cleanText(node?.id, 80) || `node_${index + 1}`,
      type: cleanText(node?.type, 80),
      title: cleanText(node?.title, 120) || cleanText(node?.type, 80) || `Node ${index + 1}`,
      params: node?.params && typeof node.params === "object" ? clone(node.params) : {},
      runtime: cleanText(node?.runtime, 80) || "local_cpu",
    };
  }

  function normalizeEdge(edge) {
    return {
      from: {
        node: cleanText(edge?.from?.node, 80),
        output: cleanText(edge?.from?.output, 80),
      },
      to: {
        node: cleanText(edge?.to?.node, 80),
        input: cleanText(edge?.to?.input, 80),
      },
    };
  }

  function normalizeGraph(input = {}) {
    const now = new Date().toISOString();
    return {
      id: cleanText(input.id, 80) || randomId("graph"),
      name: cleanText(input.name, 120) || "Untitled Graph",
      description: cleanText(input.description, 600),
      runtime: cleanText(input.runtime, 80) || "local_cpu",
      tags: Array.isArray(input.tags)
        ? input.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 12)
        : [],
      version: Number.isFinite(Number(input.version)) ? Number(input.version) : 1,
      status: cleanText(input.status, 40) || "draft",
      nodes: Array.isArray(input.nodes) ? input.nodes.map(normalizeNode) : [],
      edges: Array.isArray(input.edges) ? input.edges.map(normalizeEdge) : [],
      createdAt: cleanText(input.createdAt, 80) || now,
      updatedAt: now,
    };
  }

  function summarizeGraph(graph) {
    return {
      id: graph.id,
      name: graph.name,
      description: graph.description,
      runtime: graph.runtime,
      status: graph.status,
      version: graph.version,
      tags: graph.tags,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      createdAt: graph.createdAt,
      updatedAt: graph.updatedAt,
    };
  }

  function validateGraph(graph) {
    if (!graph.nodes.length) {
      const error = new Error("Graph vide: au moins un node est requis");
      error.statusCode = 400;
      throw error;
    }

    const nodeIds = new Set();
    for (const node of graph.nodes) {
      if (!node.type || !registry.getNodeType(node.type)) {
        const error = new Error(`Type de node inconnu: ${node.type || "(vide)"}`);
        error.statusCode = 400;
        throw error;
      }
      if (nodeIds.has(node.id)) {
        const error = new Error(`Node dupliqué: ${node.id}`);
        error.statusCode = 400;
        throw error;
      }
      nodeIds.add(node.id);
    }

    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.from.node) || !nodeIds.has(edge.to.node)) {
        const error = new Error("Edge invalide: node source ou destination introuvable");
        error.statusCode = 400;
        throw error;
      }
    }
  }

  function ensureSeedGraph() {
    const seed = normalizeGraph(registry.buildSeedGraphTemplate());
    const file = graphPath(seed.id);
    if (!fs.existsSync(file)) {
      writeJson(file, seed);
    }
  }

  function listGraphs() {
    ensureSeedGraph();
    return fs.readdirSync(graphsDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readJson(path.join(graphsDir, entry), null))
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map(summarizeGraph);
  }

  function getGraph(id) {
    ensureSeedGraph();
    const graph = readJson(graphPath(id), null);
    if (!graph) {
      const error = new Error(`Graph introuvable: ${id}`);
      error.statusCode = 404;
      throw error;
    }
    return graph;
  }

  function saveGraph(id, input) {
    const existing = fs.existsSync(graphPath(id)) ? getGraph(id) : null;
    const next = normalizeGraph({
      ...(existing || {}),
      ...(input || {}),
      id,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt,
    });
    validateGraph(next);
    writeJson(graphPath(id), next);
    return next;
  }

  function createGraph(input = {}) {
    const graph = normalizeGraph({
      ...input,
      id: cleanText(input.id, 80) || randomId("graph"),
      nodes: input.nodes || [],
      edges: input.edges || [],
    });
    validateGraph(graph);
    writeJson(graphPath(graph.id), graph);
    return graph;
  }

  function listRuns(limit = 20) {
    return fs.readdirSync(runsDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readJson(path.join(runsDir, entry), null))
      .filter(Boolean)
      .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""))
      .slice(0, limit);
  }

  function getRun(id) {
    const run = readJson(runPath(id), null);
    if (!run) {
      const error = new Error(`Run introuvable: ${id}`);
      error.statusCode = 404;
      throw error;
    }
    return run;
  }

  function runGraph(id, { actor = "admin" } = {}) {
    const graph = getGraph(id);
    const startedAt = new Date().toISOString();
    const runId = randomId("run");
    const steps = graph.nodes.map((node, index) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      order: index + 1,
      runtime: node.runtime,
      status: "completed",
      artifactType: registry.getNodeType(node.type)?.outputs?.[0] || null,
    }));

    const run = {
      id: runId,
      graphId: graph.id,
      graphName: graph.name,
      actor: cleanText(actor, 80) || "admin",
      status: "completed",
      startedAt,
      finishedAt: new Date().toISOString(),
      runtime: graph.runtime,
      stepCount: steps.length,
      steps,
      artifactSummary: {
        datasetArtifacts: steps.filter((step) => step.artifactType === "dataset" || step.artifactType === "dataset_ready").length,
        modelArtifacts: steps.filter((step) => step.artifactType === "model" || step.artifactType === "registered_model").length,
        deploymentArtifacts: steps.filter((step) => step.artifactType === "deployment").length,
      },
      note: "Run simulé Node Engine V1. Le scheduling réel sera branché dans un lot suivant.",
    };

    writeJson(runPath(runId), run);
    writeJson(artifactSummaryPath(runId), {
      runId,
      graphId: graph.id,
      generatedAt: run.finishedAt,
      artifacts: run.artifactSummary,
      note: run.note,
    });
    return run;
  }

  function getOverview() {
    const graphs = listGraphs();
    const runs = listRuns(10);
    return {
      families: registry.listFamilies(),
      nodeTypes: registry.listNodeTypes(),
      graphs,
      runs,
      runtimes: ["local_cpu", "local_gpu", "remote_gpu", "cluster", "cloud_api"],
      storage: {
        rootDir,
        graphsDir,
        runsDir,
        artifactsDir,
        cacheDir,
      },
    };
  }

  ensureSeedGraph();

  return {
    listGraphs,
    getGraph,
    saveGraph,
    createGraph,
    listRuns,
    getRun,
    runGraph,
    getOverview,
  };
}

module.exports = {
  createNodeEngineStore,
};
