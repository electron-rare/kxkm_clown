#!/usr/bin/env node
// Performance monitor TUI — polls /api/v2/perf and /api/v2/health
// Usage: node ops/v2/perf-monitor.js [--watch] [--json] [--url http://localhost:3333]

const NO_COLOR = !!process.env.NO_COLOR;
const c = {
  green:   (s) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  red:     (s) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  yellow:  (s) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
  cyan:    (s) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`,
  magenta: (s) => NO_COLOR ? s : `\x1b[35m${s}\x1b[0m`,
  bold:    (s) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  dim:     (s) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`,
};

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
${c.bold("KXKM Perf Monitor")}

Usage: node ops/v2/perf-monitor.js [options]

Options:
  --url <url>  API base URL (default: http://localhost:3333)
  --watch      Refresh every 5 seconds
  --json       Output raw JSON
  --help       Show this help
`);
  process.exit(0);
}

const FLAG_JSON = args.includes("--json");
const FLAG_WATCH = args.includes("--watch");
const BASE_URL = args.includes("--url")
  ? args[args.indexOf("--url") + 1]
  : "http://localhost:3333";

async function fetchJson(endpoint) {
  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function bar(value, max, width = 20) {
  const filled = Math.round((value / max) * width);
  const empty = width - filled;
  const color = value / max > 0.8 ? c.red : value / max > 0.5 ? c.yellow : c.green;
  return color("█".repeat(filled)) + c.dim("░".repeat(empty));
}

async function run() {
  const perf = await fetchJson("/api/v2/perf");
  const health = await fetchJson("/api/v2/health");

  if (FLAG_JSON) {
    console.log(JSON.stringify({ perf: perf?.data, health: health?.data }, null, 2));
    return;
  }

  if (!FLAG_WATCH) console.clear();
  console.log(c.bold(c.magenta("\n  ╔══════════════════════════════════╗")));
  console.log(c.bold(c.magenta("  ║   KXKM Perf Monitor — 3615      ║")));
  console.log(c.bold(c.magenta("  ╚══════════════════════════════════╝\n")));

  if (!perf) {
    console.log(c.red(`  ● API unreachable at ${BASE_URL}`));
    return;
  }

  const d = perf.data;
  const mem = d.memory;

  console.log(`  ${c.bold("Uptime")}:     ${c.cyan(d.uptime_human)}`);
  console.log(`  ${c.bold("Requests")}:   ${c.cyan(String(d.requests))}`);
  console.log(`  ${c.bold("Avg Latency")}: ${d.avg_latency_ms < 50 ? c.green(d.avg_latency_ms + "ms") : d.avg_latency_ms < 200 ? c.yellow(d.avg_latency_ms + "ms") : c.red(d.avg_latency_ms + "ms")}`);
  console.log(`  ${c.bold("Max Latency")}: ${d.max_latency_ms < 200 ? c.green(d.max_latency_ms + "ms") : c.yellow(d.max_latency_ms + "ms")}`);

  console.log("");
  console.log(`  ${c.bold("Memory")}:`);
  console.log(`    RSS:     ${bar(mem.rss_mb, 512)} ${mem.rss_mb} MB`);
  console.log(`    Heap:    ${bar(mem.heap_used_mb, mem.heap_total_mb)} ${mem.heap_used_mb}/${mem.heap_total_mb} MB`);
  console.log(`    External: ${mem.external_mb} MB`);

  if (d.status_codes && Object.keys(d.status_codes).length > 0) {
    console.log("");
    console.log(`  ${c.bold("Status Codes")}:`);
    for (const [code, count] of Object.entries(d.status_codes).sort()) {
      const color = code.startsWith("2") ? c.green : code.startsWith("4") ? c.yellow : c.red;
      console.log(`    ${color(code)}: ${count}`);
    }
  }

  if (health?.data) {
    console.log("");
    console.log(`  ${c.bold("Health")}: ${health.data.status === "ok" ? c.green("● OK") : c.red("● DEGRADED")}`);
  }

  console.log(c.dim(`\n  ${new Date().toISOString()} — ${BASE_URL}`));
}

if (FLAG_WATCH) {
  run();
  setInterval(run, 5000);
} else {
  run().catch(err => {
    console.error(c.red(`Fatal: ${err.message}`));
    process.exit(1);
  });
}
