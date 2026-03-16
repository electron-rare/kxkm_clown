import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  PERSONA_SEED_CATALOG,
  clonePersona,
  createFeedback,
  validatePersonaUpdate,
  aggregateFeedback,
  computePersonaDiff,
  createPersonaRegistryState,
  getPersonaById,
  getPersonaByNick,
  getPersonaByModel,
  buildPharmaciusPrompt,
  parsePharmaciusResponse,
  applyPatches,
  reversePatches,
  createEditorialPipeline,
  shouldTriggerProposal,
  addFeedback,
} from "./index.js";
import type { PersonaRecord, PersonaFeedbackRecord, PersonaPatch } from "./index.js";

describe("PERSONA_SEED_CATALOG", () => {
  it("has 5 personas", () => {
    assert.equal(PERSONA_SEED_CATALOG.length, 5);
  });

  it("each persona has required fields", () => {
    for (const p of PERSONA_SEED_CATALOG) {
      assert.equal(typeof p.id, "string");
      assert.equal(typeof p.name, "string");
      assert.equal(typeof p.model, "string");
      assert.equal(typeof p.summary, "string");
      assert.equal(typeof p.editable, "boolean");
    }
  });
});

describe("clonePersona", () => {
  it("creates an independent copy", () => {
    const original = PERSONA_SEED_CATALOG[0];
    const clone = clonePersona(original);
    assert.deepEqual(clone, original);
    // Mutation of clone should not affect original
    clone.name = "Modified";
    assert.notEqual(original.name, "Modified");
  });
});

describe("createFeedback", () => {
  it("creates a valid feedback record", () => {
    const fb = createFeedback("schaeffer", "vote", "positive +1");
    assert.ok(fb.id.startsWith("feedback_"));
    assert.equal(fb.personaId, "schaeffer");
    assert.equal(fb.kind, "vote");
    assert.equal(fb.message, "positive +1");
    assert.equal(typeof fb.createdAt, "string");
  });
});

describe("validatePersonaUpdate", () => {
  it("validates correct fields", () => {
    const result = validatePersonaUpdate({
      name: "NewName",
      summary: "A new summary",
      model: "mistral:7b",
    });
    assert.equal(result.name, "NewName");
    assert.equal(result.summary, "A new summary");
    assert.equal(result.model, "mistral:7b");
  });

  it("rejects invalid name (too short)", () => {
    const result = validatePersonaUpdate({ name: "X" });
    assert.equal(result.name, undefined);
  });

  it("rejects empty summary", () => {
    const result = validatePersonaUpdate({ summary: "  " });
    assert.equal(result.summary, undefined);
  });

  it("accepts editable boolean", () => {
    const result = validatePersonaUpdate({ editable: false });
    assert.equal(result.editable, false);
  });
});

describe("aggregateFeedback", () => {
  it("counts feedback correctly", () => {
    const feedback: PersonaFeedbackRecord[] = [
      { id: "1", personaId: "p1", kind: "vote", message: "positive +1", createdAt: "2024-01-01T00:00:00Z" },
      { id: "2", personaId: "p1", kind: "vote", message: "negative -1", createdAt: "2024-01-02T00:00:00Z" },
      { id: "3", personaId: "p1", kind: "vote", message: "up vote", createdAt: "2024-01-03T00:00:00Z" },
      { id: "4", personaId: "p1", kind: "chat_signal", message: "signal", createdAt: "2024-01-04T00:00:00Z" },
      { id: "5", personaId: "p1", kind: "drift_report", message: "drift", createdAt: "2024-01-05T00:00:00Z" },
    ];

    const agg = aggregateFeedback(feedback);
    assert.equal(agg.totalVotes, 3);
    assert.equal(agg.upvotes, 2);
    assert.equal(agg.downvotes, 1);
    assert.equal(agg.signals, 1);
    assert.equal(agg.driftReports, 1);
    assert.equal(agg.lastFeedbackAt, "2024-01-05T00:00:00Z");
  });

  it("returns null lastFeedbackAt for empty array", () => {
    const agg = aggregateFeedback([]);
    assert.equal(agg.totalVotes, 0);
    assert.equal(agg.lastFeedbackAt, null);
  });
});

describe("computePersonaDiff", () => {
  it("detects changes between two persona records", () => {
    const before: PersonaRecord = { id: "p1", name: "Old", model: "m1", summary: "s1", editable: true };
    const after: PersonaRecord = { id: "p1", name: "New", model: "m1", summary: "s2", editable: true };

    const diff = computePersonaDiff(before, after);
    assert.ok("name" in diff);
    assert.deepEqual(diff.name, { before: "Old", after: "New" });
    assert.ok("summary" in diff);
    assert.ok(!("id" in diff));
    assert.ok(!("model" in diff));
  });
});

