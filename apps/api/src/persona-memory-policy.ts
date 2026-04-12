import type {
  ChatPersona,
  PersonaArchivalFact,
  PersonaArchivalSummary,
  PersonaMemory,
} from "./chat-types.js";

export interface PersonaMemoryPolicy {
  extraction: {
    updateEveryResponses: number;
    minFacts: number;
    maxFacts: number;
    recentMessagesWindow: number;
  };
  pruning: {
    workingFactsLimit: number;
    workingSourceMessagesLimit: number;
    archivalFactsLimit: number;
    archivalSummariesLimit: number;
    compatFactsLimit: number;
    injectionFactsLimit?: number;
  };
}

export interface PersonaMemoryPolicyInput {
  extraction?: Partial<PersonaMemoryPolicy["extraction"]>;
  pruning?: Partial<PersonaMemoryPolicy["pruning"]>;
}

const DEFAULT_POLICY: PersonaMemoryPolicy = {
  extraction: {
    updateEveryResponses: 5,
    minFacts: 2,
    maxFacts: 3,
    recentMessagesWindow: 10,
  },
  pruning: {
    workingFactsLimit: 20,
    workingSourceMessagesLimit: 10,
    archivalFactsLimit: 100,
    archivalSummariesLimit: 50,
    compatFactsLimit: 20,
    injectionFactsLimit: 8,
  },
};

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function cloneArchivalFacts(values: PersonaArchivalFact[]): PersonaArchivalFact[] {
  return values.map((entry) => ({ ...entry }));
}

function cloneArchivalSummaries(values: PersonaArchivalSummary[]): PersonaArchivalSummary[] {
  return values.map((entry) => ({ ...entry }));
}

export function trimUniqueStrings(values: Iterable<unknown>, limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const text = String(value || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }

  return result.slice(-Math.max(1, limit));
}

export function trimRecentMessages(values: Iterable<unknown>, limit: number): string[] {
  const result: string[] = [];

  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    result.push(text);
  }

  return result.slice(-Math.max(1, limit));
}

export function normalizePersonaMemoryPolicy(input: PersonaMemoryPolicyInput = {}): PersonaMemoryPolicy {
  const workingFactsLimit = clampInteger(
    input.pruning?.workingFactsLimit ?? DEFAULT_POLICY.pruning.workingFactsLimit,
    1,
    500,
  );
  const maxFacts = clampInteger(
    input.extraction?.maxFacts ?? DEFAULT_POLICY.extraction.maxFacts,
    1,
    workingFactsLimit,
  );
  const minFacts = clampInteger(
    input.extraction?.minFacts ?? DEFAULT_POLICY.extraction.minFacts,
    1,
    maxFacts,
  );

  return {
    extraction: {
      updateEveryResponses: clampInteger(
        input.extraction?.updateEveryResponses ?? DEFAULT_POLICY.extraction.updateEveryResponses,
        1,
        500,
      ),
      minFacts,
      maxFacts,
      recentMessagesWindow: clampInteger(
        input.extraction?.recentMessagesWindow ?? DEFAULT_POLICY.extraction.recentMessagesWindow,
        1,
        200,
      ),
    },
    pruning: {
      workingFactsLimit,
      workingSourceMessagesLimit: clampInteger(
        input.pruning?.workingSourceMessagesLimit ?? DEFAULT_POLICY.pruning.workingSourceMessagesLimit,
        1,
        200,
      ),
      archivalFactsLimit: clampInteger(
        input.pruning?.archivalFactsLimit ?? DEFAULT_POLICY.pruning.archivalFactsLimit,
        1,
        2_000,
      ),
      archivalSummariesLimit: clampInteger(
        input.pruning?.archivalSummariesLimit ?? DEFAULT_POLICY.pruning.archivalSummariesLimit,
        1,
        500,
      ),
      compatFactsLimit: clampInteger(
        input.pruning?.compatFactsLimit ?? DEFAULT_POLICY.pruning.compatFactsLimit,
        1,
        workingFactsLimit,
      ),
    },
  };
}

export function resolvePersonaMemoryPolicy(): PersonaMemoryPolicy {
  return normalizePersonaMemoryPolicy({
    extraction: {
      updateEveryResponses: parseInteger(
        process.env.KXKM_PERSONA_MEMORY_UPDATE_EVERY,
        DEFAULT_POLICY.extraction.updateEveryResponses,
      ),
      minFacts: parseInteger(
        process.env.KXKM_PERSONA_MEMORY_EXTRACTION_MIN_FACTS,
        DEFAULT_POLICY.extraction.minFacts,
      ),
      maxFacts: parseInteger(
        process.env.KXKM_PERSONA_MEMORY_EXTRACTION_MAX_FACTS,
        DEFAULT_POLICY.extraction.maxFacts,
      ),
      recentMessagesWindow: parseInteger(
        process.env.KXKM_PERSONA_MEMORY_EXTRACTION_WINDOW,
        DEFAULT_POLICY.extraction.recentMessagesWindow,
      ),
    },
    pruning: {
      workingFactsLimit: parseInteger(
        process.env.KXKM_PERSONA_MEMORY_FACTS_LIMIT,
        DEFAULT_POLICY.pruning.workingFactsLimit,
      ),
      workingSourceMessagesLimit: parseInteger(
        process.env.KXKM_PERSONA_MEMORY_SOURCE_MESSAGES_LIMIT,
        DEFAULT_POLICY.pruning.workingSourceMessagesLimit,
      ),
      archivalFactsLimit: parseInteger(
        process.env.KXKM_PERSONA_MEMORY_ARCHIVAL_FACTS_LIMIT,
        DEFAULT_POLICY.pruning.archivalFactsLimit,
      ),
      archivalSummariesLimit: parseInteger(
        process.env.KXKM_PERSONA_MEMORY_ARCHIVAL_SUMMARIES_LIMIT,
        DEFAULT_POLICY.pruning.archivalSummariesLimit,
      ),
      compatFactsLimit: parseInteger(
        process.env.KXKM_PERSONA_MEMORY_COMPAT_FACTS_LIMIT,
        DEFAULT_POLICY.pruning.compatFactsLimit,
      ),
      injectionFactsLimit: parseInt(process.env.KXKM_PERSONA_MEMORY_INJECTION_LIMIT ?? "8", 10),
    },
  });
}

