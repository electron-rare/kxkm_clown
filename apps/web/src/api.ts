const BASE = import.meta.env.VITE_API_BASE_URL || "";

export type UserRole = "admin" | "editor" | "operator" | "viewer";

export interface SessionData {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
  expiresAt: string;
}

export interface PersonaData {
  id: string;
  name: string;
  model: string;
  summary: string;
  editable: boolean;
  color?: string;
  enabled?: boolean;
}

export interface PersonaFeedbackRecord {
  id: string;
  personaId: string;
  kind: "vote" | "admin_edit" | "chat_signal" | "drift_report";
  message: string;
  createdAt: string;
}

export interface PersonaSourceRecord {
  personaId: string;
  subjectName: string;
  summary: string;
  references: string[];
}

export interface PersonaProposalRecord {
  id: string;
  personaId: string;
  reason: string;
  before: { name: string; model: string; summary: string };
  after: { name: string; model: string; summary: string };
  applied: boolean;
  createdAt: string;
}

export interface OverviewData {
  queue: {
    desiredWorkers: number;
    activeWorkers: number;
    queuedRuns: number;
    runningRuns: number;
  };
  registry: {
    graphs: number;
    models: number;
  };
}

export interface GraphNodeRecord {
  id: string;
  type: string;
  runtime: string;
  label?: string;
  params: Record<string, unknown>;
  x?: number;
  y?: number;
}

export interface GraphEdgeRecord {
  from: { node: string; output: string };
  to: { node: string; input: string };
}

export interface NodeGraphRecord {
  id: string;
  name: string;
  description: string;
  nodes?: GraphNodeRecord[];
  edges?: GraphEdgeRecord[];
  createdAt?: string;
  updatedAt?: string;
}

export interface NodeRunRecord {
  id: string;
  graphId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "not_configured" | "blocked";
  createdAt: string;
}

export interface ModelRecord {
  id: string;
  label: string;
  runtime: "local_cpu" | "local_gpu" | "remote_gpu";
}

export interface ChatChannel {
  id: string;
  label: string;
  kind: "general" | "admin" | "dedicated";
  model?: string;
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });

  const body = await response.json();
  if (!response.ok) {
    throw new ApiError(body.error || "request_failed", response.status);
  }
  return body.data as T;
}

export const api = {
  // Session
  login(username: string, role?: UserRole): Promise<SessionData> {
    return apiFetch<SessionData>("/api/session/login", {
      method: "POST",
      body: JSON.stringify({ username, role: role || "viewer" }),
    });
  },

  logout(): Promise<void> {
    return apiFetch("/api/session/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }).then(() => undefined);
  },

  getSession(): Promise<SessionData> {
    return apiFetch<SessionData>("/api/session");
  },

  // Personas
  listPersonas(): Promise<PersonaData[]> {
    return apiFetch<PersonaData[]>("/api/personas");
  },

  getPersona(id: string): Promise<PersonaData> {
    return apiFetch<PersonaData>(`/api/personas/${id}`);
  },

  updatePersona(id: string, patch: Partial<PersonaData>): Promise<PersonaData> {
    return apiFetch<PersonaData>(`/api/admin/personas/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  },

  togglePersona(id: string, enabled: boolean): Promise<PersonaData> {
    return apiFetch<PersonaData>(`/api/admin/personas/${id}/toggle`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
  },

  getPersonaFeedback(id: string): Promise<PersonaFeedbackRecord[]> {
    return apiFetch<PersonaFeedbackRecord[]>(`/api/admin/personas/${id}/feedback`);
  },

  getPersonaSource(id: string): Promise<PersonaSourceRecord> {
    return apiFetch<PersonaSourceRecord>(`/api/admin/personas/${id}/source`);
  },

  getPersonaProposals(id: string): Promise<PersonaProposalRecord[]> {
    return apiFetch<PersonaProposalRecord[]>(`/api/admin/personas/${id}/proposals`);
  },

  reinforcePersona(id: string, patch: Partial<PersonaData> & { apply?: boolean }): Promise<PersonaProposalRecord> {
    return apiFetch<PersonaProposalRecord>(`/api/admin/personas/${id}/reinforce`, {
      method: "POST",
      body: JSON.stringify(patch),
    });
  },

  // Node Engine
  getOverview(): Promise<OverviewData> {
    return apiFetch<OverviewData>("/api/admin/node-engine/overview");
  },

  listGraphs(): Promise<NodeGraphRecord[]> {
    return apiFetch<NodeGraphRecord[]>("/api/admin/node-engine/graphs");
  },

  createGraph(name: string, description: string): Promise<NodeGraphRecord> {
    return apiFetch<NodeGraphRecord>("/api/admin/node-engine/graphs", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
  },

  getGraph(id: string): Promise<NodeGraphRecord> {
    return apiFetch<NodeGraphRecord>(`/api/admin/node-engine/graphs/${id}`);
  },

  updateGraph(id: string, patch: Partial<NodeGraphRecord>): Promise<NodeGraphRecord> {
    return apiFetch<NodeGraphRecord>(`/api/admin/node-engine/graphs/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  },

  startRun(graphId: string): Promise<NodeRunRecord> {
    return apiFetch<NodeRunRecord>(`/api/admin/node-engine/graphs/${graphId}/run`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  getRun(id: string): Promise<NodeRunRecord> {
    return apiFetch<NodeRunRecord>(`/api/admin/node-engine/runs/${id}`);
  },

  cancelRun(id: string): Promise<NodeRunRecord> {
    return apiFetch<NodeRunRecord>(`/api/admin/node-engine/runs/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  listModels(): Promise<ModelRecord[]> {
    return apiFetch<ModelRecord[]>("/api/admin/node-engine/models");
  },

  // Training
  getTrainingRuns(): Promise<NodeRunRecord[]> {
    return apiFetch<NodeRunRecord[]>("/api/admin/node-engine/runs");
  },

  async getDPOStats(): Promise<{ count: number }> {
    try {
      const res = await fetch(`${BASE}/api/v2/export/dpo`, { credentials: "include" });
      if (!res.ok) return { count: 0 };
      const text = await res.text();
      const lines = text.trim().split("\n").filter(Boolean);
      return { count: lines.length };
    } catch {
      return { count: 0 };
    }
  },

  // Chat
  getChannels(): Promise<ChatChannel[]> {
    return apiFetch<ChatChannel[]>("/api/chat/channels");
  },

  // Chat History
  getChatHistoryDates(): Promise<{ files: Array<{ date: string; lines: number; size: number }> }> {
    return apiFetch<{ files: Array<{ date: string; lines: number; size: number }> }>("/api/v2/chat/history");
  },

  async getChatHistoryByDate(date: string, limit = 200, offset = 0): Promise<{ messages: any[]; total: number; limit: number; offset: number }> {
    return apiFetch<{ messages: any[]; total: number; limit: number; offset: number }>(
      `/api/v2/chat/history/${date}?limit=${limit}&offset=${offset}`
    );
  },
};
