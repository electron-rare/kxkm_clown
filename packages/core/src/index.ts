export const USER_ROLES = ["admin", "editor", "operator", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSIONS = [
  "session:manage",
  "chat:read",
  "chat:write",
  "persona:read",
  "persona:write",
  "node_engine:read",
  "node_engine:operate",
  "ops:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [...PERMISSIONS],
  editor: ["chat:read", "chat:write", "persona:read", "persona:write", "node_engine:read", "ops:read"],
  operator: ["chat:read", "chat:write", "persona:read", "node_engine:read", "node_engine:operate", "ops:read"],
  viewer: ["chat:read", "persona:read", "node_engine:read", "ops:read"],
};

export type ChatChannelKind = "general" | "admin" | "dedicated";

export interface ChatChannel {
  id: string;
  label: string;
  kind: ChatChannelKind;
  model?: string;
}

export interface AuthSession {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
  expiresAt: string;
}

export interface ApiEnvelope<T> {
  ok: true;
  data: T;
}

export interface ApiErrorEnvelope {
  ok: false;
  error: string;
}

export interface NodeEngineQueueState {
  desiredWorkers: number;
  activeWorkers: number;
  queuedRuns: number;
  runningRuns: number;
}

export interface NodeEngineOverview {
  queue: NodeEngineQueueState;
  registry: {
    graphs: number;
    models: number;
  };
  storage: {
    backend: "postgres";
    artifacts: "filesystem";
  };
}

export function createIsoTimestamp(date = new Date()): string {
  return date.toISOString();
}

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

export function asApiData<T>(data: T): ApiEnvelope<T> {
  return { ok: true, data };
}