export function upsertArchivalFacts(
  existing: PersonaArchivalFact[],
  facts: string[],
  timestamp: string,
  limit: number,
): PersonaArchivalFact[] {
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

  return [...byText.values()].slice(-Math.max(1, limit));
}

export function upsertArchivalSummaries(
  existing: PersonaArchivalSummary[],
  summary: string,
  timestamp: string,
  limit: number,
): PersonaArchivalSummary[] {
  const trimmed = summary.trim();
  const next = cloneArchivalSummaries(existing).slice(-Math.max(1, limit));
  if (!trimmed) return next;
  const last = next[next.length - 1];
  if (last?.text === trimmed) return next;
  if (next.length >= limit) next.shift();
  next.push({ text: trimmed, createdAt: timestamp });
  return next;
}

export function normalizePersonaMemory(
  memory: PersonaMemory,
  options: {
    policy?: PersonaMemoryPolicy;
    personaId?: string;
    recentMessages?: Iterable<unknown>;
    timestamp?: string;
  } = {},
): PersonaMemory {
  const policy = options.policy ?? resolvePersonaMemoryPolicy();
  const timestamp = options.timestamp ?? new Date().toISOString();
  const workingFacts = trimUniqueStrings(
    memory.workingMemory?.facts?.length ? memory.workingMemory.facts : memory.facts,
    policy.pruning.workingFactsLimit,
  );
  const workingSummary = String(memory.workingMemory?.summary ?? memory.summary ?? "").trim();
  const lastSourceMessages = trimRecentMessages(
    options.recentMessages ?? memory.workingMemory?.lastSourceMessages ?? [],
    policy.pruning.workingSourceMessagesLimit,
  );
  const archivalFacts = upsertArchivalFacts(
    memory.archivalMemory?.facts || [],
    workingFacts,
    timestamp,
    policy.pruning.archivalFactsLimit,
  );
  const archivalSummaries = upsertArchivalSummaries(
    memory.archivalMemory?.summaries || [],
    workingSummary,
    timestamp,
    policy.pruning.archivalSummariesLimit,
  );

  return {
    ...memory,
    facts: [...workingFacts],
    summary: workingSummary,
    lastUpdated: timestamp,
    personaId: String(options.personaId ?? memory.personaId ?? "").trim() || undefined,
    version: 2,
    workingMemory: {
      facts: [...workingFacts],
      summary: workingSummary,
      lastSourceMessages,
    },
    archivalMemory: {
      facts: cloneArchivalFacts(archivalFacts),
      summaries: cloneArchivalSummaries(archivalSummaries),
    },
  };
}

export function applyPersonaMemoryExtraction(
  memory: PersonaMemory,
  extracted: { facts?: unknown; summary?: unknown },
  options: {
    policy?: PersonaMemoryPolicy;
    personaId?: string;
    recentMessages?: Iterable<unknown>;
    timestamp?: string;
  } = {},
): PersonaMemory {
  const policy = options.policy ?? resolvePersonaMemoryPolicy();
  const extractedFacts = trimUniqueStrings(
    Array.isArray(extracted.facts) ? extracted.facts : [],
    policy.extraction.maxFacts,
  );
  const mergedFacts = trimUniqueStrings(
    [...(memory.workingMemory?.facts || memory.facts || []), ...extractedFacts],
    policy.pruning.workingFactsLimit,
  );
  const nextSummary = typeof extracted.summary === "string" && extracted.summary.trim()
    ? extracted.summary.trim()
    : String(memory.workingMemory?.summary ?? memory.summary ?? "").trim();

  return normalizePersonaMemory(
    {
      ...memory,
      personaId: options.personaId ?? memory.personaId,
      facts: mergedFacts,
      summary: nextSummary,
      workingMemory: {
        facts: mergedFacts,
        summary: nextSummary,
        lastSourceMessages: trimRecentMessages(
          options.recentMessages ?? memory.workingMemory?.lastSourceMessages ?? [],
          policy.pruning.workingSourceMessagesLimit,
        ),
      },
    },
    options,
  );
}

export function buildPersonaMemoryExtractionPrompt(
  persona: Pick<ChatPersona, "nick">,
  recentMessages: Iterable<unknown>,
  policy: PersonaMemoryPolicy = resolvePersonaMemoryPolicy(),
): string {
  const scopedMessages = trimRecentMessages(recentMessages, policy.extraction.recentMessagesWindow);
  return [
    `Tu es ${persona.nick}. Voici les derniers echanges:`,
    scopedMessages.join("\n"),
    "",
    `Extrais ${policy.extraction.minFacts}-${policy.extraction.maxFacts} faits importants a retenir sur l'utilisateur ou le sujet.`,
    "Resume ensuite l'etat de la conversation en une seule phrase concise.",
    'Reponds uniquement en JSON strict: {"facts":["fait1","fait2"],"summary":"resume"}',
  ].join("\n");
}

export function shouldUpdatePersonaMemory(
  responseCount: number,
  policy: PersonaMemoryPolicy = resolvePersonaMemoryPolicy(),
): boolean {
  return responseCount > 0 && responseCount % policy.extraction.updateEveryResponses === 0;
}
