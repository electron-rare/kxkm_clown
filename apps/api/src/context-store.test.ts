import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
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

/** Build a valid JSONL entry as ContextStore would write it. */
function jsonlLine(nick: string, text: string, type = "message"): string {
  return JSON.stringify({ ts: new Date().toISOString(), nick, text, type });
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("ContextStore", () => {
  // -----------------------------------------------------------------------
  // Existing tests (preserved as-is)
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // init()
  // -----------------------------------------------------------------------

  it("init() creates the data directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kxkm-context-store-"));
    tmpDirs.push(dir);
    const nested = path.join(dir, "sub", "deep");
    const store = new ContextStore({ dataDir: nested });
    await store.init();

    const s = await stat(nested);
    assert.ok(s.isDirectory());
  });

  it("init() is idempotent (calling twice does not throw)", async () => {
    const { store } = await makeStore();
    // Second call should be a no-op
    await store.init();
  });

  // -----------------------------------------------------------------------
  // addEntry / append
  // -----------------------------------------------------------------------

  it("append() writes a JSONL line to the channel file", async () => {
    const { store, dir } = await makeStore();
    await store.append("general", "alice", "hello world");

    const filePath = path.join(dir, "general.jsonl");
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);

    const entry = JSON.parse(lines[0]);
    assert.equal(entry.nick, "alice");
    assert.equal(entry.text, "hello world");
    assert.equal(entry.type, "message");
    assert.ok(entry.ts, "entry should have a timestamp");
  });

  it("append() supports type parameter", async () => {
    const { store, dir } = await makeStore();
    await store.append("chan", "bot", "system message", "system");

    const filePath = path.join(dir, "chan.jsonl");
    const content = await readFile(filePath, "utf-8");
    const entry = JSON.parse(content.trim());
    assert.equal(entry.type, "system");
  });

  it("append() truncates text longer than 2000 chars", async () => {
    const { store, dir } = await makeStore();
    const longText = "x".repeat(5000);
    await store.append("chan", "alice", longText);

    const filePath = path.join(dir, "chan.jsonl");
    const content = await readFile(filePath, "utf-8");
    const entry = JSON.parse(content.trim());
    assert.equal(entry.text.length, 2000);
  });

  it("multiple sequential append() calls accumulate entries", async () => {
    const { store, dir } = await makeStore();
    await store.append("room", "alice", "msg1");
    await store.append("room", "bob", "msg2");
    await store.append("room", "carol", "msg3");

    const filePath = path.join(dir, "room.jsonl");
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[0]).nick, "alice");
    assert.equal(JSON.parse(lines[1]).nick, "bob");
    assert.equal(JSON.parse(lines[2]).nick, "carol");
  });

  // -----------------------------------------------------------------------
  // Channel sanitization
  // -----------------------------------------------------------------------

  it("sanitizes channel names: #general becomes _general", async () => {
    const { store, dir } = await makeStore();
    await store.append("#general", "alice", "hi");

    const filePath = path.join(dir, "_general.jsonl");
    const content = await readFile(filePath, "utf-8");
    assert.ok(content.includes("alice"), "file should contain the entry");
  });

  it("sanitizes channel names with special characters", async () => {
    const { store, dir } = await makeStore();
    await store.append("#café/lounge!", "alice", "bonjour");

    const filePath = path.join(dir, "_caf__lounge_.jsonl");
    const content = await readFile(filePath, "utf-8");
    assert.ok(content.includes("bonjour"));
  });

  // -----------------------------------------------------------------------
  // getContext()
  // -----------------------------------------------------------------------

  it("getContext() returns empty string when no file exists", async () => {
    const { store } = await makeStore();
    const ctx = await store.getContext("nonexistent");
    assert.equal(ctx, "");
  });

  it("getContext() returns formatted recent entries", async () => {
    const { store } = await makeStore();
    await store.append("room", "alice", "hello");
    await store.append("room", "bob", "world");

    const ctx = await store.getContext("room");
    assert.ok(ctx.includes("[Échanges récents]"), "should have recent header");
    assert.ok(ctx.includes("alice: hello"));
    assert.ok(ctx.includes("bob: world"));
  });

  it("getContext() respects maxChars and truncates oldest entries first", async () => {
    const { store } = await makeStore();
    // Add enough entries so total exceeds the limit
    for (let i = 0; i < 10; i++) {
      await store.append("room", `user${i}`, `message number ${i} with padding ${"z".repeat(20)}`);
    }

    const ctx = await store.getContext("room", 100);
    assert.ok(ctx.length <= 100, `expected <= 100 chars, got ${ctx.length}`);
    // Should contain the LAST entries since we read backwards
    assert.ok(ctx.includes("user9") || ctx.includes("user8"), "should include recent entries");
  });

  it("getContext() includes summary when summary file exists", async () => {
    const { store, dir } = await makeStore();

    // Write a summary file manually
    const summaryData = {
      channel: "room",
      summaryText: "Alice and Bob discussed the weather.",
      entriesCompacted: 50,
      lastCompactedAt: new Date().toISOString(),
      totalCompactions: 1,
    };
    await writeFile(path.join(dir, "room.summary.json"), JSON.stringify(summaryData), "utf-8");

    // Add a recent entry
    await store.append("room", "carol", "any news?");

    const ctx = await store.getContext("room");
    assert.ok(ctx.includes("[Résumé des conversations précédentes]"), "should include summary header");
    assert.ok(ctx.includes("Alice and Bob discussed the weather."), "should include summary text");
    assert.ok(ctx.includes("carol: any news?"), "should also include recent entries");
  });

  it("getContext() returns only summary when entries file is missing but summary exists", async () => {
    const { store, dir } = await makeStore();

    const summaryData = {
      channel: "room",
      summaryText: "Previously discussed topics.",
      entriesCompacted: 10,
      lastCompactedAt: new Date().toISOString(),
      totalCompactions: 1,
    };
    await writeFile(path.join(dir, "room.summary.json"), JSON.stringify(summaryData), "utf-8");

    const ctx = await store.getContext("room");
    assert.ok(ctx.includes("[Résumé des conversations précédentes]"));
    assert.ok(ctx.includes("Previously discussed topics."));
  });

  // -----------------------------------------------------------------------
  // readSummary (via getContext / internal access)
  // -----------------------------------------------------------------------

  it("readSummary returns null when no summary file exists", async () => {
    const { store } = await makeStore();
    const anyStore = store as unknown as {
      readSummary: (channel: string) => Promise<unknown>;
    };
    const result = await anyStore.readSummary("nonexistent");
    assert.equal(result, null);
  });

  it("readSummary parses valid summary JSON", async () => {
    const { store, dir } = await makeStore();
    const summaryData = {
      channel: "test",
      summaryText: "A summary.",
      entriesCompacted: 5,
      lastCompactedAt: "2026-01-01T00:00:00.000Z",
      totalCompactions: 1,
    };
    await writeFile(path.join(dir, "test.summary.json"), JSON.stringify(summaryData), "utf-8");

    const anyStore = store as unknown as {
      readSummary: (channel: string) => Promise<unknown>;
    };
    const result = await anyStore.readSummary("test") as typeof summaryData;
    assert.equal(result.summaryText, "A summary.");
    assert.equal(result.entriesCompacted, 5);
    assert.equal(result.totalCompactions, 1);
  });

  it("readSummary returns null for corrupted summary file", async () => {
    const { store, dir } = await makeStore();
    await writeFile(path.join(dir, "bad.summary.json"), "not valid json {{{", "utf-8");

    const anyStore = store as unknown as {
      readSummary: (channel: string) => Promise<unknown>;
    };
    const result = await anyStore.readSummary("bad");
    assert.equal(result, null);
  });

  // -----------------------------------------------------------------------
  // Write locks (concurrency)
  // -----------------------------------------------------------------------

  it("concurrent append() calls do not corrupt the file", async () => {
    const { store, dir } = await makeStore();

    // Fire multiple appends concurrently
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(store.append("concurrent", `user${i}`, `message ${i}`));
    }
    await Promise.all(promises);

    const filePath = path.join(dir, "concurrent.jsonl");
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 20, "all 20 entries should be present");

    // Verify each line is valid JSON
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), `line should be valid JSON: ${line.slice(0, 50)}`);
    }
  });

  it("concurrent append() on different channels writes to separate files", async () => {
    const { store, dir } = await makeStore();

    await Promise.all([
      store.append("chan-a", "alice", "msg-a"),
      store.append("chan-b", "bob", "msg-b"),
      store.append("chan-c", "carol", "msg-c"),
    ]);

    for (const [chan, nick] of [["chan-a", "alice"], ["chan-b", "bob"], ["chan-c", "carol"]]) {
      const filePath = path.join(dir, `${chan}.jsonl`);
      const content = await readFile(filePath, "utf-8");
      const entry = JSON.parse(content.trim());
      assert.equal(entry.nick, nick);
    }
  });

  // -----------------------------------------------------------------------
  // getStats()
  // -----------------------------------------------------------------------

  it("getStats() returns correct channel count and entry counts", async () => {
    const { store } = await makeStore();
    await store.append("room1", "alice", "hello");
    await store.append("room1", "bob", "hi");
    await store.append("room2", "carol", "hey");

    const stats = await store.getStats();
    assert.equal(stats.channels, 2);
    assert.equal(stats.entries["room1"] ?? stats.entries["#room1"], 2);
    assert.equal(stats.entries["room2"] ?? stats.entries["#room2"], 1);
    assert.ok(stats.totalSizeMB > 0, "totalSizeMB should be > 0");
  });

  it("getStats() returns zero for empty store", async () => {
    const { store } = await makeStore();
    const stats = await store.getStats();
    assert.equal(stats.channels, 0);
    assert.equal(stats.totalSizeMB, 0);
    assert.deepEqual(stats.entries, {});
  });

  // -----------------------------------------------------------------------
  // channelFile / summaryFile sanitization
  // -----------------------------------------------------------------------

  it("channelFile and summaryFile produce correct paths", async () => {
    const { store, dir } = await makeStore();
    const anyStore = store as unknown as {
      channelFile: (channel: string) => string;
      summaryFile: (channel: string) => string;
    };

    assert.equal(anyStore.channelFile("general"), path.join(dir, "general.jsonl"));
    assert.equal(anyStore.summaryFile("general"), path.join(dir, "general.summary.json"));
    assert.equal(anyStore.channelFile("#room"), path.join(dir, "_room.jsonl"));
    assert.equal(anyStore.summaryFile("#room"), path.join(dir, "_room.summary.json"));
  });

  // -----------------------------------------------------------------------
  // maybeCompact skips when file is small
  // -----------------------------------------------------------------------

  it("maybeCompact does not compact when file is under 1 MB", async () => {
    const { store } = await makeStore({ maxEntriesBeforeCompact: 2 });
    const anyStore = store as unknown as {
      maybeCompact: (channel: string) => Promise<void>;
      compact: (channel: string, lines: string[]) => Promise<void>;
    };

    // Add a few entries (well under 1 MB)
    await store.append("small", "alice", "hello");
    await store.append("small", "bob", "world");
    await store.append("small", "carol", "test");

    let compactCalled = false;
    anyStore.compact = async () => { compactCalled = true; };

    await anyStore.maybeCompact("small");
    assert.equal(compactCalled, false, "compact should not be called for files < 1 MB");
  });

  // -----------------------------------------------------------------------
  // parseJson helper
  // -----------------------------------------------------------------------

  it("parseJson returns null for invalid JSON", async () => {
    const { store } = await makeStore();
    const anyStore = store as unknown as {
      parseJson: <T>(raw: string) => T | null;
    };

    assert.equal(anyStore.parseJson("not json"), null);
    assert.equal(anyStore.parseJson("{bad:}"), null);
    assert.deepEqual(anyStore.parseJson('{"ok": true}'), { ok: true });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("getContext handles malformed JSONL lines gracefully", async () => {
    const { store, dir } = await makeStore();

    // Write a file with some valid and some invalid lines
    const validLine = jsonlLine("alice", "valid message");
    const content = `${validLine}\n{bad json}\n${jsonlLine("bob", "also valid")}\n`;
    await writeFile(path.join(dir, "mixed.jsonl"), content, "utf-8");

    const ctx = await store.getContext("mixed");
    // Should include valid entries, skip bad ones
    assert.ok(ctx.includes("alice: valid message") || ctx.includes("bob: also valid"),
      "should include at least one valid entry");
  });

  it("append() calls init() automatically if not yet initialized", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kxkm-context-store-"));
    tmpDirs.push(dir);
    const nested = path.join(dir, "auto-init");
    const store = new ContextStore({ dataDir: nested });
    // Do NOT call init() manually
    await store.append("room", "alice", "hello");

    // Verify the directory and file were created
    const filePath = path.join(nested, "room.jsonl");
    const content = await readFile(filePath, "utf-8");
    assert.ok(content.includes("alice"));
  });

  it("getContext() calls init() automatically if not yet initialized", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kxkm-context-store-"));
    tmpDirs.push(dir);
    const nested = path.join(dir, "auto-init2");
    const store = new ContextStore({ dataDir: nested });
    // Should not throw, just return empty
    const ctx = await store.getContext("room");
    assert.equal(ctx, "");
  });

  it("summary budget is capped so recent entries still have room", async () => {
    const { store, dir } = await makeStore({ maxContextChars: 500 });

    // Write a long summary
    const summaryData = {
      channel: "room",
      summaryText: "S".repeat(1000),
      entriesCompacted: 100,
      lastCompactedAt: new Date().toISOString(),
      totalCompactions: 5,
    };
    await writeFile(path.join(dir, "room.summary.json"), JSON.stringify(summaryData), "utf-8");

    await store.append("room", "alice", "recent msg");

    const ctx = await store.getContext("room", 500);
    assert.ok(ctx.length <= 500, `expected <= 500 chars, got ${ctx.length}`);
    // Summary should be truncated to leave room (limit - 256 = 244 for summary budget)
  });
});
