import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ChannelList from "./ChannelList";
import { api } from "../api";
import type { ChatChannel } from "../api";

vi.mock("../api", () => ({
  api: {
    getChannels: vi.fn(),
  },
}));

const mockChannels: ChatChannel[] = [
  { id: "ch1", label: "General", kind: "general" },
  { id: "ch2", label: "Admin Only", kind: "admin", model: "gpt-4" },
  { id: "ch3", label: "Persona Chat", kind: "dedicated" },
];

describe("ChannelList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    vi.mocked(api.getChannels).mockReturnValue(new Promise(() => {}));
    render(<ChannelList />);
    expect(screen.getByText("Chargement des canaux...")).toBeInTheDocument();
  });

  it("renders channel cards after loading", async () => {
    vi.mocked(api.getChannels).mockResolvedValue(mockChannels);
    render(<ChannelList />);

    expect(await screen.findByText("General")).toBeInTheDocument();
    expect(screen.getByText("Admin Only")).toBeInTheDocument();
    expect(screen.getByText("Persona Chat")).toBeInTheDocument();
  });

  it("shows model info when channel has a model", async () => {
    vi.mocked(api.getChannels).mockResolvedValue(mockChannels);
    render(<ChannelList />);

    expect(await screen.findByText("admin (gpt-4)")).toBeInTheDocument();
    expect(screen.getByText("general")).toBeInTheDocument();
    expect(screen.getByText("dedicated")).toBeInTheDocument();
  });

  it("shows empty message when no channels exist", async () => {
    vi.mocked(api.getChannels).mockResolvedValue([]);
    render(<ChannelList />);

    expect(await screen.findByText("Aucun canal disponible.")).toBeInTheDocument();
  });

  it("shows error on API failure", async () => {
    vi.mocked(api.getChannels).mockRejectedValue(new Error("Connection refused"));
    render(<ChannelList />);

    expect(await screen.findByText("Connection refused")).toBeInTheDocument();
  });

  it("renders the page title", async () => {
    vi.mocked(api.getChannels).mockResolvedValue(mockChannels);
    render(<ChannelList />);

    expect(await screen.findByText("Canaux de chat")).toBeInTheDocument();
  });
});
