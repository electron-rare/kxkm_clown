import { useState, useEffect, lazy, Suspense } from "react";
import { api, type SessionData, type UserRole } from "./api";
import Login from "./components/Login";
import MinitelFrame from "./components/MinitelFrame";
import MinitelConnect from "./components/MinitelConnect";
import Chat from "./components/Chat";
import ErrorBoundary from "./components/ErrorBoundary";
import { useAppSession } from "./hooks/useAppSession";
import { useHashRoute } from "./hooks/useHashRoute";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

// Lazy-load heavy routes (only shown on navigation)
const PersonaList = lazy(() => import("./components/PersonaList"));
const PersonaDetail = lazy(() => import("./components/PersonaDetail"));
const NodeEngineOverview = lazy(() => import("./components/NodeEngineOverview"));
const GraphDetail = lazy(() => import("./components/GraphDetail"));
const RunStatus = lazy(() => import("./components/RunStatus"));
const ChannelList = lazy(() => import("./components/ChannelList"));
const VoiceChat = lazy(() => import("./components/VoiceChat"));
const ChatHistory = lazy(() => import("./components/ChatHistory"));
const NodeEditor = lazy(() => import("./components/NodeEditor"));
const TrainingDashboard = lazy(() => import("./components/TrainingDashboard"));
const Analytics = lazy(() => import("./components/Analytics"));
const Collectif = lazy(() => import("./components/Collectif"));
const UllaPage = lazy(() => import("./components/UllaPage"));
const ComposePage = lazy(() => import("./components/ComposePage"));
const ImaginePage = lazy(() => import("./components/ImaginePage"));
const AdminPage = lazy(() => import("./components/AdminPage"));
const MediaExplorer = lazy(() => import("./components/MediaExplorer"));

// ---------------------------------------------------------------------------
// App state phases:
//   1. "connecting" — modem animation (3615 ULLA → 3615 KXKM)
//   2. "login"      — pseudo + email + password
//   3. "ready"      — main app (chat, personas, etc.)
// ---------------------------------------------------------------------------

export default function App() {
  const { session, setSession, nick, setNick, clearSessionState } = useAppSession();
  const [error, setError] = useState("");
  const { route, navigate } = useHashRoute();

  // Phase: skip connection animation if already logged in
  const [phase, setPhase] = useState<"connecting" | "login" | "ready">(
    nick ? "ready" : "connecting"
  );
  useKeyboardShortcuts(navigate);

  // Login handler: stores nick (pseudo only)
  function handleLogin(username: string) {
    setNick(username);

    // Try API login for admin features (non-blocking)
    api.login(username, "viewer" as UserRole)
      .then((s) => setSession(s))
      .catch(() => {}); // Non-blocking — chat works without session

    setPhase("ready");
    navigate("chat");
  }

  function handleLogout() {
    api.logout().catch(() => {});
    setSession(null);
    clearSessionState();
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

      case "media":
        return <MediaExplorer />;

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
        <Suspense fallback={<div className="muted">Chargement...</div>}>
          {renderPage()}
        </Suspense>
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
