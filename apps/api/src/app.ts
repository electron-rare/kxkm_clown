import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { type Request, type Response } from "express";
import {
  asApiData,
  createId,
  isUserRole,
  type AuthSession,
  type UserRole,
} from "@kxkm/core";
import { createSessionRecord, generateSessionToken, validateLoginInput } from "@kxkm/auth";
import { buildChatChannels } from "@kxkm/chat-domain";
import {
  PERSONA_SEED_CATALOG,
  clonePersona,
  createFeedback,
  createProposal,
  extractDPOPairs,
  type PersonaFeedbackRecord,
  type PersonaProposalRecord,
  type PersonaRecord,
  type PersonaSourceRecord,
} from "@kxkm/persona-domain";
import {
  createNodeEngineOverview,
  createNodeGraph,
  createNodeRun,
  type ModelRegistryRecord,
  type NodeGraphRecord,
  type NodeRunRecord,
} from "@kxkm/node-engine";
import { createSessionRoutes } from "./routes/session.js";
import { createPersonaRoutes } from "./routes/personas.js";
import { createNodeEngineRoutes } from "./routes/node-engine.js";
import { createChatHistoryRoutes } from "./routes/chat-history.js";
import mediaRoutes from "./routes/media.js";
import { bootstrapRepositories } from "./app-bootstrap.js";
import {
  type SessionRequest,
  createSessionMiddleware,
  createRequireSession,
  createRequirePermission,
  createAdminSubnetMiddleware,
  createPerfTracker,
} from "./app-middleware.js";

const COOKIE_NAME = "kxkm_v2_session";

function localStoreFiles() {
  const storeDir = path.resolve(process.cwd(), process.env.KXKM_LOCAL_DATA_DIR || "data/v2-local");
  return {
    personas: path.join(storeDir, "personas.json"),
    personaSources: path.join(storeDir, "persona-sources.json"),
    personaFeedback: path.join(storeDir, "persona-feedback.json"),
    personaProposals: path.join(storeDir, "persona-proposals.json"),
  };
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") {
      console.warn(`[kxkm/api] failed to read ${filePath}: ${e.message}`);
    }
    return fallback;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// In-memory repo adapters (fallback when DATABASE_URL is not set)
// ---------------------------------------------------------------------------

function createInMemorySessionRepo() {
  const sessions = new Map<string, AuthSession>();
  let lastCleanupAt = 0;

  function maybeCleanupExpired(now: number): void {
    // Throttle cleanup to avoid O(n) scans on every request.
    if (now - lastCleanupAt < 60_000) return;
    lastCleanupAt = now;
    for (const [id, session] of sessions) {
      if (new Date(session.expiresAt).getTime() < now) {
        sessions.delete(id);
      }
    }
  }

  return {
    async create(input: { username: string; role: UserRole; expiresAt?: string }): Promise<AuthSession> {
      maybeCleanupExpired(Date.now());
      const id = generateSessionToken();
      const session = createSessionRecord({ username: input.username, role: input.role }, id);
      sessions.set(id, session);
      return session;
    },
    async findById(id: string): Promise<AuthSession | null> {
      maybeCleanupExpired(Date.now());
      return sessions.get(id) || null;
    },
    async deleteById(id: string): Promise<void> {
      sessions.delete(id);
    },
    async deleteExpired(): Promise<number> {
      const now = Date.now();
      let count = 0;
      for (const [id, session] of sessions) {
        if (new Date(session.expiresAt).getTime() < now) {
          sessions.delete(id);
          count++;
        }
      }
      return count;
    },
  };
}

function createInMemoryPersonaRepo() {
  const files = localStoreFiles();
  const personas = new Map<string, PersonaRecord>();
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;

    const saved = await readJson<PersonaRecord[]>(files.personas, []);
    if (saved.length > 0) {
      for (const persona of saved) {
        personas.set(persona.id, { ...persona });
      }
      return;
    }

    for (const seed of PERSONA_SEED_CATALOG) {
      personas.set(seed.id, clonePersona(seed));
    }
    await writeJson(files.personas, [...personas.values()]);
  }

  async function persist(): Promise<void> {
    await writeJson(files.personas, [...personas.values()]);
  }

  return {
    async list(): Promise<PersonaRecord[]> {
      await ensureLoaded();
      return [...personas.values()];
    },
    async findById(id: string): Promise<PersonaRecord | null> {
      await ensureLoaded();
      return personas.get(id) || null;
    },
    async upsert(persona: PersonaRecord): Promise<PersonaRecord> {
      await ensureLoaded();
      personas.set(persona.id, { ...persona });
      await persist();
      return { ...persona };
    },
    async seedCatalog(catalog: PersonaRecord[]): Promise<void> {
      await ensureLoaded();
      let changed = false;
      for (const p of catalog) {
        if (!personas.has(p.id)) {
          personas.set(p.id, clonePersona(p));
          changed = true;
        }
      }
      if (changed) {
        await persist();
      }
    },
  };
}

