import type { SessionData } from "../api";

interface HeaderProps {
  session: SessionData | null;
  onLogout: () => void;
  onNavigate: (page: string) => void;
}

export default function Header({ session, onLogout, onNavigate }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="header-brand" onClick={() => onNavigate("dashboard")} style={{ cursor: "pointer" }}>
        <span className="eyebrow">KXKM_Clown V2</span>
        <span className="header-subtitle">Shell prive multi-utilisateur</span>
      </div>
      {session && (
        <div className="header-session">
          <span className="session-badge">
            {session.username} <span className="role-tag">{session.role}</span>
          </span>
          <button className="btn btn-secondary" onClick={onLogout}>
            Deconnexion
          </button>
        </div>
      )}
    </header>
  );
}
