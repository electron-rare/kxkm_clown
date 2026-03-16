import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Login from "./Login";

describe("Login", () => {
  it("renders the login form", () => {
    render(<Login onLogin={vi.fn()} error="" />);
    expect(screen.getByText("Ouvrir une session")).toBeInTheDocument();
    expect(screen.getByText("Se connecter")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("username")).toBeInTheDocument();
  });

  it("renders role select with all options", () => {
    render(<Login onLogin={vi.fn()} error="" />);
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "admin" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "editor" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "operator" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "viewer" })).toBeInTheDocument();
  });

  it("displays error when provided", () => {
    render(<Login onLogin={vi.fn()} error="Invalid credentials" />);
    expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
  });

  it("does not display error when empty", () => {
    render(<Login onLogin={vi.fn()} error="" />);
    expect(screen.queryByText(/Invalid/)).not.toBeInTheDocument();
  });

  it("calls onLogin with username and role on submit", async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    render(<Login onLogin={onLogin} error="" />);

    const input = screen.getByPlaceholderText("username");
    await userEvent.clear(input);
    await userEvent.type(input, "bob");

    await userEvent.selectOptions(screen.getByRole("combobox"), "editor");
    await userEvent.click(screen.getByText("Se connecter"));

    expect(onLogin).toHaveBeenCalledWith("bob", "editor");
  });

  it("shows loading state during submit", async () => {
    let resolveLogin: () => void;
    const loginPromise = new Promise<void>((resolve) => {
      resolveLogin = resolve;
    });
    const onLogin = vi.fn().mockReturnValue(loginPromise);

    render(<Login onLogin={onLogin} error="" />);
    await userEvent.click(screen.getByText("Se connecter"));

    expect(screen.getByText("Connexion...")).toBeInTheDocument();

    resolveLogin!();
    // Wait for state update
    await screen.findByText("Se connecter");
  });
});
