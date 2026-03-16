import { useEffect, useState, useCallback } from "react";
import { api, type SessionData, type UserRole } from "./api";
import Header from "./components/Header";
import Login from "./components/Login";
import Nav from "./components/Nav";
import PersonaList from "./components/PersonaList";
import PersonaDetail from "./components/PersonaDetail";
import NodeEngineOverview from "./components/NodeEngineOverview";
import GraphDetail from "./components/GraphDetail";
import RunStatus from "./components/RunStatus";
import ChannelList from "./components/ChannelList";
import Chat from "./components/Chat";
import VoiceChat from "./components/VoiceChat";
import ChatHistory from "./components/ChatHistory";
import NodeEditor from "./components/NodeEditor";
import TrainingDashboard from "./components/TrainingDashboard";

function parseHash(): { page: string; id: string } {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash) return { page: "dashboard", id: "" };
  const parts = hash.split("/");
  const page = parts[0] || "dashboard";
  const id = parts.slice(1).join("/");
  return { page, id };
}

function setHash(page: string, id?: string) {
  const hash = id ? `${page}/${id}` : page;
  window.location.hash = hash;
}

export default function App() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [error, setError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [route, setRoute] = useState(parseHash);

  // Listen for hash changes
  useEffect(() => {
    function onHashChange() {
      setRoute(parseHash());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Check existing session on mount
  useEffect(() => {
    api
      .getSession()
      .then((s) => setSession(s))
      .catch(() => setSession(null))
      .finally(() => setCheckingSession(false));
  }, []);

  const navigate = useCallback((page: string, id?: string) => {
    setHash(page, id);
  }, []);

  async function handleLogin(username: string, role: UserRole) {
    try {
      const s = await api.login(username, role);
      setSession(s);
      setError("");
      navigate("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "login_failed");
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setSession(null);
    setError("");
    navigate("login");
  }

  if (checkingSession) {
    return (
      <div className="shell">
        <div className="muted" style={{ padding: 40, textAlign: "center" }}>
          Verification de session...
        </div>
      </div>
    );
  }

  // Not logged in: show login
  if (!session) {
    return (
      <div className="shell">
        <Header session={null} onLogout={handleLogout} onNavigate={navigate} />
        <Login onLogin={handleLogin} error={error} />
      </div>
    );
  }

  // Render current page
  function renderPage() {
    const { page, id } = route;

    switch (page) {
      case "personas":
        return <PersonaList onSelect={(pid) => navigate("persona", pid)} />;

      case "persona":
        if (!id) return <PersonaList onSelect={(pid) => navigate("persona", pid)} />;
        return (
          <PersonaDetail
            personaId={id}
            onBack={() => navigate("personas")}
          />
        );

      case "node-engine":
        return (
          <NodeEngineOverview
            onSelectGraph={(gid) => navigate("graph", gid)}
          />
        );

      case "editor":
        if (!id) return <NodeEngineOverview onSelectGraph={(gid) => navigate("graph", gid)} />;
        return (
          <NodeEditor
            graphId={id}
            onBack={() => navigate("graph", id)}
          />
        );

      case "graph":
        if (!id) return <NodeEngineOverview onSelectGraph={(gid) => navigate("graph", gid)} />;
        return (
          <GraphDetail
            graphId={id}
            onBack={() => navigate("node-engine")}
            onSelectRun={(rid) => navigate("run", rid)}
            onOpenEditor={(gid) => navigate("editor", gid)}
          />
        );

      case "run":
        if (!id) return <NodeEngineOverview onSelectGraph={(gid) => navigate("graph", gid)} />;
        return (
          <RunStatus
            runId={id}
            onBack={() => navigate("node-engine")}
          />
        );

      case "training":
        return <TrainingDashboard />;

      case "channels":
        return <ChannelList />;

      case "chat":
        return <Chat />;

      case "voice":
        return <VoiceChat />;

      case "history":
        return <ChatHistory />;

      case "dashboard":
      default:
        return <Dashboard session={session!} onNavigate={navigate} />;
    }
  }

  return (
    <div className="shell">
      <Header session={session} onLogout={handleLogout} onNavigate={navigate} />
      <div className="app-layout">
        <Nav currentPage={route.page} session={session} onNavigate={navigate} />
        <main className="app-main">
          {error && <div className="banner">{error}</div>}
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

// Dashboard component inline — shows overview cards
function Dashboard({
  session,
  onNavigate,
}: {
  session: SessionData;
  onNavigate: (page: string) => void;
}) {
  const [personaCount, setPersonaCount] = useState<number | null>(null);
  const [overview, setOverview] = useState<{
    queue: { activeWorkers: number; desiredWorkers: number; queuedRuns: number; runningRuns: number };
    registry: { graphs: number; models: number };
  } | null>(null);

  useEffect(() => {
    api.listPersonas().then((p) => setPersonaCount(p.length)).catch(() => null);
    if (session.role === "admin" || session.role === "operator") {
      api.getOverview().then(setOverview).catch(() => null);
    }
  }, [session.role]);

  return (
    <div>
      <h2>Tableau de bord</h2>
      <p className="lead">
        Bienvenue, <strong>{session.username}</strong>. Role: <span className="role-tag">{session.role}</span>
      </p>

      <div className="status-strip">
        <div className="status-card clickable" onClick={() => onNavigate("personas")}>
          <span>Personas</span>
          <strong>{personaCount !== null ? personaCount : "..."}</strong>
        </div>
        <div className="status-card clickable" onClick={() => onNavigate("channels")}>
          <span>Chat</span>
          <strong>Canaux</strong>
        </div>
        {overview && (
          <>
            <div className="status-card clickable" onClick={() => onNavigate("node-engine")}>
              <span>Graphes</span>
              <strong>{overview.registry.graphs}</strong>
            </div>
            <div className="status-card">
              <span>Workers</span>
              <strong>{overview.queue.activeWorkers}/{overview.queue.desiredWorkers}</strong>
            </div>
            <div className="status-card">
              <span>Runs en file</span>
              <strong className={overview.queue.queuedRuns > 0 ? "status-queued" : ""}>
                {overview.queue.queuedRuns}
              </strong>
            </div>
            <div className="status-card">
              <span>Runs en cours</span>
              <strong className={overview.queue.runningRuns > 0 ? "status-running" : ""}>
                {overview.queue.runningRuns}
              </strong>
            </div>
          </>
        )}
      </div>

      {!overview && (session.role === "admin" || session.role === "operator") && (
        <p className="muted">Chargement des donnees Node Engine...</p>
      )}
      {session.role !== "admin" && session.role !== "operator" && (
        <p className="muted">Node Engine visible uniquement pour admin/operator.</p>
      )}
    </div>
  );
}
