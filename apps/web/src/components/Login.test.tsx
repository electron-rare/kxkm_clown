import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Login from "./Login";

describe("Login", () => {
  it("renders the login form with pseudo field only", () => {
    render(<Login onLogin={vi.fn()} error="" />);
    expect(screen.getByPlaceholderText("votre pseudo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ">>> Connexion <<<" })).toBeInTheDocument();
    // No password or email fields
    expect(screen.queryByPlaceholderText("mot de passe")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("votre@email.com")).not.toBeInTheDocument();
  });

  it("displays error when provided", () => {
    render(<Login onLogin={vi.fn()} error="Invalid credentials" />);
    expect(screen.getByText(/ERREUR: Invalid credentials/)).toBeInTheDocument();
  });

  it("does not display error when empty", () => {
    render(<Login onLogin={vi.fn()} error="" />);
    expect(screen.queryByText(/Invalid/)).not.toBeInTheDocument();
  });

  it("calls onLogin with username on submit", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn().mockResolvedValue(undefined);
    render(<Login onLogin={onLogin} error="" />);

    await user.type(screen.getByPlaceholderText("votre pseudo"), "bob");
    await user.click(screen.getByRole("button", { name: ">>> Connexion <<<" }));

    expect(onLogin).toHaveBeenCalledWith("bob");
  });

  it("shows loading state during submit", async () => {
    const user = userEvent.setup();
    let resolveLogin!: () => void;
    const loginPromise = new Promise<void>((resolve) => {
      resolveLogin = resolve;
    });
    const onLogin = vi.fn().mockReturnValue(loginPromise);

    render(<Login onLogin={onLogin} error="" />);
    await user.type(screen.getByPlaceholderText("votre pseudo"), "bob");
    await user.click(screen.getByRole("button", { name: ">>> Connexion <<<" }));

    expect(screen.getByRole("button", { name: "Connexion..." })).toBeInTheDocument();

    resolveLogin!();
    await screen.findByRole("button", { name: ">>> Connexion <<<" });
  });
});
