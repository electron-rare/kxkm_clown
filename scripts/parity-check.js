#!/usr/bin/env node
// Compares V1 and V2 API responses to validate feature parity
// Usage: node scripts/parity-check.js [--v1-port 3333] [--v2-port 4180] [--help]
//
// Checks:
// - Persona list matches (count, names, models)
// - Node engine graphs match
// - Channel list comparable
// - API response shapes compatible
// Output: TUI report with pass/fail indicators

const http = require("http");

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const NO_COLOR = !!process.env.NO_COLOR;
const c = {
  green:  (s) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  red:    (s) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`,
};

const PASS = c.green("PASS");
const FAIL = c.red("FAIL");
const WARN = c.yellow("WARN");
const SKIP = c.dim("SKIP");

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
${c.bold("KXKM Parity Check — V1 vs V2")}

Usage: node scripts/parity-check.js [options]

Options:
  --v1-port PORT   V1 server port (default: 3333)
  --v2-port PORT   V2 server port (default: 4180)
  --json           Output results as JSON
  --help           Show this help message

Both servers must be running for the check to work.
`);
  process.exit(0);
}

function getArgValue(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

const V1_PORT = Number(getArgValue("--v1-port", "3333"));
const V2_PORT = Number(getArgValue("--v2-port", "4180"));
const FLAG_JSON = args.includes("--json");

const V1_BASE = `http://localhost:${V1_PORT}`;
const V2_BASE = `http://localhost:${V2_PORT}`;

// ---------------------------------------------------------------------------
// HTTP fetch helper (no external deps)
// ---------------------------------------------------------------------------

function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body), raw: body });
        } catch {
          resolve({ status: res.statusCode, body: null, raw: body });
        }
      });
    });
    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function safeFetch(url) {
  try {
    return await httpGet(url);
  } catch (err) {
    return { status: 0, body: null, raw: "", error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Check definitions
// ---------------------------------------------------------------------------

const checks = [];

function check(name, fn) {
  checks.push({ name, fn });
}

// Connectivity checks
check("V1 server reachable", async () => {
  const res = await safeFetch(`${V1_BASE}/`);
  if (res.error || res.status === 0) {
    return { status: "fail", detail: `Cannot reach V1 at ${V1_BASE}: ${res.error || "no response"}` };
  }
  return { status: "pass", detail: `V1 responded with status ${res.status}` };
});

check("V2 server reachable", async () => {
  const res = await safeFetch(`${V2_BASE}/api/v2/health`);
  if (res.error || res.status === 0) {
    return { status: "fail", detail: `Cannot reach V2 at ${V2_BASE}: ${res.error || "no response"}` };
  }
  return { status: "pass", detail: `V2 responded with status ${res.status}` };
});

// Persona parity
check("Persona count parity", async () => {
  const v1 = await safeFetch(`${V1_BASE}/admin/api/personas`);
  const v2 = await safeFetch(`${V2_BASE}/api/v2/personas`);

  if (v1.error || !v1.body) return { status: "skip", detail: `V1 personas unavailable: ${v1.error || "no body"}` };
  if (v2.error || !v2.body) return { status: "skip", detail: `V2 personas unavailable: ${v2.error || "no body"}` };

  const v1List = Array.isArray(v1.body) ? v1.body : (v1.body.personas || []);
  const v2List = Array.isArray(v2.body) ? v2.body : (v2.body.personas || []);

  if (v1List.length === v2List.length) {
    return { status: "pass", detail: `Both have ${v1List.length} personas` };
  }

  return {
    status: v2List.length >= v1List.length ? "warn" : "fail",
    detail: `V1=${v1List.length} vs V2=${v2List.length}`,
  };
});

check("Persona names match", async () => {
  const v1 = await safeFetch(`${V1_BASE}/admin/api/personas`);
  const v2 = await safeFetch(`${V2_BASE}/api/v2/personas`);

  if (v1.error || !v1.body) return { status: "skip", detail: "V1 unavailable" };
  if (v2.error || !v2.body) return { status: "skip", detail: "V2 unavailable" };

  const v1List = Array.isArray(v1.body) ? v1.body : (v1.body.personas || []);
  const v2List = Array.isArray(v2.body) ? v2.body : (v2.body.personas || []);

  const v1Names = new Set(v1List.map((p) => (p.name || p.id || "").toLowerCase()));
  const v2Names = new Set(v2List.map((p) => (p.name || p.id || "").toLowerCase()));

  const missingInV2 = [...v1Names].filter((n) => !v2Names.has(n));
  const extraInV2 = [...v2Names].filter((n) => !v1Names.has(n));

  if (missingInV2.length === 0 && extraInV2.length === 0) {
    return { status: "pass", detail: `All ${v1Names.size} names match` };
  }

  const parts = [];
  if (missingInV2.length) parts.push(`missing in V2: ${missingInV2.join(", ")}`);
  if (extraInV2.length) parts.push(`extra in V2: ${extraInV2.join(", ")}`);

  return { status: missingInV2.length > 0 ? "fail" : "warn", detail: parts.join("; ") };
});

check("Persona models match", async () => {
  const v1 = await safeFetch(`${V1_BASE}/admin/api/personas`);
  const v2 = await safeFetch(`${V2_BASE}/api/v2/personas`);

  if (v1.error || !v1.body) return { status: "skip", detail: "V1 unavailable" };
  if (v2.error || !v2.body) return { status: "skip", detail: "V2 unavailable" };

  const v1List = Array.isArray(v1.body) ? v1.body : (v1.body.personas || []);
  const v2List = Array.isArray(v2.body) ? v2.body : (v2.body.personas || []);

  const v1ById = {};
  for (const p of v1List) v1ById[(p.id || "").toLowerCase()] = p;

  const mismatches = [];
  for (const p of v2List) {
    const id = (p.id || "").toLowerCase();
    const v1p = v1ById[id];
    if (!v1p) continue;
    if ((v1p.model || "") !== (p.model || "")) {
      mismatches.push(`${id}: V1=${v1p.model} vs V2=${p.model}`);
    }
  }

  if (mismatches.length === 0) {
    return { status: "pass", detail: "All models match" };
  }

  return { status: "fail", detail: mismatches.slice(0, 5).join("; ") };
});

// Node engine parity
check("Node graph count parity", async () => {
  const v1 = await safeFetch(`${V1_BASE}/admin/api/node-engine/graphs`);
  const v2 = await safeFetch(`${V2_BASE}/api/v2/node-engine/graphs`);

  if (v1.error || !v1.body) return { status: "skip", detail: `V1 graphs unavailable: ${v1.error || "no body"}` };
  if (v2.error || !v2.body) return { status: "skip", detail: `V2 graphs unavailable: ${v2.error || "no body"}` };

  const v1List = Array.isArray(v1.body) ? v1.body : (v1.body.graphs || []);
  const v2List = Array.isArray(v2.body) ? v2.body : (v2.body.graphs || []);

  if (v1List.length === v2List.length) {
    return { status: "pass", detail: `Both have ${v1List.length} graphs` };
  }

  return {
    status: v2List.length >= v1List.length ? "warn" : "fail",
    detail: `V1=${v1List.length} vs V2=${v2List.length}`,
  };
});

check("Node graph names match", async () => {
  const v1 = await safeFetch(`${V1_BASE}/admin/api/node-engine/graphs`);
  const v2 = await safeFetch(`${V2_BASE}/api/v2/node-engine/graphs`);

  if (v1.error || !v1.body) return { status: "skip", detail: "V1 unavailable" };
  if (v2.error || !v2.body) return { status: "skip", detail: "V2 unavailable" };

  const v1List = Array.isArray(v1.body) ? v1.body : (v1.body.graphs || []);
  const v2List = Array.isArray(v2.body) ? v2.body : (v2.body.graphs || []);

  const v1Names = new Set(v1List.map((g) => g.name || g.id));
  const v2Names = new Set(v2List.map((g) => g.name || g.id));

  const missing = [...v1Names].filter((n) => !v2Names.has(n));
  if (missing.length === 0) {
    return { status: "pass", detail: `All ${v1Names.size} graph names present in V2` };
  }

  return { status: "fail", detail: `Missing in V2: ${missing.slice(0, 5).join(", ")}` };
});

// Channel parity
check("Channel list comparable", async () => {
  const v1 = await safeFetch(`${V1_BASE}/admin/api/channels`);
  const v2 = await safeFetch(`${V2_BASE}/api/v2/channels`);

  if (v1.error || !v1.body) return { status: "skip", detail: `V1 channels unavailable: ${v1.error || "no body"}` };
  if (v2.error || !v2.body) return { status: "skip", detail: `V2 channels unavailable: ${v2.error || "no body"}` };

  const v1List = Array.isArray(v1.body) ? v1.body : (v1.body.channels || []);
  const v2List = Array.isArray(v2.body) ? v2.body : (v2.body.channels || []);

  return {
    status: v2List.length >= v1List.length ? "pass" : "warn",
    detail: `V1=${v1List.length} channels, V2=${v2List.length} channels`,
  };
});

// API shape checks
check("V1 API response shape (/admin/api/personas)", async () => {
  const res = await safeFetch(`${V1_BASE}/admin/api/personas`);
  if (res.error || !res.body) return { status: "skip", detail: "V1 unreachable" };

  const body = res.body;
  const hasList = Array.isArray(body) || Array.isArray(body.personas);

  if (hasList) {
    const list = Array.isArray(body) ? body : body.personas;
    const sample = list[0];
    if (sample && sample.id && sample.name && sample.model) {
      return { status: "pass", detail: "Response has expected fields (id, name, model)" };
    }
    return { status: "warn", detail: "List present but items may lack expected fields" };
  }

  return { status: "fail", detail: "Unexpected response shape" };
});

check("V2 API response shape (/api/v2/personas)", async () => {
  const res = await safeFetch(`${V2_BASE}/api/v2/personas`);
  if (res.error || !res.body) return { status: "skip", detail: "V2 unreachable" };

  const body = res.body;
  const hasList = Array.isArray(body) || Array.isArray(body.personas);

  if (hasList) {
    const list = Array.isArray(body) ? body : body.personas;
    const sample = list[0];
    if (sample && sample.id && sample.name && sample.model) {
      return { status: "pass", detail: "Response has expected fields (id, name, model)" };
    }
    return { status: "warn", detail: "List present but items may lack expected fields" };
  }

  return { status: "fail", detail: "Unexpected response shape" };
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runChecks() {
  console.log("");
  console.log(c.bold("KXKM Parity Check — V1 vs V2"));
  console.log(c.dim(`  V1: ${V1_BASE}`));
  console.log(c.dim(`  V2: ${V2_BASE}`));
  console.log(c.dim("  " + "─".repeat(60)));
  console.log("");

  const results = [];
  let passed = 0;
  let failed = 0;
  let warned = 0;
  let skipped = 0;

  for (const { name, fn } of checks) {
    try {
      const result = await fn();
      results.push({ name, ...result });

      let icon;
      switch (result.status) {
        case "pass": icon = PASS; passed++; break;
        case "fail": icon = FAIL; failed++; break;
        case "warn": icon = WARN; warned++; break;
        default:     icon = SKIP; skipped++; break;
      }

      const paddedName = name.padEnd(40);
      console.log(`  ${icon}  ${paddedName}  ${c.dim(result.detail || "")}`);
    } catch (err) {
      results.push({ name, status: "fail", detail: err.message });
      const paddedName = name.padEnd(40);
      console.log(`  ${FAIL}  ${paddedName}  ${c.dim(err.message)}`);
      failed++;
    }
  }

  console.log("");
  console.log(c.dim("  " + "─".repeat(60)));

  const summary = [
    c.green(`${passed} passed`),
    failed > 0 ? c.red(`${failed} failed`) : c.dim("0 failed"),
    warned > 0 ? c.yellow(`${warned} warnings`) : c.dim("0 warnings"),
    skipped > 0 ? c.dim(`${skipped} skipped`) : "",
  ].filter(Boolean).join("  ");

  console.log(`  ${c.bold("Summary:")} ${summary}`);
  console.log("");

  if (FLAG_JSON) {
    console.log(JSON.stringify({ results, summary: { passed, failed, warned, skipped } }, null, 2));
  }

  process.exit(failed > 0 ? 1 : 0);
}

runChecks().catch((err) => {
  console.error(c.red(`\n  [fatal] ${err.message}`));
  process.exit(1);
});