function createInMemoryNodeGraphRepo() {
  const graphs = new Map<string, NodeGraphRecord>([
    ["starter_local_eval", createNodeGraph("starter_local_eval", "Prototype local evaluation graph")],
  ]);
  // Fix: createNodeGraph generates a random id, so re-set with desired id
  const starterGraph: NodeGraphRecord = { id: "starter_local_eval", name: "starter_local_eval", description: "Prototype local evaluation graph" };
  graphs.set(starterGraph.id, starterGraph);

  return {
    async list(): Promise<NodeGraphRecord[]> {
      return [...graphs.values()];
    },
    async findById(id: string): Promise<NodeGraphRecord | null> {
      return graphs.get(id) || null;
    },
    async create(graph: NodeGraphRecord): Promise<NodeGraphRecord> {
      graphs.set(graph.id, { ...graph });
      return { ...graph };
    },
    async update(id: string, patch: Partial<NodeGraphRecord>): Promise<NodeGraphRecord | null> {
      const graph = graphs.get(id);
      if (!graph) return null;
      if (patch.name !== undefined) graph.name = patch.name;
      if (patch.description !== undefined) graph.description = patch.description;
      return { ...graph };
    },
  };
}

function createInMemoryNodeRunRepo() {
  const runs = new Map<string, NodeRunRecord>();
  return {
    async list(): Promise<NodeRunRecord[]> {
      return [...runs.values()];
    },
    async findById(id: string): Promise<NodeRunRecord | null> {
      return runs.get(id) || null;
    },
    async create(run: NodeRunRecord): Promise<NodeRunRecord> {
      runs.set(run.id, { ...run });
      return { ...run };
    },
    async updateStatus(id: string, status: NodeRunRecord["status"]): Promise<void> {
      const run = runs.get(id);
      if (run) run.status = status;
    },
    async requestCancel(id: string): Promise<void> {
      const run = runs.get(id);
      if (run) run.status = "cancelled";
    },
    async deleteOlderThan(date: string): Promise<number> {
      const threshold = new Date(date).getTime();
      let count = 0;
      for (const [id, run] of runs) {
        if (
          ["completed", "failed", "cancelled"].includes(run.status) &&
          new Date(run.createdAt).getTime() < threshold
        ) {
          runs.delete(id);
          count++;
        }
      }
      return count;
    },
  };
}

function createInMemoryPersonaSourceRepo() {
  const files = localStoreFiles();
  const sources = new Map<string, PersonaSourceRecord>();
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const saved = await readJson<Record<string, PersonaSourceRecord>>(files.personaSources, {});
    for (const [personaId, source] of Object.entries(saved)) {
      sources.set(personaId, { ...source });
    }
  }

  async function persist(): Promise<void> {
    const objectView = Object.fromEntries(sources.entries());
    await writeJson(files.personaSources, objectView);
  }

  return {
    async findByPersonaId(personaId: string): Promise<PersonaSourceRecord | null> {
      await ensureLoaded();
      return sources.get(personaId) || null;
    },
    async upsert(source: PersonaSourceRecord): Promise<PersonaSourceRecord> {
      await ensureLoaded();
      sources.set(source.personaId, { ...source });
      await persist();
      return { ...source };
    },
  };
}

function createInMemoryPersonaFeedbackRepo() {
  const files = localStoreFiles();
  const feedback = new Map<string, PersonaFeedbackRecord[]>();
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const saved = await readJson<PersonaFeedbackRecord[]>(files.personaFeedback, []);
    for (const record of saved) {
      const list = feedback.get(record.personaId) || [];
      list.push({ ...record });
      feedback.set(record.personaId, list);
    }
  }

  async function persist(): Promise<void> {
    const all = [...feedback.values()].flat();
    await writeJson(files.personaFeedback, all);
  }

  return {
    async listByPersonaId(personaId: string): Promise<PersonaFeedbackRecord[]> {
      await ensureLoaded();
      return feedback.get(personaId) || [];
    },
    async create(record: PersonaFeedbackRecord): Promise<PersonaFeedbackRecord> {
      await ensureLoaded();
      const list = feedback.get(record.personaId) || [];
      list.push({ ...record });
      feedback.set(record.personaId, list);
      await persist();
      return { ...record };
    },
  };
}

