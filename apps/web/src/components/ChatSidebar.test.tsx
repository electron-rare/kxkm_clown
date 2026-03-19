import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSidebar } from "./ChatSidebar";
import type { PersonaColor } from "./chat-types";

const personaColors: PersonaColor = {
  Arlequin: "#ff00ff",
  Pierrot: "#00ff00",
};

const users = ["Arlequin", "Pierrot", "Jean", "Marie"];

function renderSidebar(overrides: Partial<{
  personaColors: PersonaColor;
  users: string[];
  sidebarCollapsed: { personas: boolean; users: boolean };
  toggleSidebar: (section: "personas" | "users") => void;
}> = {}) {
  const props = {
    personaColors: overrides.personaColors ?? personaColors,
    users: overrides.users ?? users,
    sidebarCollapsed: overrides.sidebarCollapsed ?? { personas: false, users: false },
    toggleSidebar: overrides.toggleSidebar ?? vi.fn(),
  };
  return { ...render(<ChatSidebar {...props} />), props };
}

describe("ChatSidebar", () => {
  it("affiche les sections personas et connectes", () => {
    renderSidebar();
    expect(screen.getByText(/Personas/)).toBeInTheDocument();
    expect(screen.getByText(/Connectes/)).toBeInTheDocument();
  });

  it("toggle la section personas au clic", async () => {
    const user = userEvent.setup();
    const toggleSidebar = vi.fn();
    renderSidebar({ toggleSidebar });
    await user.click(screen.getByText(/Personas/));
    expect(toggleSidebar).toHaveBeenCalledWith("personas");
  });

  it("toggle la section users au clic", async () => {
    const user = userEvent.setup();
    const toggleSidebar = vi.fn();
    renderSidebar({ toggleSidebar });
    await user.click(screen.getByText(/Connectes/));
    expect(toggleSidebar).toHaveBeenCalledWith("users");
  });

  it("affiche les personas avec leurs couleurs", () => {
    renderSidebar();
    const arlequin = screen.getByText(/Arlequin/);
    expect(arlequin).toBeInTheDocument();
    expect(arlequin.closest(".chat-sidebar-persona")).toHaveStyle({ color: "#ff00ff" });
    const pierrot = screen.getByText(/Pierrot/);
    expect(pierrot).toBeInTheDocument();
    expect(pierrot.closest(".chat-sidebar-persona")).toHaveStyle({ color: "#00ff00" });
  });

  it("affiche les users sans couleur", () => {
    renderSidebar();
    expect(screen.getByText("Jean")).toBeInTheDocument();
    expect(screen.getByText("Marie")).toBeInTheDocument();
    expect(screen.getByText("Jean").closest(".chat-user")).toBeInTheDocument();
  });

  it("masque les personas quand la section est collapsed", () => {
    renderSidebar({ sidebarCollapsed: { personas: true, users: false } });
    expect(screen.queryByText(/Arlequin/)).not.toBeInTheDocument();
    expect(screen.getByText("Jean")).toBeInTheDocument();
  });

  it("masque les users quand la section est collapsed", () => {
    renderSidebar({ sidebarCollapsed: { personas: false, users: true } });
    expect(screen.getByText(/Arlequin/)).toBeInTheDocument();
    expect(screen.queryByText("Jean")).not.toBeInTheDocument();
  });
});
