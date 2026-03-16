import { createId, createIsoTimestamp } from "@kxkm/core";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface PersonaRecord {
  id: string;
  name: string;
  model: string;
  summary: string;
  editable: boolean;
  enabled?: boolean;
}

export interface PersonaSourceRecord {
  personaId: string;
  subjectName: string;
  summary: string;
  references: string[];
}

export interface PersonaFeedbackRecord {
  id: string;
  personaId: string;
  kind: "vote" | "admin_edit" | "chat_signal" | "drift_report";
  message: string;
  createdAt: string;
}

export interface PersonaProposalRecord {
  id: string;
  personaId: string;
  reason: string;
  before: Pick<PersonaRecord, "name" | "model" | "summary">;
  after: Pick<PersonaRecord, "name" | "model" | "summary">;
  applied: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Seed catalog
// ---------------------------------------------------------------------------

export const PERSONA_SEED_CATALOG: PersonaRecord[] = [
  {
    id: "schaeffer",
    name: "Schaeffer",
    model: "qwen2.5:14b",
    summary: "Ecoute structuree, matiere sonore et analyse.",
    editable: true,
  },
  {
    id: "batty",
    name: "Batty",
    model: "mistral:7b",
    summary: "Intensite lyrique, urgence et tension.",
    editable: true,
  },
  {
    id: "radigue",
    name: "Radigue",
    model: "mythalion:latest",
    summary: "Lenteur, drone et precision contemplative.",
    editable: true,
  },
  {
    id: "moorcock",
    name: "Moorcock",
    model: "nollama/mythomax-l2-13b:Q4_K_M",
    summary: "Chaos, multivers et fiction de conflit.",
    editable: true,
  },
  {
    id: "pharmacius",
    name: "Pharmacius",
    model: "qwen2.5:14b",
    summary: "Orchestrateur editorial, ajuste les autres personas.",
    editable: true,
  },
];

// ---------------------------------------------------------------------------
// Existing factory helpers
// ---------------------------------------------------------------------------

export function clonePersona(persona: PersonaRecord): PersonaRecord {
  return { ...persona };
}

export function createFeedback(personaId: string, kind: PersonaFeedbackRecord["kind"], message: string): PersonaFeedbackRecord {
  return {
    id: createId("feedback"),
    personaId,
    kind,
    message,
    createdAt: createIsoTimestamp(),
  };
}

export function createProposal(
  persona: PersonaRecord,
  after: Pick<PersonaRecord, "name" | "model" | "summary">,
  reason: string,
  applied: boolean
): PersonaProposalRecord {
  return {
    id: createId("proposal"),
    personaId: persona.id,
    reason,
    before: {
      name: persona.name,
      model: persona.model,
      summary: persona.summary,
    },
    after,
    applied,
    createdAt: createIsoTimestamp(),
  };
}

// ---------------------------------------------------------------------------
// Persona validation
// ---------------------------------------------------------------------------

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Validate and sanitise a partial persona update.  Only fields present in
 * `patch` are checked; invalid values are dropped from the returned object.
 *
 * Ported from V1 persona-registry.js validation rules:
 * - name: 2-40 chars, alphanumeric / underscore / hyphen
 * - summary (desc): non-empty string, trimmed
 * - color: must be a valid hex colour
 * - model: non-empty string
 * - Other known text fields (tone, lexicon, themes) are trimmed when present
 */
export function validatePersonaUpdate(patch: Partial<PersonaRecord>): Partial<PersonaRecord> {
  const cleaned: Partial<PersonaRecord> = {};

  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (name.length >= 2 && name.length <= 40 && /^[a-zA-Z0-9_-]+$/.test(name)) {
      cleaned.name = name;
    }
  }

  if (patch.summary !== undefined) {
    const summary = String(patch.summary).trim();
    if (summary.length > 0) {
      cleaned.summary = summary;
    }
  }

  if (patch.model !== undefined) {
    const model = String(patch.model).trim();
    if (model.length > 0) {
      cleaned.model = model;
    }
  }

  if (patch.editable !== undefined) {
    cleaned.editable = Boolean(patch.editable);
  }

  // Allow arbitrary extra keys that V1 persona-registry uses (color, tone,
  // lexicon, themes) — validate the ones we know about and pass through others.
  const extra = patch as Record<string, unknown>;

