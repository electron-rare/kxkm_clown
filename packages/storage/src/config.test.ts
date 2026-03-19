import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  loadDatabaseConfig,
  createPostgresPool,
  CORE_SCHEMA_SQL,
  PERSONA_SCHEMA_SQL,
  NODE_ENGINE_SCHEMA_SQL,
  PERSONA_SUBSTORES_SCHEMA_SQL,
} from "./index.js";
import type { DatabaseConfig } from "./index.js";

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
