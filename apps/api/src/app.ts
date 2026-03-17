import net from "node:net";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { type Request, type Response, type NextFunction } from "express";
import {
  asApiData,
  createId,
  isUserRole,
  type AuthSession,
  type Permission,
  type UserRole,
} from "@kxkm/core";
import { createSessionRecord, hasPermission, extractSessionId, generateSessionToken, validateLoginInput } from "@kxkm/auth";
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
import {
  loadDatabaseConfig,
  createPostgresPool,
  runMigrations,
  createSessionRepo,
  createPersonaRepo,
  createNodeGraphRepo,
  createNodeRunRepo,
  createPersonaSourceRepo,
  createPersonaFeedbackRepo,
  createPersonaProposalRepo,
} from "@kxkm/storage";
import { createSessionRoutes } from "./routes/session.js";
import { createPersonaRoutes } from "./routes/personas.js";
import { createNodeEngineRoutes } from "./routes/node-engine.js";
import { createChatHistoryRoutes } from "./routes/chat-history.js";

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

interface SessionRequest extends Request {
  session?: AuthSession;
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
// Subnet helpers (mirrors V1 network-policy.js, simplified for single subnet)
// ---------------------------------------------------------------------------

interface ParsedSubnet {
  version: number;
  mask: bigint;
  network: bigint;
}

function normalizeIp(value: string): string {
  let ip = value.trim();
  const zoneIndex = ip.indexOf("%");
  if (zoneIndex >= 0) ip = ip.slice(0, zoneIndex);
  if (ip.startsWith("::ffff:") && net.isIP(ip.slice(7)) === 4) {
    return ip.slice(7);
  }
  return ip;
}

function ipv4ToBigInt(ip: string): bigint {
  return ip.split(".").reduce((r, o) => (r << 8n) + BigInt(Number.parseInt(o, 10)), 0n);
}

function ipv6ToBigInt(ip: string): bigint {
  const parts = ip.split("::");
  const head = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const tail = parts[1] ? parts[1].split(":").filter(Boolean) : [];
  const missing = 8 - (head.length + tail.length);
  const groups = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  return groups.reduce((r, g) => (r << 16n) + BigInt(Number.parseInt(g || "0", 16)), 0n);
}

function parseSubnet(entry: string): ParsedSubnet | null {
  const raw = entry.trim();
  if (!raw) return null;
  const [addressPart, prefixPart] = raw.split("/");
  const address = normalizeIp(addressPart);
  const version = net.isIP(address);
  if (!version) return null;

  const totalBits = version === 4 ? 32 : 128;
  const prefix = prefixPart === undefined ? totalBits : Number.parseInt(prefixPart, 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > totalBits) return null;

  const bits = BigInt(totalBits);
  const hostBits = BigInt(totalBits - prefix);
  const allOnes = (1n << bits) - 1n;
  const mask = prefix === 0 ? 0n : (allOnes << hostBits) & allOnes;
  const value = version === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);

  return { version, mask, network: value & mask };
}

