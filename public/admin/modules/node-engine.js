import { escapeHtml, formatTs } from "../utils.js";

const POLLABLE_RUN_STATUSES = new Set(["validated", "queued", "running", "cancelling"]);
const CANCELABLE_RUN_STATUSES = new Set(["queued", "running", "cancelling"]);

function prettyJson(value) {
  return JSON.stringify(value || [], null, 2);
}

function normalizeStatus(status) {
  return String(status || "unknown").trim().toLowerCase();
}

function isPollableStatus(status) {
  return POLLABLE_RUN_STATUSES.has(normalizeStatus(status));
}

function isCancelableStatus(status) {
  return CANCELABLE_RUN_STATUSES.has(normalizeStatus(status));
}

function statusTone(status) {
  switch (normalizeStatus(status)) {
    case "completed":
      return "ok";
    case "failed":
    case "cancelled":
      return "off";
    case "queued":
    case "running":
    case "validated":
    case "cancelling":
      return "warn";
    default:
      return "";
  }
}

function renderStatusTag(status) {
  return `<span class="tag ${statusTone(status)}">${escapeHtml(status || "unknown")}</span>`;
}

function renderTags(items = [], tone = "") {
  return items.map((item) => `<span class="tag ${tone}">${escapeHtml(item)}</span>`).join("");
}

function renderGraphOptions(graphs = [], selectedId = "") {
  return graphs.map((graph) => `
    <option value="${escapeHtml(graph.id)}" ${graph.id === selectedId ? "selected" : ""}>
      ${escapeHtml(`${graph.name} · ${graph.runtime} · v${graph.version}`)}
    </option>
  `).join("");
}

function renderRunOptions(runs = [], selectedId = "") {
  return runs.map((run) => `
    <option value="${escapeHtml(run.id)}" ${run.id === selectedId ? "selected" : ""}>
      ${escapeHtml(`${run.graphName || run.graphId} · ${run.status || "unknown"} · ${run.id}`)}
    </option>
  `).join("");
}

