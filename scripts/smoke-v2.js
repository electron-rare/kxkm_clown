#!/usr/bin/env node
// V2 API smoke tests — validates all endpoints without requiring Postgres
// Usage: node scripts/smoke-v2.js [--port 4180] [--verbose]
//
// The V2 API must be running. Tests hit real endpoints.
// Exit code 0 = all pass, 1 = failures

const ARGS = process.argv.slice(2);
const portIdx = ARGS.indexOf("--port");
const port = portIdx !== -1 ? Number(ARGS[portIdx + 1]) : 4180;
const verbose = ARGS.includes("--verbose");

const BASE = `http://127.0.0.1:${port}`;

// ANSI helpers
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";

const results = [];
let sessionCookie = null;

// ── Helpers ──────────────────────────────────────────────────────────

async function api(method, path, opts = {}) {
  const url = `${BASE}${path}`;
  const headers = { ...(opts.headers || {}) };

  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (sessionCookie) {
    headers["Cookie"] = sessionCookie;
  }

  const t0 = Date.now();
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
  const elapsed = Date.now() - t0;
  const body = await res.json().catch(() => null);

  // Extract Set-Cookie for session management
  const setCookie = res.headers.get("set-cookie");

  return { status: res.status, body, elapsed, setCookie };
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function test(category, name, fn) {
  const label = `${category} > ${name}`;
  try {
    await fn();
    results.push({ label, pass: true });
    const tag = `${GREEN}PASS${RESET}`;
    process.stdout.write(`  ${tag}  ${label}\n`);
  } catch (err) {
    results.push({ label, pass: false, error: err.message });
    const tag = `${RED}FAIL${RESET}`;
    process.stdout.write(`  ${tag}  ${label}  ${DIM}${err.message}${RESET}\n`);
  }
}

function logTiming(elapsed) {
  if (verbose) {
    process.stdout.write(`        ${DIM}(${elapsed}ms)${RESET}\n`);
  }
}

// ── Tests ────────────────────────────────────────────────────────────

async function runAll() {
  console.log(`\n${BOLD}${CYAN}V2 API Smoke Tests${RESET}  ${DIM}${BASE}${RESET}\n`);

  // State shared between tests
  let firstPersonaId = null;
  let createdGraphId = null;
  let createdRunId = null;

  // ── 1. Health ────────────────────────────────────────────────────

  await test("Health", "GET /api/v2/health -> 200, ok:true", async () => {
    const r = await api("GET", "/api/v2/health");
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true in response");
    assert(r.body.data, "expected data envelope");
  });

  // ── 2. Session lifecycle ─────────────────────────────────────────

  await test("Session", "POST /api/session/login -> 200, sets cookie", async () => {
    const r = await api("POST", "/api/session/login", {
      body: { username: "smoke_test", role: "admin" },
    });
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(r.body.data, "expected data envelope");
    assert(r.setCookie, "expected Set-Cookie header");
    // Store the cookie for subsequent requests
    sessionCookie = r.setCookie.split(";")[0];
  });

  await test("Session", "GET /api/session -> 200, has username", async () => {
    const r = await api("GET", "/api/session");
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(r.body.data && r.body.data.username === "smoke_test", "expected username smoke_test");
  });

  await test("Session", "POST /api/session/logout -> 200", async () => {
    const savedCookie = sessionCookie;
    const r = await api("POST", "/api/session/logout");
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    // Keep the old cookie to test that session is invalidated
    sessionCookie = savedCookie;
  });

  await test("Session", "GET /api/session after logout -> 401", async () => {
    const r = await api("GET", "/api/session");
    logTiming(r.elapsed);
    assert(r.status === 401, `expected 401, got ${r.status}`);
    // Clear cookie so we can login fresh
    sessionCookie = null;
  });

  // Re-login for subsequent tests
  await test("Session", "Re-login for remaining tests -> 200", async () => {
    const r = await api("POST", "/api/session/login", {
      body: { username: "smoke_test", role: "admin" },
    });
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.setCookie, "expected Set-Cookie header");
    sessionCookie = r.setCookie.split(";")[0];
  });

  // ── 3. Personas ──────────────────────────────────────────────────

  await test("Personas", "GET /api/personas -> 200, array >= 5", async () => {
    const r = await api("GET", "/api/personas");
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(Array.isArray(r.body.data), "expected data to be array");
    assert(r.body.data.length >= 5, `expected >= 5 personas, got ${r.body.data.length}`);
    firstPersonaId = r.body.data[0].id;
  });

  await test("Personas", "GET /api/personas/:id -> 200, has name/model", async () => {
    assert(firstPersonaId, "no persona id from previous test");
    const r = await api("GET", `/api/personas/${firstPersonaId}`);
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(r.body.data.name, "expected name");
    assert(r.body.data.model, "expected model");
  });

  await test("Personas", "PUT /api/admin/personas/:id -> 200", async () => {
    assert(firstPersonaId, "no persona id from previous test");
    const r = await api("PUT", `/api/admin/personas/${firstPersonaId}`, {
      body: { summary: "smoke test" },
    });
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
  });

  await test("Personas", "GET /api/admin/personas/:id/feedback -> 200, array", async () => {
    assert(firstPersonaId, "no persona id from previous test");
    const r = await api("GET", `/api/admin/personas/${firstPersonaId}/feedback`);
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(Array.isArray(r.body.data), "expected data to be array");
  });

  await test("Personas", "GET /api/admin/personas/:id/proposals -> 200, array", async () => {
    assert(firstPersonaId, "no persona id from previous test");
    const r = await api("GET", `/api/admin/personas/${firstPersonaId}/proposals`);
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(Array.isArray(r.body.data), "expected data to be array");
  });

  // ── 4. Node Engine ───────────────────────────────────────────────

  await test("Node Engine", "GET /api/admin/node-engine/overview -> 200, has queue", async () => {
    const r = await api("GET", "/api/admin/node-engine/overview");
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(r.body.data, "expected data envelope");
  });

  await test("Node Engine", "GET /api/admin/node-engine/graphs -> 200, array", async () => {
    const r = await api("GET", "/api/admin/node-engine/graphs");
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(Array.isArray(r.body.data), "expected data to be array");
  });

  await test("Node Engine", "POST /api/admin/node-engine/graphs -> 201, creates graph", async () => {
    const r = await api("POST", "/api/admin/node-engine/graphs", {
      body: { name: "smoke-test", description: "test" },
    });
    logTiming(r.elapsed);
    assert(r.status === 201, `expected 201, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(r.body.data && r.body.data.id, "expected graph id");
    createdGraphId = r.body.data.id;
  });

  await test("Node Engine", "PUT /api/admin/node-engine/graphs/:id -> 200, updates", async () => {
    assert(createdGraphId, "no graph id from previous test");
    const r = await api("PUT", `/api/admin/node-engine/graphs/${createdGraphId}`, {
      body: { description: "updated" },
    });
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
  });

  await test("Node Engine", "POST /api/admin/node-engine/graphs/:id/run -> 201, has id", async () => {
    assert(createdGraphId, "no graph id from previous test");
    const r = await api("POST", `/api/admin/node-engine/graphs/${createdGraphId}/run`, {
      body: { hold: true },
    });
    logTiming(r.elapsed);
    assert(r.status === 201, `expected 201, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(r.body.data && r.body.data.id, "expected run id");
    createdRunId = r.body.data.id;
  });

  await test("Node Engine", "GET /api/admin/node-engine/runs/:id -> 200, has status", async () => {
    assert(createdRunId, "no run id from previous test");
    const r = await api("GET", `/api/admin/node-engine/runs/${createdRunId}`);
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(r.body.data && r.body.data.status, "expected status field");
  });

  await test("Node Engine", "POST /api/admin/node-engine/runs/:id/cancel -> 200", async () => {
    assert(createdRunId, "no run id from previous test");
    const r = await api("POST", `/api/admin/node-engine/runs/${createdRunId}/cancel`);
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
  });

  await test("Node Engine", "GET /api/admin/node-engine/models -> 200, array", async () => {
    const r = await api("GET", "/api/admin/node-engine/models");
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(Array.isArray(r.body.data), "expected data to be array");
  });

  // ── 5. Chat ──────────────────────────────────────────────────────

  await test("Chat", "GET /api/chat/channels -> 200, array >= 2", async () => {
    const r = await api("GET", "/api/chat/channels");
    logTiming(r.elapsed);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body && r.body.ok === true, "expected ok:true");
    assert(Array.isArray(r.body.data), "expected data to be array");
    assert(r.body.data.length >= 2, `expected >= 2 channels, got ${r.body.data.length}`);
  });

  // ── Summary ──────────────────────────────────────────────────────

  console.log("");
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;

  if (failed === 0) {
    console.log(`${GREEN}${BOLD}${passed}/${total} passed${RESET}\n`);
  } else {
    console.log(`${RED}${BOLD}${passed}/${total} passed, ${failed} FAILED${RESET}`);
    console.log("");
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  ${RED}x${RESET} ${r.label}: ${r.error}`);
    }
    console.log("");
  }

  return failed === 0 ? 0 : 1;
}

// ── Entry point ────────────────────────────────────────────────────

(async () => {
  try {
    const code = await runAll();
    process.exit(code);
  } catch (err) {
    if (err.cause && err.cause.code === "ECONNREFUSED") {
      console.error(`${RED}Connection refused${RESET} — is the V2 API running on port ${port}?`);
      console.error(`${DIM}Start with: npm run dev:v2:api${RESET}\n`);
    } else {
      console.error(`${RED}Unexpected error:${RESET} ${err.message}`);
      if (verbose) console.error(err);
    }
    process.exit(1);
  }
})();
