import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import {
  loadDatabaseConfig,
  createPostgresPool,
  createSessionRepo,
  createPersonaRepo,
  createNodeGraphRepo,
  createNodeRunRepo,
  createPersonaSourceRepo,
  createPersonaFeedbackRepo,
  createPersonaProposalRepo,
  runMigrations,
  CORE_SCHEMA_SQL,
  PERSONA_SCHEMA_SQL,
  NODE_ENGINE_SCHEMA_SQL,
  PERSONA_SUBSTORES_SCHEMA_SQL,
} from "./index.js";
import type { DatabaseConfig } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers: mock Pool that records queries
// ---------------------------------------------------------------------------

interface MockQuery {
  text: string;
  params: unknown[];
}

function createMockPool(rows: Record<string, unknown>[] = [], rowCount = 0) {
  const queries: MockQuery[] = [];
  const pool = {
    query(text: string, params: unknown[] = []) {
      queries.push({ text, params });
      return Promise.resolve({ rows, rowCount });
    },
    connect() {
      const client = {
        query(text: string, params: unknown[] = []) {
          queries.push({ text, params });
          return Promise.resolve({ rows, rowCount });
        },
        release() {},
      };
      return Promise.resolve(client);
    },
    queries,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pool as any;
}

// ---------------------------------------------------------------------------
// loadDatabaseConfig
// ---------------------------------------------------------------------------

describe("loadDatabaseConfig", () => {
  it("returns defaults when no env vars set", () => {
    const config: DatabaseConfig = loadDatabaseConfig({});
    assert.equal(config.connectionString, "postgres://localhost:5432/kxkm_clown_v2");
    assert.equal(config.schema, "public");
  });

  it("reads DATABASE_URL from env", () => {
    const config = loadDatabaseConfig({ DATABASE_URL: "postgres://custom:5433/mydb" });
    assert.equal(config.connectionString, "postgres://custom:5433/mydb");
  });

  it("reads DATABASE_SCHEMA from env", () => {
    const config = loadDatabaseConfig({ DATABASE_SCHEMA: "v2" });
    assert.equal(config.schema, "v2");
  });

  it("reads both env vars together", () => {
    const config = loadDatabaseConfig({
      DATABASE_URL: "postgres://host/db",
      DATABASE_SCHEMA: "custom",
    });
    assert.equal(config.connectionString, "postgres://host/db");
    assert.equal(config.schema, "custom");
  });
});

// ---------------------------------------------------------------------------
// Schema SQL constants
// ---------------------------------------------------------------------------

describe("Schema SQL constants", () => {
  it("CORE_SCHEMA_SQL contains users and sessions tables", () => {
    assert.ok(CORE_SCHEMA_SQL.length > 0);
    assert.ok(CORE_SCHEMA_SQL.includes("CREATE TABLE IF NOT EXISTS users"));
    assert.ok(CORE_SCHEMA_SQL.includes("CREATE TABLE IF NOT EXISTS sessions"));
  });

  it("PERSONA_SCHEMA_SQL contains personas table", () => {
    assert.ok(PERSONA_SCHEMA_SQL.length > 0);
    assert.ok(PERSONA_SCHEMA_SQL.includes("CREATE TABLE IF NOT EXISTS personas"));
  });

  it("NODE_ENGINE_SCHEMA_SQL contains node_graphs and node_runs", () => {
    assert.ok(NODE_ENGINE_SCHEMA_SQL.length > 0);
    assert.ok(NODE_ENGINE_SCHEMA_SQL.includes("CREATE TABLE IF NOT EXISTS node_graphs"));
    assert.ok(NODE_ENGINE_SCHEMA_SQL.includes("CREATE TABLE IF NOT EXISTS node_runs"));
  });

  it("PERSONA_SUBSTORES_SCHEMA_SQL contains sources, feedback, proposals", () => {
    assert.ok(PERSONA_SUBSTORES_SCHEMA_SQL.length > 0);
    assert.ok(PERSONA_SUBSTORES_SCHEMA_SQL.includes("CREATE TABLE IF NOT EXISTS persona_sources"));
    assert.ok(PERSONA_SUBSTORES_SCHEMA_SQL.includes("CREATE TABLE IF NOT EXISTS persona_feedback"));
    assert.ok(PERSONA_SUBSTORES_SCHEMA_SQL.includes("CREATE TABLE IF NOT EXISTS persona_proposals"));
  });
});

// ---------------------------------------------------------------------------
// createPostgresPool
// ---------------------------------------------------------------------------

describe("createPostgresPool", () => {
  it("is a function that accepts a config", () => {
    assert.equal(typeof createPostgresPool, "function");
  });
});

// ---------------------------------------------------------------------------
// runMigrations
// ---------------------------------------------------------------------------

describe("runMigrations", () => {
  it("executes schema SQL inside a transaction", async () => {
    const pool = createMockPool();
    await runMigrations(pool);

    const texts = pool.queries.map((q: MockQuery) => q.text);
    assert.ok(texts.includes("BEGIN"), "should BEGIN transaction");
    assert.ok(texts.includes("COMMIT"), "should COMMIT transaction");
    assert.ok(texts.includes(CORE_SCHEMA_SQL));
    assert.ok(texts.includes(PERSONA_SCHEMA_SQL));
    assert.ok(texts.includes(PERSONA_SUBSTORES_SCHEMA_SQL));
    assert.ok(texts.includes(NODE_ENGINE_SCHEMA_SQL));
  });

  it("rolls back on error", async () => {
    let queryCount = 0;
    const pool = {
      connect() {
        return Promise.resolve({
          query(text: string) {
            queryCount++;
            // Fail on the 3rd query (after BEGIN + first schema)
            if (queryCount === 3) throw new Error("boom");
            return Promise.resolve({ rows: [] });
          },
          release() {},
        });
      },
    };

    await assert.rejects(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => runMigrations(pool as any),
      { message: "boom" },
    );
  });
});

// ---------------------------------------------------------------------------
// Session repository
// ---------------------------------------------------------------------------

describe("createSessionRepo", () => {
  it("returns an object with create, findById, deleteById, deleteExpired", () => {
    const repo = createSessionRepo(createMockPool());
    assert.equal(typeof repo.create, "function");
    assert.equal(typeof repo.findById, "function");
    assert.equal(typeof repo.deleteById, "function");
    assert.equal(typeof repo.deleteExpired, "function");
  });

  it("create() inserts and returns a session", async () => {
    const pool = createMockPool();
    const repo = createSessionRepo(pool);
    const session = await repo.create({ username: "alice", role: "admin" });

    assert.equal(session.username, "alice");
    assert.equal(session.role, "admin");
    assert.ok(session.id.startsWith("session_"));
    assert.ok(session.createdAt);
    assert.ok(session.expiresAt);
    assert.equal(pool.queries.length, 1);
    assert.ok(pool.queries[0].text.includes("INSERT INTO sessions"));
  });

  it("findById() returns null when no rows", async () => {
    const pool = createMockPool([]);
    const repo = createSessionRepo(pool);
    const result = await repo.findById("sess_missing");
    assert.equal(result, null);
  });

  it("findById() maps row to AuthSession", async () => {
    const now = new Date("2024-06-01T10:00:00Z");
    const expires = new Date("2024-06-01T11:00:00Z");
    const pool = createMockPool([{
      id: "sess_1",
      username: "bob",
      role: "editor",
      created_at: now,
      expires_at: expires,
    }]);
    const repo = createSessionRepo(pool);
    const result = await repo.findById("sess_1");

    assert.ok(result);
    assert.equal(result!.id, "sess_1");
    assert.equal(result!.username, "bob");
    assert.equal(result!.role, "editor");
    assert.equal(result!.createdAt, "2024-06-01T10:00:00.000Z");
    assert.equal(result!.expiresAt, "2024-06-01T11:00:00.000Z");
  });

  it("deleteById() sends DELETE query", async () => {
    const pool = createMockPool();
    const repo = createSessionRepo(pool);
    await repo.deleteById("sess_1");
    assert.ok(pool.queries[0].text.includes("DELETE FROM sessions"));
    assert.deepEqual(pool.queries[0].params, ["sess_1"]);
  });

  it("deleteExpired() returns rowCount", async () => {
    const pool = createMockPool([], 3);
    const repo = createSessionRepo(pool);
    const count = await repo.deleteExpired();
    assert.equal(count, 3);
  });
});

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
// Node Graph repository
// ---------------------------------------------------------------------------

describe("createNodeGraphRepo", () => {
  it("returns list, findById, create, update methods", () => {
    const repo = createNodeGraphRepo(createMockPool());
    assert.equal(typeof repo.list, "function");
    assert.equal(typeof repo.findById, "function");
    assert.equal(typeof repo.create, "function");
    assert.equal(typeof repo.update, "function");
  });

  it("list() maps rows to NodeGraphRecord[]", async () => {
    const pool = createMockPool([
      { id: "g1", name: "Graph 1", description: "desc1" },
    ]);
    const repo = createNodeGraphRepo(pool);
    const result = await repo.list();
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "g1");
    assert.equal(result[0].name, "Graph 1");
    assert.equal(result[0].description, "desc1");
  });

  it("findById() returns null for empty result", async () => {
    const repo = createNodeGraphRepo(createMockPool([]));
    assert.equal(await repo.findById("missing"), null);
  });

  it("create() sends INSERT and returns mapped record", async () => {
    const pool = createMockPool([{ id: "g1", name: "New", description: "d" }]);
    const repo = createNodeGraphRepo(pool);
    const result = await repo.create({ id: "g1", name: "New", description: "d" });
    assert.equal(result.id, "g1");
    assert.ok(pool.queries[0].text.includes("INSERT INTO node_graphs"));
  });

  it("update() with no fields delegates to findById", async () => {
    const pool = createMockPool([{ id: "g1", name: "X", description: "d" }]);
    const repo = createNodeGraphRepo(pool);
    const result = await repo.update("g1", {});
    // Should have called findById (SELECT) not UPDATE
    assert.ok(pool.queries[0].text.includes("SELECT"));
  });

  it("update() builds SET clause for provided fields", async () => {
    const pool = createMockPool([{ id: "g1", name: "Updated", description: "new desc" }]);
    const repo = createNodeGraphRepo(pool);
    await repo.update("g1", { name: "Updated", description: "new desc" });
    assert.ok(pool.queries[0].text.includes("UPDATE node_graphs SET"));
    assert.ok(pool.queries[0].text.includes("name ="));
    assert.ok(pool.queries[0].text.includes("description ="));
  });

  it("update() returns null when no rows match", async () => {
    const pool = createMockPool([]);
    const repo = createNodeGraphRepo(pool);
    const result = await repo.update("missing", { name: "x" });
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// Node Run repository
// ---------------------------------------------------------------------------

describe("createNodeRunRepo", () => {
  it("returns all expected methods", () => {
    const repo = createNodeRunRepo(createMockPool());
    assert.equal(typeof repo.list, "function");
    assert.equal(typeof repo.findById, "function");
    assert.equal(typeof repo.create, "function");
    assert.equal(typeof repo.updateStatus, "function");
    assert.equal(typeof repo.requestCancel, "function");
    assert.equal(typeof repo.recoverStaleRuns, "function");
    assert.equal(typeof repo.listByStatus, "function");
    assert.equal(typeof repo.deleteOlderThan, "function");
  });

  it("list() maps rows with graphId from graph_id", async () => {
    const pool = createMockPool([
      { id: "r1", graph_id: "g1", status: "completed", created_at: new Date("2024-01-01T00:00:00Z") },
    ]);
    const repo = createNodeRunRepo(pool);
    const result = await repo.list();
    assert.equal(result.length, 1);
    assert.equal(result[0].graphId, "g1");
    assert.equal(result[0].status, "completed");
    assert.equal(result[0].createdAt, "2024-01-01T00:00:00.000Z");
  });

  it("list() handles string created_at (not Date)", async () => {
    const pool = createMockPool([
      { id: "r1", graph_id: "g1", status: "queued", created_at: "2024-06-15T12:00:00Z" },
    ]);
    const repo = createNodeRunRepo(pool);
    const result = await repo.list();
    assert.equal(result[0].createdAt, "2024-06-15T12:00:00Z");
  });

  it("findById() returns null for empty result", async () => {
    const repo = createNodeRunRepo(createMockPool([]));
    assert.equal(await repo.findById("missing"), null);
  });

  it("create() sends INSERT with correct params", async () => {
    const pool = createMockPool([
      { id: "r1", graph_id: "g1", status: "queued", created_at: new Date("2024-01-01T00:00:00Z") },
    ]);
    const repo = createNodeRunRepo(pool);
    await repo.create({ id: "r1", graphId: "g1", status: "queued", createdAt: "2024-01-01T00:00:00Z" });
    assert.ok(pool.queries[0].text.includes("INSERT INTO node_runs"));
    assert.deepEqual(pool.queries[0].params, ["r1", "g1", "queued", "2024-01-01T00:00:00Z"]);
  });

  it("updateStatus() sends UPDATE with status and id", async () => {
    const pool = createMockPool();
    const repo = createNodeRunRepo(pool);
    await repo.updateStatus("r1", "completed");
    assert.ok(pool.queries[0].text.includes("UPDATE node_runs SET status"));
    assert.deepEqual(pool.queries[0].params, ["completed", "r1"]);
  });

  it("requestCancel() targets queued/running runs", async () => {
    const pool = createMockPool();
    const repo = createNodeRunRepo(pool);
    await repo.requestCancel("r1");
    assert.ok(pool.queries[0].text.includes("cancelled"));
    assert.ok(pool.queries[0].text.includes("'queued', 'running'"));
  });

  it("recoverStaleRuns() re-queues running runs", async () => {
    const pool = createMockPool([
      { id: "r1", graph_id: "g1", status: "queued", created_at: new Date("2024-01-01T00:00:00Z") },
    ]);
    const repo = createNodeRunRepo(pool);
    const result = await repo.recoverStaleRuns();
    assert.equal(result.length, 1);
    assert.ok(pool.queries[0].text.includes("status = 'queued'"));
    assert.ok(pool.queries[0].text.includes("WHERE status = 'running'"));
  });

  it("listByStatus() passes status and limit", async () => {
    const pool = createMockPool([]);
    const repo = createNodeRunRepo(pool);
    await repo.listByStatus("queued", 10);
    assert.deepEqual(pool.queries[0].params, ["queued", 10]);
  });

  it("deleteOlderThan() returns rowCount", async () => {
    const pool = createMockPool([], 5);
    const repo = createNodeRunRepo(pool);
    const count = await repo.deleteOlderThan("2024-01-01T00:00:00Z");
    assert.equal(count, 5);
    assert.ok(pool.queries[0].text.includes("DELETE FROM node_runs"));
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
