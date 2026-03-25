import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PERSONA_SEED_CATALOG,
  clonePersona,
  type PersonaFeedbackRecord,
  type PersonaProposalRecord,
  type PersonaRecord,
  type PersonaSourceRecord,
} from "@kxkm/persona-domain";
import {
  type ModelRegistryRecord,
  type NodeGraphRecord,
  type NodeRunRecord,
} from "@kxkm/node-engine";
import { createSessionRecord, generateSessionToken } from "@kxkm/auth";
import type { AuthSession, UserRole } from "@kxkm/core";

// ---------------------------------------------------------------------------
// JSON persistence helpers
// ---------------------------------------------------------------------------

function localStoreFiles() {
  const storeDir = path.resolve(process.cwd(), process.env.KXKM_LOCAL_DATA_DIR || "data/v2-local");
  return {
    personasDir: path.join(storeDir, "personas"),
    personaSourcesDir: path.join(storeDir, "persona-sources"),
    personaFeedbackDir: path.join(storeDir, "persona-feedback"),
    personaProposalsDir: path.join(storeDir, "persona-proposals"),
    legacyPersonas: path.join(storeDir, "personas.json"),
    legacyPersonaSources: path.join(storeDir, "persona-sources.json"),
    legacyPersonaFeedback: path.join(storeDir, "persona-feedback.json"),
    legacyPersonaProposals: path.join(storeDir, "persona-proposals.json"),
  };
}

