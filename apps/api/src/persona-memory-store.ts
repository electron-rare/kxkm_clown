import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ChatPersona,
  PersonaMemory,
} from "./chat-types.js";
import {
  normalizePersonaMemory,
  type PersonaMemoryPolicy,
  resolvePersonaMemoryPolicy,
} from "./persona-memory-policy.js";

type PersonaMemorySubject = string | Pick<ChatPersona, "id" | "nick"> | { id?: string; personaId?: string; nick: string };

interface PersonaMemoryRecordV2 {
  version: 2;
  personaId: string;
  personaNick: string;
  updatedAt: string;
  workingMemory: NonNullable<PersonaMemory["workingMemory"]>;
  archivalMemory: NonNullable<PersonaMemory["archivalMemory"]>;
  compat: {
    facts: string[];
    summary: string;
    lastUpdated: string;
  };
}

const memoryCache = new Map<string, { data: PersonaMemory; loadedAt: number }>();
const MEMORY_CACHE_TTL = 30_000;

// O(1) (personaId, nick) → filePath index
const nickIndex = new Map<string, string>();
let nickIndexPromise: Promise<void> | null = null;

async function ensureNickIndex(): Promise<void> {
  if (!nickIndexPromise) {
    nickIndexPromise = (async () => {
      const { v2Dir } = resolveDirs();
      let personaDirs: string[] = [];
      try {
        personaDirs = await readdir(v2Dir);
      } catch {
        return;
      }
      for (const personaDir of personaDirs) {
        const personaDirPath = path.join(v2Dir, personaDir);
        let nickFiles: string[] = [];
        try {
          nickFiles = await readdir(personaDirPath);
        } catch {
          continue;
        }
        for (const nickFile of nickFiles) {
          if (!nickFile.endsWith(".json")) continue;
          const filePath = path.join(personaDirPath, nickFile);
          const record = await readJson<PersonaMemoryRecordV2>(filePath);
          if (record?.version === 2 && record.personaId) {
            const userNick = path.basename(nickFile, ".json");
            const compositeKey = `${record.personaId}:${userNick}`;
            nickIndex.set(compositeKey.toLowerCase(), filePath);
          }
        }
      }
    })();
  }
  return nickIndexPromise;
}

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

function v2PathForIdNick(v2Dir: string, personaId: string, userNick: string): string {
  return path.join(v2Dir, safeFileSegment(personaId), `${safeFileSegment(userNick)}.json`);
}

// Legacy flat path — kept for loadPersonaMemoryGlobal and migration reads
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

function cloneArchivalFacts(values: NonNullable<PersonaMemory["archivalMemory"]>["facts"]): NonNullable<PersonaMemory["archivalMemory"]>["facts"] {
  return values.map((entry) => ({ ...entry }));
}