describe("PersonaRegistryState", () => {
  it("createPersonaRegistryState initializes from seed", () => {
    const state = createPersonaRegistryState(PERSONA_SEED_CATALOG);
    assert.equal(state.personas.size, 5);
    assert.equal(state.enabledSet.size, 5);
  });

  it("getPersonaById returns correct persona", () => {
    const state = createPersonaRegistryState(PERSONA_SEED_CATALOG);
    const p = getPersonaById(state, "schaeffer");
    assert.notEqual(p, null);
    assert.equal(p!.name, "Schaeffer");
  });

  it("getPersonaById returns null for unknown id", () => {
    const state = createPersonaRegistryState(PERSONA_SEED_CATALOG);
    assert.equal(getPersonaById(state, "nonexistent"), null);
  });

  it("getPersonaByNick finds by case-insensitive name", () => {
    const state = createPersonaRegistryState(PERSONA_SEED_CATALOG);
    const p = getPersonaByNick(state, "BATTY");
    assert.notEqual(p, null);
    assert.equal(p!.id, "batty");
  });

  it("getPersonaByModel finds first persona for a model", () => {
    const state = createPersonaRegistryState(PERSONA_SEED_CATALOG);
    const p = getPersonaByModel(state, "mistral:7b");
    assert.notEqual(p, null);
    assert.equal(p!.id, "batty");
  });

  it("getPersonaByModel returns null for unknown model", () => {
    const state = createPersonaRegistryState(PERSONA_SEED_CATALOG);
    assert.equal(getPersonaByModel(state, "unknown:model"), null);
  });
});

describe("buildPharmaciusPrompt", () => {
  it("returns a non-empty string containing persona info", () => {
    const persona = PERSONA_SEED_CATALOG[0];
    const prompt = buildPharmaciusPrompt({
      personaId: persona.id,
      feedbackItems: [],
      currentPersona: persona,
    });
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.length > 0);
    assert.ok(prompt.includes("Pharmacius"));
    assert.ok(prompt.includes(persona.name));
  });
});

describe("parsePharmaciusResponse", () => {
  it("parses valid JSON patches", () => {
    const raw = `Here is the result: {"patches":[{"field":"summary","before":"old","after":"new","reason":"better","confidence":0.9}],"reasoning":"improved"}`;
    const patches = parsePharmaciusResponse(raw, "p1");
    assert.equal(patches.length, 1);
    assert.equal(patches[0].field, "summary");
    assert.equal(patches[0].after, "new");
    assert.equal(patches[0].personaId, "p1");
    assert.equal(patches[0].confidence, 0.9);
  });

  it("returns empty array for unparseable input", () => {
    const patches = parsePharmaciusResponse("not json at all", "p1");
    assert.equal(patches.length, 0);
  });
});

describe("applyPatches", () => {
  it("modifies persona fields based on patches", () => {
    const persona: PersonaRecord = { id: "p1", name: "Old", model: "m1", summary: "s1", editable: true };
    const patches: PersonaPatch[] = [
      { personaId: "p1", field: "summary", before: "s1", after: "s2", reason: "test", confidence: 0.8 },
    ];
    const result = applyPatches(persona, patches);
    assert.equal(result.summary, "s2");
    // Original should not be mutated
    assert.equal(persona.summary, "s1");
  });
});

describe("reversePatches", () => {
  it("swaps before and after", () => {
    const patches: PersonaPatch[] = [
      { personaId: "p1", field: "name", before: "A", after: "B", reason: "test", confidence: 0.7 },
    ];
    const reversed = reversePatches(patches);
    assert.equal(reversed.length, 1);
    assert.equal(reversed[0].before, "B");
    assert.equal(reversed[0].after, "A");
    assert.ok(reversed[0].reason.startsWith("revert:"));
  });
});

describe("createEditorialPipeline", () => {
  it("initializes with idle stage", () => {
    const pipeline = createEditorialPipeline("schaeffer");
    assert.equal(pipeline.personaId, "schaeffer");
    assert.equal(pipeline.stage, "idle");
    assert.equal(pipeline.feedbackBuffer.length, 0);
    assert.equal(pipeline.currentProposal, null);
    assert.equal(pipeline.history.length, 0);
  });
});

describe("shouldTriggerProposal", () => {
  it("returns false when below threshold", () => {
    const pipeline = createEditorialPipeline("p1");
    assert.equal(shouldTriggerProposal(pipeline), false);
    assert.equal(shouldTriggerProposal(pipeline, 3), false);
  });

  it("returns true when at or above threshold", () => {
    const pipeline = createEditorialPipeline("p1");
    for (let i = 0; i < 5; i++) {
      addFeedback(pipeline, {
        id: `fb_${i}`,
        personaId: "p1",
        kind: "vote",
        message: "up",
        createdAt: new Date().toISOString(),
      });
    }
    assert.equal(shouldTriggerProposal(pipeline), true);
    assert.equal(shouldTriggerProposal(pipeline, 10), false);
  });
});
