import type { PersonaFeedbackRecord, PersonaRecord } from "./index.js";

export interface PersonaPatch {
  personaId: string;
  field: string;
  before: string;
  after: string;
  reason: string;
  confidence: number;
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

function cleanText(value: unknown, maxLength = 4000): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
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
    feedback: recentFeedback.map((feedback) => ({
      kind: feedback.kind,
      message: feedback.message,
      createdAt: feedback.createdAt,
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

      return { personaId, field, before, after, reason, confidence } satisfies PersonaPatch;
    })
    .filter((patch): patch is PersonaPatch => patch !== null);
}

export function applyPatches(persona: PersonaRecord, patches: PersonaPatch[]): PersonaRecord {
  const result = { ...persona } as Record<string, unknown> & PersonaRecord;
  const allowedFields = new Set<string>(["name", "model", "summary", "editable", "enabled"]);

  for (const patch of patches) {
    if (allowedFields.has(patch.field) && patch.field in persona) {
      const existing = (persona as unknown as Record<string, unknown>)[patch.field];
      if (existing === undefined || typeof patch.after === typeof existing) {
        result[patch.field] = patch.after;
      }
    }
  }

  return result;
}

export function reversePatches(patches: PersonaPatch[]): PersonaPatch[] {
  return patches.map((patch) => ({
    ...patch,
    before: patch.after,
    after: patch.before,
    reason: `revert: ${patch.reason}`,
  }));
}