function isIpInSubnet(ip: string, subnet: ParsedSubnet): boolean {
  const normalized = normalizeIp(ip);
  const version = net.isIP(normalized);
  if (!version || version !== subnet.version) return false;
  const value = version === 4 ? ipv4ToBigInt(normalized) : ipv6ToBigInt(normalized);
  return (value & subnet.mask) === subnet.network;
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

  const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";
  if (!process.env.DATABASE_URL && isProduction) {
    throw new Error("DATABASE_URL is required when NODE_ENV=production");
  }

  if (process.env.DATABASE_URL) {
    const dbConfig = loadDatabaseConfig();
    const pool = createPostgresPool(dbConfig);
    await runMigrations(pool);

    sessionRepo = createSessionRepo(pool);
    personaRepo = createPersonaRepo(pool);
    graphRepo = createNodeGraphRepo(pool);
    runRepo = createNodeRunRepo(pool);
    sourceRepo = createPersonaSourceRepo(pool);
    feedbackRepo = createPersonaFeedbackRepo(pool);
    proposalRepo = createPersonaProposalRepo(pool);

    // Seed personas from catalog
    await personaRepo.seedCatalog(PERSONA_SEED_CATALOG.map(clonePersona));

    storageMode = "postgres";
  } else {
    console.warn("[kxkm/api] DATABASE_URL not set — using local persona storage + in-memory runtime stores");

    sessionRepo = createInMemorySessionRepo();
    personaRepo = createInMemoryPersonaRepo();
    graphRepo = createInMemoryNodeGraphRepo();
    runRepo = createInMemoryNodeRunRepo();
    sourceRepo = createInMemoryPersonaSourceRepo();
    feedbackRepo = createInMemoryPersonaFeedbackRepo();
    proposalRepo = createInMemoryPersonaProposalRepo();

    storageMode = "memory";
  }

  const app = express();
  app.use(express.json());

  // Session middleware
  app.use((req: SessionRequest, _res: Response, next: NextFunction) => {
    const sessionId = extractSessionId(req as unknown as { cookies?: Record<string, string>; headers?: Record<string, string> });
    if (!sessionId) {
      next();
      return;
    }
    sessionRepo.findById(sessionId).then((session) => {
      if (session) req.session = session;
      next();
    }).catch(next);
  });

  function requireSession(req: SessionRequest, res: Response, next: NextFunction): void {
    if (!req.session) {
      res.status(401).json({ ok: false, error: "session_required" });
      return;
    }
    next();
  }

  function requirePermission(permission: Permission) {
    return (req: SessionRequest, res: Response, next: NextFunction) => {
      if (!req.session) {
        res.status(401).json({ ok: false, error: "session_required" });
        return;
      }
      if (!hasPermission(req.session.role, permission)) {
        res.status(403).json({ ok: false, error: "permission_denied" });
        return;
      }
      next();
    };
  }

  // -----------------------------------------------------------------------
  // Subnet gate — restrict /api/v2/admin/* when ADMIN_SUBNET is set
  // -----------------------------------------------------------------------

  if (process.env.ADMIN_SUBNET) {
    const subnet = parseSubnet(process.env.ADMIN_SUBNET);
    if (subnet) {
      app.use("/api/v2/admin", (req: Request, res: Response, next: NextFunction) => {
        const ip = normalizeIp(req.ip || req.socket?.remoteAddress || "");
        if (!isIpInSubnet(ip, subnet)) {
          res.status(403).json({ ok: false, error: "subnet_denied" });
          return;
        }
        next();
      });
    }
  }

  // -----------------------------------------------------------------------
  // Performance instrumentation middleware
  // -----------------------------------------------------------------------

  const perfStats = {
    requestCount: 0,
    totalLatencyMs: 0,
    maxLatencyMs: 0,
    statusCodes: new Map<number, number>(),
    startedAt: Date.now(),
  };

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();
    res.on("finish", () => {
      const latency = performance.now() - start;
      perfStats.requestCount++;
      perfStats.totalLatencyMs += latency;
      if (latency > perfStats.maxLatencyMs) perfStats.maxLatencyMs = latency;
      const code = res.statusCode;
      perfStats.statusCodes.set(code, (perfStats.statusCodes.get(code) || 0) + 1);
    });
    next();
  });

  app.get("/api/v2/perf", ((_req: Request, res: Response) => {
    const uptimeMs = Date.now() - perfStats.startedAt;
    const avgLatency = perfStats.requestCount > 0
      ? perfStats.totalLatencyMs / perfStats.requestCount
      : 0;
    const mem = process.memoryUsage();
    res.json({
      ok: true,
      data: {
        uptime_ms: uptimeMs,
        uptime_human: `${Math.floor(uptimeMs / 3600000)}h${Math.floor((uptimeMs % 3600000) / 60000)}m`,
        requests: perfStats.requestCount,
        avg_latency_ms: Math.round(avgLatency * 100) / 100,
        max_latency_ms: Math.round(perfStats.maxLatencyMs * 100) / 100,
        status_codes: Object.fromEntries(perfStats.statusCodes),
        memory: {
          rss_mb: Math.round(mem.rss / 1048576),
          heap_used_mb: Math.round(mem.heapUsed / 1048576),
          heap_total_mb: Math.round(mem.heapTotal / 1048576),
          external_mb: Math.round(mem.external / 1048576),
        },
      },
    });
  }) as express.RequestHandler);

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
