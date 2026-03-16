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
  return {
    async create(input: { username: string; role: UserRole; expiresAt?: string }): Promise<AuthSession> {
      const id = generateSessionToken();
      const session = createSessionRecord({ username: input.username, role: input.role }, id);
      sessions.set(id, session);
      return session;
    },
    async findById(id: string): Promise<AuthSession | null> {
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
  // Routes
  // -----------------------------------------------------------------------

  app.get("/api/v2/health", (_req, res) => {
    res.json(asApiData({
      app: "@kxkm/api",
      storage: storageMode, // BUG-06 fix: don't leak DATABASE_URL
      roles: ["admin", "editor", "operator", "viewer"] satisfies UserRole[],
    }));
  });

  // Public status strip — no auth required
  app.get("/api/v2/status", async (_req, res) => {
    try {
      const [personas, graphs, runs] = await Promise.all([
        personaRepo.list(),
        graphRepo.list(),
        runRepo.list(),
      ]);
      const activePersonas = personas.filter((p) => (p as unknown as { enabled?: boolean }).enabled !== false);
      const runningRuns = runs.filter((r) => r.status === "running");
      const queuedRuns = runs.filter((r) => r.status === "queued");

      res.json(asApiData({
        name: "KXKM_Clown",
        version: "2.0.0",
        storage: storageMode,
        personas: { total: personas.length, active: activePersonas.length },
        nodeEngine: {
          graphs: graphs.length,
          runs: runs.length,
          running: runningRuns.length,
          queued: queuedRuns.length,
        },
      }));
    } catch (err) {
      res.status(500).json({ ok: false, error: "status_error" });
    }
  });

  app.post("/api/session/login", async (req, res) => {
    try {
      const input = validateLoginInput(req.body);

      // SEC-04 fix: Never trust client-supplied role — assign viewer by default.
      // Admin role requires ADMIN_TOKEN env var match.
      let role: UserRole = "viewer";
      const adminToken = process.env.ADMIN_TOKEN;
      const tokenMatches = Boolean(adminToken && req.body?.token === adminToken);
      if (input.role === "admin" && tokenMatches) {
        role = "admin";
      } else if (input.role === "operator" || input.role === "editor") {
        // Allow non-admin elevated roles only if admin token is provided
        if (tokenMatches) {
          role = input.role as UserRole;
        }
      }

      const session = await sessionRepo.create({ username: input.username, role });
      setSessionCookie(res, session.id);
      res.json(asApiData(session));
    } catch {
      res.status(400).json({ ok: false, error: "invalid_login_payload" });
    }
  });

  app.get("/api/session", (req: SessionRequest, res) => {
    if (!req.session) {
      res.status(401).json({ ok: false, error: "session_required" });
      return;
    }
    res.json(asApiData(req.session));
  });

  app.post("/api/session/logout", async (req: SessionRequest, res) => {
    if (req.session) {
      await sessionRepo.deleteById(req.session.id);
    }
    clearSessionCookie(res);
    res.json(asApiData({ loggedOut: true }));
  });

  app.get("/api/chat/channels", requireSession, (_req, res) => {
    res.json(asApiData(buildChatChannels(modelRegistry.map((model) => model.id))));
  });

  app.get("/api/personas", requireSession, async (_req, res) => {
    const list = await personaRepo.list();
    res.json(asApiData(list));
  });

  app.get("/api/personas/:id", requireSession, async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    if (!persona) {
      res.status(404).json({ ok: false, error: "persona_not_found" });
      return;
    }
    res.json(asApiData(persona));
  });

  app.put("/api/admin/personas/:id", requirePermission("persona:write"), async (req: SessionRequest, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    if (!persona) {
      res.status(404).json({ ok: false, error: "persona_not_found" });
      return;
    }

    persona.name = String(req.body?.name || persona.name);
    persona.model = String(req.body?.model || persona.model);
    persona.summary = String(req.body?.summary || persona.summary);
    if (req.body?.enabled !== undefined) {
      (persona as unknown as Record<string, unknown>).enabled = Boolean(req.body.enabled);
    }

    await personaRepo.upsert(persona);

    await feedbackRepo.create(
      createFeedback(persona.id, "admin_edit", `Persona editee par ${req.session?.username || "unknown"}`),
    );

    res.json(asApiData(persona));
  });

  app.post("/api/admin/personas/:id/toggle", requirePermission("persona:write"), async (req: SessionRequest, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    if (!persona) {
      res.status(404).json({ ok: false, error: "persona_not_found" });
      return;
    }

    const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : !(persona as unknown as { enabled?: boolean }).enabled;
    (persona as unknown as Record<string, unknown>).enabled = enabled;
    await personaRepo.upsert(persona);

    await feedbackRepo.create(
      createFeedback(persona.id, "admin_edit", `Persona ${enabled ? "activee" : "desactivee"} par ${req.session?.username || "unknown"}`),
    );

    res.json(asApiData(persona));
  });

  app.get("/api/admin/personas/:id/source", requirePermission("persona:read"), async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    const source = await sourceRepo.findByPersonaId(personaId);
    res.json(asApiData(source || defaultPersonaSource(personaId, persona?.name || personaId)));
  });

  app.put("/api/admin/personas/:id/source", requirePermission("persona:write"), async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const source: PersonaSourceRecord = {
      personaId,
      subjectName: String(req.body?.subjectName || personaId),
      summary: String(req.body?.summary || ""),
      references: Array.isArray(req.body?.references) ? req.body.references.map(String) : [],
    };
    const saved = await sourceRepo.upsert(source);
    res.json(asApiData(saved));
  });

  app.get("/api/admin/personas/:id/feedback", requirePermission("persona:read"), async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const list = await feedbackRepo.listByPersonaId(personaId);
    res.json(asApiData(list));
  });

  app.get("/api/admin/personas/:id/proposals", requirePermission("persona:read"), async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const list = await proposalRepo.listByPersonaId(personaId);
    res.json(asApiData(list));
  });

  app.post("/api/admin/personas/:id/reinforce", requirePermission("persona:write"), async (req: SessionRequest, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    if (!persona) {
      res.status(404).json({ ok: false, error: "persona_not_found" });
      return;
    }

    const existingFeedback = await feedbackRepo.listByPersonaId(persona.id);
    const suffix = existingFeedback.length ? " affinee par feedback" : " calibree par source";
    const after = {
      name: String(req.body?.name || persona.name),
      model: String(req.body?.model || persona.model),
      summary: String(req.body?.summary || `${persona.summary}${suffix}`),
    };
    const apply = Boolean(req.body?.apply);
    const proposal = createProposal(persona, after, "reinforce_v2", apply);

    if (apply) {
      persona.name = after.name;
      persona.model = after.model;
      persona.summary = after.summary;
      await personaRepo.upsert(persona);
    }

    const saved = await proposalRepo.create(proposal);
    res.json(asApiData(saved));
  });

  app.post("/api/admin/personas/:id/revert", requirePermission("persona:write"), async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    const personaProposals = await proposalRepo.listByPersonaId(personaId);
    const lastApplied = [...personaProposals].reverse().find((proposal) => proposal.applied);

    if (!persona || !lastApplied) {
      res.status(404).json({ ok: false, error: "proposal_not_found" });
      return;
    }

    persona.name = lastApplied.before.name;
    persona.model = lastApplied.before.model;
    persona.summary = lastApplied.before.summary;
    await personaRepo.upsert(persona);

    res.json(asApiData(persona));
  });

  app.get("/api/admin/node-engine/overview", requirePermission("node_engine:read"), async (_req, res) => {
    const allRuns = await runRepo.list();
    const allGraphs = await graphRepo.list();
    const overview = createNodeEngineOverview({
      graphs: allGraphs.length,
      models: modelRegistry.length,
      queuedRuns: allRuns.filter((run) => run.status === "queued").length,
      runningRuns: allRuns.filter((run) => run.status === "running").length,
    });
    res.json(asApiData(overview));
  });

  app.get("/api/admin/node-engine/graphs", requirePermission("node_engine:read"), async (_req, res) => {
    const list = await graphRepo.list();
    res.json(asApiData(list));
  });

  app.post("/api/admin/node-engine/graphs", requirePermission("node_engine:operate"), async (req, res) => {
    const graph = createNodeGraph(
      String(req.body?.name || "graph"),
      String(req.body?.description || ""),
    );
    const created = await graphRepo.create(graph);
    res.status(201).json(asApiData(created));
  });

  app.put("/api/admin/node-engine/graphs/:id", requirePermission("node_engine:operate"), async (req, res) => {
    const graphId = readRouteParam(req.params.id);
    const graph = await graphRepo.findById(graphId);
    if (!graph) {
      res.status(404).json({ ok: false, error: "graph_not_found" });
      return;
    }
    const updated = await graphRepo.update(graphId, {
      name: String(req.body?.name || graph.name),
      description: String(req.body?.description || graph.description),
    });
    res.json(asApiData(updated));
  });

  app.post("/api/admin/node-engine/graphs/:id/run", requirePermission("node_engine:operate"), async (req, res) => {
    const graphId = readRouteParam(req.params.id);
    const graph = await graphRepo.findById(graphId);
    if (!graph) {
      res.status(404).json({ ok: false, error: "graph_not_found" });
      return;
    }

    const run = createNodeRun(graphId, "queued");
    const created = await runRepo.create(run);
    if (!req.body?.hold) {
      enqueueRunTransition(created.id, runRepo);
    }
    res.status(201).json(asApiData(created));
  });

  app.get("/api/admin/node-engine/runs/:id", requirePermission("node_engine:read"), async (req, res) => {
    const runId = readRouteParam(req.params.id);
    const run = await runRepo.findById(runId);
    if (!run) {
      res.status(404).json({ ok: false, error: "run_not_found" });
      return;
    }
    res.json(asApiData(run));
  });

  app.post("/api/admin/node-engine/runs/:id/cancel", requirePermission("node_engine:operate"), async (req, res) => {
    const runId = readRouteParam(req.params.id);
    const run = await runRepo.findById(runId);
    if (!run) {
      res.status(404).json({ ok: false, error: "run_not_found" });
      return;
    }
    await runRepo.updateStatus(runId, "cancelled");
    res.json(asApiData({ ...run, status: "cancelled" }));
  });

  app.post("/api/v2/node-engine/runs/:id/cancel", requirePermission("node_engine:operate"), async (req, res) => {
    const runId = readRouteParam(req.params.id);
    const run = await runRepo.findById(runId);
    if (!run) {
      res.status(404).json({ ok: false, error: "run_not_found" });
      return;
    }
    await runRepo.requestCancel(runId);
    res.json({ ok: true });
  });

  app.get("/api/admin/node-engine/artifacts/:runId", requirePermission("node_engine:read"), (req, res) => {
    const runId = readRouteParam(req.params.runId);
    res.json(asApiData({
      runId,
      artifacts: [
        { id: createId("artifact"), label: "overview.json", storage: "filesystem" },
      ],
    }));
  });

  app.get("/api/admin/node-engine/models", requirePermission("node_engine:read"), (_req, res) => {
    res.json(asApiData(modelRegistry));
  });

  // -----------------------------------------------------------------------
  // Retention sweep — delete old completed/failed/cancelled runs
  // -----------------------------------------------------------------------

  app.post("/api/v2/admin/retention-sweep", requirePermission("node_engine:operate"), async (req, res) => {
    const maxAgeDays = Number(req.body?.maxAgeDays) || 30;
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    const deleted = await runRepo.deleteOlderThan(cutoff);
    res.json({ ok: true, deleted });
  });

  // -----------------------------------------------------------------------
  // Export conversation as HTML
  // -----------------------------------------------------------------------

  app.get("/api/v2/export/html", requireSession, async (req: SessionRequest, res) => {
    try {
      const channel = readRouteParam(req.query?.channel as string || "general");
      const personas = await personaRepo.list();
      const personaMap = new Map(personas.map((p) => {
        const rec = p as unknown as { id: string; nick?: string; name?: string };
        return [rec.id, rec.nick || rec.name || rec.id] as const;
      }));

      // Build simple HTML export (session data placeholder — real impl would read from storage)
      const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>KXKM_Clown — Export #${escapeForHtml(channel)}</title>
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
    .msg { margin: 4px 0; } .nick { font-weight: bold; } .ts { color: #666; font-size: 0.85em; }
    h1 { color: #16213e; background: #0f3460; padding: 8px 16px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>#${escapeForHtml(channel)} — exported ${new Date().toISOString()}</h1>
  <p>Channel: <strong>#${escapeForHtml(channel)}</strong> | Personas: ${personas.length} | Storage: ${storageMode}</p>
  <p><em>Full message history requires session storage integration.</em></p>
</body>
</html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="kxkm-export-${channel}.html"`);
      res.send(html);
    } catch {
      res.status(500).json({ ok: false, error: "export_error" });
    }
  });

  // -----------------------------------------------------------------------
  // Export DPO training pairs as JSONL
  // -----------------------------------------------------------------------

  app.get("/api/v2/export/dpo", requirePermission("persona:read"), async (req: SessionRequest, res) => {
    try {
      const filterPersonaId = req.query?.persona_id ? readRouteParam(req.query.persona_id as string) : null;

      let personas = await personaRepo.list();
      if (filterPersonaId) {
        personas = personas.filter((p) => p.id === filterPersonaId);
        if (personas.length === 0) {
          res.status(404).json({ ok: false, error: "persona_not_found" });
          return;
        }
      }

      const allPairs: Array<{ prompt: string; chosen: string; rejected: string; persona_id: string }> = [];

      for (const persona of personas) {
        const feedback = await feedbackRepo.listByPersonaId(persona.id);
        const pairs = extractDPOPairs(feedback, persona);
        for (const pair of pairs) {
          allPairs.push({
            prompt: pair.prompt,
            chosen: pair.chosen,
            rejected: pair.rejected,
            persona_id: pair.personaId,
          });
        }
      }

      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Content-Disposition", `attachment; filename="dpo-pairs-${new Date().toISOString().slice(0, 10)}.jsonl"`);
      const lines = allPairs.map((pair) => JSON.stringify(pair));
      res.send(lines.join("\n") + (lines.length ? "\n" : ""));
    } catch {
      res.status(500).json({ ok: false, error: "dpo_export_error" });
    }
  });

  // -----------------------------------------------------------------------
  // Chat history — browse past chat log files
  // -----------------------------------------------------------------------

  const chatLogDir = path.resolve(process.cwd(), process.env.KXKM_LOCAL_DATA_DIR || "data", "chat-logs");

  app.get("/api/v2/chat/history", requireSession, async (_req, res) => {
    try {
      await mkdir(chatLogDir, { recursive: true });
      const entries = await readdir(chatLogDir);
      const jsonlFiles = entries.filter((f) => f.startsWith("v2-") && f.endsWith(".jsonl"));

      const files: Array<{ date: string; lines: number; size: number }> = [];

      for (const filename of jsonlFiles) {
        const dateMatch = filename.match(/^v2-(\d{4}-\d{2}-\d{2})\.jsonl$/);
        if (!dateMatch) continue;
        const filePath = path.join(chatLogDir, filename);
        const fileStat = await stat(filePath);
        const content = await readFile(filePath, "utf8");
        const lineCount = content.trim() ? content.trim().split("\n").length : 0;
        files.push({ date: dateMatch[1], lines: lineCount, size: fileStat.size });
      }

      files.sort((a, b) => b.date.localeCompare(a.date));
      res.json(asApiData({ files }));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        res.json(asApiData({ files: [] }));
        return;
      }
      res.status(500).json({ ok: false, error: "chat_history_error" });
    }
  });

  app.get("/api/v2/chat/history/:date", requireSession, async (req, res) => {
    try {
      const date = readRouteParam(req.params.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ ok: false, error: "invalid_date_format" });
        return;
      }

      const filePath = path.join(chatLogDir, `v2-${date}.jsonl`);
      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") {
          res.status(404).json({ ok: false, error: "log_not_found" });
          return;
        }
        throw err;
      }

      const allLines = content.trim().split("\n").filter(Boolean);
      const limit = Math.min(Math.max(Number(req.query?.limit) || 200, 1), 1000);
      const offset = Math.max(Number(req.query?.offset) || 0, 0);

      const sliced = allLines.slice(offset, offset + limit);
      const messages = sliced.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { text: line, type: "raw" };
        }
      });

      res.json(asApiData({ messages, total: allLines.length, limit, offset }));
    } catch {
      res.status(500).json({ ok: false, error: "chat_history_error" });
    }
  });

  return { app, personaRepo };
}
