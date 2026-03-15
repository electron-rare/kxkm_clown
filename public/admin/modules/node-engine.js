function renderRuntimeTags(runtimes = []) {
  return runtimes.map((runtime) => `<span class="tag">${escapeHtml(runtime)}</span>`).join("");
}

function renderNodeFamilies(families = []) {
  return families.map((family) => `
    <article class="result-entry">
      <strong>${escapeHtml(family.title)}</strong>
      <pre>${escapeHtml(`${family.description}\n${family.count} node(s)`)}<\/pre>
    </article>
  `).join("");
}

function renderGraphs(graphs = []) {
  return graphs.map((graph) => `
    <div class="table-row">
      <div>
        <strong>${escapeHtml(graph.name)}</strong>
        <div class="small">${escapeHtml(graph.description || "Graphe sans description.")}</div>
      </div>
      <div class="small">${graph.nodeCount} nodes · ${graph.edgeCount} edges · v${graph.version}</div>
      <div class="actions-inline">
        <span class="tag">${escapeHtml(graph.runtime)}</span>
        <button type="button" data-action="run-graph" data-graph-id="${escapeHtml(graph.id)}">Exécuter</button>
      </div>
    </div>
  `).join("");
}

function renderRuns(runs = []) {
  return runs.map((run) => `
    <div class="table-row">
      <div>
        <strong>${escapeHtml(run.graphName)}</strong>
        <div class="small">${escapeHtml(run.id)} · ${escapeHtml(run.actor || "admin")}</div>
      </div>
      <div class="small">${run.stepCount} étapes · ${escapeHtml(run.runtime || "local_cpu")}</div>
      <span class="tag ${run.status === "completed" ? "ok" : ""}">${escapeHtml(run.status || "unknown")}</span>
    </div>
  `).join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function mountNodeEngine(container, { api, setStatus }) {
  const [overview, nodeTypesPayload] = await Promise.all([
    api.getNodeEngineOverview(),
    api.getNodeEngineNodeTypes(),
  ]);

  const families = overview.families || nodeTypesPayload.families || [];
  const graphs = overview.graphs || [];
  const runs = overview.runs || [];
  const runtimes = overview.runtimes || [];

  container.innerHTML = `
    <div class="stack">
      <div class="grid-cards">
        <article class="card">
          <p class="eyebrow">Node Engine</p>
          <h3>${graphs.length} graphes</h3>
          <p class="small">${runs.length} runs visibles · ${families.length} familles de nodes</p>
        </article>
        <article class="card">
          <p class="eyebrow">Runtimes</p>
          <h3>${runtimes.length} cibles</h3>
          <div class="tag-list">${renderRuntimeTags(runtimes)}</div>
        </article>
        <article class="card">
          <p class="eyebrow">Stockage</p>
          <h3>Local traçable</h3>
          <p class="small">${escapeHtml(overview.storage?.rootDir || "data/node-engine")}</p>
        </article>
      </div>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Graphes</p>
            <h3>Fondation V1</h3>
          </div>
          <button type="button" id="node-engine-create-seed">Créer un graphe seed</button>
        </div>
        <div class="table-like" id="node-engine-graphs">
          ${graphs.length ? renderGraphs(graphs) : '<div class="small">Aucun graphe disponible.</div>'}
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Runs</p>
            <h3>Exécutions récentes</h3>
          </div>
        </div>
        <div class="table-like" id="node-engine-runs">
          ${runs.length ? renderRuns(runs) : '<div class="small">Aucun run enregistré.</div>'}
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Node Families</p>
            <h3>Palette initiale</h3>
          </div>
        </div>
        <div class="result-list">
          ${renderNodeFamilies(families)}
        </div>
      </section>
    </div>
  `;

  const refresh = async () => {
    const nextOverview = await api.getNodeEngineOverview();
    const graphRoot = container.querySelector("#node-engine-graphs");
    const runsRoot = container.querySelector("#node-engine-runs");
    if (graphRoot) {
      graphRoot.innerHTML = nextOverview.graphs?.length
        ? renderGraphs(nextOverview.graphs)
        : '<div class="small">Aucun graphe disponible.</div>';
    }
    if (runsRoot) {
      runsRoot.innerHTML = nextOverview.runs?.length
        ? renderRuns(nextOverview.runs)
        : '<div class="small">Aucun run enregistré.</div>';
    }
  };

  container.querySelector("#node-engine-create-seed")?.addEventListener("click", async () => {
    setStatus("Création d'un graphe Node Engine…", "info");
    try {
      const result = await api.createNodeEngineGraph({
        name: `Node Engine Graph ${new Date().toISOString().slice(11, 19)}`,
        description: "Graphe de démonstration pour tester le runner nodal.",
        runtime: "local_gpu",
        status: "draft",
        tags: ["manual", "node-engine"],
        nodes: [
          { id: "source", type: "dataset_file", title: "Dataset File", params: { path: "data/example.jsonl" }, runtime: "local_cpu" },
          { id: "format", type: "format_instruction_dataset", title: "Instruction Dataset", params: { mode: "chat" }, runtime: "local_cpu" },
          { id: "train", type: "lora_training", title: "LoRA Training", params: { baseModel: "mistral:7b" }, runtime: "local_gpu" },
        ],
        edges: [
          { from: { node: "source", output: "dataset" }, to: { node: "format", input: "dataset" } },
          { from: { node: "format", output: "dataset_ready" }, to: { node: "train", input: "dataset_ready" } },
        ],
      });
      setStatus(`Graphe créé: ${result.graph.name}`, "ok");
      await refresh();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  container.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action='run-graph']");
    if (!button) return;
    const graphId = button.dataset.graphId;
    setStatus(`Exécution du graphe ${graphId}…`, "info");
    try {
      const result = await api.runNodeEngineGraph(graphId, { actor: "admin_ui" });
      setStatus(`Run terminé: ${result.run.id}`, "ok");
      await refresh();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}
