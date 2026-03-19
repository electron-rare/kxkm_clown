import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  createNodeGraph,
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

export function createInMemorySessionRepo() {
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

export function createInMemoryPersonaRepo() {
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

export function createInMemoryNodeGraphRepo() {
  const graphs = new Map<string, NodeGraphRecord>([
    ["starter_local_eval", createNodeGraph("starter_local_eval", "Prototype local evaluation graph")],
  ]);
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

export function createInMemoryNodeRunRepo() {
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

export function createInMemoryPersonaSourceRepo() {
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

export function createInMemoryPersonaFeedbackRepo() {
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

export function createInMemoryPersonaProposalRepo() {
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

export type SessionRepo = ReturnType<typeof createInMemorySessionRepo>;
export type PersonaRepo = ReturnType<typeof createInMemoryPersonaRepo>;
export type GraphRepo = ReturnType<typeof createInMemoryNodeGraphRepo>;
export type RunRepo = ReturnType<typeof createInMemoryNodeRunRepo>;
export type SourceRepo = ReturnType<typeof createInMemoryPersonaSourceRepo>;
export type FeedbackRepo = ReturnType<typeof createInMemoryPersonaFeedbackRepo>;
export type ProposalRepo = ReturnType<typeof createInMemoryPersonaProposalRepo>;

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
