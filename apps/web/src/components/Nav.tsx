import type { SessionData } from "../api";

interface NavProps {
  currentPage: string;
  session: SessionData;
  onNavigate: (page: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  roles?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Tableau de bord" },
  { id: "channels", label: "Canaux" },
  { id: "chat", label: "Chat" },
  { id: "voice", label: "Chat Vocal" },
  { id: "personas", label: "Personas" },
  { id: "history", label: "Historique" },
  { id: "node-engine", label: "Node Engine", roles: ["admin", "operator"] },
  { id: "training", label: "Training", roles: ["admin", "operator"] },
];

export default function Nav({ currentPage, session, onNavigate }: NavProps) {
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(session.role)
  );

  return (
    <nav className="app-nav">
      {visibleItems.map((item) => (
        <button
          key={item.id}
          className={`nav-item${currentPage.startsWith(item.id) ? " nav-active" : ""}`}
          onClick={() => onNavigate(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
