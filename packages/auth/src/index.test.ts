import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hasPermission,
  assertPermission,
  validateLoginInput,
  createSessionRecord,
  extractSessionId,
} from "./index.js";

describe("hashPassword", () => {
  it("produces a salt:hash string", async () => {
    const hash = await hashPassword("secret123");
    assert.equal(typeof hash, "string");
    const parts = hash.split(":");
    assert.equal(parts.length, 2, "expected salt:hash format");
    assert.ok(parts[0].length > 0, "salt should be non-empty");
    assert.ok(parts[1].length > 0, "hash should be non-empty");
  });
});

describe("verifyPassword", () => {
  it("matches the correct password", async () => {
    const hash = await hashPassword("correct-horse");
    const result = await verifyPassword("correct-horse", hash);
    assert.equal(result, true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct-horse");
    const result = await verifyPassword("wrong-horse", hash);
    assert.equal(result, false);
  });
});

describe("generateSessionToken", () => {
  it("returns a 64-character hex string", () => {
    const token = generateSessionToken();
    assert.equal(typeof token, "string");
    assert.equal(token.length, 64);
    assert.match(token, /^[0-9a-f]{64}$/);
  });

  it("generates unique tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    assert.notEqual(a, b);
  });
});

describe("hasPermission", () => {
  it("admin has all permissions", () => {
    assert.equal(hasPermission("admin", "session:manage"), true);
    assert.equal(hasPermission("admin", "chat:read"), true);
    assert.equal(hasPermission("admin", "persona:write"), true);
    assert.equal(hasPermission("admin", "node_engine:operate"), true);
  });

  it("viewer has limited permissions", () => {
    assert.equal(hasPermission("viewer", "chat:read"), true);
    assert.equal(hasPermission("viewer", "persona:read"), true);
    assert.equal(hasPermission("viewer", "chat:write"), false);
    assert.equal(hasPermission("viewer", "session:manage"), false);
    assert.equal(hasPermission("viewer", "persona:write"), false);
  });
});

describe("assertPermission", () => {
  it("does not throw when permission is granted", () => {
    assert.doesNotThrow(() => assertPermission("admin", "session:manage"));
  });

  it("throws when permission is denied", () => {
    assert.throws(
      () => assertPermission("viewer", "session:manage"),
      { message: /permission_denied/ },
    );
  });
});

describe("validateLoginInput", () => {
  it("accepts valid input", () => {
    const result = validateLoginInput({ username: "alice", role: "editor" });
    assert.equal(result.username, "alice");
    assert.equal(result.role, "editor");
  });

  it("rejects empty username", () => {
    assert.throws(
      () => validateLoginInput({ username: "" }),
      { message: /invalid_username/ },
    );
  });

  it("rejects invalid role", () => {
    assert.throws(
      () => validateLoginInput({ username: "alice", role: "superadmin" }),
      { message: /invalid_role/ },
    );
  });

  it("rejects non-object input", () => {
    assert.throws(
      () => validateLoginInput(null),
      { message: /invalid_login_payload/ },
    );
  });
});

describe("createSessionRecord", () => {
  it("produces a valid session", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const session = createSessionRecord(
      { username: "bob", role: "operator" },
      "sess_123",
      now,
    );
    assert.equal(session.id, "sess_123");
    assert.equal(session.username, "bob");
    assert.equal(session.role, "operator");
    assert.equal(session.createdAt, "2024-01-01T00:00:00.000Z");
    // Default TTL is 1 hour
    assert.equal(session.expiresAt, "2024-01-01T01:00:00.000Z");
  });
});

describe("extractSessionId", () => {
  it("extracts from parsed cookies", () => {
    const id = extractSessionId({
      cookies: { kxkm_v2_session: "tok123" },
    });
    assert.equal(id, "tok123");
  });

  it("extracts from raw Cookie header", () => {
    const id = extractSessionId({
      headers: { cookie: "other=x; kxkm_v2_session=tok456; foo=bar" },
    });
    assert.equal(id, "tok456");
  });

  it("extracts from x-session-id header", () => {
    const id = extractSessionId({
      headers: { "x-session-id": "tok789" },
    });
    assert.equal(id, "tok789");
  });

  it("returns null when no session found", () => {
    const id = extractSessionId({ headers: {} });
    assert.equal(id, null);
  });
});