function createInMemoryPersonaProposalRepo() {
  const files = localStoreFiles();
  const proposals = new Map<string, PersonaProposalRecord[]>();
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const saved = await readJson<PersonaProposalRecord[]>(files.personaProposals, []);
    for (const record of saved) {
      const list = proposals.get(record.personaId) || [];
      list.push({ ...record });
      proposals.set(record.personaId, list);
    }
  }

  async function persist(): Promise<void> {
    const all = [...proposals.values()].flat();
    await writeJson(files.personaProposals, all);
  }

  return {
    async listByPersonaId(personaId: string): Promise<PersonaProposalRecord[]> {
      await ensureLoaded();
      return proposals.get(personaId) || [];
    },
    async create(record: PersonaProposalRecord): Promise<PersonaProposalRecord> {
      await ensureLoaded();
      const list = proposals.get(record.personaId) || [];
      list.push({ ...record });
      proposals.set(record.personaId, list);
      await persist();
      return { ...record };
    },
    async markApplied(id: string): Promise<void> {
      await ensureLoaded();
      for (const list of proposals.values()) {
        const proposal = list.find((p) => p.id === id);
        if (proposal) {
          proposal.applied = true;
          await persist();
          return;
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Repo interface types (union of Postgres and in-memory)
// ---------------------------------------------------------------------------

type SessionRepo = ReturnType<typeof createInMemorySessionRepo>;
type PersonaRepo = ReturnType<typeof createInMemoryPersonaRepo>;
type GraphRepo = ReturnType<typeof createInMemoryNodeGraphRepo>;
type RunRepo = ReturnType<typeof createInMemoryNodeRunRepo>;
type SourceRepo = ReturnType<typeof createInMemoryPersonaSourceRepo>;
type FeedbackRepo = ReturnType<typeof createInMemoryPersonaFeedbackRepo>;
type ProposalRepo = ReturnType<typeof createInMemoryPersonaProposalRepo>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const modelRegistry: ModelRegistryRecord[] = [
  { id: "qwen2.5:14b", label: "Qwen 2.5 14B", runtime: "local_gpu" },
  { id: "mistral:7b", label: "Mistral 7B", runtime: "local_cpu" },
  { id: "mythalion:latest", label: "Mythalion", runtime: "local_gpu" },
];

function readRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function escapeForHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function setSessionCookie(res: Response, sessionId: string): void {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
}

function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// ---------------------------------------------------------------------------
// Persona sub-store default helper
// ---------------------------------------------------------------------------

function defaultPersonaSource(personaId: string, personaName: string): PersonaSourceRecord {
  return {
    personaId,
    subjectName: personaName || personaId,
    summary: "Aucune source structuree pour le moment.",
    references: [],
  };
}

// ---------------------------------------------------------------------------
// Simulated run transition (dev/demo purposes)
// ---------------------------------------------------------------------------

function enqueueRunTransition(runId: string, runRepo: RunRepo): void {
  const timer1 = setTimeout(async () => {
    const run = await runRepo.findById(runId);
    if (!run || run.status !== "queued") {
      clearTimeout(timer2);
      return;
    }
    await runRepo.updateStatus(runId, "running");
  }, 50);

  const timer2 = setTimeout(async () => {
    const run = await runRepo.findById(runId);
    if (!run || run.status !== "running") return;
    await runRepo.updateStatus(runId, "completed");
  }, 150);
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export async function createApp(): Promise<{ app: express.Express; personaRepo: PersonaRepo }> {
  let sessionRepo: SessionRepo;
  let personaRepo: PersonaRepo;
  let graphRepo: GraphRepo;
  let runRepo: RunRepo;
  let sourceRepo: SourceRepo;
  let feedbackRepo: FeedbackRepo;
  let proposalRepo: ProposalRepo;
  let storageMode: "postgres" | "memory";

  ({
    sessionRepo,
    personaRepo,
    graphRepo,
    runRepo,
    sourceRepo,
    feedbackRepo,
    proposalRepo,
    storageMode,
  } = await bootstrapRepositories({
    createSessionRepo: createInMemorySessionRepo,
    createPersonaRepo: createInMemoryPersonaRepo,
    createGraphRepo: createInMemoryNodeGraphRepo,
    createRunRepo: createInMemoryNodeRunRepo,
    createSourceRepo: createInMemoryPersonaSourceRepo,
    createFeedbackRepo: createInMemoryPersonaFeedbackRepo,
    createProposalRepo: createInMemoryPersonaProposalRepo,
  }));

  const app = express();
  app.use(express.json());
  app.use(createSessionMiddleware(sessionRepo));

  const requireSession = createRequireSession();
  const requirePermission = createRequirePermission;
  const subnetMiddleware = createAdminSubnetMiddleware(process.env.ADMIN_SUBNET);
  const perfTracker = createPerfTracker();

  if (subnetMiddleware) {
    app.use("/api/v2/admin", subnetMiddleware);
  }
  app.use(perfTracker.middleware);
  app.get("/api/v2/perf", perfTracker.route);

  // -----------------------------------------------------------------------
  // Routes (extracted to routes/ modules)
  // -----------------------------------------------------------------------

  app.use(createSessionRoutes({
    sessionRepo,
    personaRepo,
    graphRepo,
    runRepo,
    modelRegistry,
    storageMode,
    requireSession,
    requirePermission,
    setSessionCookie,
    clearSessionCookie,
  }));

  app.use(createPersonaRoutes({
    personaRepo,
    sourceRepo,
    feedbackRepo,
    proposalRepo,
    requireSession,
    requirePermission,
    readRouteParam,
  }));

  app.use(createNodeEngineRoutes({
    graphRepo,
    runRepo,
    modelRegistry,
    requirePermission,
    readRouteParam,
    enqueueRunTransition,
  }));

  app.use("/api/v2/media", mediaRoutes);

  app.use(createChatHistoryRoutes({
    personaRepo,
    feedbackRepo,
    runRepo,
    storageMode,
    requireSession,
    requirePermission,
    readRouteParam,
    escapeForHtml,
  }));

  return { app, personaRepo };
}
