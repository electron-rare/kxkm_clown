import { useEffect, useState } from "react";
import { api, type OverviewData, type NodeGraphRecord } from "../api";

interface NodeEngineOverviewProps {
  onSelectGraph: (id: string) => void;
}

export default function NodeEngineOverview({ onSelectGraph }: NodeEngineOverviewProps) {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [graphs, setGraphs] = useState<NodeGraphRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newGraphName, setNewGraphName] = useState("");
  const [newGraphDesc, setNewGraphDesc] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [ov, gr] = await Promise.all([
        api.getOverview(),
        api.listGraphs(),
      ]);
      setOverview(ov);
      setGraphs(gr);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGraph() {
    if (!newGraphName.trim()) return;
    setCreating(true);
    try {
      const graph = await api.createGraph(newGraphName, newGraphDesc);
      setGraphs((prev) => [...prev, graph]);
      setNewGraphName("");
      setNewGraphDesc("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "create_failed");
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="muted">Chargement du Node Engine...</div>;
  if (error && !overview) return <div className="banner">{error}</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Node Engine</h2>
        <button className="btn btn-secondary" onClick={loadAll}>Rafraichir</button>
      </div>

      {error && <div className="banner">{error}</div>}

      {overview && (
        <div className="status-strip">
          <div className="status-card">
            <span>Workers</span>
            <strong>{overview.queue.activeWorkers}/{overview.queue.desiredWorkers}</strong>
          </div>
          <div className="status-card">
            <span>En file</span>
            <strong className={overview.queue.queuedRuns > 0 ? "status-queued" : ""}>
              {overview.queue.queuedRuns}
            </strong>
          </div>
          <div className="status-card">
            <span>En cours</span>
            <strong className={overview.queue.runningRuns > 0 ? "status-running" : ""}>
              {overview.queue.runningRuns}
            </strong>
          </div>
          <div className="status-card">
            <span>Modeles</span>
            <strong>{overview.registry.models}</strong>
          </div>
          <div className="status-card">
            <span>Graphes</span>
            <strong>{overview.registry.graphs}</strong>
          </div>
        </div>
      )}

      <section className="panel" style={{ marginBottom: 16 }}>
        <p className="eyebrow">Nouveau graphe</p>
        <div className="inline-form">
          <input
            placeholder="Nom du graphe"
            value={newGraphName}
            onChange={(e) => setNewGraphName(e.target.value)}
          />
          <input
            placeholder="Description"
            value={newGraphDesc}
            onChange={(e) => setNewGraphDesc(e.target.value)}
          />
          <button
            className="btn btn-primary"
            onClick={handleCreateGraph}
            disabled={creating || !newGraphName.trim()}
          >
            {creating ? "Creation..." : "Creer"}
          </button>
        </div>
      </section>

      <section>
        <p className="eyebrow">Graphes disponibles</p>
        <div className="card-grid">
          {graphs.map((graph) => (
            <div
              key={graph.id}
              className="card"
              onClick={() => onSelectGraph(graph.id)}
            >
              <strong>{graph.name || graph.id}</strong>
              <p className="card-desc">{graph.description || "Aucune description"}</p>
            </div>
          ))}
        </div>
        {graphs.length === 0 && <p className="muted">Aucun graphe configure.</p>}
      </section>
    </div>
  );
}