function getCompletedStepCount(run) {
  return Array.isArray(run?.steps)
    ? run.steps.filter((step) => normalizeStatus(step.status) === "completed").length
    : 0;
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function deriveAsyncMeta(overview = {}, runs = []) {
  const queue = overview.queue || {};
  const workers = Array.isArray(queue.workers) ? queue.workers : [];
  let queuedCount = 0;
  let runningCount = 0;
  let activeCount = 0;
  for (const run of runs) {
    const s = normalizeStatus(run.status);
    if (s === "queued") queuedCount++;
    if (s === "running") runningCount++;
    if (isPollableStatus(run.status)) activeCount++;
  }
  const queueDepth = toFiniteNumber(queue.queueDepth) ?? queuedCount;
  const workerCount = toFiniteNumber(queue.workerCount) ?? (workers.length || null);
  const busyWorkers = toFiniteNumber(queue.busyWorkers) ?? runningCount;
  const concurrency = toFiniteNumber(queue.concurrency);
  const source = workerCount !== null || concurrency !== null ? "backend" : "derived";

  return {
    queueDepth,
    queuedCount,
    runningCount,
    activeCount,
    workerCount,
    busyWorkers,
    concurrency,
    workers,
    source,
  };
}

function renderWorkerList(meta) {
  if (!meta.workers.length) {
    return `<div class="small">Aucun worker detaille par le backend. Vue ${meta.source === "derived" ? "derivee du listing runs" : "partielle"}.</div>`;
  }

  return meta.workers.map((worker, index) => {
    if (typeof worker === "string") {
      return `
        <article class="result-entry">
          <strong>${escapeHtml(worker)}</strong>
          <div class="small">worker ${index + 1}</div>
        </article>
      `;
    }

    const label = worker.id || worker.name || `worker_${index + 1}`;
    const status = worker.status || worker.state || (worker.busy ? "running" : "idle");
    const details = [
      worker.runtime,
      worker.currentRunId,
      worker.currentNodeId,
      worker.host,
    ].filter(Boolean).join(" · ");

    return `
      <article class="result-entry">
        <div class="panel-header">
          <div>
            <strong>${escapeHtml(label)}</strong>
            <div class="small">${escapeHtml(details || "worker")}</div>
          </div>
          ${renderStatusTag(status)}
        </div>
      </article>
    `;
  }).join("");
}

function renderGraphRows(graphs = [], selectedId = "") {
  if (!graphs.length) {
    return '<div class="small">Aucun graphe disponible.</div>';
  }

  return graphs.map((graph) => `
    <div class="table-row ${graph.id === selectedId ? "is-active" : ""}">
      <div>
        <strong>${escapeHtml(graph.name)}</strong>
        <div class="small">${escapeHtml(graph.id)} · ${escapeHtml(graph.status || "draft")}</div>
      </div>
      <div class="small">${graph.nodeCount} nodes · ${graph.edgeCount} edges · v${graph.version}</div>
      <div class="actions-inline">
        <span class="tag">${escapeHtml(graph.runtime)}</span>
        <button type="button" class="secondary" data-action="select-graph" data-graph-id="${escapeHtml(graph.id)}">Ouvrir</button>
        <button type="button" data-action="run-graph" data-graph-id="${escapeHtml(graph.id)}">Run</button>
      </div>
    </div>
  `).join("");
}

function renderRunRows(runs = [], selectedId = "") {
  if (!runs.length) {
    return '<div class="small">Aucun run enregistre.</div>';
  }

  return runs.map((run) => {
    const progress = `${getCompletedStepCount(run)}/${run.stepCount || 0}`;
    return `
      <div class="table-row ${run.id === selectedId ? "is-active" : ""}">
        <div>
          <strong>${escapeHtml(run.graphName || run.graphId)}</strong>
          <div class="small">${escapeHtml(run.id)} · ${escapeHtml(run.actor || "admin")}</div>
        </div>
        <div class="small">${escapeHtml(run.runtime || "local_cpu")} · ${progress} etapes · ${formatTs(run.finishedAt || run.startedAt)}</div>
        <div class="actions-inline">
          ${renderStatusTag(run.status)}
          <button type="button" class="secondary" data-action="select-run" data-run-id="${escapeHtml(run.id)}">Inspecter</button>
          ${isCancelableStatus(run.status)
            ? `<button type="button" class="danger" data-action="cancel-run" data-run-id="${escapeHtml(run.id)}">Cancel</button>`
            : ""}
        </div>
      </div>
    `;
  }).join("");
}

function renderRunSteps(run) {
  if (!run?.steps?.length) {
    return '<div class="small">Aucune etape detaillee pour ce run.</div>';
  }

  return run.steps.map((step) => `
    <article class="node-engine-step">
      <div class="panel-header">
        <div>
          <strong>${escapeHtml(`${step.order}. ${step.title || step.id}`)}</strong>
          <div class="small">${escapeHtml(step.type || "node")} · ${escapeHtml(step.id)}</div>
        </div>
        ${renderStatusTag(step.status)}
      </div>
      <div class="small">${escapeHtml(step.runtime || "local_cpu")} · ${formatTs(step.startedAt)} → ${formatTs(step.finishedAt)}</div>
      <div class="small">Outputs: ${escapeHtml((step.outputs || []).join(", ") || "—")}</div>
      ${step.error ? `<pre>${escapeHtml(step.error)}</pre>` : ""}
      ${step.details ? `<pre>${escapeHtml(JSON.stringify(step.details, null, 2))}</pre>` : ""}
    </article>
  `).join("");
}

function renderNodePalette(families = [], nodeTypes = []) {
  if (!families.length) {
    return '<div class="small">Aucune famille de nodes recue.</div>';
  }

  return families.map((family) => {
    const entries = nodeTypes.filter((nodeType) => nodeType.family === family.id);
    return `
      <article class="node-engine-family">
        <div>
          <strong>${escapeHtml(family.title)}</strong>
          <div class="small">${escapeHtml(family.description || "")}</div>
        </div>
        <div class="node-engine-family-grid">
          ${entries.map((nodeType) => `
            <div class="node-type-card">
              <strong>${escapeHtml(nodeType.title)}</strong>
              <div class="small">${escapeHtml(nodeType.type)}</div>
              <div class="small">${escapeHtml(nodeType.description || "")}</div>
              <div class="small">I/O: ${escapeHtml((nodeType.inputs || []).join(", ") || "source")} → ${escapeHtml((nodeType.outputs || []).join(", ") || "—")}</div>
              <div class="tag-list">${renderTags(nodeType.runtimes || [])}</div>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }).join("");
}

function renderModelList(models = []) {
  if (!models.length) {
    return '<div class="small">Aucun modele enregistre dans le registry Node Engine.</div>';
  }

  return models.map((model) => `
    <article class="result-entry">
      <strong>${escapeHtml(model.id)}</strong>
      <div class="small">${escapeHtml(model.alias || "candidate")} · ${escapeHtml(model.family || "base")} · v${escapeHtml(model.version)}</div>
      <pre>${escapeHtml(`${model.modelName || "modele inconnu"}\n${model.modelDir || ""}`)}</pre>
    </article>
  `).join("");
}

function createSeedPayload() {
  return {
    name: `Node Engine Seed ${new Date().toISOString().slice(11, 19)}`,
    description: "Graphe de travail pour orchestrer dataset, preparation, training et evaluation.",
    runtime: "local_gpu",
    status: "draft",
    tags: ["manual", "seed", "node-engine"],
    nodes: [
      { id: "source", type: "dataset_file", title: "Dataset File", params: { path: "docs/examples/node_engine_dataset.jsonl" }, runtime: "local_cpu" },
      { id: "clean", type: "clean_text", title: "Clean Text", params: { trim: true }, runtime: "local_cpu" },
      { id: "format", type: "format_instruction_dataset", title: "Instruction Dataset", params: { mode: "chat" }, runtime: "local_cpu" },
      { id: "train", type: "lora_training", title: "LoRA Training", params: { baseModel: "mistral:7b" }, runtime: "local_gpu" },
      { id: "benchmark", type: "benchmark", title: "Benchmark", params: { suite: "smoke" }, runtime: "local_cpu" },
    ],
    edges: [
      { from: { node: "source", output: "dataset" }, to: { node: "clean", input: "dataset" } },
      { from: { node: "clean", output: "dataset" }, to: { node: "format", input: "dataset" } },
      { from: { node: "format", output: "dataset_ready" }, to: { node: "train", input: "dataset_ready" } },
      { from: { node: "train", output: "model" }, to: { node: "benchmark", input: "model" } },
    ],
  };
}

function readGraphDraft(container, selectedGraph) {
  if (!selectedGraph) return null;

  const readField = (name) => container.querySelector(`[data-graph-field="${name}"]`);
  const tags = String(readField("tags")?.value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  let nodes;
  let edges;

  try {
    nodes = JSON.parse(readField("nodes")?.value || "[]");
    if (!Array.isArray(nodes)) throw new Error("Le JSON des nodes doit etre un tableau");
  } catch (error) {
    throw new Error(`Nodes invalides: ${error.message}`);
  }

  try {
    edges = JSON.parse(readField("edges")?.value || "[]");
    if (!Array.isArray(edges)) throw new Error("Le JSON des edges doit etre un tableau");
  } catch (error) {
    throw new Error(`Edges invalides: ${error.message}`);
  }

  return {
    name: String(readField("name")?.value || "").trim() || selectedGraph.name,
    description: String(readField("description")?.value || "").trim(),
    runtime: String(readField("runtime")?.value || "").trim() || selectedGraph.runtime,
    status: String(readField("status")?.value || "").trim() || selectedGraph.status,
    tags,
    nodes,
    edges,
  };
}

export async function mountNodeEngine(container, { api, setStatus }) {
  if (typeof container.__nodeEngineCleanup === "function") {
    container.__nodeEngineCleanup();
  }

  const controller = new AbortController();
  let pollTimer = null;
  const observer = new MutationObserver(() => {
    if (!container.querySelector('[data-node-engine-root="1"]')) {
      cleanup();
    }
  });

  function cleanup() {
    controller.abort();
    observer.disconnect();
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (container.__nodeEngineCleanup === cleanup) {
      delete container.__nodeEngineCleanup;
    }
  }

  container.__nodeEngineCleanup = cleanup;

  const state = {
    overview: null,
    asyncMeta: deriveAsyncMeta(),
    nodeTypes: [],
    families: [],
    graphs: [],
    runs: [],
    models: [],
    selectedGraphId: "",
    selectedRunId: "",
    selectedGraph: null,
    selectedRun: null,
    polling: false,
  };

  function syncPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }

    if (!state.polling || controller.signal.aborted) return;

    pollTimer = setTimeout(async () => {
      if (controller.signal.aborted) return;
      try {
        await refreshAll({
          preserveGraphId: state.selectedGraphId,
          preserveRunId: state.selectedRunId,
          skipStatic: true,
        });
        render();
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        syncPolling();
      }
    }, 2000);
  }

  async function loadSelected(id, { idKey, itemKey, listKey, fetchFn }) {
    if (!id) {
      state[idKey] = "";
      state[itemKey] = null;
      return;
    }

    try {
      const item = await fetchFn(id);
      state[idKey] = item.id;
      state[itemKey] = item;
    } catch (error) {
      const fallbackId = state[listKey][0]?.id;
      if (fallbackId && fallbackId !== id) {
        const fallback = await fetchFn(fallbackId);
        state[idKey] = fallback.id;
        state[itemKey] = fallback;
        return;
      }
      throw error;
    }
  }

  function loadSelectedGraph(graphId) {
    return loadSelected(graphId, {
      idKey: "selectedGraphId",
      itemKey: "selectedGraph",
      listKey: "graphs",
      fetchFn: (id) => api.getNodeEngineGraph(id),
    });
  }

  function loadSelectedRun(runId) {
    return loadSelected(runId, {
      idKey: "selectedRunId",
      itemKey: "selectedRun",
      listKey: "runs",
      fetchFn: (id) => api.getNodeEngineRun(id),
    });
  }

  async function refreshAll({
    preserveGraphId = state.selectedGraphId || state.graphs[0]?.id || "",
    preserveRunId = state.selectedRunId || state.runs[0]?.id || "",
    skipStatic = false,
  } = {}) {
    const needsStatic = !skipStatic || !state.nodeTypes.length;
    const fetches = [api.getNodeEngineOverview()];
    if (needsStatic) fetches.push(api.getNodeEngineNodeTypes());
    const [overview, nodeTypesPayload] = await Promise.all(fetches);

    state.overview = overview || {};
    if (nodeTypesPayload) {
      state.nodeTypes = nodeTypesPayload.nodeTypes || overview.nodeTypes || [];
      state.families = overview.families || nodeTypesPayload.families || [];
    }
    state.graphs = overview.graphs || [];
    state.runs = overview.runs || [];
    state.models = overview.models || [];
    state.asyncMeta = deriveAsyncMeta(state.overview, state.runs);
    state.polling = state.asyncMeta.activeCount > 0;

    const nextGraphId = preserveGraphId || state.graphs[0]?.id || "";
    const nextRunId = preserveRunId || state.runs[0]?.id || "";
    await Promise.all([
      loadSelectedGraph(nextGraphId),
      loadSelectedRun(nextRunId),
    ]);
  }

  function render() {
    const graph = state.selectedGraph;
    const run = state.selectedRun;
    const progress = run ? `${getCompletedStepCount(run)}/${run.stepCount || 0}` : "—";

    container.innerHTML = `
      <div data-node-engine-root="1" class="stack">
        <div class="grid-cards">
          <article class="card">
            <p class="eyebrow">Node Engine</p>
            <h3>${state.graphs.length} graphes</h3>
            <p class="small">${state.runs.length} runs visibles · ${state.nodeTypes.length} node types</p>
          </article>
          <article class="card">
            <p class="eyebrow">Queue</p>
            <h3>${state.asyncMeta.queueDepth}</h3>
            <p class="small">${state.asyncMeta.queuedCount} queued · ${state.asyncMeta.runningCount} running · ${state.polling ? "polling actif" : "idle"}</p>
          </article>
          <article class="card">
            <p class="eyebrow">Workers</p>
            <h3>${state.asyncMeta.workerCount ?? "n/d"}</h3>
            <p class="small">${state.asyncMeta.busyWorkers ?? state.asyncMeta.runningCount} occupes · source ${escapeHtml(state.asyncMeta.source)}</p>
          </article>
          <article class="card">
            <p class="eyebrow">Concurrency</p>
            <h3>${state.asyncMeta.concurrency ?? "n/d"}</h3>
            <p class="small">${state.models.length} modeles traces · ${escapeHtml(state.overview?.storage?.rootDir || "data/node-engine")}</p>
          </article>
        </div>

        <section class="panel">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Workbench</p>
              <h3>Selection, save, run, cancel</h3>
            </div>
            ${state.polling ? renderStatusTag("polling_auto") : ""}
          </div>
          <div class="node-engine-toolbar">
            <label class="field">
              <span>Graphe</span>
              <select id="node-engine-graph-select">
                ${state.graphs.length ? renderGraphOptions(state.graphs, state.selectedGraphId) : '<option value="">Aucun graphe</option>'}
              </select>
            </label>
            <label class="field">
              <span>Run</span>
              <select id="node-engine-run-select">
                ${state.runs.length ? renderRunOptions(state.runs, state.selectedRunId) : '<option value="">Aucun run</option>'}
              </select>
            </label>
            <div class="actions-inline">
              <button type="button" class="secondary" data-action="refresh">Rafraichir</button>
              <button type="button" class="secondary" data-action="create-seed">Creer un seed</button>
              <button type="button" data-action="save-graph" ${graph ? "" : "disabled"}>Sauvegarder</button>
              <button type="button" data-action="run-selected" ${graph ? "" : "disabled"}>Executer</button>
              <button type="button" class="danger" data-action="cancel-selected-run" ${run && isCancelableStatus(run.status) ? "" : "disabled"}>Cancel run</button>
            </div>
          </div>
        </section>

        <div class="node-engine-layout">
          <div class="stack">
            <section class="panel">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">Graph Editor</p>
                  <h3>${escapeHtml(graph?.name || "Aucun graphe selectionne")}</h3>
                </div>
                ${graph ? `<div class="node-engine-meta">
                  <span class="tag">v${escapeHtml(graph.version)}</span>
                  ${renderStatusTag(graph.status || "draft")}
                  <span class="tag">${escapeHtml(graph.runtime || "local_cpu")}</span>
                </div>` : ""}
              </div>
              ${graph ? `
                <div class="node-engine-editor">
                  <div class="form-grid">
                    <label class="field">
                      <span>Nom</span>
                      <input data-graph-field="name" value="${escapeHtml(graph.name)}">
                    </label>
                    <label class="field">
                      <span>Runtime</span>
                      <input data-graph-field="runtime" value="${escapeHtml(graph.runtime)}">
                    </label>
                    <label class="field full">
                      <span>Description</span>
                      <textarea data-graph-field="description">${escapeHtml(graph.description || "")}</textarea>
                    </label>
                    <label class="field">
                      <span>Status</span>
                      <input data-graph-field="status" value="${escapeHtml(graph.status || "draft")}">
                    </label>
                    <label class="field">
                      <span>Tags CSV</span>
                      <input data-graph-field="tags" value="${escapeHtml((graph.tags || []).join(", "))}">
                    </label>
                  </div>
                  <div class="tag-list">
                    <span class="tag">id ${escapeHtml(graph.id)}</span>
                    <span class="tag">${graph.nodes.length} nodes</span>
                    <span class="tag">${graph.edges.length} edges</span>
                    <span class="tag">maj ${escapeHtml(formatTs(graph.updatedAt))}</span>
                  </div>
                  <div class="node-engine-json-grid">
                    <label class="field">
                      <span>Nodes JSON</span>
                      <textarea class="code-area" data-graph-field="nodes">${escapeHtml(prettyJson(graph.nodes))}</textarea>
                    </label>
                    <label class="field">
                      <span>Edges JSON</span>
                      <textarea class="code-area" data-graph-field="edges">${escapeHtml(prettyJson(graph.edges))}</textarea>
                    </label>
                  </div>
                </div>
              ` : '<div class="small">Charge ou cree un graphe pour ouvrir l editeur JSON minimal.</div>'}
            </section>

            <section class="panel">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">Run Inspector</p>
                  <h3>${escapeHtml(run?.graphName || "Aucun run selectionne")}</h3>
                </div>
                ${run ? renderStatusTag(run.status) : ""}
              </div>
              ${run ? `
                <div class="actions-inline">
                  <span class="tag">${escapeHtml(run.id)}</span>
                  <span class="tag">${escapeHtml(run.runtime || "local_cpu")}</span>
                  <span class="tag">${escapeHtml(run.actor || "admin")}</span>
                  <span class="tag">${progress} etapes</span>
                  ${isCancelableStatus(run.status)
                    ? `<button type="button" class="danger" data-action="cancel-run" data-run-id="${escapeHtml(run.id)}">Cancel</button>`
                    : ""}
                </div>
                <div class="small">${formatTs(run.startedAt)} → ${formatTs(run.finishedAt)}</div>
                <div class="small">Artifacts: ${escapeHtml(JSON.stringify(run.artifactSummary || {}, null, 0) || "{}")}</div>
                ${run.note ? `<div class="small">${escapeHtml(run.note)}</div>` : ""}
                <div class="node-engine-list">${renderRunSteps(run)}</div>
              ` : '<div class="small">Choisis un run pour inspecter ses etapes, son statut et ses artifacts.</div>'}
            </section>
          </div>

          <div class="stack">
            <section class="panel">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">Scheduler</p>
                  <h3>Queue, workers, concurrency</h3>
                </div>
              </div>
              <div class="tag-list">
                <span class="tag">queue ${state.asyncMeta.queueDepth}</span>
                <span class="tag">queued ${state.asyncMeta.queuedCount}</span>
                <span class="tag">running ${state.asyncMeta.runningCount}</span>
                <span class="tag">workers ${state.asyncMeta.workerCount ?? "n/d"}</span>
                <span class="tag">concurrency ${state.asyncMeta.concurrency ?? "n/d"}</span>
              </div>
              <div class="result-list">${renderWorkerList(state.asyncMeta)}</div>
            </section>

            <section class="panel">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">Catalogue</p>
                  <h3>Graphes disponibles</h3>
                </div>
              </div>
              <div class="table-like">${renderGraphRows(state.graphs, state.selectedGraphId)}</div>
            </section>

            <section class="panel">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">Runs</p>
                  <h3>Executions recentes</h3>
                </div>
              </div>
              <div class="table-like">${renderRunRows(state.runs, state.selectedRunId)}</div>
            </section>

            <section class="panel">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">Palette</p>
                  <h3>Families et node types</h3>
                </div>
              </div>
              <div class="node-engine-palette">${renderNodePalette(state.families, state.nodeTypes)}</div>
            </section>

            <section class="panel">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">Registry</p>
                  <h3>Modeles traces</h3>
                </div>
              </div>
              <div class="result-list">${renderModelList(state.models)}</div>
            </section>
          </div>
        </div>
      </div>
    `;
  }

  async function selectGraph(graphId) {
    await loadSelectedGraph(graphId);
    render();
  }

  async function selectRun(runId) {
    await loadSelectedRun(runId);
    render();
  }

  async function saveSelectedGraph() {
    if (!state.selectedGraphId || !state.selectedGraph) return;
    const payload = readGraphDraft(container, state.selectedGraph);
    setStatus(`Sauvegarde du graphe ${state.selectedGraphId}…`, "info");
    const result = await api.updateNodeEngineGraph(state.selectedGraphId, payload);
    await refreshAll({
      preserveGraphId: result.graph.id,
      preserveRunId: state.selectedRunId,
    });
    render();
    syncPolling();
    setStatus(`Graphe ${result.graph.name} sauvegarde.`, "ok");
  }

  async function runGraph(graphId) {
    const targetGraphId = graphId || state.selectedGraphId;
    if (!targetGraphId) return;

    setStatus(`Execution du graphe ${targetGraphId}…`, "info");
    const result = await api.runNodeEngineGraph(targetGraphId, {
      actor: "admin_ui",
    });
    const nextRunId = result?.run?.id || state.selectedRunId;
    await refreshAll({
      preserveGraphId: targetGraphId,
      preserveRunId: nextRunId,
    });
    render();
    syncPolling();

    const nextStatus = normalizeStatus(result?.run?.status);
    if (isPollableStatus(nextStatus)) {
      setStatus(`Run ${result.run.id} ${nextStatus}. Polling active.`, "info");
      return;
    }

    setStatus(
      `Run termine: ${result.run.id}`,
      nextStatus === "completed" ? "ok" : statusTone(nextStatus) === "off" ? "error" : "info"
    );
  }

  async function cancelRun(runId) {
    const targetRunId = runId || state.selectedRunId;
    if (!targetRunId) return;

    setStatus(`Annulation du run ${targetRunId}…`, "info");
    const result = await api.cancelNodeEngineRun(targetRunId, {
      actor: "admin_ui",
    });
    const nextRunId = result?.run?.id || targetRunId;
    await refreshAll({
      preserveGraphId: state.selectedGraphId,
      preserveRunId: nextRunId,
    });
    render();
    syncPolling();

    if (isCancelableStatus(state.selectedRun?.status)) {
      setStatus(`Annulation demandee pour ${targetRunId}.`, "info");
      return;
    }

    setStatus(`Run ${targetRunId} mis a jour apres annulation.`, "ok");
  }

  await refreshAll();
  render();
  syncPolling();
  observer.observe(container, { childList: true, subtree: true });

  container.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.id === "node-engine-graph-select") {
      try {
        setStatus("Chargement du graphe…", "info");
        await selectGraph(target.value);
        setStatus("Graphe charge.", "ok");
      } catch (error) {
        setStatus(error.message, "error");
      }
      return;
    }

    if (target.id === "node-engine-run-select") {
      try {
        setStatus("Chargement du run…", "info");
        await selectRun(target.value);
        setStatus("Run charge.", "ok");
      } catch (error) {
        setStatus(error.message, "error");
      }
    }
  }, { signal: controller.signal });

  container.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-action]");
    if (!button) return;

    try {
      switch (button.dataset.action) {
        case "refresh":
          setStatus("Rafraichissement Node Engine…", "info");
          await refreshAll({
            preserveGraphId: state.selectedGraphId,
            preserveRunId: state.selectedRunId,
          });
          render();
          syncPolling();
          setStatus("Node Engine rafraichi.", "ok");
          break;
        case "create-seed": {
          setStatus("Creation d'un graphe seed…", "info");
          const result = await api.createNodeEngineGraph(createSeedPayload());
          await refreshAll({
            preserveGraphId: result.graph.id,
            preserveRunId: state.selectedRunId,
          });
          render();
          syncPolling();
          setStatus(`Graphe cree: ${result.graph.name}`, "ok");
          break;
        }
        case "save-graph":
          await saveSelectedGraph();
          break;
        case "run-selected":
          await runGraph(state.selectedGraphId);
          break;
        case "select-graph":
          setStatus("Chargement du graphe…", "info");
          await selectGraph(button.dataset.graphId || "");
          setStatus("Graphe charge.", "ok");
          break;
        case "run-graph":
          await runGraph(button.dataset.graphId || "");
          break;
        case "select-run":
          setStatus("Chargement du run…", "info");
          await selectRun(button.dataset.runId || "");
          setStatus("Run charge.", "ok");
          break;
        case "cancel-selected-run":
          await cancelRun(state.selectedRunId);
          break;
        case "cancel-run":
          await cancelRun(button.dataset.runId || state.selectedRunId);
          break;
      }
    } catch (error) {
      setStatus(error.message, "error");
    }
  }, { signal: controller.signal });
}
