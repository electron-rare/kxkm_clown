#!/usr/bin/env node
// Health check script — checks V1 server, V2 API, Ollama, disk, Node.js
// Usage: node ops/v2/health-check.js [--json] [--watch] [--help]

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// ANSI helpers (inline — no external deps)
// ---------------------------------------------------------------------------

const NO_COLOR = !!process.env.NO_COLOR;
const c = {
  green:   (s) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  red:     (s) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  yellow:  (s) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
  cyan:    (s) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`,
  bold:    (s) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  dim:     (s) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`,
};

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
${c.bold("KXKM Health Check")}

Usage: node ops/v2/health-check.js [options]

Options:
  --json    Output results as JSON
  --watch   Refresh every 5 seconds
  --help    Show this help message
`);
  process.exit(0);
}

const FLAG_JSON = args.includes("--json");
const FLAG_WATCH = args.includes("--watch");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT_DIR = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT_DIR, "data");

const TARGETS = [
  { name: "V1 Server", url: "http://localhost:3333/", label: ":3333" },
  { name: "V2 API", url: "http://localhost:4180/api/v2/health", label: ":4180" },
  { name: "Ollama", url: "http://localhost:11434/api/tags", label: ":11434" },
];

// ---------------------------------------------------------------------------
// Probe a HTTP endpoint — returns { ok, ms, error? }
// ---------------------------------------------------------------------------

async function probe(url, timeoutMs = 5000) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const ms = Date.now() - start;
    return { ok: res.ok, status: res.status, ms };
  } catch (err) {
    const ms = Date.now() - start;
    return { ok: false, ms, error: err.code || err.message || "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Disk usage of a directory (recursive)
// ---------------------------------------------------------------------------

function diskUsage(dir) {
  let totalBytes = 0;
  let fileCount = 0;

  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        try {
          totalBytes += fs.statSync(full).size;
          fileCount++;
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  walk(dir);
  return { totalBytes, fileCount };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Count graphs in data/node-engine/graphs/
// ---------------------------------------------------------------------------

function countGraphs() {
  const graphsDir = path.join(DATA_DIR, "node-engine", "graphs");
  try {
    return fs.readdirSync(graphsDir).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Draw box
// ---------------------------------------------------------------------------

function drawBox(title, lines, width) {
  const inner = width - 2;

  function padLine(text) {
    const vis = stripAnsi(text).length;
    return "\u2551 " + text + " ".repeat(Math.max(0, inner - vis - 1)) + "\u2551";
  }

  const titleVis = stripAnsi(title).length;
  const totalPad = inner - titleVis;
  const left = Math.floor(totalPad / 2);
  const right = totalPad - left;
  const titleLine = "\u2551" + " ".repeat(left) + title + " ".repeat(right) + "\u2551";

  return [
    "\u2554" + "\u2550".repeat(inner) + "\u2557",
    titleLine,
    "\u2560" + "\u2550".repeat(inner) + "\u2563",
    ...lines.map(padLine),
    "\u255A" + "\u2550".repeat(inner) + "\u255D",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Run one health check cycle
// ---------------------------------------------------------------------------

async function runCheck() {
  const results = [];

  // Probe endpoints in parallel
  const probes = await Promise.all(TARGETS.map((t) => probe(t.url)));

  for (let i = 0; i < TARGETS.length; i++) {
    const t = TARGETS[i];
    const p = probes[i];
    results.push({
      name: t.name,
      label: t.label,
      ok: p.ok,
      ms: p.ms,
      error: p.error || null,
    });
  }

  // Disk usage
  const disk = diskUsage(DATA_DIR);
  const graphs = countGraphs();

  // Node.js info
  const mem = process.memoryUsage();

  return {
    timestamp: new Date().toISOString(),
    services: results,
    disk: {
      path: "data/",
      bytes: disk.totalBytes,
      formatted: formatBytes(disk.totalBytes),
      files: disk.fileCount,
      graphs,
    },
    node: {
      version: process.version,
      rss: mem.rss,
      rssFormatted: formatBytes(mem.rss),
    },
  };
}

// ---------------------------------------------------------------------------
// Render TUI output
// ---------------------------------------------------------------------------

function renderTui(data) {
  const WIDTH = 45;
  const lines = [];

  for (const svc of data.services) {
    const dot = svc.ok ? c.green("\u25CF UP  ") : c.red("\u25CF DOWN");
    const ms = c.dim(`${String(svc.ms).padStart(4)}ms`);
    lines.push(`${svc.name.padEnd(14)}${dot}  ${svc.label.padEnd(8)}${ms}`);
  }

  const diskLine = `${"Disk (data/)".padEnd(14)}${c.cyan(data.disk.formatted.padEnd(8))}${data.disk.files} files  ${data.disk.graphs} graphs`;
  lines.push(diskLine);

  const nodeLine = `${"Node.js".padEnd(14)}${c.cyan(data.node.version.padEnd(8))}RSS ${data.node.rssFormatted}`;
  lines.push(nodeLine);

  return drawBox(c.bold("KXKM Health Check"), lines, WIDTH);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (FLAG_WATCH) {
    while (true) {
      process.stdout.write("\x1b[2J\x1b[H");
      const data = await runCheck();
      if (FLAG_JSON) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(renderTui(data));
        console.log(c.dim(`  Last check: ${data.timestamp}  (Ctrl+C to exit)`));
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  } else {
    const data = await runCheck();
    if (FLAG_JSON) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(renderTui(data));
    }
  }
}

main().catch((err) => {
  console.error(`[health-check] ${err.message}`);
  process.exit(1);
});
