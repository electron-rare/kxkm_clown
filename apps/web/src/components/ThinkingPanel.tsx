import { useState, useEffect, useRef } from "react";

type ThinkingState = {
  personaId: string;
  phase: "start" | "stream" | "done";
  progress: number;
  buf: string;
  flavor?: string;
  bar?: string;
  updatedAt: number;
};

interface ThinkingPanelProps {
  thinkingByPersona: Record<string, ThinkingState>;
  getNickColor: (nick: string) => string | undefined;
}

export function ThinkingPanel({ thinkingByPersona, getNickColor }: ThinkingPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const entries = Object.entries(thinkingByPersona);
  const bufRefs = useRef<Map<string, HTMLPreElement>>(new Map());

  useEffect(() => {
    for (const [nick, el] of bufRefs.current.entries()) {
      if (el && thinkingByPersona[nick]) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [thinkingByPersona]);

  if (entries.length === 0 && collapsed) {
    return (
      <div className="thinking-panel thinking-panel-collapsed">
        <button
          className="thinking-panel-toggle"
          onClick={() => setCollapsed(false)}
          title="Ouvrir le panneau des pensées"
        >
          {"\u{1F9E0}"}
        </button>
      </div>
    );
  }

  return (
    <aside className={`thinking-panel ${collapsed ? "thinking-panel-collapsed" : ""}`}>
      <div className="thinking-panel-header">
        <span className="thinking-panel-title">{"\u{1F9E0}"} Pensées en cours</span>
        <button
          className="thinking-panel-toggle"
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? "Déplier" : "Replier"}
        >
          {collapsed ? "\u25C0" : "\u25B6"}
        </button>
      </div>
      {!collapsed && (
        <div className="thinking-panel-body">
          {entries.length === 0 && (
            <div className="thinking-panel-empty">Personne ne pense pour l'instant…</div>
          )}
          {entries.map(([nick, state]) => (
            <div
              key={nick}
              className={`thinking-entry thinking-phase-${state.phase}`}
              style={{ borderLeftColor: getNickColor(nick) }}
            >
              <div className="thinking-entry-header">
                <span className="thinking-entry-nick" style={{ color: getNickColor(nick) }}>
                  {nick}
                </span>
                <span className="thinking-entry-progress">
                  {state.bar || ""} {state.progress}%
                </span>
              </div>
              {state.flavor && <div className="thinking-entry-flavor">{state.flavor}</div>}
              <pre
                className="thinking-entry-buf"
                ref={el => {
                  if (el) bufRefs.current.set(nick, el);
                  else bufRefs.current.delete(nick);
                }}
              >
                {state.buf || "…"}
              </pre>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
