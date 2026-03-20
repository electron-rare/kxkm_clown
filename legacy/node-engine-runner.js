const fs = require("fs");
const path = require("path");
const { setTimeout: delay } = require("timers/promises");

const NODE_ENGINE_STEP_DELAY_MS = Number.isFinite(Number.parseInt(process.env.NODE_ENGINE_STEP_DELAY_MS || "", 10))
  ? Math.max(0, Number.parseInt(process.env.NODE_ENGINE_STEP_DELAY_MS || "", 10))
  : 0;

const NODE_ENGINE_STEP_TIMEOUT_MS = Number.isFinite(Number.parseInt(process.env.NODE_ENGINE_STEP_TIMEOUT_MS || "", 10))
  ? Math.max(10_000, Number.parseInt(process.env.NODE_ENGINE_STEP_TIMEOUT_MS || "", 10))
  : 10 * 60_000; // 10 min default per node

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function cleanText(value, maxLength = 400) {
  return String(value || "").trim().slice(0, maxLength);
}

function detectFormat(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jsonl") return "jsonl";
  if (ext === ".json") return "json";
  if (ext === ".csv") return "csv";
  if (ext === ".txt" || ext === ".md") return "text";
  return "unknown";
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const entry = {};
    headers.forEach((header, index) => {
      entry[header || `col_${index + 1}`] = String(values[index] || "").trim();
    });
    return entry;
  });
}

function summarizeDatasetPayload(dataset, source = {}) {
  const items = Array.isArray(dataset?.items) ? dataset.items : [];
  return {
    rows: items.length,
    format: source.format || dataset?.format || "unknown",
    sourcePath: source.path || dataset?.sourcePath || null,
    sampleKeys: items.length && isObject(items[0]) ? Object.keys(items[0]).slice(0, 8) : [],
  };
}

function readFileDataset(rootDir, inputPath) {
  // SEC-01 fix: Reject absolute paths and ensure resolved path stays within rootDir
  if (path.isAbsolute(inputPath)) {
    throw new Error(`Chemin absolu interdit pour dataset: ${inputPath}`);
  }
  const absolute = path.resolve(rootDir, inputPath);
  if (!absolute.startsWith(path.resolve(rootDir) + path.sep) && absolute !== path.resolve(rootDir)) {
    throw new Error(`Traversée de chemin détectée: ${inputPath}`);
  }
  if (!fs.existsSync(absolute)) {
    throw new Error(`Dataset introuvable: ${inputPath}`);
  }

  const format = detectFormat(absolute);
  const text = fs.readFileSync(absolute, "utf8");
  let items = [];

  if (format === "jsonl") {
    items = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (e) {
          console.warn(`[readFileDataset] Skipping invalid JSONL line ${index + 1}: ${e.message}`);
          return null;
        }
      })
      .filter(Boolean);
  } else if (format === "json") {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) items = parsed;
    else if (Array.isArray(parsed.items)) items = parsed.items;
    else items = [parsed];
  } else if (format === "csv") {
    items = parseCsv(text);
  } else if (format === "text") {
    items = text
      .split(/\r?\n\r?\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((content) => ({ text: content }));
  } else {
    throw new Error(`Format dataset non supporté: ${path.extname(absolute) || "sans extension"}`);
  }

  return {
    items,
    format,
    sourcePath: path.relative(rootDir, absolute),
    summary: summarizeDatasetPayload({ items, format }, {
      path: path.relative(rootDir, absolute),
      format,
    }),
  };
}

