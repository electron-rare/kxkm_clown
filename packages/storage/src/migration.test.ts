import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  runMigrations,
  CORE_SCHEMA_SQL,
  PERSONA_SCHEMA_SQL,
  NODE_ENGINE_SCHEMA_SQL,
  PERSONA_SUBSTORES_SCHEMA_SQL,
} from "./index.js";
import { createMockPool, type MockQuery } from "./test-helpers.js";

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
