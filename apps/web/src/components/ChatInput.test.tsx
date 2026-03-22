import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInput } from "./ChatInput";
import type { UseWebSocketReturn } from "../hooks/useWebSocket";

function mockWs(connected: boolean): UseWebSocketReturn {
  return {
    connected,
    send: vi.fn(),
    lastMessage: null,
  } as unknown as UseWebSocketReturn;
}

function renderInput(overrides: Partial<{
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  ws: UseWebSocketReturn;
}> = {}) {
  const props = {
    input: overrides.input ?? "",
    setInput: overrides.setInput ?? vi.fn(),
    onSend: overrides.onSend ?? vi.fn(),
    onKeyDown: overrides.onKeyDown ?? vi.fn(),
    ws: overrides.ws ?? mockWs(true),
  };
  return { ...render(<ChatInput {...props} />), props };
}

describe("ChatInput", () => {
  it("affiche l'input et le bouton envoyer", () => {
    renderInput();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /envoyer/i })).toBeInTheDocument();
  });

  it("le bouton est disabled quand ws non connecte", () => {
    renderInput({ ws: mockWs(false) });
    expect(screen.getByRole("button", { name: /envoyer/i })).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("le bouton est disabled quand l'input est vide", () => {
    renderInput({ input: "", ws: mockWs(true) });
    expect(screen.getByRole("button", { name: /envoyer/i })).toBeDisabled();
  });

  it("le bouton est enabled quand input non vide et ws connecte", () => {
    renderInput({ input: "hello", ws: mockWs(true) });
    expect(screen.getByRole("button", { name: /envoyer/i })).toBeEnabled();
  });

  it("appelle onSend quand le bouton est clique", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderInput({ input: "test", onSend, ws: mockWs(true) });
    await user.click(screen.getByRole("button", { name: /envoyer/i }));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("appelle onKeyDown quand une touche est pressee", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    renderInput({ onKeyDown, ws: mockWs(true) });
    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.keyboard("a");
    expect(onKeyDown).toHaveBeenCalled();
  });

  it("affiche le bouton upload avec file input", () => {
    const { container } = renderInput();
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    expect(screen.getByText("+")).toBeInTheDocument();
  });
});
