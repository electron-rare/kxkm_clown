import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  formatOverviewLine,
  ansi,
  statusDot,
  formatTable,
  drawBox,
  stripAnsi,
} from "./index.js";
import type { NodeEngineOverview } from "@kxkm/core";

describe("formatOverviewLine", () => {
  it("returns a formatted string with all fields", () => {
    const overview: NodeEngineOverview = {
      queue: { desiredWorkers: 2, activeWorkers: 1, queuedRuns: 3, runningRuns: 1 },
      registry: { graphs: 5, models: 10 },
      storage: { backend: "postgres", artifacts: "filesystem" },
    };
    const line = formatOverviewLine(overview);
    assert.equal(typeof line, "string");
    assert.ok(line.includes("workers=1/2"));
    assert.ok(line.includes("queued=3"));
    assert.ok(line.includes("running=1"));
    assert.ok(line.includes("graphs=5"));
    assert.ok(line.includes("models=10"));
  });
});

describe("ansi helpers", () => {
  it("green wraps with ANSI green codes", () => {
    const result = ansi.green("ok");
    assert.ok(result.includes("\x1b[32m"));
    assert.ok(result.includes("ok"));
    assert.ok(result.includes("\x1b[0m"));
  });

  it("red wraps with ANSI red codes", () => {
    const result = ansi.red("err");
    assert.ok(result.includes("\x1b[31m"));
    assert.ok(result.includes("err"));
  });

  it("bold wraps with ANSI bold codes", () => {
    const result = ansi.bold("title");
    assert.ok(result.includes("\x1b[1m"));
    assert.ok(result.includes("title"));
  });
});

describe("statusDot", () => {
  it("returns green dot for ok=true", () => {
    const dot = statusDot(true);
    assert.ok(dot.includes("\x1b[32m"));
    assert.ok(stripAnsi(dot).includes("\u25CF")); // Unicode filled circle
  });

  it("returns red dot for ok=false", () => {
    const dot = statusDot(false);
    assert.ok(dot.includes("\x1b[31m"));
  });
});

describe("formatTable", () => {
  it("formats headers and rows", () => {
    const table = formatTable(
      ["Name", "Status"],
      [
        ["alpha", "ok"],
        ["beta", "fail"],
      ],
    );
    assert.equal(typeof table, "string");
    const lines = table.split("\n");
    assert.equal(lines.length, 4); // header + separator + 2 rows
    assert.ok(stripAnsi(lines[0]).includes("Name"));
    assert.ok(stripAnsi(lines[0]).includes("Status"));
    assert.ok(lines[2].includes("alpha"));
    assert.ok(lines[3].includes("beta"));
  });
});

describe("drawBox", () => {
  it("draws a box with title and content", () => {
    const box = drawBox("Title", ["line1", "line2"]);
    assert.equal(typeof box, "string");
    const lines = box.split("\n");
    // Top border, title, separator, 2 content lines, bottom border = 6
    assert.equal(lines.length, 6);
    assert.ok(lines[0].startsWith("\u2554")); // top-left corner
    assert.ok(lines[lines.length - 1].startsWith("\u255A")); // bottom-left corner
    assert.ok(box.includes("Title"));
    assert.ok(box.includes("line1"));
    assert.ok(box.includes("line2"));
  });
});

describe("stripAnsi", () => {
  it("removes ANSI escape codes", () => {
    const colored = "\x1b[32mhello\x1b[0m \x1b[1mworld\x1b[0m";
    const plain = stripAnsi(colored);
    assert.equal(plain, "hello world");
  });

  it("returns plain text unchanged", () => {
    assert.equal(stripAnsi("plain"), "plain");
  });
});
