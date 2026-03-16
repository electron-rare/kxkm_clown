import React from "react";

interface MinitelFrameProps {
  children: React.ReactNode;
  channel?: string;
  connected?: boolean;
}

export default function MinitelFrame({ children, channel, connected }: MinitelFrameProps) {
  return (
    <div className="minitel-terminal">
      {/* Physical Minitel body */}
      <div className="minitel-body">
        {/* Screen area with CRT effect */}
        <div className="minitel-screen-bezel">
          <div className="minitel-screen">
            {/* Scanline overlay */}
            <div className="minitel-scanlines" />
            {/* Vignette overlay */}
            <div className="minitel-vignette" />
            {/* Flicker overlay */}
            <div className="minitel-flicker" />

            {/* Service bar top */}
            <div className="minitel-service-top">
              <span>3615 KXKM</span>
              <span>{channel || "#general"}</span>
              <span>{connected ? "CONNECTE" : "DECONNECTE"}</span>
            </div>

            {/* Content area */}
            <div className="minitel-content">
              {children}
            </div>

            {/* Service bar bottom */}
            <div className="minitel-service-bottom">
              <span className="minitel-fkey">Sommaire</span>
              <span className="minitel-fkey">Suite</span>
              <span className="minitel-fkey">Retour</span>
              <span className="minitel-fkey">Annul</span>
              <span className="minitel-fkey minitel-fkey-envoi">Envoi</span>
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
