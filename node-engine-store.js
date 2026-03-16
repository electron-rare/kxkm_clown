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

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createNodeEngineStore({
  dataDir,
  registry,
}) {
  const projectRoot = path.dirname(dataDir);
  const rootDir = path.join(dataDir, "node-engine");
  const graphsDir = path.join(rootDir, "graphs");
  const runsDir = path.join(rootDir, "runs");
  const artifactsDir = path.join(rootDir, "artifacts");
  const cacheDir = path.join(rootDir, "cache");
  const modelsRoot = path.join(projectRoot, "models");
  const modelFamilies = {
    base: path.join(modelsRoot, "base_models"),
    finetuned: path.join(modelsRoot, "finetuned"),
    lora: path.join(modelsRoot, "lora"),
  };
  const modelIndexFile = path.join(modelsRoot, "registry.json");

  for (const dir of [rootDir, graphsDir, runsDir, artifactsDir, cacheDir, modelsRoot, ...Object.values(modelFamilies)]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  function graphPath(id) {
    return path.join(graphsDir, `${id}.json`);
  }

  function runPath(id) {
    return path.join(runsDir, `${id}.json`);
  }

  function runArtifactDir(runId) {
    return path.join(artifactsDir, runId);
  }

  function stepArtifactDir(runId, stepId) {
    return path.join(runArtifactDir(runId), stepId);
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

  function loadModelIndex() {
    return readJson(modelIndexFile, { updatedAt: null, models: [] }) || { updatedAt: null, models: [] };
  }

  function saveModelIndex(index) {
    writeJson(modelIndexFile, {
      updatedAt: new Date().toISOString(),
      models: index.models || [],
    });
  }

  function normalizeNode(node, index) {
    return {
      id: cleanText(node?.id, 80) || `node_${index + 1}`,
      type: cleanText(node?.type, 80),
      title: cleanText(node?.title, 120) || cleanText(node?.type, 80) || `Node ${index + 1}`,
      params: isObject(node?.params) ? clone(node.params) : {},
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
      const nodeType = registry.getNodeType(node.type);
      if (!node.type || !nodeType) {
        const error = new Error(`Type de node inconnu: ${node.type || "(vide)"}`);
        error.statusCode = 400;
        throw error;
      }
      if (!nodeType.runtimes.includes(node.runtime)) {
        const error = new Error(`Runtime ${node.runtime} non supporté pour ${node.type}`);
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

  let seedGraphsEnsured = false;
  function ensureSeedGraphs() {
    if (seedGraphsEnsured) return;
    seedGraphsEnsured = true;

    const seedGraphs = typeof registry.listSeedGraphs === "function"
      ? registry.listSeedGraphs()
      : [registry.buildSeedGraphTemplate()];

    for (const template of seedGraphs) {
      const graph = normalizeGraph(template);
      const file = graphPath(graph.id);
      if (!fs.existsSync(file)) {
        writeJson(file, graph);
      }
    }
  }

  function listGraphs() {
    ensureSeedGraphs();
    return fs.readdirSync(graphsDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readJson(path.join(graphsDir, entry), null))
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map(summarizeGraph);
  }

  function getGraph(id) {
    ensureSeedGraphs();
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
    });
    validateGraph(graph);
    writeJson(graphPath(graph.id), graph);
    return graph;
  }

  function createRun({
    graph,
    actor = "admin",
    runtimes = [],
  }) {
    const runId = randomId("run");
    const createdAt = new Date().toISOString();
    const run = {
      id: runId,
      graphId: graph.id,
      graphName: graph.name,
      graphVersion: graph.version,
      graphSnapshot: clone(graph),
      actor: cleanText(actor, 80) || "admin",
      status: "queued",
      createdAt,
      queuedAt: createdAt,
      startedAt: null,
      finishedAt: null,
      runtime: graph.runtime,
      stepCount: graph.nodes.length,
      runtimes,
      cancelRequestedAt: null,
      recoveredAt: null,
      recoveryCount: 0,
      steps: graph.nodes.map((node, index) => ({
        id: node.id,
        type: node.type,
        title: node.title,
        order: index + 1,
        runtime: node.runtime,
        status: "queued",
        outputs: [],
        error: null,
        details: null,
        startedAt: null,
        finishedAt: null,
      })),
      artifactSummary: {},
    };
    writeJson(runPath(runId), run);
    fs.mkdirSync(runArtifactDir(runId), { recursive: true });
    return run;
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

  function saveRun(run) {
    writeJson(runPath(run.id), run);
    return run;
  }

  function listRuns(limit = 20) {
    return fs.readdirSync(runsDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readJson(path.join(runsDir, entry), null))
      .filter(Boolean)
      .sort((a, b) => (
        (b.finishedAt || b.startedAt || b.queuedAt || b.createdAt || "")
          .localeCompare(a.finishedAt || a.startedAt || a.queuedAt || a.createdAt || "")
      ))
      .slice(0, limit);
  }

  function listRunsByStatus(statuses = [], limit = 100) {
    const wanted = new Set((statuses || []).map((status) => cleanText(status, 40)).filter(Boolean));
    return fs.readdirSync(runsDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readJson(path.join(runsDir, entry), null))
      .filter((run) => run && (!wanted.size || wanted.has(run.status)))
      .sort((a, b) => (
        (a.queuedAt || a.createdAt || a.startedAt || "")
          .localeCompare(b.queuedAt || b.createdAt || b.startedAt || "")
      ))
      .slice(0, limit);
  }

  function updateRun(runId, patch = {}) {
    const run = getRun(runId);
    Object.assign(run, patch || {});
    writeJson(runPath(run.id), run);
    return run;
  }

  function markRunStep(runId, stepId, patch) {
    const run = getRun(runId);
    const step = run.steps.find((entry) => entry.id === stepId);
    if (!step) {
      const error = new Error(`Étape introuvable: ${stepId}`);
      error.statusCode = 404;
      throw error;
    }
    Object.assign(step, patch || {});
    if (step.status === "running") run.status = "running";
    return saveRun(run);
  }

  function ensureRunStepDir(runId, stepId) {
    const dir = stepArtifactDir(runId, stepId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function writeStepArtifact(runId, stepId, outputName, value) {
    const dir = ensureRunStepDir(runId, stepId);
    writeJson(path.join(dir, `${outputName}.json`), value);
    const run = getRun(runId);
    const step = run.steps.find((entry) => entry.id === stepId);
    if (step) {
      if (!step.outputs.includes(outputName)) step.outputs.push(outputName);
      saveRun(run);
    }
  }

  function readStepOutputs(runId, stepId) {
    const dir = stepArtifactDir(runId, stepId);
    if (!fs.existsSync(dir)) return {};

    const outputs = {};
    for (const entry of fs.readdirSync(dir).sort()) {
      if (!entry.endsWith(".json")) continue;
      outputs[entry.replace(/\.json$/, "")] = readJson(path.join(dir, entry), null);
    }
    return outputs;
  }

  function getArtifacts(runId) {
    const root = runArtifactDir(runId);
    if (!fs.existsSync(root)) {
      const error = new Error(`Artifacts introuvables pour ${runId}`);
      error.statusCode = 404;
      throw error;
    }

    const artifacts = [];
    for (const stepId of fs.readdirSync(root).sort()) {
      const stepDir = path.join(root, stepId);
      if (!fs.statSync(stepDir).isDirectory()) continue;
      for (const entry of fs.readdirSync(stepDir).sort()) {
        if (!entry.endsWith(".json")) continue;
        artifacts.push({
          stepId,
          name: entry.replace(/\.json$/, ""),
          file: path.join(stepDir, entry),
          relativePath: path.relative(root, path.join(stepDir, entry)),
          payload: readJson(path.join(stepDir, entry), null),
        });
      }
    }
    return artifacts;
  }

  function finishRun(runId, status) {
    const run = getRun(runId);
    run.status = cleanText(status, 40) || "completed";
    if (!run.startedAt && run.status !== "queued") {
      run.startedAt = run.queuedAt || run.createdAt || new Date().toISOString();
    }
    run.finishedAt = new Date().toISOString();

    const root = runArtifactDir(runId);
    const stepArtifacts = {};
    let totalArtifacts = 0;
    if (fs.existsSync(root)) {
      for (const stepId of fs.readdirSync(root)) {
        const stepDir = path.join(root, stepId);
        try {
          if (!fs.statSync(stepDir).isDirectory()) continue;
        } catch { continue; }
        const count = fs.readdirSync(stepDir).filter((f) => f.endsWith(".json")).length;
        if (count) {
          stepArtifacts[stepId] = count;
          totalArtifacts += count;
        }
      }
    }
    run.artifactSummary = { totalArtifacts, stepArtifacts };

    saveRun(run);
    writeJson(path.join(runArtifactDir(runId), "summary.json"), {
      runId,
      status: run.status,
      artifactSummary: run.artifactSummary,
      generatedAt: run.finishedAt,
    });
    return run;
  }

  function requestRunCancel(runId) {
    const run = getRun(runId);
    if (["completed", "failed", "cancelled", "blocked", "not_configured"].includes(run.status)) {
      return run;
    }

    if (run.status === "queued") {
      return finishRun(runId, "cancelled");
    }

    run.cancelRequestedAt = new Date().toISOString();
    return saveRun(run);
  }

  function recoverRunnableRuns() {
    const recoveredAt = new Date().toISOString();
    const candidates = listRunsByStatus(["queued", "running"], 500);
    const recovered = [];

    for (const run of candidates) {
      let touched = false;

      if (run.status === "running") {
        run.status = "queued";
        run.recoveredAt = recoveredAt;
        run.recoveryCount = Number(run.recoveryCount || 0) + 1;
        touched = true;
      }

      for (const step of run.steps || []) {
        if (step.status === "running") {
          step.status = "queued";
          step.startedAt = null;
          step.finishedAt = null;
          step.error = null;
          step.details = {
            ...(isObject(step.details) ? step.details : {}),
            recoveredAt,
            recoveredFrom: "running",
          };
          touched = true;
        }
      }

      if (touched) saveRun(run);
      recovered.push(run);
    }

    return recovered;
  }

  function resolveModelFamily(family) {
    if (family === "lora") return "lora";
    if (family === "finetuned") return "finetuned";
    return "base";
  }

  function registerModel({
    alias,
    modelName,
    family = "base",
    sourceRunId,
    sourceStepId,
    evaluation = null,
    metadata = {},
  }) {
    const resolvedFamily = resolveModelFamily(family);
    const index = loadModelIndex();
    const baseAlias = cleanText(alias, 80) || "candidate";
    const previousVersions = index.models.filter((entry) => entry.alias === baseAlias);
    const version = previousVersions.length + 1;
    const id = `${baseAlias}_v${version}`;
    const modelDir = path.join(modelFamilies[resolvedFamily], id);
    fs.mkdirSync(modelDir, { recursive: true });

    const entry = {
      id,
      alias: baseAlias,
      version,
      family: resolvedFamily,
      modelName: cleanText(modelName, 120),
      sourceRunId: cleanText(sourceRunId, 80),
      sourceStepId: cleanText(sourceStepId, 80),
      evaluation: evaluation || null,
      metadata: isObject(metadata) ? clone(metadata) : {},
      deployedTargets: [],
      createdAt: new Date().toISOString(),
      modelDir: path.relative(projectRoot, modelDir),
    };

    writeJson(path.join(modelDir, "metadata.json"), entry);
    index.models = index.models.filter((item) => item.id !== id).concat(entry);
    saveModelIndex(index);
    return entry;
  }

  function listModels(limit = 50) {
    return loadModelIndex().models
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, limit);
  }

  function getModel(id) {
    const model = loadModelIndex().models.find((entry) => entry.id === id) || null;
    if (!model) {
      const error = new Error(`Modèle introuvable: ${id}`);
      error.statusCode = 404;
      throw error;
    }
    return model;
  }

  function registerDeployment({
    runId,
    stepId,
    target,
    registeredModelId,
    alias,
    modelName,
  }) {
    const deployment = {
      id: randomId("deploy"),
      target: cleanText(target, 40) || "local",
      registeredModelId: cleanText(registeredModelId, 80),
      alias: cleanText(alias, 80),
      modelName: cleanText(modelName, 120),
      createdAt: new Date().toISOString(),
      mode: "manifest_only",
    };

    const index = loadModelIndex();
    const model = index.models.find((entry) => entry.id === deployment.registeredModelId);
    if (!model) {
      const error = new Error(`Modèle introuvable: ${deployment.registeredModelId}`);
      error.statusCode = 404;
      throw error;
    }
    const nextModel = {
      ...model,
      deployedTargets: [...new Set([...(model.deployedTargets || []), deployment.target])],
    };

    writeJson(path.join(runArtifactDir(runId), `${stepId}_deployment.json`), deployment);

    index.models = index.models.map((entry) => entry.id === nextModel.id ? nextModel : entry);
    saveModelIndex(index);
    writeJson(path.join(modelFamilies[nextModel.family], nextModel.id, "metadata.json"), nextModel);
    return deployment;
  }

  function getOverview() {
    const graphs = listGraphs();
    const runs = listRuns(10);
    return {
      families: registry.listFamilies(),
      nodeTypes: registry.listNodeTypes(),
      graphs,
      runs,
      models: listModels(10),
      runtimes: [],
      storage: {
        rootDir,
        graphsDir,
        runsDir,
        artifactsDir,
        cacheDir,
        modelsRoot,
      },
    };
  }

  ensureSeedGraphs();

  return {
    listGraphs,
    getGraph,
    saveGraph,
    createGraph,
    createRun,
    getRun,
    listRuns,
    listRunsByStatus,
    updateRun,
    markRunStep,
    writeStepArtifact,
    readStepOutputs,
    ensureRunStepDir,
    finishRun,
    requestRunCancel,
    recoverRunnableRuns,
    getArtifacts,
    registerModel,
    listModels,
    getModel,
    registerDeployment,
    getOverview,
  };
}

module.exports = {
  createNodeEngineStore,
};
