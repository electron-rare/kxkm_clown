import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ChatPersona,
  PersonaArchivalFact,
  PersonaArchivalMemory,
  PersonaArchivalSummary,
  PersonaMemory,
  PersonaWorkingMemory,
} from "./chat-types.js";

type PersonaMemorySubject = string | Pick<ChatPersona, "id" | "nick"> | { id?: string; personaId?: string; nick: string };

interface PersonaMemoryRecordV2 {
  version: 2;
  personaId: string;
  personaNick: string;
  updatedAt: string;
  workingMemory: PersonaWorkingMemory;
  archivalMemory: PersonaArchivalMemory;
  compat: {
    facts: string[];
    summary: string;
    lastUpdated: string;
  };
}

const memoryCache = new Map<string, { data: PersonaMemory; loadedAt: number }>();
const MEMORY_CACHE_TTL = 30_000;

function resolveIdentity(subject: PersonaMemorySubject): { personaId?: string; nick: string } {
  if (typeof subject === "string") {
    return { nick: subject };
  }

  const personaId = "personaId" in subject && typeof subject.personaId === "string" && subject.personaId.trim()
    ? subject.personaId.trim()
    : (typeof subject.id === "string" && subject.id.trim() ? subject.id.trim() : undefined);

  return {
    personaId,
    nick: String(subject.nick || "").trim(),
  };
}

function resolveDirs(): { v2Dir: string; legacyDir: string } {
  const localStoreDir = path.resolve(process.cwd(), process.env.KXKM_LOCAL_DATA_DIR || "data/v2-local");
  const legacyOverride = process.env.KXKM_PERSONA_MEMORY_LEGACY_DIR;
  const legacyDir = legacyOverride && legacyOverride.trim().length > 0
    ? path.resolve(process.cwd(), legacyOverride)
    : path.join(path.dirname(localStoreDir), "persona-memory");

  return {
    v2Dir: path.join(localStoreDir, "persona-memory"),
    legacyDir,
  };
}

function safeFileSegment(value: string): string {
  const safe = String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "persona";
}

function v2PathForId(v2Dir: string, personaId: string): string {
  return path.join(v2Dir, `${safeFileSegment(personaId)}.json`);
}

