import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RunStatus from "./RunStatus";
import { api } from "../api";
import type { NodeRunRecord } from "../api";

vi.mock("../api", () => ({
  api: {
    getRun: vi.fn(),
    cancelRun: vi.fn(),
  },
}));

function makeRun(overrides: Partial<NodeRunRecord> = {}): NodeRunRecord {
  return {
    id: "run-abc123def456",
    graphId: "graph-1",
    status: "running",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("RunStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows loading state initially", () => {
    vi.mocked(api.getRun).mockReturnValue(new Promise(() => {}));
    render(<RunStatus runId="run-abc123def456" onBack={vi.fn()} />);
    expect(screen.getByText("Chargement du run...")).toBeInTheDocument();
  });

  it("renders run details after loading", async () => {
    const run = makeRun({ status: "completed" });
    vi.mocked(api.getRun).mockResolvedValue(run);
    render(<RunStatus runId="run-abc123def456" onBack={vi.fn()} />);

    expect(await screen.findByText("completed")).toBeInTheDocument();
    expect(screen.getByText("run-abc123def456")).toBeInTheDocument();
    expect(screen.getByText("graph-1")).toBeInTheDocument();
  });

  it("shows cancel button for non-terminal status", async () => {
    vi.mocked(api.getRun).mockResolvedValue(makeRun({ status: "running" }));
    render(<RunStatus runId="run-abc123def456" onBack={vi.fn()} />);

    expect(await screen.findByText("Annuler le run")).toBeInTheDocument();
  });

  it("hides cancel button for terminal status", async () => {
    vi.mocked(api.getRun).mockResolvedValue(makeRun({ status: "completed" }));
    render(<RunStatus runId="run-abc123def456" onBack={vi.fn()} />);

    await screen.findByText("completed");
    expect(screen.queryByText("Annuler le run")).not.toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", async () => {
    vi.mocked(api.getRun).mockResolvedValue(makeRun({ status: "completed" }));
    const onBack = vi.fn();
    render(<RunStatus runId="run-abc123def456" onBack={onBack} />);

    await screen.findByText("Retour");
    await userEvent.click(screen.getByText("Retour"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows error when load fails", async () => {
    vi.mocked(api.getRun).mockRejectedValue(new Error("not found"));
    render(<RunStatus runId="run-abc123def456" onBack={vi.fn()} />);

    expect(await screen.findByText("not found")).toBeInTheDocument();
  });
});
