import { useState, useEffect } from "react";
import { api, type SessionData, type UserRole } from "../api";

interface AdminPageProps {
  session: SessionData | null;
  onLogin: (session: SessionData) => void;
  onNavigate: (page: string, id?: string) => void;
}

/**
 * Admin page — authentication + admin dashboard
 * Accessible via "Connexion" in Sommaire menu.
 * Provides Node Engine, Training, Stats access after auth.
 */
export default function AdminPage({ session, onLogin, onNavigate }: AdminPageProps) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<{
    personas?: number;
    graphs?: number;
    runs?: { queued: number; running: number };
    workers?: { active: number; desired: number };
  } | null>(null);

  // If already authenticated, show admin dashboard
  const isAdmin = session && (session.role === "admin" || session.role === "operator");

  useEffect(() => {
    if (isAdmin) {
      loadStats();
    }
  }, [isAdmin]);

  async function loadStats() {
    try {
      const personas = await api.listPersonas();
      const overview = await api.getOverview();
      setStats({
        personas: personas.length,
        graphs: overview.registry?.graphs || 0,
        runs: {
          queued: overview.queue?.queuedRuns || 0,
          running: overview.queue?.runningRuns || 0,
        },
        workers: {
          active: overview.queue?.activeWorkers || 0,
          desired: overview.queue?.desiredWorkers || 0,
        },
      });
    } catch { /* non-blocking */ }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    setError("");
    try {
      const s = await api.login(username.trim(), "admin" as UserRole);
      onLogin(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentification echouee");
    } finally {
      setLoading(false);
    }
  }

  // Not authenticated — show login form
  if (!isAdmin) {
    return (
      <div className="admin-page">
        <div className="compose-header">{">>> ADMINISTRATION <<<"}</div>
        <div className="compose-subtitle">Acces reserve aux operateurs et administrateurs</div>

        <form onSubmit={handleLogin} className="admin-login-form">
          <div className="minitel-field">
            <label>Identifiant admin _</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="minitel-input"
              placeholder="admin"
              autoFocus
            />
          </div>
          <button type="submit" className="minitel-login-btn" disabled={loading || !username.trim()}>
            {loading ? "Authentification..." : ">>> Connexion admin <<<"}
          </button>
        </form>
        {error && <div className="minitel-login-error">ERREUR: {error}</div>}
      </div>
    );
  }

  // Authenticated — admin dashboard
  return (
    <div className="admin-page">
      <div className="compose-header">{">>> ADMINISTRATION <<<"}</div>
      <div className="admin-user">
        {session!.username} [{session!.role}]
      </div>

      <div className="admin-grid">
        <button className="admin-card" onClick={() => onNavigate("personas")}>
          <div className="admin-card-title">Personas</div>
          <div className="admin-card-value">{stats?.personas ?? "..."}</div>
        </button>
        <button className="admin-card" onClick={() => onNavigate("node-engine")}>
          <div className="admin-card-title">Graphes</div>
          <div className="admin-card-value">{stats?.graphs ?? "..."}</div>
        </button>
        <button className="admin-card" onClick={() => onNavigate("training")}>
          <div className="admin-card-title">Training</div>
          <div className="admin-card-value">
            {stats?.workers ? `${stats.workers.active}/${stats.workers.desired}` : "..."}
          </div>
        </button>
        <button className="admin-card" onClick={() => onNavigate("analytics")}>
          <div className="admin-card-title">Stats</div>
          <div className="admin-card-value">→</div>
        </button>
      </div>

      {stats?.runs && (
        <div className="admin-runs">
          <div className="admin-runs-title">File d'attente</div>
          <div className="admin-runs-row">
            <span>En file:</span>
            <span className={stats.runs.queued > 0 ? "admin-count-active" : ""}>
              {stats.runs.queued}
            </span>
          </div>
          <div className="admin-runs-row">
            <span>En cours:</span>
            <span className={stats.runs.running > 0 ? "admin-count-active" : ""}>
              {stats.runs.running}
            </span>
          </div>
        </div>
      )}

      <div className="admin-actions">
        <div className="admin-actions-title">Actions rapides</div>
        <button className="minitel-nav-btn" onClick={() => onNavigate("node-engine")}>
          Node Engine
        </button>
        <button className="minitel-nav-btn" onClick={() => onNavigate("training")}>
          Training Dashboard
        </button>
        <button className="minitel-nav-btn" onClick={() => onNavigate("analytics")}>
          Statistiques
        </button>
        <button className="minitel-nav-btn" onClick={() => onNavigate("history")}>
          Historique chat
        </button>
        <button className="minitel-nav-btn" onClick={() => onNavigate("channels")}>
          Canaux
        </button>
      </div>
    </div>
  );
}