function cloneArchivalSummaries(values: NonNullable<PersonaMemory["archivalMemory"]>["summaries"]): NonNullable<PersonaMemory["archivalMemory"]>["summaries"] {
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

function dedupeFacts(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function mergeGlobalRecords(identity: { personaId?: string; nick: string }, records: PersonaMemoryRecordV2[]): PersonaMemory {
  const merged = createEmptyPersonaMemory(identity);
  if (records.length === 0) {
    return merged;
  }

  const sorted = [...records].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const latest = sorted[sorted.length - 1]!;
  const archivalFactsByText = new Map<string, NonNullable<PersonaMemory["archivalMemory"]>["facts"][number]>();
  const summariesByKey = new Map<string, NonNullable<PersonaMemory["archivalMemory"]>["summaries"][number]>();

  for (const record of sorted) {
    for (const entry of record.archivalMemory.facts) {
      const text = String(entry.text || "").trim();
      const key = text.toLowerCase();
      if (!text) continue;
      const current = archivalFactsByText.get(key);
      if (!current) {
        archivalFactsByText.set(key, { ...entry, text });
        continue;
      }
      current.firstSeenAt = current.firstSeenAt.localeCompare(entry.firstSeenAt) <= 0 ? current.firstSeenAt : entry.firstSeenAt;
      current.lastSeenAt = current.lastSeenAt.localeCompare(entry.lastSeenAt) >= 0 ? current.lastSeenAt : entry.lastSeenAt;
    }
    for (const summary of record.archivalMemory.summaries) {
      const text = String(summary.text || "").trim();
      if (!text) continue;
      const key = `${summary.createdAt}:${text.toLowerCase()}`;
      if (!summariesByKey.has(key)) {
        summariesByKey.set(key, { ...summary, text });
      }
    }
  }

  const mergedFacts = dedupeFacts(sorted.flatMap((record) => record.workingMemory.facts));
  merged.nick = latest.personaNick || identity.nick;
  merged.personaId = latest.personaId || identity.personaId;
  merged.facts = [...mergedFacts];
  merged.summary = latest.workingMemory.summary;
  merged.lastUpdated = latest.updatedAt;
  merged.workingMemory = {
    facts: [...mergedFacts],
    summary: latest.workingMemory.summary,
    lastSourceMessages: [...latest.workingMemory.lastSourceMessages],
  };
  merged.archivalMemory = {
    facts: [...archivalFactsByText.values()].sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt)),
    summaries: [...summariesByKey.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
  return merged;
}

function toCompatMemory(record: PersonaMemoryRecordV2): PersonaMemory {
  return {
    nick: record.personaNick,
    facts: [...record.workingMemory.facts],
    summary: record.workingMemory.summary,
    lastUpdated: record.updatedAt,
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

function toRecord(
  memory: PersonaMemory,
  policy: PersonaMemoryPolicy = resolvePersonaMemoryPolicy(),
): PersonaMemoryRecordV2 {
  const timestamp = new Date().toISOString();
  const normalized = normalizePersonaMemory(memory, { policy, timestamp });
  const personaId = String(normalized.personaId || normalized.nick || "").trim();
  const nick = String(normalized.nick || "").trim();
  const compatFacts = normalized.workingMemory!.facts.slice(-policy.pruning.compatFactsLimit);

  return {
    version: 2,
    personaId,
    personaNick: nick,
    updatedAt: timestamp,
    workingMemory: normalized.workingMemory!,
    archivalMemory: normalized.archivalMemory!,
    compat: {
      facts: compatFacts,
      summary: normalized.summary,
      lastUpdated: timestamp,
    },
  };
}

function fromLegacyMemory(
  identity: { personaId?: string; nick: string },
  legacy: Partial<PersonaMemory>,
): PersonaMemoryRecordV2 {
  const timestamp = String(legacy.lastUpdated || "").trim() || new Date().toISOString();
  const normalized = normalizePersonaMemory({
    nick: identity.nick,
    personaId: String(identity.personaId || identity.nick || "").trim(),
    facts: Array.isArray(legacy.facts) ? legacy.facts : [],
    summary: String(legacy.summary || "").trim(),
    lastUpdated: timestamp,
  }, {
    timestamp,
    personaId: String(identity.personaId || identity.nick || "").trim(),
  });
  const policy = resolvePersonaMemoryPolicy();
  const compatFacts = normalized.workingMemory!.facts.slice(-policy.pruning.compatFactsLimit);

  return {
    version: 2,
    personaId: String(normalized.personaId || identity.personaId || identity.nick || "").trim(),
    personaNick: identity.nick,
    updatedAt: timestamp,
    workingMemory: normalized.workingMemory!,
    archivalMemory: normalized.archivalMemory!,
    compat: {
      facts: compatFacts,
      summary: normalized.summary,
      lastUpdated: timestamp,
    },
  };
}

/**
 * Scan the legacy dir for a file whose basename matches personaId case-insensitively.
 * Legacy files were written with capitalized persona nicks (e.g. "Schaeffer.json").
 */
async function readLegacyByPersonaId(legacyDir: string, personaId: string): Promise<PersonaMemory | null> {
  let files: string[] = [];
  try {
    files = await readdir(legacyDir);
  } catch {
    return null;
  }
  const target = personaId.toLowerCase();
  const match = files.find((f) => f.endsWith(".json") && f.slice(0, -5).toLowerCase() === target);
  if (!match) return null;
  return readJson<PersonaMemory>(path.join(legacyDir, match));
}

async function readV2Record(identity: { personaId: string; userNick: string }): Promise<PersonaMemoryRecordV2 | null> {
  const { v2Dir } = resolveDirs();

  // Direct per-nick path lookup
  const direct = await readJson<PersonaMemoryRecordV2>(v2PathForIdNick(v2Dir, identity.personaId, identity.userNick));
  if (direct?.version === 2) return direct;

  // O(1) composite key lookup via in-process index
  await ensureNickIndex();
  const compositeKey = `${identity.personaId}:${identity.userNick}`;
  const indexedPath = nickIndex.get(compositeKey.toLowerCase());
  if (indexedPath) {
    const record = await readJson<PersonaMemoryRecordV2>(indexedPath);
    if (record?.version === 2) return record;
    // Stale index entry — remove and fall through
    nickIndex.delete(compositeKey.toLowerCase());
  }

  return null;
}

function nickCacheKey(personaId: string, userNick: string): string {
  return `id:${personaId}:${userNick}`;
}

function setCache(personaId: string, userNick: string, memory: PersonaMemory): void {
  const cloned = clonePersonaMemory(memory);
  memoryCache.set(nickCacheKey(personaId, userNick), { data: cloned, loadedAt: Date.now() });
}

export function clearPersonaMemoryCache(): void {
  memoryCache.clear();
  nickIndex.clear();
  nickIndexPromise = null;
}

/**
 * Load memory for a specific (personaId, userNick) pair.
 * Pass "_anonymous" for userNick in relay chains where the caller nick is unknown.
 */
export async function loadPersonaMemory(personaId: string, userNick: string, personaNick?: string): Promise<PersonaMemory> {
  const cacheKey = nickCacheKey(personaId, userNick);
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < MEMORY_CACHE_TTL) {
    return clonePersonaMemory(cached.data);
  }

  const record = await readV2Record({ personaId, userNick });
  if (record) {
    const memory = toCompatMemory(record);
    setCache(personaId, userNick, memory);
    return clonePersonaMemory(memory);
  }

  const { v2Dir } = resolveDirs();

  // Legacy migration: if per-nick file missing but flat {personaId}.json exists → copy to per-nick path
  // Only migrate ONCE (for the first user). Subsequent new users get empty memory.
  // A flat file marked with `_migrated: true` has already been migrated; skip copying.
  const flatRecord = await readJson<PersonaMemoryRecordV2 & { _migrated?: boolean; userNick?: string }>(v2PathForId(v2Dir, personaId));
  if (flatRecord?.version === 2 && !flatRecord._migrated) {
    const perNickPath = v2PathForIdNick(v2Dir, personaId, userNick);
    const migrated: PersonaMemoryRecordV2 = { ...flatRecord };
    await writeJson(perNickPath, migrated);
    // Mark the flat file as migrated so subsequent new users don't inherit this data
    await writeJson(v2PathForId(v2Dir, personaId), { ...flatRecord, _migrated: true });
    const memory = toCompatMemory(migrated);
    setCache(personaId, userNick, memory);
    return clonePersonaMemory(memory);
  }

  // Legacy dir migration (old flat nick-based files)
  // Legacy files are keyed by persona nick (e.g. "Schaeffer.json"), not user nick.
  // Use a case-insensitive scan so "Schaeffer.json" is found when personaId is "schaeffer".
  const { legacyDir } = resolveDirs();
  const legacy = await readLegacyByPersonaId(legacyDir, personaId);
  if (legacy) {
    // Preserve the persona's own display nick from the legacy record.
    const identity = { personaId, nick: String(legacy.nick || personaId).trim() };
    const migrated = fromLegacyMemory(identity, legacy);
    const perNickPath = v2PathForIdNick(v2Dir, personaId, userNick);
    await writeJson(perNickPath, migrated);
    const memory = toCompatMemory(migrated);
    setCache(personaId, userNick, memory);
    return clonePersonaMemory(memory);
  }

  const fresh = createEmptyPersonaMemory({ personaId, nick: String(personaNick || personaId).trim() || personaId });
  setCache(personaId, userNick, fresh);
  return clonePersonaMemory(fresh);
}

/**
 * Load the old flat {personaId}.json — used by display commands that show persona-level memory
 * without a specific user nick context.
 */
export async function loadPersonaMemoryGlobal(subject: PersonaMemorySubject): Promise<PersonaMemory> {
  const identity = resolveIdentity(subject);
  const { v2Dir } = resolveDirs();

  if (identity.personaId) {
    const personaDirPath = path.join(v2Dir, safeFileSegment(identity.personaId));
    let nickFiles: string[] = [];
    try {
      nickFiles = await readdir(personaDirPath);
    } catch { /* no per-nick files yet */ }

    const records: PersonaMemoryRecordV2[] = [];
    for (const nickFile of nickFiles) {
      if (!nickFile.endsWith(".json")) continue;
      const record = await readJson<PersonaMemoryRecordV2>(path.join(personaDirPath, nickFile));
      if (record?.version === 2) {
        records.push(record);
      }
    }

    if (records.length > 0) {
      return mergeGlobalRecords(identity, records);
    }

    const legacyRecord = await readJson<PersonaMemoryRecordV2>(v2PathForId(v2Dir, identity.personaId));
    if (legacyRecord?.version === 2) {
      return toCompatMemory(legacyRecord);
    }
  }

  return createEmptyPersonaMemory(identity);
}

export async function savePersonaMemory(memory: PersonaMemory, userNick: string, policy: PersonaMemoryPolicy = resolvePersonaMemoryPolicy()): Promise<void> {
  const record = toRecord(memory, policy);
  const personaId = record.personaId;
  const { v2Dir, legacyDir } = resolveDirs();
  const perNickPath = v2PathForIdNick(v2Dir, personaId, userNick);
  await writeJson(perNickPath, record);

  // Keep nickIndex in sync on every write
  const compositeKey = `${personaId}:${userNick}`;
  nickIndex.set(compositeKey.toLowerCase(), perNickPath);

  await writeJson(legacyPathForNick(legacyDir, record.personaNick), {
    nick: record.personaNick,
    facts: record.compat.facts,
    summary: record.compat.summary,
    lastUpdated: record.compat.lastUpdated,
  });

  const compat = toCompatMemory(record);
  setCache(personaId, userNick, compat);
}

export async function resetPersonaMemory(
  personaId: string,
  userNick: string,
  personaNick?: string,
  policy: PersonaMemoryPolicy = resolvePersonaMemoryPolicy(),
): Promise<PersonaMemory> {
  // Load current memory first so we preserve the persona's display nick
  // (needed to overwrite the correct legacy file, e.g. "Schaeffer.json").
  const current = await loadPersonaMemory(personaId, userNick, personaNick);
  const resolvedPersonaNick = String(current.nick || personaNick || personaId).trim();
  const identity = { personaId, nick: resolvedPersonaNick };
  const memory = createEmptyPersonaMemory(identity);
  await savePersonaMemory(memory, userNick, policy);
  return loadPersonaMemory(personaId, userNick, resolvedPersonaNick);
}
