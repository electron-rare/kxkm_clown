import { useEffect, useState } from "react";
import { getRunStatusClass } from "@kxkm/ui";
import { api, type NodeRunRecord } from "../api";
import { VideotexPageHeader, VideotexSeparator } from "./VideotexMosaic";

const BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:4180";

// Training-related graph keywords to filter runs
const TRAINING_KEYWORDS = ["train", "lora", "qlora", "dpo", "sft", "finetune", "fine-tune"];

function isTrainingRun(run: NodeRunRecord): boolean {
  const gid = (run.graphId || "").toLowerCase();
  return TRAINING_KEYWORDS.some((kw) => gid.includes(kw));
}

function truncateId(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) + "..." : id;
}

function formatDuration(start: string, end?: string): string {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diff = Math.max(0, e - s);
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TrainingDashboard() {
  const [runs, setRuns] = useState<NodeRunRecord[]>([]);
  const [dpoCount, setDpoCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [allRuns, dpoStats] = await Promise.all([
        api.getTrainingRuns().catch(() => [] as NodeRunRecord[]),
        api.getDPOStats(),
      ]);
      // Filter training-related runs; if none match keywords, show all runs
      const trainingRuns = allRuns.filter(isTrainingRun);
      setRuns(trainingRuns.length > 0 ? trainingRuns : allRuns);
      setDpoCount(dpoStats.count);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }

  const completedRuns = runs.filter((r) => r.status === "completed");
  const failedRuns = runs.filter((r) => r.status === "failed");
  const runningRuns = runs.filter((r) => r.status === "running");
  const queuedRuns = runs.filter((r) => r.status === "queued");

  const lastCompleted = completedRuns.length > 0
    ? completedRuns.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : null;

  if (loading) return <div className="muted">Chargement du Training Dashboard...</div>;
  if (error && runs.length === 0) return <div className="banner">{error}</div>;

  return (
    <div>
      <VideotexPageHeader title="TRAINING" subtitle="Fine-tuning & DPO" color="pink" />
      <div className="page-header">
        <button className="btn btn-secondary" onClick={loadData}>Rafraichir</button>
      </div>

      {error && <div className="banner">{error}</div>}

      {/* Section 1: Overview Cards */}
      <div className="status-strip">
        <div className="status-card">
          <span>Total runs</span>
          <strong>{runs.length}</strong>
        </div>
        <div className="status-card">
          <span>Completed</span>
          <strong className={getRunStatusClass("completed")}>{completedRuns.length}</strong>
        </div>
        <div className="status-card">
          <span>Failed</span>
          <strong className={failedRuns.length > 0 ? getRunStatusClass("failed") : ""}>
            {failedRuns.length}
          </strong>
        </div>
        <div className="status-card">
          <span>Running</span>
          <strong className={runningRuns.length > 0 ? getRunStatusClass("running") : ""}>
            {runningRuns.length}
          </strong>
        </div>
        <div className="status-card">
          <span>Queued</span>
          <strong className={queuedRuns.length > 0 ? getRunStatusClass("queued") : ""}>
            {queuedRuns.length}
          </strong>
        </div>
        <div className="status-card">
          <span>DPO pairs</span>
          <strong>{dpoCount}</strong>
        </div>
        <div className="status-card">
          <span>Dernier training</span>
          <strong style={{ fontSize: "0.85em" }}>
            {lastCompleted ? formatDate(lastCompleted.createdAt) : "---"}
          </strong>
        </div>
      </div>

      {/* Section 2: Training Runs Table */}
      <VideotexSeparator color="green" />
      <section className="panel" style={{ marginTop: 16 }}>
        <p className="eyebrow">Historique des runs</p>
        {runs.length === 0 ? (
          <p className="muted">Aucun run de training trouve.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="run-table" style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: "0.85em" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border, #333)", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Run ID</th>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                  <th style={{ padding: "6px 8px" }}>Graph</th>
                  <th style={{ padding: "6px 8px" }}>Duration</th>
                  <th style={{ padding: "6px 8px" }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {runs
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .slice(0, 50)
                  .map((run) => (
                    <tr key={run.id} style={{ borderBottom: "1px solid var(--border, #222)" }}>
                      <td style={{ padding: "4px 8px" }} title={run.id}>
                        {truncateId(run.id)}
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <span className={getRunStatusClass(run.status)}>{run.status}</span>
                      </td>
                      <td style={{ padding: "4px 8px" }} title={run.graphId}>
                        {truncateId(run.graphId, 16)}
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        {formatDuration(run.createdAt)}
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        {formatDate(run.createdAt)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 3: Quick Actions */}
      <section className="panel" style={{ marginTop: 16 }}>
        <p className="eyebrow">Actions rapides</p>
        <div className="inline-form">
          <a
            className="btn btn-primary"
            href={`${BASE}/api/v2/export/dpo`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Exporter DPO
          </a>
          <button
            className="btn btn-secondary"
            disabled
            title="Utilisez le Node Engine pour lancer un training"
          >
            Lancer Training
          </button>
        </div>
      </section>
    </div>
  );
}
