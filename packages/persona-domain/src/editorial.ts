import type {
  PersonaFeedbackRecord,
  PersonaProposalRecord,
  PersonaRecord,
} from "./index.js";

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

export function createEditorialPipeline(personaId: string): EditorialPipelineState {
  return {
    personaId,
    stage: "idle",
    feedbackBuffer: [],
    currentProposal: null,
    history: [],
  };
}

export function addFeedback(state: EditorialPipelineState, feedback: PersonaFeedbackRecord): void {
  state.feedbackBuffer.push(feedback);
  if (state.stage === "idle") {
    state.stage = "collecting_feedback";
  }
}

export function shouldTriggerProposal(state: EditorialPipelineState, threshold = 5): boolean {
  return state.feedbackBuffer.length >= threshold;
}

export function applyProposal(state: EditorialPipelineState, proposal: PersonaProposalRecord): void {
  state.currentProposal = proposal;
  state.history.push(proposal);
  state.feedbackBuffer = [];
  state.stage = "applied";
}

export function revertLastProposal(state: EditorialPipelineState): PersonaProposalRecord | null {
  if (state.history.length === 0) {
    return null;
  }

  const last = state.history[state.history.length - 1];
  state.currentProposal = null;
  state.stage = "reverted";
  return last;
}

export interface DPOPair {
  prompt: string;
  chosen: string;
  rejected: string;
  personaId: string;
  timestamp: string;
}

export interface VoteFeedbackPayload {
  type?: "vote";
  vote: "up" | "down";
  response: string;
  prompt?: string;
  messageId?: string;
  channel?: string;
}

export function createVoteFeedbackMessage(payload: VoteFeedbackPayload): string {
  return JSON.stringify({
    type: "vote",
    vote: payload.vote,
    response: payload.response,
    prompt: payload.prompt || "",
    messageId: payload.messageId || "",
    channel: payload.channel || "",
  });
}

export function parseVoteFeedbackMessage(message: string): VoteFeedbackPayload | null {
  const raw = String(message || "").trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as VoteFeedbackPayload | null;
    if (
      parsed &&
      (parsed.vote === "up" || parsed.vote === "down") &&
      typeof parsed.response === "string" &&
      parsed.response.trim().length > 0
    ) {
      return {
        type: "vote",
        vote: parsed.vote,
        response: parsed.response,
        prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
        messageId: typeof parsed.messageId === "string" ? parsed.messageId : "",
        channel: typeof parsed.channel === "string" ? parsed.channel : "",
      };
    }
  } catch {
    // Legacy plain-text vote messages are still parsed below.
  }

  const upPattern = /\bup\b|positive|\+1|chosen/i;
  const downPattern = /\bdown\b|negative|-1|rejected/i;
  const vote = upPattern.test(raw) ? "up" : (downPattern.test(raw) ? "down" : null);
  if (!vote) return null;

  return {
    type: "vote",
    vote,
    response: raw,
    prompt: "",
    messageId: "",
    channel: "",
  };
}

export function extractDPOPairs(
  feedback: PersonaFeedbackRecord[],
  persona: PersonaRecord,
): DPOPair[] {
  const byPrompt = new Map<string, { chosen: Array<{ response: string; createdAt: string }>; rejected: Array<{ response: string; createdAt: string }> }>();
  const fallbackPrompt = `Persona ${persona.name}: ${persona.summary}`;

  for (const entry of feedback) {
    if (entry.kind !== "vote") continue;
    const parsed = parseVoteFeedbackMessage(entry.message);
    if (!parsed) continue;

    const prompt = parsed.prompt?.trim() || fallbackPrompt;
    const bucket = byPrompt.get(prompt) || { chosen: [], rejected: [] };
    const target = parsed.vote === "up" ? bucket.chosen : bucket.rejected;
    target.push({
      response: parsed.response,
      createdAt: entry.createdAt,
    });
    byPrompt.set(prompt, bucket);
  }

  const pairs: DPOPair[] = [];
  for (const [prompt, bucket] of byPrompt.entries()) {
    const pairCount = Math.min(bucket.chosen.length, bucket.rejected.length);
    for (let index = 0; index < pairCount; index++) {
      pairs.push({
        prompt,
        chosen: bucket.chosen[index].response,
        rejected: bucket.rejected[index].response,
        personaId: persona.id,
        timestamp: bucket.chosen[index].createdAt > bucket.rejected[index].createdAt
          ? bucket.chosen[index].createdAt
          : bucket.rejected[index].createdAt,
      });
    }
  }

  if (pairs.length === 0 && feedback.length > 0) {
    console.warn(
      `[DPO] extractDPOPairs returned 0 pairs for persona "${persona.id}" from ${feedback.length} feedback items — check vote polarity signals`,
    );
  }

  return pairs;
}
