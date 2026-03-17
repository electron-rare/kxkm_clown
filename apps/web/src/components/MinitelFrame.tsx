import React, { useState } from "react";

interface MinitelFrameProps {
  children: React.ReactNode;
  channel?: string;
  connected?: boolean;
  currentPage?: string;
  session?: { username: string; role: string } | null;
  onNavigate?: (page: string) => void;
  onLogout?: () => void;
}

// Bottom bar buttons = project modes
interface ModeButton {
  label: string;
  page: string;
  key: string;       // keyboard shortcut hint
  roles?: string[];
}

const MODE_BUTTONS: ModeButton[] = [
  { label: "Chat", page: "chat", key: "F1" },
  { label: "Vocal", page: "voice", key: "F2" },
  { label: "Personas", page: "personas", key: "F3" },
  { label: "Compose", page: "compose-mode", key: "F4" },
  { label: "Images", page: "imagine-mode", key: "F5" },
];

// Sommaire = full navigation (overlay)
interface NavItem {
  label: string;
  page: string;
  roles?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Chat", page: "chat" },
  { label: "Chat Vocal", page: "voice" },
  { label: "Canaux", page: "channels" },
  { label: "Collectif", page: "collectif" },
  { label: "Personas", page: "personas" },
  { label: "Historique", page: "history" },
  { label: "Composition musicale", page: "compose-mode" },
  { label: "Generation images", page: "imagine-mode" },
  { label: "Tableau de bord", page: "dashboard" },
  { label: "Node Engine", page: "node-engine", roles: ["admin", "operator"] },
  { label: "Training", page: "training", roles: ["admin", "operator"] },
  { label: "Stats", page: "analytics", roles: ["admin"] },
  { label: "Administration", page: "admin" },
  { label: "3615 ULLA", page: "ulla" },
];

export default function MinitelFrame({
  children,
  channel,
  connected,
  currentPage,
  session,
  onNavigate,
  onLogout,
}: MinitelFrameProps) {
  const [navOpen, setNavOpen] = useState(false);

  const visibleNav = NAV_ITEMS.filter(
    (item) => !item.roles || (session && item.roles.includes(session.role))
  );

  function handleNav(page: string) {
    onNavigate?.(page);
    setNavOpen(false);
  }

  return (
    <div className="minitel-terminal">
      <div className="minitel-body">
        <div className="minitel-screen-bezel">
          <div className="minitel-screen">
            {/* CRT overlays */}
            <div className="minitel-scanlines" />
            <div className="minitel-vignette" />
            <div className="minitel-flicker" />

            {/* Service bar top */}
            <div className="minitel-service-top">
              <span
                className="minitel-brand-link"
                onClick={() => setNavOpen(!navOpen)}
                title="Sommaire"
              >
                3615 KXKM
              </span>
              <span className="minitel-top-page">
                {channel || currentPage || ""}
              </span>
              {session && (
                <span className="minitel-user">
                  {session.username}
                </span>
              )}
              <span className={connected ? "minitel-status-on" : "minitel-status-off"}>
                {connected !== false ? "●" : "○"}
              </span>
            </div>

            {/* Content area — chat text goes here */}
            <div className="minitel-content">
              {children}
            </div>

            {/* Navigation overlay (sommaire) */}
            {navOpen && (
              <div className="minitel-nav-drawer" onClick={() => setNavOpen(false)}>
                <div className="minitel-nav-panel" onClick={(e) => e.stopPropagation()}>
                  <div className="minitel-nav-title">{">>> SOMMAIRE <<<"}</div>
                  {visibleNav.map((item) => (
                    <button
                      key={item.page}
                      className={`minitel-nav-btn${currentPage === item.page ? " minitel-nav-active" : ""}`}
                      onClick={() => handleNav(item.page)}
                    >
                      {item.label}
                    </button>
                  ))}
                  <div className="minitel-nav-sep" />
                  {session && onLogout && (
                    <button className="minitel-nav-btn minitel-nav-fin" onClick={onLogout}>
                      Fin de session
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Bottom bar — project mode buttons */}
            <div className="minitel-service-bottom">
              <button
                className="minitel-fkey minitel-fkey-sommaire"
                onClick={() => setNavOpen(!navOpen)}
                title="Sommaire — navigation complete"
              >
                ☰
              </button>
              {MODE_BUTTONS.map((btn) => (
                <button
                  key={btn.page}
                  className={`minitel-fkey${currentPage === btn.page ? " minitel-fkey-active" : ""}`}
                  onClick={() => handleNav(btn.page)}
                  title={`${btn.key} — ${btn.label}`}
                >
                  <span className="minitel-fkey-shortcut">{btn.key}</span>
                  {btn.label}
                </button>
              ))}
              {session && onLogout ? (
                <button
                  className="minitel-fkey minitel-fkey-fin"
                  onClick={onLogout}
                  title="Deconnexion"
                >
                  Fin
                </button>
              ) : (
                <button
                  className="minitel-fkey minitel-fkey-envoi"
                  onClick={() => handleNav("chat")}
                >
                  Envoi
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Speaker grille (decorative) */}
        <div className="minitel-speaker">
          <div className="minitel-speaker-grille">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="minitel-speaker-hole" />
            ))}
          </div>
          <div className="minitel-knobs">
            <div className="minitel-knob" title="Luminosite" />
            <div className="minitel-knob" title="Contraste" />
          </div>
        </div>

        <div className="minitel-label">
          <span className="minitel-brand">MINITEL 1B</span>
          <span className="minitel-telecom">FRANCE TELECOM</span>
          <div className="minitel-power-led" />
        </div>

        <div className="minitel-keyboard-hint">
          <img src="/minitel-keyboard.svg" alt="" className="minitel-kb-img" />
        </div>
      </div>
    </div>
  );
}