function trimRecordText(record) {
  if (Array.isArray(record)) return record.map(trimRecordText);
  if (!isObject(record)) {
    return typeof record === "string" ? cleanText(record, 4000) : record;
  }

  const next = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      next[key] = value.replace(/\s+/g, " ").trim();
    } else if (Array.isArray(value) || isObject(value)) {
      next[key] = trimRecordText(value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

function normalizeMessagesRow(row) {
  if (Array.isArray(row?.messages)) {
    return {
      messages: row.messages
        .filter((message) => message?.role && message?.content)
        .map((message) => ({
          role: cleanText(message.role, 40),
          content: cleanText(message.content, 6000),
        })),
      meta: row.meta || {},
    };
  }

  const system = cleanText(row?.system || row?.context || "", 2000);
  const user = cleanText(
    row?.prompt || row?.instruction || row?.input || row?.question || row?.text || "",
    4000
  );
  const assistant = cleanText(
    row?.completion || row?.output || row?.answer || row?.response || "",
    4000
  );
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  if (user) messages.push({ role: "user", content: user });
  if (assistant) messages.push({ role: "assistant", content: assistant });
  if (!messages.length) {
    messages.push({ role: "user", content: JSON.stringify(row).slice(0, 4000) });
  }
  return { messages, meta: row.meta || {} };
}

function topologicalSort(graph) {
  if (!Array.isArray(graph.edges)) graph.edges = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));

  for (const edge of graph.edges) {
    incoming.set(edge.to.node, (incoming.get(edge.to.node) || 0) + 1);
    outgoing.get(edge.from.node).push(edge.to.node);
  }

  const queue = graph.nodes
    .filter((node) => incoming.get(node.id) === 0)
    .map((node) => node.id);
  const sorted = [];

  while (queue.length) {
    const nodeId = queue.shift();
    sorted.push(nodesById.get(nodeId));
    for (const nextNode of outgoing.get(nodeId) || []) {
      incoming.set(nextNode, incoming.get(nextNode) - 1);
      if (incoming.get(nextNode) === 0) queue.push(nextNode);
    }
  }

  if (sorted.length !== graph.nodes.length) {
    const error = new Error("Graph Node Engine invalide: cycle détecté");
    error.statusCode = 400;
    throw error;
  }

  return sorted;
}