  if (typeof extra["color"] === "string") {
    const color = (extra["color"] as string).trim();
    if (HEX_COLOR_RE.test(color)) {
      (cleaned as Record<string, unknown>)["color"] = color;
    }
  }

  if (typeof extra["tone"] === "string") {
    const tone = (extra["tone"] as string).trim();
    if (tone.length > 0) {
      (cleaned as Record<string, unknown>)["tone"] = tone;
    }
  }

  if (Array.isArray(extra["lexicon"])) {
    (cleaned as Record<string, unknown>)["lexicon"] = (extra["lexicon"] as string[])
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (Array.isArray(extra["themes"])) {
    (cleaned as Record<string, unknown>)["themes"] = (extra["themes"] as string[])
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// Source management
// ---------------------------------------------------------------------------

export function createPersonaSource(
  personaId: string,
  content: string,
  url?: string,
): PersonaSourceRecord {
  return {
    personaId,
    subjectName: "",
    summary: content,
    references: url ? [url] : [],
  };
}

// ---------------------------------------------------------------------------
// Feedback aggregation
// ---------------------------------------------------------------------------

export type FeedbackKind = "vote" | "admin_edit" | "chat_signal" | "drift_report";

export interface FeedbackAggregation {
  totalVotes: number;
  upvotes: number;
  downvotes: number;
  signals: number;
  driftReports: number;
  lastFeedbackAt: string | null;
}

/**
 * Aggregate an array of feedback records into summary counts.
 *
 * Vote direction is determined by examining the `message` field: messages
 * containing "up" / "positive" / "+1" count as upvotes, "down" / "negative" /
 * "-1" count as downvotes.  All vote-kind entries count toward totalVotes.
 */
export function aggregateFeedback(feedback: PersonaFeedbackRecord[]): FeedbackAggregation {
  let totalVotes = 0;
  let upvotes = 0;
  let downvotes = 0;
  let signals = 0;
  let driftReports = 0;
  let lastFeedbackAt: string | null = null;

  const upPattern = /\bup\b|positive|\+1/i;
  const downPattern = /\bdown\b|negative|-1/i;

  for (const entry of feedback) {
    // Track the most recent timestamp
    if (lastFeedbackAt === null || entry.createdAt > lastFeedbackAt) {
      lastFeedbackAt = entry.createdAt;
    }

    switch (entry.kind) {
      case "vote":
        totalVotes++;
        if (upPattern.test(entry.message)) {
          upvotes++;
        } else if (downPattern.test(entry.message)) {
          downvotes++;
        }
        break;
      case "chat_signal":
        signals++;
        break;
      case "drift_report":
        driftReports++;
        break;
      // admin_edit is counted but not bucketed into a specific metric
      default:
        break;
    }
  }

  return {
    totalVotes,
    upvotes,
    downvotes,
    signals,
    driftReports,
    lastFeedbackAt,
  };
}

// ---------------------------------------------------------------------------
// Proposal diff
// ---------------------------------------------------------------------------

/**
 * Compute a field-by-field diff between two PersonaRecord snapshots.  Only
 * fields whose values differ (by strict equality) are included in the result.
 */
export function computePersonaDiff(
  before: PersonaRecord,
  after: PersonaRecord,
): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ]) as Set<keyof PersonaRecord>;

  for (const key of keys) {
    const bVal = before[key];
    const aVal = after[key];
    if (bVal !== aVal) {
      diff[key] = { before: bVal, after: aVal };
    }
  }

  return diff;
}

// ---------------------------------------------------------------------------
// A) Persona Registry (pure logic, no I/O)
// ---------------------------------------------------------------------------

export interface PersonaRegistryState {
  personas: Map<string, PersonaRecord>;
  enabledSet: Set<string>;
}

/**
 * Create an initial registry state from seed personas.
 * All provided personas are enabled by default.
 */
export function createPersonaRegistryState(seed: PersonaRecord[]): PersonaRegistryState {
  const personas = new Map<string, PersonaRecord>();
  const enabledSet = new Set<string>();

  for (const persona of seed) {
    personas.set(persona.id, { ...persona });
    enabledSet.add(persona.id);
  }

  return { personas, enabledSet };
}

