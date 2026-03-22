import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatMessage } from "./ChatMessage";
import type { ChatMsg } from "./chat-types";

const baseMsg: Omit<ChatMsg, "type"> = { id: 1, timestamp: Date.now() };
const getNickColor = vi.fn((nick: string) => {
  if (nick === "Arlequin") return "#ff00ff";
  return undefined;
});
const channel = "#salon";

describe("ChatMessage", () => {
  it("affiche un message system avec les lignes", () => {
    const msg: ChatMsg = { ...baseMsg, type: "system", text: "Ligne 1\nLigne 2\nLigne 3" };
    render(<ChatMessage msg={msg} getNickColor={getNickColor} channel={channel} />);
    expect(screen.getByText("Ligne 1")).toBeInTheDocument();
    expect(screen.getByText("Ligne 2")).toBeInTheDocument();
    expect(screen.getByText("Ligne 3")).toBeInTheDocument();
  });

  it("affiche un message join avec le nick et le channel", () => {
    const msg: ChatMsg = { ...baseMsg, type: "join", nick: "Bob", channel: "#test" };
    render(<ChatMessage msg={msg} getNickColor={getNickColor} channel={channel} />);
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
    expect(screen.getByText(/a rejoint/)).toBeInTheDocument();
    expect(screen.getByText(/#test/)).toBeInTheDocument();
  });

  it("affiche un message part", () => {
    const msg: ChatMsg = { ...baseMsg, type: "part", nick: "Bob" };
    render(<ChatMessage msg={msg} getNickColor={getNickColor} channel={channel} />);
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
    expect(screen.getByText(/a quitte/)).toBeInTheDocument();
    expect(screen.getByText(/#salon/)).toBeInTheDocument();
  });

  it("affiche un message texte avec la couleur du nick (persona)", () => {
    const msg: ChatMsg = { ...baseMsg, type: "message", nick: "Arlequin", text: "Bonjour le monde" };
    render(<ChatMessage msg={msg} getNickColor={getNickColor} channel={channel} />);
    const container = screen.getByText("Bonjour le monde").closest(".chat-msg");
    expect(container).toHaveClass("chat-msg-persona");
    expect(container).toHaveStyle({ color: "#ff00ff" });
  });

  it("affiche un message texte user (sans couleur)", () => {
    const msg: ChatMsg = { ...baseMsg, type: "message", nick: "Jean", text: "Salut" };
    render(<ChatMessage msg={msg} getNickColor={getNickColor} channel={channel} />);
    const container = screen.getByText("Salut").closest(".chat-msg");
    expect(container).toHaveClass("chat-msg-user");
    expect(container).not.toHaveStyle({ color: "#ff00ff" });
  });

  it("audio messages are hidden (voice chat queue handles playback)", () => {
    const msg: ChatMsg = {
      ...baseMsg,
      type: "audio",
      nick: "Arlequin",
      audioData: "AAAA",
      audioMime: "audio/wav",
    };
    const { container } = render(<ChatMessage msg={msg} getNickColor={getNickColor} channel={channel} />);
    // Audio messages return null — playback via voice chat queue
    expect(container.firstChild).toBeNull();
  });

  it("affiche un message image avec l'image", () => {
    const msg: ChatMsg = {
      ...baseMsg,
      type: "image",
      nick: "Arlequin",
      text: "Un paysage",
      imageData: "AAAA",
      imageMime: "image/png",
    };
    render(<ChatMessage msg={msg} getNickColor={getNickColor} channel={channel} />);
    expect(screen.getByText("Un paysage")).toBeInTheDocument();
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(img).toHaveAttribute("alt", "Un paysage");
  });

  it("affiche un message music avec le player audio (fallback)", () => {
    const msg: ChatMsg = {
      ...baseMsg,
      type: "music",
      nick: "Arlequin",
      text: "Ma composition",
      audioData: "BBBB",
      audioMime: "audio/mpeg",
    };
    const { container } = render(<ChatMessage msg={msg} getNickColor={getNickColor} channel={channel} />);
    expect(screen.getByText("Ma composition")).toBeInTheDocument();
    // WaveformPlayer is lazy — Suspense fallback renders native <audio>
    const audio = container.querySelector("audio");
    expect(audio).toBeTruthy();
    expect(audio?.getAttribute("src")).toContain("audio/mpeg");
  });
});
