import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createSessionRepo } from "./index.js";
import { createMockPool } from "./test-helpers.js";

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