function createNodeEngineRunner({
  rootDir,
  registry,
  store,
  runtimes,
}) {
  function collectNodeInputs(graph, nodeId, outputsByNode) {
    const inputs = {};
    for (const edge of graph.edges) {
      if (edge.to.node !== nodeId) continue;
      const source = outputsByNode.get(edge.from.node) || {};
      if (Object.prototype.hasOwnProperty.call(source, edge.from.output)) {
        inputs[edge.to.input] = source[edge.from.output];
      }
    }
    return inputs;
  }

  function validateEdgeContracts(graph) {
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const edge of graph.edges) {
      const fromNode = nodesById.get(edge.from.node);
      const toNode = nodesById.get(edge.to.node);
      const fromType = registry.getNodeType(fromNode?.type);
      const toType = registry.getNodeType(toNode?.type);
      if (!fromType?.outputs?.includes(edge.from.output)) {
        const error = new Error(`Sortie invalide: ${edge.from.node}.${edge.from.output}`);
        error.statusCode = 400;
        throw error;
      }
      if (!toType?.inputs?.includes(edge.to.input)) {
        const error = new Error(`Entrée invalide: ${edge.to.node}.${edge.to.input}`);
        error.statusCode = 400;
        throw error;
      }
    }
  }

  async function executeDatasetFile(node) {
    return {
      dataset: readFileDataset(rootDir, node.params.path),
    };
  }

  async function executeDatasetFolder(node) {
    // SEC-01 fix: Reject absolute paths and enforce rootDir boundary
    if (path.isAbsolute(node.params.path || "")) {
      throw new Error(`Chemin absolu interdit pour dataset folder: ${node.params.path}`);
    }
    const folderPath = path.resolve(rootDir, node.params.path || "");
    if (!folderPath.startsWith(path.resolve(rootDir) + path.sep) && folderPath !== path.resolve(rootDir)) {
      throw new Error(`Traversée de chemin détectée: ${node.params.path}`);
    }
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      throw new Error(`Répertoire dataset introuvable: ${node.params.path || "(vide)"}`);
    }

    const merged = [];
    for (const entry of fs.readdirSync(folderPath).sort()) {
      const file = path.join(folderPath, entry);
      if (!fs.statSync(file).isFile()) continue;
      const dataset = readFileDataset(rootDir, file);
      merged.push(...dataset.items);
    }

    return {
      dataset: {
        items: merged,
        format: "folder",
        sourcePath: path.relative(rootDir, folderPath),
        summary: summarizeDatasetPayload({ items: merged }, {
          path: path.relative(rootDir, folderPath),
          format: "folder",
        }),
      },
    };
  }

  async function executeCleanText(node, inputs) {
    const dataset = clone(inputs.dataset);
    dataset.items = (dataset.items || []).map(trimRecordText);
    dataset.summary = summarizeDatasetPayload(dataset, dataset);
    return { dataset };
  }

  async function executeRemoveDuplicates(node, inputs) {
    const dataset = clone(inputs.dataset);
    const seen = new Set();
    dataset.items = (dataset.items || []).filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    dataset.summary = summarizeDatasetPayload(dataset, dataset);
    return { dataset };
  }

  async function executeSplitDataset(node, inputs) {
    const dataset = clone(inputs.dataset);
    const items = dataset.items || [];
    const trainRatio = Math.min(0.99, Math.max(0.5, Number(node.params.train) || 0.9));
    const trainCount = Math.max(1, Math.round(items.length * trainRatio));
    dataset.splits = {
      train: items.slice(0, trainCount),
      test: items.slice(trainCount),
    };
    dataset.summary = {
      ...summarizeDatasetPayload(dataset, dataset),
      trainCount: dataset.splits.train.length,
      testCount: dataset.splits.test.length,
    };
    return { dataset };
  }

  async function executeFormatInstructionDataset(node, inputs) {
    const items = (inputs.dataset?.splits?.train || inputs.dataset?.items || [])
      .map(normalizeMessagesRow);
    return {
      dataset_ready: {
        items,
        format: "instruction_chat",
        sourcePath: inputs.dataset?.sourcePath || null,
        summary: {
          rows: items.length,
          format: "instruction_chat",
          sourcePath: inputs.dataset?.sourcePath || null,
          sampleKeys: ["messages", "meta"],
        },
      },
    };
  }

  async function executeChatDataset(node, inputs) {
    return executeFormatInstructionDataset(node, inputs);
  }

  async function executePromptTest(node, inputs) {
    const datasetReady = inputs.dataset_ready || null;
    const modelArtifact = inputs.model || null;
    const modelName = cleanText(
      modelArtifact?.modelName
      || modelArtifact?.baseModel
      || modelArtifact?.model
      || node.params.model
      || node.params.baseModel,
      120
    );
    if (!modelName) {
      throw new Error(`Prompt test sans modèle pour le node ${node.id}`);
    }

    const prompt = cleanText(
      node.params.prompt
      || datasetReady?.items?.[0]?.messages?.find((message) => message.role === "user")?.content
      || "Décris brièvement ce dataset.",
      4000
    );

    const inference = await runtimes.invokeModel({
      model: modelName,
      prompt,
      runtimeId: node.runtime,
    });

    if (inference.status !== "completed") {
      return { __status: inference.status, __reason: inference.reason };
    }

    return {
      evaluation: {
        kind: "prompt_test",
        model: modelName,
        prompt,
        output: inference.output,
        runtime: node.runtime,
      },
    };
  }

  async function executeBenchmark(node, inputs) {
    const datasetReady = inputs.dataset_ready || null;
    const modelArtifact = inputs.model || null;
    const modelName = cleanText(
      modelArtifact?.modelName
      || modelArtifact?.baseModel
      || modelArtifact?.model
      || node.params.model
      || node.params.baseModel,
      120
    );
    if (!modelName) {
      throw new Error(`Benchmark sans modèle pour le node ${node.id}`);
    }

    const prompts = Array.isArray(node.params.prompts) && node.params.prompts.length
      ? node.params.prompts.map((prompt) => cleanText(prompt, 4000)).filter(Boolean).slice(0, 3)
      : (datasetReady?.items || [])
        .slice(0, 2)
        .map((item) => item.messages?.find((message) => message.role === "user")?.content)
        .filter(Boolean);

    const resolvedPrompts = prompts.length ? prompts : ["Raconte brièvement ce pipeline."];
    const cases = [];
    for (const prompt of resolvedPrompts) {
      const inference = await runtimes.invokeModel({
        model: modelName,
        prompt,
        runtimeId: node.runtime,
        tokenLimit: 90,
      });
      if (inference.status !== "completed") {
        return { __status: inference.status, __reason: inference.reason };
      }
      cases.push({
        prompt,
        output: inference.output,
        score: inference.output ? 1 : 0,
      });
    }

    const score = cases.length
      ? Number((cases.reduce((sum, item) => sum + item.score, 0) / cases.length).toFixed(2))
      : 0;

    return {
      evaluation: {
        kind: "benchmark",
        model: modelName,
        score,
        cases,
        runtime: node.runtime,
      },
    };
  }

  async function executeRegisterModel(node, inputs, context) {
    const modelArtifact = inputs.model || null;
    const evaluation = inputs.evaluation || null;
    const modelName = cleanText(
      modelArtifact?.modelName
      || modelArtifact?.baseModel
      || modelArtifact?.model
      || node.params.model
      || node.params.baseModel,
      120
    );
    if (!modelName) {
      throw new Error(`Register model sans modèle pour le node ${node.id}`);
    }

    const registered = store.registerModel({
      alias: cleanText(node.params.alias, 80) || "candidate",
      modelName,
      family: modelArtifact?.family || (modelArtifact?.kind === "lora" ? "lora" : "base"),
      sourceRunId: context.run.id,
      sourceStepId: node.id,
      evaluation,
      metadata: {
        graphId: context.graph.id,
        graphName: context.graph.name,
      },
    });

    return {
      registered_model: registered,
    };
  }

  async function executeDeployApi(node, inputs, context) {
    const registeredModel = inputs.registered_model || null;
    if (!registeredModel?.id) {
      throw new Error(`Deploy API sans registered_model pour le node ${node.id}`);
    }

    const deployment = store.registerDeployment({
      runId: context.run.id,
      stepId: node.id,
      target: cleanText(node.params.target, 40) || "local",
      registeredModelId: registeredModel.id,
      alias: registeredModel.alias,
      modelName: registeredModel.modelName,
    });

    return { deployment };
  }

  async function executeTrainingNode(node, inputs, context) {
    const datasetReady = inputs.dataset_ready || null;
    if (!datasetReady?.items?.length) {
      throw new Error(`Training sans dataset_ready pour le node ${node.id}`);
    }

    const baseModel = cleanText(node.params.baseModel || node.params.model, 120);
    if (!baseModel) {
      throw new Error(`Training sans modèle de base pour le node ${node.id}`);
    }

    const jobDir = store.ensureRunStepDir(context.run.id, node.id);
    const adapter = await runtimes.runTrainingAdapter({
      runtimeId: node.runtime,
      nodeType: node.type,
      jobDir,
      jobSpec: {
        type: node.type,
        runtime: node.runtime,
        baseModel,
        params: node.params || {},
        datasetSummary: datasetReady.summary || summarizeDatasetPayload(datasetReady, datasetReady),
      },
    });

    if (adapter.status !== "completed") {
      return {
        __status: adapter.status,
        __reason: adapter.reason,
        __details: adapter,
      };
    }

    return {
      model: {
        kind: node.type === "qlora_training" ? "qlora" : "lora",
        modelName: cleanText(adapter.payload?.modelName || `${baseModel}-${node.type}`, 120),
        baseModel,
        runtime: node.runtime,
        adapter: adapter.payload || {},
      },
    };
  }

  const executors = {
    dataset_file: executeDatasetFile,
    dataset_folder: executeDatasetFolder,
    clean_text: executeCleanText,
    remove_duplicates: executeRemoveDuplicates,
    split_dataset: executeSplitDataset,
    format_instruction_dataset: executeFormatInstructionDataset,
    chat_dataset: executeChatDataset,
    prompt_test: executePromptTest,
    benchmark: executeBenchmark,
    register_model: executeRegisterModel,
    deploy_api: executeDeployApi,
    lora_training: executeTrainingNode,
    qlora_training: executeTrainingNode,
  };

  function resolveFinalStatus(stepStatuses = [], cancelled = false) {
    if (cancelled) return "cancelled";
    if (stepStatuses.includes("failed")) return "failed";
    if (stepStatuses.includes("not_configured")) return "not_configured";
    if (stepStatuses.includes("blocked")) return "blocked";
    return "completed";
  }

  async function maybeDelayBetweenSteps() {
    if (!NODE_ENGINE_STEP_DELAY_MS) return;
    await delay(NODE_ENGINE_STEP_DELAY_MS);
  }

  function prepareRun(graphId, { actor = "admin" } = {}) {
    const graph = store.getGraph(graphId);
    validateEdgeContracts(graph);
    topologicalSort(graph);
    return store.createRun({
      graph,
      actor,
      runtimes: runtimes.listRuntimes(),
    });
  }

  async function executeRun(runId, { shouldCancel = () => false } = {}) {
    const run = store.getRun(runId);
    const graph = run.graphSnapshot || store.getGraph(run.graphId);
    validateEdgeContracts(graph);
    const sortedNodes = topologicalSort(graph);

    const outputsByNode = new Map();
    const stepStatuses = [];
    let cancelled = false;

    store.updateRun(runId, {
      status: "running",
      startedAt: run.startedAt || new Date().toISOString(),
    });

    for (const node of sortedNodes) {
      const existingStep = store.getRun(runId).steps.find((entry) => entry.id === node.id);
      if (existingStep?.status === "completed") {
        const restoredOutputs = store.readStepOutputs(runId, node.id);
        outputsByNode.set(node.id, restoredOutputs);
        stepStatuses.push("completed");
      }
    }

    for (const node of sortedNodes) {
      const currentRun = store.getRun(runId);
      const currentStep = currentRun.steps.find((entry) => entry.id === node.id);
      if (currentStep?.status === "completed") continue;

      if (shouldCancel()) {
        cancelled = true;
        break;
      }

      const nodeType = registry.getNodeType(node.type);
      const inputs = collectNodeInputs(graph, node.id, outputsByNode);
      const preview = runtimes.previewNode(node.type, node.runtime);
      const missingRequiredInputs = (nodeType?.inputs || [])
        .filter((inputName) => !Object.prototype.hasOwnProperty.call(inputs, inputName));

      store.markRunStep(runId, node.id, {
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
        runtimeMeta: preview.runtime,
      });

        if (missingRequiredInputs.length && executors[node.type] !== executeBenchmark && executors[node.type] !== executePromptTest && executors[node.type] !== executeRegisterModel) {
          store.markRunStep(runId, node.id, {
            status: "blocked",
            finishedAt: new Date().toISOString(),
            error: `Inputs manquants: ${missingRequiredInputs.join(", ")}`,
          });
          stepStatuses.push("blocked");
          await maybeDelayBetweenSteps();
          continue;
        }

        if (!executors[node.type]) {
          store.markRunStep(runId, node.id, {
            status: "not_configured",
            finishedAt: new Date().toISOString(),
            error: `Node ${node.type} non exécutable dans cette itération`,
          });
          stepStatuses.push("not_configured");
          await maybeDelayBetweenSteps();
          continue;
        }

      try {
        // BUG-02 fix: Use AbortSignal to cancel timeout when executor completes
        const ac = new AbortController();
        const result = await Promise.race([
          executors[node.type](node, inputs, {
            graph,
            run: store.getRun(runId),
          }).finally(() => ac.abort()),
          delay(NODE_ENGINE_STEP_TIMEOUT_MS, null, { signal: ac.signal }).then(() => {
            throw new Error(`Timeout: node ${node.id} (${node.type}) exceeded ${NODE_ENGINE_STEP_TIMEOUT_MS / 1000}s`);
          }),
        ]);

        if (result?.__status && result.__status !== "completed") {
          store.markRunStep(runId, node.id, {
            status: result.__status,
            finishedAt: new Date().toISOString(),
            error: result.__reason || "Node non configuré",
            details: result.__details || null,
          });
          stepStatuses.push(result.__status);
          await maybeDelayBetweenSteps();
          continue;
        }

        const outputs = {};
        for (const [key, value] of Object.entries(result || {})) {
          outputs[key] = value;
          store.writeStepArtifact(runId, node.id, key, value);
        }
        outputsByNode.set(node.id, outputs);
        store.markRunStep(runId, node.id, {
          status: "completed",
          finishedAt: new Date().toISOString(),
          outputs: Object.keys(outputs),
        });
        stepStatuses.push("completed");

        if (shouldCancel()) {
          cancelled = true;
          break;
        }

        await maybeDelayBetweenSteps();
      } catch (error) {
        store.markRunStep(runId, node.id, {
          status: "failed",
          finishedAt: new Date().toISOString(),
          error: cleanText(error.message, 500),
        });
        stepStatuses.push("failed");
        break;
      }
    }

    return store.finishRun(runId, resolveFinalStatus(stepStatuses, cancelled));
  }

  async function runGraph(graphId, { actor = "admin" } = {}) {
    const run = prepareRun(graphId, { actor });
    return executeRun(run.id);
  }

  function previewNode(nodeType, runtimeId = "local_cpu", params = {}) {
    const type = registry.getNodeType(nodeType);
    if (!type) {
      const error = new Error(`Type de node inconnu: ${nodeType}`);
      error.statusCode = 404;
      throw error;
    }

    const runtimePreview = runtimes.previewNode(nodeType, runtimeId);
    return {
      nodeType: type,
      runtime: runtimePreview.runtime,
      runtimePreview,
      params: clone(params || {}),
    };
  }

  return {
    prepareRun,
    executeRun,
    runGraph,
    previewNode,
    listRuntimes: runtimes.listRuntimes,
  };
}

module.exports = {
  createNodeEngineRunner,
};