/**
 * Look up a persona by its id.
 */
export function getPersonaById(state: PersonaRegistryState, id: string): PersonaRecord | null {
  return state.personas.get(id) ?? null;
}

/**
 * Look up a persona by its name (case-insensitive nick match).
 */
export function getPersonaByNick(state: PersonaRegistryState, nick: string): PersonaRecord | null {
  const lower = nick.toLowerCase();
  for (const persona of state.personas.values()) {
    if (persona.name.toLowerCase() === lower) {
      return persona;
    }
  }
  return null;
}

/**
 * Look up the first persona mapped to a given model string.
 */
export function getPersonaByModel(state: PersonaRegistryState, model: string): PersonaRecord | null {
  for (const persona of state.personas.values()) {
    if (persona.model === model) {
      return persona;
    }
  }
  return null;
}

/**
 * Return all personas as an array (ordered by insertion).
 */
export function listPersonas(state: PersonaRegistryState): PersonaRecord[] {
  return Array.from(state.personas.values());
}

/**
 * Return only the personas whose id is in the enabled set.
 */
export function listEnabledPersonas(state: PersonaRegistryState): PersonaRecord[] {
  return Array.from(state.personas.values()).filter((p) => state.enabledSet.has(p.id));
}

/**
 * Enable or disable a persona by id.  Throws if the id is unknown.
 */
export function setPersonaEnabled(state: PersonaRegistryState, id: string, enabled: boolean): void {
  if (!state.personas.has(id)) {
    throw new Error(`Unknown persona: ${id}`);
  }
  if (enabled) {
    state.enabledSet.add(id);
  } else {
    state.enabledSet.delete(id);
  }
}

/**
 * Apply a partial update to a persona record.  Returns the updated record.
 * Throws if the id is unknown.  Does not mutate the original — replaces the
 * entry in the map.
 */
export function updatePersona(
  state: PersonaRegistryState,
  id: string,
  patch: Partial<PersonaRecord>,
): PersonaRecord {
  const existing = state.personas.get(id);
  if (!existing) {
    throw new Error(`Unknown persona: ${id}`);
  }
  const updated: PersonaRecord = { ...existing, ...patch, id };
  state.personas.set(id, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// B) Pharmacius patch types (pure — actual LLM calls live in apps/)
// ---------------------------------------------------------------------------

export interface PersonaPatch {
  personaId: string;
  field: string;
  before: string;
  after: string;
  reason: string;
  confidence: number; // 0-1
}

export interface PharmaciusRequest {
  personaId: string;
  feedbackItems: PersonaFeedbackRecord[];
  sourceContent?: string;
  currentPersona: PersonaRecord;
}

export interface PharmaciusResult {
  patches: PersonaPatch[];
  reasoning: string;
  timestamp: string;
}

// -- internal helpers ported from V1 pharmacius.js --

function cleanText(value: unknown, maxLength = 4000): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cleanList(value: unknown, maxItems = 12, maxLength = 240): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanText(item, maxLength))
      .filter(Boolean)
      .slice(0, maxItems);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((item) => cleanText(item, maxLength))
      .filter(Boolean)
      .slice(0, maxItems);
  }
  return [];
}

