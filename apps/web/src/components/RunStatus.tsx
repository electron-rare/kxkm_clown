import { useEffect, useState } from "react";
import { getRunStatusClass } from "@kxkm/ui";
import { api, type NodeRunRecord } from "../api";
import { VideotexSeparator } from "./VideotexMosaic";

type RunStatusValue = NodeRunRecord["status"];

const TERMINAL_STATUSES: RunStatusValue[] = ["completed", "failed", "cancelled", "not_configured", "blocked"];

function isTerminalStatus(status: RunStatusValue): boolean {
  return TERMINAL_STATUSES.includes(status);
}

interface RunStatusProps {
  runId: string;
  onBack: () => void;
}

export default function RunStatus({ runId, onBack }: RunStatusProps) {
  const [run, setRun] = useState<NodeRunRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    loadRun();
  }, [runId]);

  useEffect(() => {
    if (!run) return;
    if (isTerminalStatus(run.status)) return;

    const interval = setInterval(async () => {
      try {
        const updated = await api.getRun(runId);
        setRun(updated);
        if (isTerminalStatus(updated.status)) {
          clearInterval(interval);
        }
      } catch {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [run?.status, runId]);

  async function loadRun() {
    setLoading(true);
    try {
      const r = await api.getRun(runId);
      setRun(r);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      const updated = await api.cancelRun(runId);
      setRun(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "cancel_failed");
    } finally {
      setCancelling(false);
    }
  }

  if (loading) return <div className="muted">Chargement du run...</div>;
  if (error && !run) return <div className="banner">{error}</div>;
  if (!run) return <div className="banner">Run introuvable.</div>;

  const isTerminal = isTerminalStatus(run.status);

  return (
    <div>
      <div className="page-header">
        <button className="btn btn-secondary" onClick={onBack}>Retour</button>
        <h2>Run {run.id.slice(0, 12)}...</h2>
      </div>

      {error && <div className="banner">{error}</div>}

      <VideotexSeparator color="amber" />
      <div className="panel">
        <p className="eyebrow">Statut du run</p>

        <div className="run-detail">
          <div className="detail-row">
            <span className="detail-label">ID</span>
            <code>{run.id}</code>
          </div>
          <div className="detail-row">
            <span className="detail-label">Graphe</span>
            <code>{run.graphId}</code>
          </div>
          <div className="detail-row">
            <span className="detail-label">Statut</span>
            <span className={`status-badge ${getRunStatusClass(run.status)}`}>{run.status}</span>
          </div>

          <div className="run-progress">
            <div className="progress-steps">
              <div className={`progress-step ${run.status === "queued" ? "step-active" : "step-done"}`}>
                En file
              </div>
              <div className={`progress-step ${run.status === "running" ? "step-active" : run.status === "completed" ? "step-done" : ""}`}>
                Execution
              </div>
              <div className={`progress-step ${isTerminal ? (run.status === "completed" ? "step-done" : "step-failed") : ""}`}>
                {run.status === "cancelled" ? "Annule" : run.status === "failed" ? "Echec" : "Termine"}
              </div>
            </div>
          </div>

          {!isTerminal && (
            <button
              className="btn btn-danger"
              onClick={handleCancel}
              disabled={cancelling}
              style={{ marginTop: 16 }}
            >
              {cancelling ? "Annulation..." : "Annuler le run"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
