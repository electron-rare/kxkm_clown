import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyPersonaMemoryExtraction,
  buildPersonaMemoryExtractionPrompt,
  normalizePersonaMemoryPolicy,
} from "./persona-memory-policy.js";

describe("persona-memory-policy", () => {
  it("clamps invalid policy inputs into a coherent range", () => {
    const policy = normalizePersonaMemoryPolicy({
      extraction: {
        minFacts: 9,
        maxFacts: 2,
        updateEveryResponses: 0,
        recentMessagesWindow: -1,
      },
      pruning: {
        workingFactsLimit: 1,
        compatFactsLimit: 99,
        workingSourceMessagesLimit: 0,
        archivalFactsLimit: 0,
        archivalSummariesLimit: 0,
      },
    });

    assert.equal(policy.extraction.updateEveryResponses, 1);
    assert.equal(policy.extraction.minFacts, 1);
    assert.equal(policy.extraction.maxFacts, 1);
    assert.equal(policy.extraction.recentMessagesWindow, 1);
    assert.equal(policy.pruning.workingFactsLimit, 1);
    assert.equal(policy.pruning.compatFactsLimit, 1);
    assert.equal(policy.pruning.workingSourceMessagesLimit, 1);
    assert.equal(policy.pruning.archivalFactsLimit, 1);
    assert.equal(policy.pruning.archivalSummariesLimit, 1);
  });

  it("builds prompts and extracted memories from the configured policy", () => {
    const policy = normalizePersonaMemoryPolicy({
      extraction: {
        minFacts: 1,
        maxFacts: 2,
        recentMessagesWindow: 2,
      },
      pruning: {
        workingFactsLimit: 3,
        workingSourceMessagesLimit: 2,
        archivalFactsLimit: 4,
        archivalSummariesLimit: 2,
        compatFactsLimit: 2,
      },
    });

    const prompt = buildPersonaMemoryExtractionPrompt(
      { nick: "Schaeffer" },
      ["msg 1", "msg 2", "msg 3"],
      policy,
    );
    assert.match(prompt, /Extrais 1-2 faits/);
    assert.doesNotMatch(prompt, /msg 1/);
    assert.match(prompt, /msg 2/);
    assert.match(prompt, /msg 3/);

    const memory = applyPersonaMemoryExtraction({
      personaId: "schaeffer",
      nick: "Schaeffer",
      facts: ["fait 1", "fait 2"],
      summary: "ancien resume",
      lastUpdated: "2026-03-20T10:00:00.000Z",
      archivalMemory: {
        facts: [],
        summaries: [],
      },
    }, {
      facts: ["fait 2", "fait 3", "fait 4"],
      summary: "nouveau resume",
    }, {
      policy,
      recentMessages: ["m1", "m2", "m3"],
      timestamp: "2026-03-25T20:00:00.000Z",
    });

    assert.deepEqual(memory.workingMemory?.facts, ["fait 2", "fait 3", "fait 4"]);
    assert.deepEqual(memory.workingMemory?.lastSourceMessages, ["m2", "m3"]);
    assert.equal(memory.summary, "nouveau resume");
    assert.equal(memory.archivalMemory?.facts.length, 3);
    assert.equal(memory.archivalMemory?.summaries.length, 1);
  });
});
