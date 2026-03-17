import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { ContextStore } from "./context-store.js";

const tmpDirs: string[] = [];

async function makeStore(overrides: Record<string, unknown> = {}): Promise<{ store: ContextStore; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kxkm-context-store-"));
  tmpDirs.push(dir);
  const store = new ContextStore({
    dataDir: dir,
    ...overrides,
  });
  await store.init();
  return { store, dir };
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("ContextStore", () => {
  it("keeps returned context under requested char limit", async () => {
    const { store } = await makeStore({ maxContextChars: 200 });

    await store.append("#room", "alice", "a".repeat(80));
    await store.append("#room", "bob", "b".repeat(80));
    await store.append("#room", "carol", "c".repeat(80));

    const ctx = await store.getContext("#room", 120);
    assert.ok(ctx.length <= 120, `expected <= 120 chars, got ${ctx.length}`);
  });

  it("falls back to keeping recent lines when compaction has no valid entries", async () => {
    const { store, dir } = await makeStore();
    const anyStore = store as unknown as {
      compact: (channel: string, lines: string[]) => Promise<void>;
      channelFile: (channel: string) => string;
    };

    const channel = "#broken";
    const lines = ["{bad", "not-json", "still-not-json", "xx", "yy"];
    const splitIdx = Math.floor(lines.length * 0.8);
    const expected = lines.slice(splitIdx).join("\n") + "\n";

    await anyStore.compact(channel, lines);

    const safe = channel.replace(/[^a-zA-Z0-9_-]/g, "_");
    const rawPath = path.join(dir, `${safe}.jsonl`);
    const raw = await readFile(rawPath, "utf-8");
    assert.equal(raw, expected);
  });

  it("serializes limit enforcement calls", async () => {
    const { store } = await makeStore();
    const anyStore = store as unknown as {
      maybeEnforceLimits: (channel: string) => Promise<void>;
      enforceLimits: (channel: string) => Promise<void>;
    };

    let calls = 0;
    anyStore.enforceLimits = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
    };

    await Promise.all([
      anyStore.maybeEnforceLimits("#a"),
      anyStore.maybeEnforceLimits("#b"),
      anyStore.maybeEnforceLimits("#c"),
    ]);

    assert.equal(calls, 1);
  });
});
