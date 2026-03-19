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

  for (let index = 0; index < pairCount; index++) {
    pairs.push({
      prompt: `Persona ${persona.name}: ${persona.summary}`,
      chosen: chosen[index].message,
      rejected: rejected[index].message,
      personaId: persona.id,
      timestamp: chosen[index].createdAt > rejected[index].createdAt
        ? chosen[index].createdAt
        : rejected[index].createdAt,
    });
  }

  return pairs;
}
