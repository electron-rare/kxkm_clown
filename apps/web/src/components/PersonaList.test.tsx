import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PersonaList from "./PersonaList";
import { api } from "../api";
import type { PersonaData } from "../api";

vi.mock("../api", () => ({
  api: {
    listPersonas: vi.fn(),
  },
}));

const mockPersonas: PersonaData[] = [
  { id: "p1", name: "Clown Rouge", model: "gpt-4", summary: "Un clown joyeux", editable: true, color: "#ff0000" },
  { id: "p2", name: "Clown Bleu", model: "claude-3", summary: "Un clown triste", editable: false },
];

describe("PersonaList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    vi.mocked(api.listPersonas).mockReturnValue(new Promise(() => {}));
    render(<PersonaList onSelect={vi.fn()} />);
    expect(screen.getByText("Chargement des personas...")).toBeInTheDocument();
  });

  it("renders persona cards after loading", async () => {
    vi.mocked(api.listPersonas).mockResolvedValue(mockPersonas);
    render(<PersonaList onSelect={vi.fn()} />);

    expect(await screen.findByText("Clown Rouge")).toBeInTheDocument();
    expect(screen.getByText("Clown Bleu")).toBeInTheDocument();
    expect(screen.getByText("gpt-4")).toBeInTheDocument();
    expect(screen.getByText("claude-3")).toBeInTheDocument();
    expect(screen.getByText("Un clown joyeux")).toBeInTheDocument();
  });

  it("calls onSelect when a persona card is clicked", async () => {
    vi.mocked(api.listPersonas).mockResolvedValue(mockPersonas);
    const onSelect = vi.fn();
    render(<PersonaList onSelect={onSelect} />);

    const card = await screen.findByText("Clown Rouge");
    await userEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith("p1");
  });

  it("shows empty message when no personas exist", async () => {
    vi.mocked(api.listPersonas).mockResolvedValue([]);
    render(<PersonaList onSelect={vi.fn()} />);

    expect(await screen.findByText("Aucune persona configuree.")).toBeInTheDocument();
  });

  it("shows error on API failure", async () => {
    vi.mocked(api.listPersonas).mockRejectedValue(new Error("Network error"));
    render(<PersonaList onSelect={vi.fn()} />);

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });
});
