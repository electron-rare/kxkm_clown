import { useEffect, useState, useCallback } from "react";
import { api, type SessionData, type UserRole } from "./api";
import Login from "./components/Login";
import MinitelFrame from "./components/MinitelFrame";
import MinitelConnect from "./components/MinitelConnect";
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
import Analytics from "./components/Analytics";
import Collectif from "./components/Collectif";
import UllaPage from "./components/UllaPage";
import ComposePage from "./components/ComposePage";
import ImaginePage from "./components/ImaginePage";
import AdminPage from "./components/AdminPage";
import ErrorBoundary from "./components/ErrorBoundary";

function parseHash(): { page: string; id: string } {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash) return { page: "chat", id: "" };
  const parts = hash.split("/");
  const page = parts[0] || "chat";
  const id = parts.slice(1).join("/");
  return { page, id };
}

function setHash(page: string, id?: string) {
  const hash = id ? `${page}/${id}` : page;
  window.location.hash = hash;
}

// ---------------------------------------------------------------------------
// App state phases:
//   1. "connecting" — modem animation (3615 ULLA → 3615 KXKM)
//   2. "login"      — pseudo + email + password
//   3. "ready"      — main app (chat, personas, etc.)
// ---------------------------------------------------------------------------

export default function App() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [nick, setNick] = useState<string | null>(() => {
    return typeof sessionStorage !== "undefined" ? sessionStorage.getItem("kxkm-nick") : null;
  });
  const [error, setError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [route, setRoute] = useState(parseHash);

  // Phase: skip connection animation if already logged in
  const [phase, setPhase] = useState<"connecting" | "login" | "ready">(
    nick ? "ready" : "connecting"
  );

  useEffect(() => {
    function onHashChange() { setRoute(parseHash()); }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    api.getSession()
      .then((s) => { setSession(s); if (s && nick) setPhase("ready"); })
      .catch(() => setSession(null))
      .finally(() => setCheckingSession(false));
  }, [nick]);

  const navigate = useCallback((page: string, id?: string) => {
    setHash(page, id);
  }, []);

  // Login handler: stores nick + optional credentials
  function handleLogin(username: string, email?: string, password?: string) {
    setNick(username);
    sessionStorage.setItem("kxkm-nick", username);
    if (email) sessionStorage.setItem("kxkm-email", email);

    // Try API login for admin features (non-blocking)
    if (password) {
      api.login(username, "viewer" as UserRole)
        .then((s) => setSession(s))
        .catch(() => {}); // Non-blocking — chat works without session
    }

    setPhase("ready");
    navigate("chat");
  }

  function handleLogout() {
    api.logout().catch(() => {});
    setSession(null);
    setNick(null);
    sessionStorage.removeItem("kxkm-nick");
    sessionStorage.removeItem("kxkm-email");
    setPhase("connecting");
    setError("");
  }

  // Phase 1: Modem connection animation (ULLA → KXKM)
  if (phase === "connecting") {
    return (
      <MinitelFrame connected={false}>
        <MinitelConnect onComplete={() => setPhase("login")} />
      </MinitelFrame>
    );
  }

  // Phase 2: Login / register
  if (phase === "login" || !nick) {
    return (
      <MinitelFrame connected={false}>
        <Login onLogin={handleLogin} error={error} />
      </MinitelFrame>
    );
  }

  // Phase 3: Main app
  function renderPage() {
    const { page, id } = route;

    switch (page) {
      case "personas":
        return <PersonaList onSelect={(pid) => navigate("persona", pid)} />;

      case "persona":
        if (!id) return <PersonaList onSelect={(pid) => navigate("persona", pid)} />;
        return <PersonaDetail personaId={id} onBack={() => navigate("personas")} />;

      case "node-engine":
        return <NodeEngineOverview onSelectGraph={(gid) => navigate("graph", gid)} />;

      case "editor":
        if (!id) return <NodeEngineOverview onSelectGraph={(gid) => navigate("graph", gid)} />;
        return <NodeEditor graphId={id} onBack={() => navigate("graph", id)} />;

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
        return <RunStatus runId={id} onBack={() => navigate("node-engine")} />;

      case "training":
        return <TrainingDashboard />;

      case "channels":
        return <ChannelList />;

      case "voice":
        return <VoiceChat />;

      case "history":
        return <ChatHistory />;

      case "collectif":
        return <Collectif onNavigate={navigate} />;

      case "analytics":
        return <Analytics />;

      case "ulla":
        return <UllaPage onBack={() => navigate("chat")} />;

      case "admin":
        return (
          <AdminPage
            session={session}
            onLogin={(s) => setSession(s)}
            onNavigate={navigate}
          />
        );

      case "dashboard":
        return <Dashboard session={session!} onNavigate={navigate} />;

      case "compose-mode":
        return <ComposePage />;

      case "imagine-mode":
        return <ImaginePage />;

      case "chat":
      default:
        return <Chat />;
    }
  }

  return (
    <MinitelFrame
      connected={true}
      currentPage={route.page}
      session={session ? session : { username: nick, role: "viewer" }}
      onNavigate={navigate}
      onLogout={handleLogout}
    >
      {error && <div className="minitel-error">ERREUR: {error}</div>}
      <ErrorBoundary>
        {renderPage()}
      </ErrorBoundary>
    </MinitelFrame>
  );
}

// Dashboard component
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
    if (session?.role === "admin" || session?.role === "operator") {
      api.getOverview().then(setOverview).catch(() => null);
    }
  }, [session?.role]);

  return (
    <div className="minitel-dashboard">
      <div className="minitel-dash-title">{">>> TABLEAU DE BORD <<<"}</div>
      <div className="minitel-dash-user">
        {session?.username || "anonyme"} [{session?.role || "viewer"}]
      </div>
      <div className="minitel-dash-grid">
        <button className="minitel-dash-card" onClick={() => onNavigate("personas")}>
          Personas: {personaCount !== null ? personaCount : "..."}
        </button>
        <button className="minitel-dash-card" onClick={() => onNavigate("channels")}>
          Canaux
        </button>
        <button className="minitel-dash-card" onClick={() => onNavigate("chat")}>
          Chat
        </button>
        <button className="minitel-dash-card" onClick={() => onNavigate("voice")}>
          Vocal
        </button>
        {overview && (
          <>
            <button className="minitel-dash-card" onClick={() => onNavigate("node-engine")}>
              Graphes: {overview.registry.graphs}
            </button>
            <button className="minitel-dash-card" onClick={() => onNavigate("training")}>
              Workers: {overview.queue.activeWorkers}/{overview.queue.desiredWorkers}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
