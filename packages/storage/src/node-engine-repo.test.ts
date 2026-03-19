import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createNodeGraphRepo, createNodeRunRepo } from "./index.js";
import { createMockPool } from "./test-helpers.js";

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
