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

// Navigation items mapped to F-key style buttons
interface NavButton {
  label: string;
  page: string;
  roles?: string[];  // restrict to these roles (empty = all)
}

const NAV_BUTTONS: NavButton[] = [
  { label: "Sommaire", page: "dashboard" },
  { label: "Canaux", page: "channels" },
  { label: "Chat", page: "chat" },
  { label: "Vocal", page: "voice" },
  { label: "Collectif", page: "collectif" },
  { label: "Personas", page: "personas" },
  { label: "Historique", page: "history" },
  { label: "Moteur", page: "node-engine", roles: ["admin", "operator"] },
  { label: "Training", page: "training", roles: ["admin", "operator"] },
  { label: "Stats", page: "analytics", roles: ["admin"] },
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

  const visibleButtons = NAV_BUTTONS.filter(
    (btn) => !btn.roles || (session && btn.roles.includes(session.role))
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
            {/* Scanline + CRT overlays */}
            <div className="minitel-scanlines" />
            <div className="minitel-vignette" />
            <div className="minitel-flicker" />

            {/* Service bar top */}
            <div className="minitel-service-top">
              <span
                className="minitel-brand-link"
                onClick={() => handleNav("dashboard")}
                title="Sommaire"
              >
                3615 KXKM
              </span>
              <span>{channel || currentPage || "#general"}</span>
              <span className={connected ? "minitel-status-on" : "minitel-status-off"}>
                {connected !== false ? "CONNECTE" : "DECONNECTE"}
              </span>
              {session && (
                <span className="minitel-user">
                  {session.username} [{session.role}]
                </span>
              )}
            </div>

            {/* Content area */}
            <div className="minitel-content">
              {children}
            </div>

            {/* Navigation drawer (overlays content when open) */}
            {navOpen && (
              <div className="minitel-nav-drawer" onClick={() => setNavOpen(false)}>
                <div className="minitel-nav-panel" onClick={(e) => e.stopPropagation()}>
                  <div className="minitel-nav-title">{">>> SOMMAIRE <<<"}</div>
                  {visibleButtons.map((btn) => (
                    <button
                      key={btn.page}
                      className={`minitel-nav-btn${currentPage === btn.page ? " minitel-nav-active" : ""}`}
                      onClick={() => handleNav(btn.page)}
                    >
                      {btn.label}
                    </button>
                  ))}
                  {session && onLogout && (
                    <button
                      className="minitel-nav-btn minitel-nav-fin"
                      onClick={onLogout}
                    >
                      Fin
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Service bar bottom — functional navigation */}
            <div className="minitel-service-bottom">
              <button
                className={`minitel-fkey${currentPage === "dashboard" ? " minitel-fkey-active" : ""}`}
                onClick={() => setNavOpen(!navOpen)}
                title="F1 — Menu sommaire"
              >
                Sommaire
              </button>
              <button
                className={`minitel-fkey${currentPage === "chat" ? " minitel-fkey-active" : ""}`}
                onClick={() => handleNav("chat")}
                title="F2 — Chat"
              >
                Chat
              </button>
              <button
                className="minitel-fkey"
                onClick={() => window.history.back()}
                title="F3 — Page precedente"
              >
                Retour
              </button>
              <button
                className={`minitel-fkey${currentPage === "personas" ? " minitel-fkey-active" : ""}`}
                onClick={() => handleNav("personas")}
                title="F4 — Personas"
              >
                Personas
              </button>
              {session && onLogout ? (
                <button
                  className="minitel-fkey minitel-fkey-envoi"
                  onClick={onLogout}
                  title="Fin — Deconnexion"
                >
                  Fin
                </button>
              ) : (
                <button
                  className="minitel-fkey minitel-fkey-envoi"
                  onClick={() => handleNav("dashboard")}
                  title="Connexion"
                >
                  Connexion
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

        {/* Minitel label */}
        <div className="minitel-label">
          <span className="minitel-brand">MINITEL 1B</span>
          <span className="minitel-telecom">FRANCE TELECOM</span>
          <div className="minitel-power-led" />
        </div>

        {/* Keyboard suggestion (decorative) */}
        <div className="minitel-keyboard-hint">
          <img src="/minitel-keyboard.svg" alt="" className="minitel-kb-img" />
        </div>
      </div>
    </div>
  );
}
