#!/usr/bin/env node
// Persona overview TUI — lists personas with status, model, feedback counts
// Usage: node ops/v2/persona-manager.js [--json] [--port N] [--help]

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
${c.bold("KXKM Persona Manager")}

Usage: node ops/v2/persona-manager.js [options]

Options:
  --json    Output raw JSON
  --port N  V1 server port (default 3333)
  --help    Show this help message

Displays all personas with their model, enabled status, and color.
Requires the V1 server to be running on localhost.
`);
  process.exit(0);
}

const FLAG_JSON = args.includes("--json");
const PORT = (() => {
  const idx = args.indexOf("--port");
  return idx >= 0 && args[idx + 1] ? Number(args[idx + 1]) : 3333;
})();

const BASE_URL = `http://localhost:${PORT}`;

// ---------------------------------------------------------------------------
// Fetch
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
// Render
// ---------------------------------------------------------------------------

function renderPersonas(personas) {
  if (!personas || !personas.length) {
    return c.dim("  No personas found.");
  }

  const headers = ["Name", "Model", "Status", "Color", "Feedback"];
  const rows = personas.map((p) => {
    const enabled = p.enabled !== false;
    const status = enabled ? c.green("enabled") : c.red("disabled");
    const color = p.color || c.dim("--");
    const feedbackCount = p.feedbackCount != null
      ? String(p.feedbackCount)
      : c.dim("--");
    return [
      p.name || p.id || "?",
      (p.model || c.dim("default")).slice(0, 25),
      status,
      color,
      feedbackCount,
    ];
  });

  return formatTable(headers, rows);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const res = await fetchJson("/api/personas");

  if (FLAG_JSON) {
    console.log(JSON.stringify(res.data || { error: res.error }, null, 2));
    if (res.error) process.exit(1);
    return;
  }

  console.log(c.bold("=== KXKM Personas ==="));
  console.log("");

  if (res.error) {
    console.log(c.red(`Error fetching personas: ${res.error}`));
    console.log(c.dim(`  Tried: ${BASE_URL}/api/personas`));
    process.exit(1);
  }

  const personas = Array.isArray(res.data) ? res.data : [];
  console.log(renderPersonas(personas));
  console.log("");

  const enabled = personas.filter((p) => p.enabled !== false).length;
  const disabled = personas.length - enabled;
  console.log(c.dim(`  Total: ${personas.length}  Enabled: ${enabled}  Disabled: ${disabled}`));
}

main().catch((err) => {
  console.error(`[persona-manager] ${err.message}`);
  process.exit(1);
});