function safePersonaFileName(personaId: string): string {
  const safe = String(personaId || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${safe || "persona"}.json`;
}

function personaFilePath(directory: string, personaId: string): string {
  return path.join(directory, safePersonaFileName(personaId));
}

async function readJsonFiles<T>(directory: string): Promise<T[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const rows: T[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const record = await readJson<T | null>(path.join(directory, entry), null);
    if (record !== null) rows.push(record);
  }
  return rows;
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

function clonePersonaRecord(persona: PersonaRecord): PersonaRecord {
  return { ...persona };
}

function cloneAuthSession(session: AuthSession): AuthSession {
  return { ...session };
}

function cloneNodeGraphRecord(graph: NodeGraphRecord): NodeGraphRecord {
  return { ...graph };
}

function cloneNodeRunRecord(run: NodeRunRecord): NodeRunRecord {
  return { ...run };
}

function clonePersonaSourceRecord(source: PersonaSourceRecord): PersonaSourceRecord {
  return { ...source };
}

function clonePersonaFeedbackRecord(record: PersonaFeedbackRecord): PersonaFeedbackRecord {
  return { ...record };
}

function clonePersonaProposalRecord(record: PersonaProposalRecord): PersonaProposalRecord {
  return { ...record };
}

// ---------------------------------------------------------------------------
// Local repo adapters (fallback when DATABASE_URL is not set)
// ---------------------------------------------------------------------------

export function createLocalSessionRepo() {
  const sessions = new Map<string, AuthSession>();
  let lastCleanupAt = 0;

  function maybeCleanupExpired(now: number): void {
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
      return cloneAuthSession(session);
    },
    async findById(id: string): Promise<AuthSession | null> {
      maybeCleanupExpired(Date.now());
      const session = sessions.get(id);
      return session ? cloneAuthSession(session) : null;
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

export function createLocalPersonaRepo() {
  const files = localStoreFiles();
  const personas = new Map<string, PersonaRecord>();
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;

    const byPersonaFiles = await readJsonFiles<PersonaRecord>(files.personasDir);
    for (const persona of byPersonaFiles) {
      personas.set(persona.id, { ...persona });
    }

    const saved = await readJson<PersonaRecord[]>(files.legacyPersonas, []);
    for (const persona of saved) {
      if (personas.has(persona.id)) continue;
      personas.set(persona.id, { ...persona });
      await writeJson(personaFilePath(files.personasDir, persona.id), persona);
    }

    if (personas.size > 0) {
      return;
    }

    for (const seed of PERSONA_SEED_CATALOG) {
      const cloned = clonePersona(seed);
      personas.set(seed.id, cloned);
      await writeJson(personaFilePath(files.personasDir, seed.id), cloned);
    }
  }

  return {
    async list(): Promise<PersonaRecord[]> {
      await ensureLoaded();
      return [...personas.values()].map(clonePersonaRecord);
    },
    async findById(id: string): Promise<PersonaRecord | null> {
      await ensureLoaded();
      const persona = personas.get(id);
      return persona ? clonePersonaRecord(persona) : null;
    },
    async upsert(persona: PersonaRecord): Promise<PersonaRecord> {
      await ensureLoaded();
      personas.set(persona.id, { ...persona });
      await writeJson(personaFilePath(files.personasDir, persona.id), persona);
      return { ...persona };
    },
    async seedCatalog(catalog: PersonaRecord[]): Promise<void> {
      await ensureLoaded();
      let changed = false;
      for (const p of catalog) {
        if (!personas.has(p.id)) {
          const cloned = clonePersona(p);
          personas.set(p.id, cloned);
          await writeJson(personaFilePath(files.personasDir, p.id), cloned);
          changed = true;
        }
      }
      if (!changed) return;
    },
  };
}

export function createLocalNodeGraphRepo() {
  const starterGraph: NodeGraphRecord = { id: "starter_local_eval", name: "starter_local_eval", description: "Prototype local evaluation graph" };
  const graphs = new Map<string, NodeGraphRecord>([[starterGraph.id, cloneNodeGraphRecord(starterGraph)]]);

  return {
    async list(): Promise<NodeGraphRecord[]> {
      return [...graphs.values()].map(cloneNodeGraphRecord);
    },
    async findById(id: string): Promise<NodeGraphRecord | null> {
      const graph = graphs.get(id);
      return graph ? cloneNodeGraphRecord(graph) : null;
    },
    async create(graph: NodeGraphRecord): Promise<NodeGraphRecord> {
      const stored = cloneNodeGraphRecord(graph);
      graphs.set(stored.id, stored);
      return cloneNodeGraphRecord(stored);
    },
    async update(id: string, patch: Partial<NodeGraphRecord>): Promise<NodeGraphRecord | null> {
      const graph = graphs.get(id);
      if (!graph) return null;
      if (patch.name !== undefined) graph.name = patch.name;
      if (patch.description !== undefined) graph.description = patch.description;
      return cloneNodeGraphRecord(graph);
    },
  };
}

export function createLocalNodeRunRepo() {
  const runs = new Map<string, NodeRunRecord>();
  return {
    async list(): Promise<NodeRunRecord[]> {
      return [...runs.values()].map(cloneNodeRunRecord);
    },
    async findById(id: string): Promise<NodeRunRecord | null> {
      const run = runs.get(id);
      return run ? cloneNodeRunRecord(run) : null;
    },
    async create(run: NodeRunRecord): Promise<NodeRunRecord> {
      const stored = cloneNodeRunRecord(run);
      runs.set(stored.id, stored);
      return cloneNodeRunRecord(stored);
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

export function createLocalPersonaSourceRepo() {
  const files = localStoreFiles();
  const sources = new Map<string, PersonaSourceRecord>();
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;

    const byPersonaFiles = await readJsonFiles<PersonaSourceRecord>(files.personaSourcesDir);
    for (const source of byPersonaFiles) {
      sources.set(source.personaId, { ...source });
    }

    const saved = await readJson<Record<string, PersonaSourceRecord>>(files.legacyPersonaSources, {});
    for (const source of Object.values(saved)) {
      if (sources.has(source.personaId)) continue;
      sources.set(source.personaId, { ...source });
      await writeJson(personaFilePath(files.personaSourcesDir, source.personaId), source);
    }
  }

  return {
    async findByPersonaId(personaId: string): Promise<PersonaSourceRecord | null> {
      await ensureLoaded();
      const source = sources.get(personaId);
      return source ? clonePersonaSourceRecord(source) : null;
    },
    async upsert(source: PersonaSourceRecord): Promise<PersonaSourceRecord> {
      await ensureLoaded();
      sources.set(source.personaId, { ...source });
      await writeJson(personaFilePath(files.personaSourcesDir, source.personaId), source);
      return { ...source };
    },
  };
}

export function createLocalPersonaFeedbackRepo() {
  const files = localStoreFiles();
  const feedback = new Map<string, PersonaFeedbackRecord[]>();
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;

    const byPersonaFiles = await readJsonFiles<PersonaFeedbackRecord[] | PersonaFeedbackRecord>(files.personaFeedbackDir);
    for (const payload of byPersonaFiles) {
      const records = Array.isArray(payload) ? payload : [payload];
      for (const record of records) {
        const list = feedback.get(record.personaId) || [];
        list.push({ ...record });
        feedback.set(record.personaId, list);
      }
    }

    const saved = await readJson<PersonaFeedbackRecord[]>(files.legacyPersonaFeedback, []);
    const dirtyPersonaIds = new Set<string>();
    for (const record of saved) {
      const list = feedback.get(record.personaId) || [];
      if (list.some((entry) => entry.id === record.id)) continue;
      list.push({ ...record });
      feedback.set(record.personaId, list);
      dirtyPersonaIds.add(record.personaId);
    }
    for (const personaId of dirtyPersonaIds) {
      await writeJson(personaFilePath(files.personaFeedbackDir, personaId), feedback.get(personaId) || []);
    }
  }

  return {
    async listByPersonaId(personaId: string): Promise<PersonaFeedbackRecord[]> {
      await ensureLoaded();
      return (feedback.get(personaId) || []).map(clonePersonaFeedbackRecord);
    },
    async create(record: PersonaFeedbackRecord): Promise<PersonaFeedbackRecord> {
      await ensureLoaded();
      const list = feedback.get(record.personaId) || [];
      list.push({ ...record });
      feedback.set(record.personaId, list);
      await writeJson(personaFilePath(files.personaFeedbackDir, record.personaId), list);
      return { ...record };
    },
  };
}

export function createLocalPersonaProposalRepo() {
  const files = localStoreFiles();
  const proposals = new Map<string, PersonaProposalRecord[]>();
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;

    const byPersonaFiles = await readJsonFiles<PersonaProposalRecord[] | PersonaProposalRecord>(files.personaProposalsDir);
    for (const payload of byPersonaFiles) {
      const records = Array.isArray(payload) ? payload : [payload];
      for (const record of records) {
        const list = proposals.get(record.personaId) || [];
        list.push({ ...record });
        proposals.set(record.personaId, list);
      }
    }

    const saved = await readJson<PersonaProposalRecord[]>(files.legacyPersonaProposals, []);
    const dirtyPersonaIds = new Set<string>();
    for (const record of saved) {
      const list = proposals.get(record.personaId) || [];
      if (list.some((entry) => entry.id === record.id)) continue;
      list.push({ ...record });
      proposals.set(record.personaId, list);
      dirtyPersonaIds.add(record.personaId);
    }
    for (const personaId of dirtyPersonaIds) {
      await writeJson(personaFilePath(files.personaProposalsDir, personaId), proposals.get(personaId) || []);
    }
  }

  return {
    async listByPersonaId(personaId: string): Promise<PersonaProposalRecord[]> {
      await ensureLoaded();
      return (proposals.get(personaId) || []).map(clonePersonaProposalRecord);
    },
    async create(record: PersonaProposalRecord): Promise<PersonaProposalRecord> {
      await ensureLoaded();
      const list = proposals.get(record.personaId) || [];
      list.push({ ...record });
      proposals.set(record.personaId, list);
      await writeJson(personaFilePath(files.personaProposalsDir, record.personaId), list);
      return { ...record };
    },
    async markApplied(id: string): Promise<void> {
      await ensureLoaded();
      for (const [personaId, list] of proposals.entries()) {
        const proposal = list.find((p) => p.id === id);
        if (proposal) {
          proposal.applied = true;
          await writeJson(personaFilePath(files.personaProposalsDir, personaId), list);
          return;
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Repo interface types (union of Postgres and in-memory)
// ---------------------------------------------------------------------------

export type SessionRepo = ReturnType<typeof createLocalSessionRepo>;
export type PersonaRepo = ReturnType<typeof createLocalPersonaRepo>;
export type GraphRepo = ReturnType<typeof createLocalNodeGraphRepo>;
export type RunRepo = ReturnType<typeof createLocalNodeRunRepo>;
export type SourceRepo = ReturnType<typeof createLocalPersonaSourceRepo>;
export type FeedbackRepo = ReturnType<typeof createLocalPersonaFeedbackRepo>;
export type ProposalRepo = ReturnType<typeof createLocalPersonaProposalRepo>;

// ---------------------------------------------------------------------------
// Model registry + helpers
// ---------------------------------------------------------------------------

export const modelRegistry: ModelRegistryRecord[] = [
  { id: "qwen2.5:14b", label: "Qwen 2.5 14B", runtime: "local_gpu" },
  { id: "mistral:7b", label: "Mistral 7B", runtime: "local_cpu" },
  { id: "mythalion:latest", label: "Mythalion", runtime: "local_gpu" },
];

export function readRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export function escapeForHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function enqueueRunTransition(runId: string, runRepo: RunRepo): void {
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