function uniq(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function extractJsonBlock(text: string): unknown {
  if (typeof text !== "string") return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Summarise feedback entries into positive / negative / admin buckets.
 * Ported from V1 pharmacius.js `buildFeedbackSummary`.
 */
function buildFeedbackSummary(feedback: PersonaFeedbackRecord[]): {
  positive: string[];
  negative: string[];
  admin: string[];
} {
  const summary: { positive: string[]; negative: string[]; admin: string[] } = {
    positive: [],
    negative: [],
    admin: [],
  };

  for (const entry of feedback.slice(-24)) {
    const short = cleanText(entry.message, 200) || `${entry.kind} feedback`;

    if (entry.kind === "vote") {
      const msg = entry.message.toLowerCase();
      if (/\bup\b|positive|\+1|chosen/.test(msg)) summary.positive.push(short);
      if (/\bdown\b|negative|-1|rejected/.test(msg)) summary.negative.push(short);
      continue;
    }

    if (entry.kind === "admin_edit") {
      summary.admin.push(short);
    }
  }

  return {
    positive: uniq(summary.positive).slice(0, 6),
    negative: uniq(summary.negative).slice(0, 6),
    admin: uniq(summary.admin).slice(0, 6),
  };
}

/**
 * Build the LLM prompt for Pharmacius persona patch generation.
 *
 * Ported from V1 pharmacius.js `buildPrompt`.  Returns a single string
 * containing the system instructions and the JSON payload for the user turn.
 * The actual LLM call is performed by the application layer.
 */
export function buildPharmaciusPrompt(request: PharmaciusRequest): string {
  const { currentPersona, feedbackItems, sourceContent } = request;
  const recentFeedback = feedbackItems.slice(-12);
  const feedbackSummary = buildFeedbackSummary(feedbackItems);

  const systemLines = [
    "Tu es Pharmacius, orchestrateur editorial de KXKM_Clown.",
    "Tu proposes des ajustements de persona sous forme de patches JSON.",
    "Tu reponds uniquement en JSON valide, sans markdown.",
    'Format strict: {"patches":[{"field":"...","before":"...","after":"...","reason":"...","confidence":0.0}],"reasoning":"..."}',
    "Chaque patch modifie un champ precis de la persona.",
    "Tu dois t appuyer sur les sources et le feedback. Pas d invention biographique.",
  ];

  const feedbackDirectives: string[] = [];
  if (feedbackSummary.positive.length) {
    feedbackDirectives.push(`A renforcer: ${feedbackSummary.positive.join(" | ")}.`);
  }
  if (feedbackSummary.negative.length) {
    feedbackDirectives.push(`A eviter ou corriger: ${feedbackSummary.negative.join(" | ")}.`);
  }
  if (feedbackSummary.admin.length) {
    feedbackDirectives.push(`Decisions editoriales recentes: ${feedbackSummary.admin.join(" | ")}.`);
  }

  const userPayload = {
    persona: {
      id: currentPersona.id,
      name: currentPersona.name,
      model: currentPersona.model,
      summary: currentPersona.summary,
    },
    sourceContent: sourceContent || null,
    feedback: recentFeedback.map((f) => ({
      kind: f.kind,
      message: f.message,
      createdAt: f.createdAt,
    })),
    feedbackSynthesis: feedbackDirectives.length ? feedbackDirectives : null,
  };

  return [
    "=== SYSTEM ===",
    ...systemLines,
    "",
    "=== USER ===",
    JSON.stringify(userPayload),
  ].join("\n");
}

/**
 * Parse and validate a raw LLM response string into an array of PersonaPatch.
 *
 * Ported from V1 pharmacius.js `extractJsonBlock` + `normalizePatch` pattern.
 * Returns an empty array when the response cannot be parsed.
 */
export function parsePharmaciusResponse(raw: string, personaId: string): PersonaPatch[] {
  const parsed = extractJsonBlock(raw) as {
    patches?: Array<{
      field?: string;
      before?: string;
      after?: string;
      reason?: string;
      confidence?: number;
    }>;
  } | null;

  if (!parsed || !Array.isArray(parsed.patches)) {
    return [];
  }

  return parsed.patches
    .map((entry) => {
      const field = cleanText(entry.field, 80);
      const before = cleanText(entry.before, 4000);
      const after = cleanText(entry.after, 4000);
      const reason = cleanText(entry.reason, 400);
      const confidence = typeof entry.confidence === "number"
        ? Math.max(0, Math.min(1, entry.confidence))
        : 0.5;

      if (!field || !after) return null;

      return { personaId, field, before, after, reason, confidence } as PersonaPatch;
    })
    .filter((p): p is PersonaPatch => p !== null);
}

/**
 * Apply an array of patches to a persona record, returning a new record.
 * Only patches whose `field` matches a key on PersonaRecord are applied.
 * The original record is never mutated.
 */
export function applyPatches(persona: PersonaRecord, patches: PersonaPatch[]): PersonaRecord {
  const result = { ...persona } as Record<string, unknown> & PersonaRecord;

  for (const patch of patches) {
    if (patch.field in persona) {
      result[patch.field] = patch.after;
    }
  }

  return result;
}

/**
 * Compute reverse patches so a set of applied patches can be undone.
 * The returned patches have `before` and `after` swapped.
 */
export function reversePatches(patches: PersonaPatch[]): PersonaPatch[] {
  return patches.map((patch) => ({
    ...patch,
    before: patch.after,
    after: patch.before,
    reason: `revert: ${patch.reason}`,
  }));
}

// ---------------------------------------------------------------------------
// C) Editorial pipeline state machine
// ---------------------------------------------------------------------------

export type EditorialStage =
  | "idle"
  | "collecting_feedback"
  | "generating_proposal"
  | "review"
  | "applied"
  | "reverted";

export interface EditorialPipelineState {
  personaId: string;
  stage: EditorialStage;
  feedbackBuffer: PersonaFeedbackRecord[];
  currentProposal: PersonaProposalRecord | null;
  history: PersonaProposalRecord[];
}

/**
 * Create a fresh editorial pipeline for a given persona.
 */
export function createEditorialPipeline(personaId: string): EditorialPipelineState {
  return {
    personaId,
    stage: "idle",
    feedbackBuffer: [],
    currentProposal: null,
    history: [],
  };
}

/**
 * Add a feedback item to the pipeline buffer and transition to
 * "collecting_feedback" if currently idle.
 */
export function addFeedback(state: EditorialPipelineState, feedback: PersonaFeedbackRecord): void {
  state.feedbackBuffer.push(feedback);
  if (state.stage === "idle") {
    state.stage = "collecting_feedback";
  }
}

/**
 * Returns true when the feedback buffer has reached the threshold count.
 * Default threshold is 5 items.
 */
export function shouldTriggerProposal(state: EditorialPipelineState, threshold = 5): boolean {
  return state.feedbackBuffer.length >= threshold;
}

/**
 * Apply a proposal to the pipeline: record it as current, push to history,
 * clear the feedback buffer, and advance the stage to "applied".
 */
export function applyProposal(state: EditorialPipelineState, proposal: PersonaProposalRecord): void {
  state.currentProposal = proposal;
  state.history.push(proposal);
  state.feedbackBuffer = [];
  state.stage = "applied";
}

/**
 * Revert the most recently applied proposal.  Returns the reverted proposal
 * or null if there is nothing to revert.  Moves stage to "reverted".
 */
export function revertLastProposal(state: EditorialPipelineState): PersonaProposalRecord | null {
  if (state.history.length === 0) {
    return null;
  }

  const last = state.history[state.history.length - 1];
  state.currentProposal = null;
  state.stage = "reverted";
  return last;
}

// ---------------------------------------------------------------------------
// D) DPO training data extraction (pure transform)
// ---------------------------------------------------------------------------

export interface DPOPair {
  prompt: string;
  chosen: string;
  rejected: string;
  personaId: string;
  timestamp: string;
}

/**
 * Extract DPO training pairs from feedback records.
 *
 * Vote-kind feedback with messages containing directional signals ("up" /
 * "positive" vs "down" / "negative") are paired.  Each pair uses the
 * persona's current summary as the prompt context.
 *
 * Ported from V1 persona-store.js DPO signal logic.
 */
export function extractDPOPairs(
  feedback: PersonaFeedbackRecord[],
  persona: PersonaRecord,
): DPOPair[] {
  const upPattern = /\bup\b|positive|\+1|chosen/i;
  const downPattern = /\bdown\b|negative|-1|rejected/i;

  const chosen: PersonaFeedbackRecord[] = [];
  const rejected: PersonaFeedbackRecord[] = [];

  for (const entry of feedback) {
    if (entry.kind !== "vote") continue;
    if (upPattern.test(entry.message)) {
      chosen.push(entry);
    } else if (downPattern.test(entry.message)) {
      rejected.push(entry);
    }
  }

  const pairs: DPOPair[] = [];
  const pairCount = Math.min(chosen.length, rejected.length);

  for (let i = 0; i < pairCount; i++) {
    pairs.push({
      prompt: `Persona ${persona.name}: ${persona.summary}`,
      chosen: chosen[i].message,
      rejected: rejected[i].message,
      personaId: persona.id,
      timestamp: chosen[i].createdAt > rejected[i].createdAt
        ? chosen[i].createdAt
        : rejected[i].createdAt,
    });
  }

  return pairs;
}
