import { useEffect, useState } from "react";
import { api, type NodeGraphRecord, type NodeRunRecord } from "../api";

interface GraphDetailProps {
  graphId: string;
  onBack: () => void;
  onSelectRun: (id: string) => void;
  onOpenEditor?: (id: string) => void;
}

export default function GraphDetail({ graphId, onBack, onSelectRun, onOpenEditor }: GraphDetailProps) {
  const [graph, setGraph] = useState<NodeGraphRecord | null>(null);
  const [runs, setRuns] = useState<NodeRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    loadGraph();
  }, [graphId]);

  async function loadGraph() {
    setLoading(true);
    try {
      const graphs = await api.listGraphs();
      const found = graphs.find((g) => g.id === graphId);
      if (!found) throw new Error("graph_not_found");
      setGraph(found);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleStartRun() {
    setStarting(true);
    try {
      const run = await api.startRun(graphId);
      setRuns((prev) => [run, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "run_failed");
    } finally {
      setStarting(false);
    }
  }

  if (loading) return <div className="muted">Chargement du graphe...</div>;
  if (error && !graph) return <div className="banner">{error}</div>;
  if (!graph) return <div className="banner">Graphe introuvable.</div>;

  return (
    <div>
      <div className="page-header">
        <button className="btn btn-secondary" onClick={onBack}>Retour</button>
        <h2>{graph.name || graph.id}</h2>
      </div>

      {error && <div className="banner">{error}</div>}

      <div className="detail-grid">
        <section className="panel">
          <p className="eyebrow">Informations</p>
          <div className="detail-row">
            <span className="detail-label">ID</span>
            <code>{graph.id}</code>
          </div>
          <div className="detail-row">
            <span className="detail-label">Description</span>
            <span>{graph.description || "Aucune"}</span>
          </div>

          {graph.nodes && graph.nodes.length > 0 && (
            <>
              <p className="eyebrow" style={{ marginTop: 16 }}>Noeuds ({graph.nodes.length})</p>
              <ul className="node-list">
                {graph.nodes.map((node) => (
                  <li key={node.id}>
                    <code>{node.id}</code> <span className="model-tag">{node.type}</span>
                    {node.label && <span> - {node.label}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {graph.edges && graph.edges.length > 0 && (
            <>
              <p className="eyebrow" style={{ marginTop: 16 }}>Aretes ({graph.edges.length})</p>
              <ul className="node-list">
                {graph.edges.map((edge, i) => (
                  <li key={i}>
                    <code>{edge.from.node}:{edge.from.output}</code> → <code>{edge.to.node}:{edge.to.input}</code>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            {onOpenEditor && (
              <button
                className="btn btn-secondary"
                onClick={() => onOpenEditor(graphId)}
              >
                Editeur visuel
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={handleStartRun}
              disabled={starting}
            >
              {starting ? "Lancement..." : "Lancer un run"}
            </button>
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Runs recents</p>
          {runs.length > 0 ? (
            <ul className="run-list">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="run-item"
                  onClick={() => onSelectRun(run.id)}
                >
                  <code>{run.id.slice(0, 12)}...</code>
                  <span className={`status-badge status-${run.status}`}>
                    {run.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Aucun run pour ce graphe.</p>
          )}
        </section>
      </div>
    </div>
  );
}
