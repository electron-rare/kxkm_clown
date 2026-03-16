import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createId,
  createIsoTimestamp,
  isUserRole,
  ROLE_PERMISSIONS,
  asApiData,
  USER_ROLES,
} from "./index.js";

describe("createId", () => {
  it("returns a string with the given prefix", () => {
    const id = createId("test");
    assert.equal(typeof id, "string");
    assert.ok(id.startsWith("test_"), `expected prefix 'test_', got '${id}'`);
  });

  it("generates unique ids on successive calls", () => {
    const a = createId("x");
    const b = createId("x");
    assert.notEqual(a, b);
  });
});

describe("createIsoTimestamp", () => {
  it("returns an ISO 8601 string", () => {
    const ts = createIsoTimestamp();
    assert.equal(typeof ts, "string");
    // Must parse back to a valid date
    const parsed = new Date(ts);
    assert.ok(!isNaN(parsed.getTime()));
    // ISO strings end with 'Z'
    assert.ok(ts.endsWith("Z"), `expected trailing 'Z', got '${ts}'`);
  });

  it("uses the provided date", () => {
    const d = new Date("2024-06-15T12:00:00.000Z");
    const ts = createIsoTimestamp(d);
    assert.equal(ts, "2024-06-15T12:00:00.000Z");
  });
});

describe("isUserRole", () => {
  it("returns true for valid roles", () => {
    for (const role of USER_ROLES) {
      assert.equal(isUserRole(role), true, `'${role}' should be valid`);
    }
  });

  it("returns false for invalid values", () => {
    assert.equal(isUserRole("superadmin"), false);
    assert.equal(isUserRole(""), false);
    assert.equal(isUserRole("Admin"), false);
  });
});

describe("ROLE_PERMISSIONS", () => {
  it("has entries for all four roles", () => {
    const roles = Object.keys(ROLE_PERMISSIONS);
    assert.deepEqual(roles.sort(), ["admin", "editor", "operator", "viewer"]);
  });

  it("admin has all permissions", () => {
    assert.ok(ROLE_PERMISSIONS.admin.length > 0);
    // admin should have the most permissions
    for (const role of USER_ROLES) {
      assert.ok(
        ROLE_PERMISSIONS.admin.length >= ROLE_PERMISSIONS[role].length,
        `admin should have >= perms than ${role}`,
      );
    }
  });
});

describe("asApiData", () => {
  it("wraps data in an ok envelope", () => {
    const result = asApiData({ foo: 42 });
    assert.deepEqual(result, { ok: true, data: { foo: 42 } });
  });

  it("works with primitive values", () => {
    const result = asApiData("hello");
    assert.deepEqual(result, { ok: true, data: "hello" });
  });
});
