import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Header from "./Header";
import type { SessionData } from "../api";

const mockSession: SessionData = {
  id: "s1",
  username: "alice",
  role: "admin",
  createdAt: "2026-01-01T00:00:00Z",
  expiresAt: "2026-01-02T00:00:00Z",
};

describe("Header", () => {
  it("renders the brand title", () => {
    render(<Header session={null} onLogout={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText("KXKM_Clown V2")).toBeInTheDocument();
    expect(screen.getByText("Shell prive multi-utilisateur")).toBeInTheDocument();
  });

  it("does not show session info when session is null", () => {
    render(<Header session={null} onLogout={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.queryByText("Deconnexion")).not.toBeInTheDocument();
  });

  it("shows username and role when session is provided", () => {
    render(<Header session={mockSession} onLogout={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("calls onLogout when logout button is clicked", async () => {
    const onLogout = vi.fn();
    render(<Header session={mockSession} onLogout={onLogout} onNavigate={vi.fn()} />);
    await userEvent.click(screen.getByText("Deconnexion"));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("calls onNavigate with 'dashboard' when brand is clicked", async () => {
    const onNavigate = vi.fn();
    render(<Header session={null} onLogout={vi.fn()} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText("KXKM_Clown V2"));
    expect(onNavigate).toHaveBeenCalledWith("dashboard");
  });
});
