import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Nav from "./Nav";
import type { SessionData } from "../api";

function makeSession(role: SessionData["role"]): SessionData {
  return {
    id: "s1",
    username: "test",
    role,
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-02T00:00:00Z",
  };
}

describe("Nav", () => {
  it("renders all nav items for admin", () => {
    render(<Nav currentPage="dashboard" session={makeSession("admin")} onNavigate={vi.fn()} />);
    expect(screen.getByText("Tableau de bord")).toBeInTheDocument();
    expect(screen.getByText("Canaux")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Personas")).toBeInTheDocument();
    expect(screen.getByText("Node Engine")).toBeInTheDocument();
  });

  it("hides role-restricted items for viewer", () => {
    render(<Nav currentPage="dashboard" session={makeSession("viewer")} onNavigate={vi.fn()} />);
    expect(screen.getByText("Tableau de bord")).toBeInTheDocument();
    expect(screen.getByText("Canaux")).toBeInTheDocument();
    expect(screen.queryByText("Node Engine")).not.toBeInTheDocument();
  });

  it("shows Node Engine for operator role", () => {
    render(<Nav currentPage="dashboard" session={makeSession("operator")} onNavigate={vi.fn()} />);
    expect(screen.getByText("Node Engine")).toBeInTheDocument();
  });

  it("marks current page as active", () => {
    render(<Nav currentPage="chat" session={makeSession("admin")} onNavigate={vi.fn()} />);
    const chatBtn = screen.getByText("Chat");
    expect(chatBtn.className).toContain("nav-active");
    const dashBtn = screen.getByText("Tableau de bord");
    expect(dashBtn.className).not.toContain("nav-active");
  });

  it("calls onNavigate when a nav item is clicked", async () => {
    const onNavigate = vi.fn();
    render(<Nav currentPage="dashboard" session={makeSession("admin")} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText("Personas"));
    expect(onNavigate).toHaveBeenCalledWith("personas");
  });
});
