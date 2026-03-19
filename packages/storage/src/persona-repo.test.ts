import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createPersonaRepo,
  createPersonaSourceRepo,
  createPersonaFeedbackRepo,
  createPersonaProposalRepo,
} from "./index.js";
import { createMockPool, type MockQuery } from "./test-helpers.js";

// ---------------------------------------------------------------------------
// Persona repository
// ---------------------------------------------------------------------------

describe("createPersonaRepo", () => {
  it("returns an object with list, findById, upsert, seedCatalog", () => {
    const repo = createPersonaRepo(createMockPool());
    assert.equal(typeof repo.list, "function");
    assert.equal(typeof repo.findById, "function");
    assert.equal(typeof repo.upsert, "function");
    assert.equal(typeof repo.seedCatalog, "function");
  });

  it("list() maps rows to PersonaRecord[]", async () => {
    const pool = createMockPool([
      { id: "p1", name: "Alice", model: "gpt-4", summary: "A persona", editable: true },
      { id: "p2", name: "Bob", model: "llama", summary: "Another", editable: false },
    ]);
    const repo = createPersonaRepo(pool);
    const result = await repo.list();

    assert.equal(result.length, 2);
    assert.equal(result[0].id, "p1");
    assert.equal(result[0].name, "Alice");
    assert.equal(result[0].editable, true);
    assert.equal(result[1].editable, false);
  });

  it("findById() returns null for empty result", async () => {
    const repo = createPersonaRepo(createMockPool([]));
    const result = await repo.findById("missing");
    assert.equal(result, null);
  });

  it("findById() maps row correctly", async () => {
    const pool = createMockPool([
      { id: "p1", name: "Test", model: "m1", summary: "s", editable: 1 },
    ]);
    const repo = createPersonaRepo(pool);
    const result = await repo.findById("p1");
    assert.ok(result);
    assert.equal(result!.editable, true); // Boolean(1) === true
  });

  it("upsert() sends INSERT ON CONFLICT query", async () => {
    const pool = createMockPool([
      { id: "p1", name: "Test", model: "m1", summary: "s", editable: true },
    ]);
    const repo = createPersonaRepo(pool);
    const result = await repo.upsert({
      id: "p1", name: "Test", model: "m1", summary: "s", editable: true,
    });
    assert.equal(result.id, "p1");
    assert.ok(pool.queries[0].text.includes("ON CONFLICT"));
  });

  it("seedCatalog() does nothing for empty array", async () => {
    const pool = createMockPool();
    const repo = createPersonaRepo(pool);
    await repo.seedCatalog([]);
    assert.equal(pool.queries.length, 0);
  });

  it("seedCatalog() wraps inserts in a transaction", async () => {
    const pool = createMockPool();
    const repo = createPersonaRepo(pool);
    await repo.seedCatalog([
      { id: "p1", name: "A", model: "m", summary: "s", editable: true },
      { id: "p2", name: "B", model: "m", summary: "s", editable: false },
    ]);
    const texts = pool.queries.map((q: MockQuery) => q.text);
    assert.ok(texts[0] === "BEGIN");
    assert.ok(texts[texts.length - 1] === "COMMIT");
    // 2 inserts between BEGIN and COMMIT
    const inserts = texts.filter((t: string) => t.includes("INSERT INTO personas"));
    assert.equal(inserts.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Persona Source repository
// ---------------------------------------------------------------------------

describe("createPersonaSourceRepo", () => {
  it("returns findByPersonaId and upsert", () => {
    const repo = createPersonaSourceRepo(createMockPool());
    assert.equal(typeof repo.findByPersonaId, "function");
    assert.equal(typeof repo.upsert, "function");
  });

  it("findByPersonaId() returns null when no rows", async () => {
    const repo = createPersonaSourceRepo(createMockPool([]));
    assert.equal(await repo.findByPersonaId("p1"), null);
  });

  it("findByPersonaId() maps row correctly", async () => {
    const pool = createMockPool([{
      persona_id: "p1",
      subject_name: "Test Subject",
      summary: "A summary",
      references_: ["ref1", "ref2"],
    }]);
    const repo = createPersonaSourceRepo(pool);
    const result = await repo.findByPersonaId("p1");
    assert.ok(result);
    assert.equal(result!.personaId, "p1");
    assert.equal(result!.subjectName, "Test Subject");
    assert.equal(result!.summary, "A summary");
    assert.deepEqual(result!.references, ["ref1", "ref2"]);
  });

  it("findByPersonaId() defaults references to [] when null", async () => {
    const pool = createMockPool([{
      persona_id: "p1",
      subject_name: "X",
      summary: "S",
      references_: null,
    }]);
    const repo = createPersonaSourceRepo(pool);
    const result = await repo.findByPersonaId("p1");
    assert.deepEqual(result!.references, []);
  });

  it("upsert() sends INSERT ON CONFLICT query", async () => {
    const pool = createMockPool([{
      persona_id: "p1",
      subject_name: "X",
      summary: "S",
      references_: [],
    }]);
    const repo = createPersonaSourceRepo(pool);
    await repo.upsert({
      personaId: "p1",
      subjectName: "X",
      summary: "S",
      references: ["r1"],
    });
    assert.ok(pool.queries[0].text.includes("ON CONFLICT"));
    // references should be JSON-stringified
    assert.equal(pool.queries[0].params[3], JSON.stringify(["r1"]));
  });
});

// ---------------------------------------------------------------------------
// Persona Feedback repository
// ---------------------------------------------------------------------------

describe("createPersonaFeedbackRepo", () => {
  it("returns listByPersonaId and create", () => {
    const repo = createPersonaFeedbackRepo(createMockPool());
    assert.equal(typeof repo.listByPersonaId, "function");
    assert.equal(typeof repo.create, "function");
  });

  it("listByPersonaId() maps rows with Date created_at", async () => {
    const pool = createMockPool([{
      id: "f1",
      persona_id: "p1",
      kind: "vote",
      message: "good",
      created_at: new Date("2024-03-01T00:00:00Z"),
    }]);
    const repo = createPersonaFeedbackRepo(pool);
    const result = await repo.listByPersonaId("p1");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "f1");
    assert.equal(result[0].personaId, "p1");
    assert.equal(result[0].kind, "vote");
    assert.equal(result[0].createdAt, "2024-03-01T00:00:00.000Z");
  });

  it("listByPersonaId() handles string created_at", async () => {
    const pool = createMockPool([{
      id: "f1",
      persona_id: "p1",
      kind: "admin_edit",
      message: "edit",
      created_at: "2024-03-01",
    }]);
    const repo = createPersonaFeedbackRepo(pool);
    const result = await repo.listByPersonaId("p1");
    assert.equal(result[0].createdAt, "2024-03-01");
  });

  it("create() sends INSERT", async () => {
    const pool = createMockPool([{
      id: "f1",
      persona_id: "p1",
      kind: "vote",
      message: "msg",
      created_at: new Date("2024-01-01T00:00:00Z"),
    }]);
    const repo = createPersonaFeedbackRepo(pool);
    await repo.create({
      id: "f1",
      personaId: "p1",
      kind: "vote",
      message: "msg",
      createdAt: "2024-01-01T00:00:00Z",
    });
    assert.ok(pool.queries[0].text.includes("INSERT INTO persona_feedback"));
  });
});

// ---------------------------------------------------------------------------
// Persona Proposal repository
// ---------------------------------------------------------------------------

describe("createPersonaProposalRepo", () => {
  it("returns listByPersonaId, create, markApplied", () => {
    const repo = createPersonaProposalRepo(createMockPool());
    assert.equal(typeof repo.listByPersonaId, "function");
    assert.equal(typeof repo.create, "function");
    assert.equal(typeof repo.markApplied, "function");
  });

  it("listByPersonaId() maps rows correctly", async () => {
    const pool = createMockPool([{
      id: "pr1",
      persona_id: "p1",
      before_snapshot: { name: "A", model: "m", summary: "s" },
      after_snapshot: { name: "B", model: "m", summary: "s2" },
      reason: "improvement",
      applied: false,
      created_at: new Date("2024-05-01T00:00:00Z"),
    }]);
    const repo = createPersonaProposalRepo(pool);
    const result = await repo.listByPersonaId("p1");

    assert.equal(result.length, 1);
    assert.equal(result[0].id, "pr1");
    assert.equal(result[0].personaId, "p1");
    assert.equal(result[0].reason, "improvement");
    assert.equal(result[0].applied, false);
    assert.deepEqual(result[0].before, { name: "A", model: "m", summary: "s" });
    assert.deepEqual(result[0].after, { name: "B", model: "m", summary: "s2" });
  });

  it("create() sends INSERT with JSON-stringified snapshots", async () => {
    const pool = createMockPool([{
      id: "pr1",
      persona_id: "p1",
      before_snapshot: { name: "A", model: "m", summary: "s" },
      after_snapshot: { name: "B", model: "m", summary: "s2" },
      reason: "test",
      applied: false,
      created_at: new Date("2024-01-01T00:00:00Z"),
    }]);
    const repo = createPersonaProposalRepo(pool);
    const before = { name: "A", model: "m", summary: "s" };
    const after = { name: "B", model: "m", summary: "s2" };
    await repo.create({
      id: "pr1",
      personaId: "p1",
      before,
      after,
      reason: "test",
      applied: false,
      createdAt: "2024-01-01T00:00:00Z",
    });
    assert.ok(pool.queries[0].text.includes("INSERT INTO persona_proposals"));
    // Params 2 and 3 (index) are JSON-stringified snapshots
    assert.equal(pool.queries[0].params[2], JSON.stringify(before));
    assert.equal(pool.queries[0].params[3], JSON.stringify(after));
  });

  it("markApplied() sends UPDATE", async () => {
    const pool = createMockPool();
    const repo = createPersonaProposalRepo(pool);
    await repo.markApplied("pr1");
    assert.ok(pool.queries[0].text.includes("UPDATE persona_proposals SET applied = true"));
    assert.deepEqual(pool.queries[0].params, ["pr1"]);
  });
});
