#!/usr/bin/env node
// Node Engine queue TUI — shows queue state, running jobs, recent runs
// Usage: node ops/v2/queue-viewer.js [--watch] [--json] [--help]

const path = require("path");

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const NO_COLOR = !!process.env.NO_COLOR;
const c = {
  green:   (s) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  red:     (s) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  yellow:  (s) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
  cyan:    (s) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`,
  bold:    (s) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  dim:     (s) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`,
  magenta: (s) => NO_COLOR ? s : `\x1b[35m${s}\x1b[0m`,
};

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
${c.bold("KXKM Node Engine Queue Viewer")}

Usage: node ops/v2/queue-viewer.js [options]

Options:
  --watch   Refresh every 5 seconds
  --json    Output raw JSON from API
  --port N  V1 server port (default 3333)
  --help    Show this help message

Requires the V1 server to be running with admin access on localhost.
`);
  process.exit(0);
}

const FLAG_JSON = args.includes("--json");
const FLAG_WATCH = args.includes("--watch");
const PORT = (() => {
  const idx = args.indexOf("--port");
  return idx >= 0 && args[idx + 1] ? Number(args[idx + 1]) : 3333;
})();

const BASE_URL = `http://localhost:${PORT}`;

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson(urlPath, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${urlPath}`, { signal: controller.signal });
    if (!res.ok) return { error: `HTTP ${res.status}`, data: null };
    return { error: null, data: await res.json() };
  } catch (err) {
    return { error: err.code || err.message || "connection failed", data: null };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Table formatter
// ---------------------------------------------------------------------------

function formatTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] || "").length))
  );

  function pad(text, width) {
    const vis = stripAnsi(text).length;
    return text + " ".repeat(Math.max(0, width - vis));
  }

  const headerLine = headers.map((h, i) => pad(h, widths[i])).join("  ");
  const sep = widths.map((w) => "\u2500".repeat(w)).join("\u2500\u2500");
  const body = rows.map((row) =>
    row.map((cell, i) => pad(cell || "", widths[i])).join("  ")
  ).join("\n");

  return [c.bold(headerLine), sep, body].join("\n");
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function statusBadge(status) {
  switch (status) {
    case "completed": return c.green("completed");
    case "running":   return c.yellow("running");
    case "queued":    return c.cyan("queued");
    case "failed":    return c.red("failed");
    case "cancelled": return c.dim("cancelled");
    default:          return status || "?";
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderOverview(overview) {
  const q = overview.queue || {};
  const r = overview.registry || {};
  const lines = [
    `Workers: ${c.cyan(`${q.activeWorkers || 0}/${q.desiredWorkers || 0}`)}  ` +
    `Queued: ${c.yellow(String(q.queuedRuns || 0))}  ` +
    `Running: ${c.green(String(q.runningRuns || 0))}`,
    `Graphs: ${c.cyan(String(r.graphs || 0))}  Models: ${c.cyan(String(r.models || 0))}`,
  ];
  return lines.join("\n");
}

function renderRuns(runs) {
  if (!runs || !runs.length) return c.dim("  No recent runs.");

  const headers = ["ID", "Graph", "Status", "Started", "Duration"];
  const rows = runs.slice(0, 20).map((run) => {
    const started = run.startedAt
      ? new Date(run.startedAt).toLocaleTimeString()
      : c.dim("--");
    const duration = run.durationMs != null
      ? `${(run.durationMs / 1000).toFixed(1)}s`
      : run.startedAt
        ? c.dim("running...")
        : c.dim("--");
    return [
      c.dim(String(run.id || "").slice(0, 8)),
      String(run.graphId || run.graph || "").slice(0, 20),
      statusBadge(run.status),
      started,
      duration,
    ];
  });

  return formatTable(headers, rows);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runCycle() {
  const [overviewRes, runsRes] = await Promise.all([
    fetchJson("/api/admin/node-engine/overview"),
    fetchJson("/api/admin/node-engine/runs"),
  ]);

  return { overview: overviewRes, runs: runsRes };
}

function renderAll(data) {
  const out = [];
  out.push(c.bold("=== KXKM Node Engine Queue ==="));
  out.push("");

  if (data.overview.error) {
    out.push(c.red(`Overview: ${data.overview.error}`));
  } else {
    out.push(renderOverview(data.overview.data));
  }

  out.push("");
  out.push(c.bold("Recent Runs:"));

  if (data.runs.error) {
    out.push(c.red(`  Runs: ${data.runs.error}`));
  } else {
    const runsList = Array.isArray(data.runs.data) ? data.runs.data : data.runs.data?.runs || [];
    out.push(renderRuns(runsList));
  }

  return out.join("\n");
}

async function main() {
  if (FLAG_WATCH) {
    while (true) {
      process.stdout.write("\x1b[2J\x1b[H");
      const data = await runCycle();
      if (FLAG_JSON) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(renderAll(data));
        console.log("");
        console.log(c.dim(`  Refreshed: ${new Date().toLocaleTimeString()}  (Ctrl+C to exit)`));
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  } else {
    const data = await runCycle();
    if (FLAG_JSON) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(renderAll(data));
    }
  }
}

main().catch((err) => {
  console.error(`[queue-viewer] ${err.message}`);
  process.exit(1);
});
