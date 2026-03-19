import React from "react";
import type { PersonaColor } from "./chat-types";

export interface ChatSidebarProps {
  personaColors: PersonaColor;
  users: string[];
  sidebarCollapsed: { personas: boolean; users: boolean };
  toggleSidebar: (section: "personas" | "users") => void;
}

export const ChatSidebar = React.memo(function ChatSidebar({ personaColors, users, sidebarCollapsed, toggleSidebar }: ChatSidebarProps) {
  return (
    <div className="chat-sidebar">
      <div className="chat-sidebar-section">
        <div className="chat-sidebar-title" onClick={() => toggleSidebar("personas")}>
          {sidebarCollapsed.personas ? "+" : "-"} Personas
        </div>
        {!sidebarCollapsed.personas && (
          <div className="chat-sidebar-personas">
            {Object.entries(
              users.filter(u => personaColors[u]).reduce((acc, u) => {
                const key = personaColors[u] ? "active" : "idle";
                (acc[key] = acc[key] || []).push(u);
                return acc;
              }, {} as Record<string, string[]>)
            ).map(([, group]) =>
              group.map(u => (
                <div
                  key={u}
                  className="chat-sidebar-persona"
                  style={{ color: personaColors[u] }}
                  onClick={() => {
                    const input = document.querySelector<HTMLInputElement>(".chat-input input");
                    if (input) { input.value = `@${u} `; input.focus(); }
                  }}
                  title={`@${u}`}
                >
                  ● {u}
                </div>
              ))
            )}
          </div>
        )}
      </div>
      <div className="chat-sidebar-section">
        <div className="chat-sidebar-title" onClick={() => toggleSidebar("users")}>
          {sidebarCollapsed.users ? "+" : "-"} Connectes ({users.filter(u => !personaColors[u]).length})
        </div>
        {!sidebarCollapsed.users && users.filter(u => !personaColors[u]).map((u) => (
          <div key={u} className="chat-user">{u}</div>
        ))}
      </div>
    </div>
  );
});