function legacyPathForNick(legacyDir: string, nick: string): string {
  return path.join(legacyDir, `${safeFileSegment(nick)}.json`);
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function uniqueTrimmed(values: unknown[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const text = String(value || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }

  return result.slice(-limit);
}

function cloneArchivalFacts(values: PersonaArchivalFact[]): PersonaArchivalFact[] {
  return values.map((entry) => ({ ...entry }));
}

function cloneArchivalSummaries(values: PersonaArchivalSummary[]): PersonaArchivalSummary[] {
  return values.map((entry) => ({ ...entry }));
}

function clonePersonaMemory(memory: PersonaMemory): PersonaMemory {
  return {
    nick: memory.nick,
    facts: [...memory.facts],
    summary: memory.summary,
    lastUpdated: memory.lastUpdated,
    personaId: memory.personaId,
    version: memory.version,
    workingMemory: memory.workingMemory
      ? {
        facts: [...memory.workingMemory.facts],
        summary: memory.workingMemory.summary,
        lastSourceMessages: [...memory.workingMemory.lastSourceMessages],
      }
      : undefined,
    archivalMemory: memory.archivalMemory
      ? {
        facts: cloneArchivalFacts(memory.archivalMemory.facts),
        summaries: cloneArchivalSummaries(memory.archivalMemory.summaries),
      }
      : undefined,
  };
}

function createEmptyPersonaMemory(identity: { personaId?: string; nick: string }): PersonaMemory {
  return {
    nick: identity.nick,
    facts: [],
    summary: "",
    lastUpdated: "",
    personaId: identity.personaId,
    version: 2,
    workingMemory: {
      facts: [],
      summary: "",
      lastSourceMessages: [],
    },
    archivalMemory: {
      facts: [],
      summaries: [],
    },
  };
}

function toCompatMemory(record: PersonaMemoryRecordV2): PersonaMemory {
  return {
    nick: record.personaNick,
    facts: [...record.compat.facts],
    summary: record.compat.summary,
    lastUpdated: record.compat.lastUpdated || record.updatedAt,
    personaId: record.personaId,
    version: 2,
    workingMemory: {
      facts: [...record.workingMemory.facts],
      summary: record.workingMemory.summary,
      lastSourceMessages: [...record.workingMemory.lastSourceMessages],
    },
    archivalMemory: {
      facts: cloneArchivalFacts(record.archivalMemory.facts),
      summaries: cloneArchivalSummaries(record.archivalMemory.summaries),
    },
  };
}

function upsertArchivalFacts(existing: PersonaArchivalFact[], facts: string[], timestamp: string): PersonaArchivalFact[] {
  const byText = new Map<string, PersonaArchivalFact>();

  for (const entry of existing) {
    const text = String(entry.text || "").trim();
    if (!text) continue;
    byText.set(text.toLowerCase(), { ...entry, text });
  }

  for (const fact of facts) {
    const key = fact.toLowerCase();
    const current = byText.get(key);
    if (current) {
      current.lastSeenAt = timestamp;
      continue;
    }

    byText.set(key, {
      text: fact,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      source: "chat",
    });
  }

  return [...byText.values()].slice(-100);
}

function upsertArchivalSummaries(existing: PersonaArchivalSummary[], summary: string, timestamp: string): PersonaArchivalSummary[] {
  const trimmed = summary.trim();
  const next = cloneArchivalSummaries(existing).slice(-49);
  if (!trimmed) return next;
  const last = next[next.length - 1];
  if (last?.text === trimmed) return next;
  next.push({ text: trimmed, createdAt: timestamp });
  return next;
}

function toRecord(memory: PersonaMemory): PersonaMemoryRecordV2 {
  const timestamp = new Date().toISOString();
  const personaId = String(memory.personaId || memory.nick || "").trim();
  const nick = String(memory.nick || "").trim();
  const workingFacts = uniqueTrimmed(memory.workingMemory?.facts || memory.facts || [], 20);
  const workingSummary = String(memory.workingMemory?.summary ?? memory.summary ?? "").trim();
  const lastSourceMessages = uniqueTrimmed(memory.workingMemory?.lastSourceMessages || [], 10);
  const archivalFacts = upsertArchivalFacts(memory.archivalMemory?.facts || [], workingFacts, timestamp);
  const archivalSummaries = upsertArchivalSummaries(memory.archivalMemory?.summaries || [], workingSummary, timestamp);

  return {
    version: 2,
    personaId,
    personaNick: nick,
    updatedAt: timestamp,
    workingMemory: {
      facts: workingFacts,
      summary: workingSummary,
      lastSourceMessages,
    },
    archivalMemory: {
      facts: archivalFacts,
      summaries: archivalSummaries,
    },
    compat: {
      facts: workingFacts,
      summary: workingSummary,
      lastUpdated: timestamp,
    },
  };
}

function fromLegacyMemory(
  identity: { personaId?: string; nick: string },
  legacy: Partial<PersonaMemory>,
): PersonaMemoryRecordV2 {
  const timestamp = String(legacy.lastUpdated || "").trim() || new Date().toISOString();
  const facts = uniqueTrimmed(Array.isArray(legacy.facts) ? legacy.facts : [], 20);
  const summary = String(legacy.summary || "").trim();

  return {
    version: 2,
    personaId: String(identity.personaId || identity.nick || "").trim(),
    personaNick: identity.nick,
    updatedAt: timestamp,
    workingMemory: {
      facts,
      summary,
      lastSourceMessages: [],
    },
    archivalMemory: {
      facts: facts.map((text) => ({
        text,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        source: "chat",
      })),
      summaries: summary ? [{ text: summary, createdAt: timestamp }] : [],
    },
    compat: {
      facts,
      summary,
      lastUpdated: timestamp,
    },
  };
}

async function readV2Record(identity: { personaId?: string; nick: string }): Promise<PersonaMemoryRecordV2 | null> {
  const { v2Dir } = resolveDirs();

  if (identity.personaId) {
    const direct = await readJson<PersonaMemoryRecordV2>(v2PathForId(v2Dir, identity.personaId));
    if (direct?.version === 2) return direct;
  }

  let entries: string[] = [];
  try {
    entries = await readdir(v2Dir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const record = await readJson<PersonaMemoryRecordV2>(path.join(v2Dir, entry));
    if (record?.version !== 2) continue;
    if (record.personaNick.toLowerCase() === identity.nick.toLowerCase()) {
      return record;
    }
  }

  return null;
}

function cacheKeys(identity: { personaId?: string; nick: string }): string[] {
  const keys = [`nick:${identity.nick.toLowerCase()}`];
  if (identity.personaId) keys.unshift(`id:${identity.personaId}`);
  return keys;
}

function setCache(identity: { personaId?: string; nick: string }, memory: PersonaMemory): void {
  const cloned = clonePersonaMemory(memory);
  for (const key of cacheKeys(identity)) {
    memoryCache.set(key, { data: cloned, loadedAt: Date.now() });
  }
}

export function clearPersonaMemoryCache(): void {
  memoryCache.clear();
}

export async function loadPersonaMemory(subject: PersonaMemorySubject): Promise<PersonaMemory> {
  const identity = resolveIdentity(subject);
  for (const key of cacheKeys(identity)) {
    const cached = memoryCache.get(key);
    if (cached && Date.now() - cached.loadedAt < MEMORY_CACHE_TTL) {
      return clonePersonaMemory(cached.data);
    }
  }

  const record = await readV2Record(identity);
  if (record) {
    const memory = toCompatMemory(record);
    setCache(identity, memory);
    return clonePersonaMemory(memory);
  }

  const { legacyDir, v2Dir } = resolveDirs();
  const legacy = await readJson<PersonaMemory>(legacyPathForNick(legacyDir, identity.nick));
  if (legacy) {
    const migrated = fromLegacyMemory(identity, legacy);
    await writeJson(v2PathForId(v2Dir, migrated.personaId), migrated);
    const memory = toCompatMemory(migrated);
    setCache(identity, memory);
    return clonePersonaMemory(memory);
  }

  const fresh = createEmptyPersonaMemory(identity);
  setCache(identity, fresh);
  return clonePersonaMemory(fresh);
}

export async function savePersonaMemory(memory: PersonaMemory): Promise<void> {
  const identity = resolveIdentity({ personaId: memory.personaId, nick: memory.nick });
  const record = toRecord(memory);
  const { v2Dir, legacyDir } = resolveDirs();
  await writeJson(v2PathForId(v2Dir, record.personaId), record);
  await writeJson(legacyPathForNick(legacyDir, record.personaNick), {
    nick: record.personaNick,
    facts: record.compat.facts,
    summary: record.compat.summary,
    lastUpdated: record.compat.lastUpdated,
  });

  const compat = toCompatMemory(record);
  setCache({ personaId: record.personaId, nick: record.personaNick }, compat);
  setCache(identity, compat);
}

export async function resetPersonaMemory(subject: PersonaMemorySubject): Promise<PersonaMemory> {
  const identity = resolveIdentity(subject);
  const memory = createEmptyPersonaMemory(identity);
  await savePersonaMemory(memory);
  return loadPersonaMemory(identity);
}
