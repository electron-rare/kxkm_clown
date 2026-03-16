#!/usr/bin/env node

/**
 * KXKM_Clown V2 — End-to-End Test
 * Tests all features against a running API server.
 * Usage: node scripts/test-e2e.js [--url http://localhost:4180]
 */

const http = require("http");
const WebSocket = require("ws");

const API_URL = process.argv.includes("--url")
  ? process.argv[process.argv.indexOf("--url") + 1]
  : "http://localhost:4180";
const WS_URL = API_URL.replace("http", "ws") + "/ws";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  PASS  " + name);
  } catch (err) {
    failed++;
    console.log("  FAIL  " + name + " — " + (err.message || String(err)));
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "assertion failed");
}

async function main() {
  console.log("[e2e] Testing against " + API_URL + "\n");

  // 1. Health check
  await test("API health", async () => {
    const res = await fetch(API_URL + "/api/v2/health");
    const data = await res.json();
    assert(data.ok === true, "expected ok=true, got " + JSON.stringify(data));
  });

  // 2. Frontend served
  await test("Frontend HTML", async () => {
    const res = await fetch(API_URL);
    const html = await res.text();
    assert(html.includes("<!DOCTYPE html>") || html.includes("<!doctype html>"), "no DOCTYPE in response");
  });

  // 3. WebSocket connect
  await test("WebSocket connect", () => new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on("open", () => { ws.close(); resolve(); });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("timeout")), 5000);
  }));

  // 4. WebSocket chat flow
  await test("WebSocket chat message + persona response", () => new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let gotPersona = false;
    let gotResponse = false;
    ws.on("open", () => {
      setTimeout(() => ws.send(JSON.stringify({ type: "message", text: "test e2e" })), 500);
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data);
      if (msg.type === "persona") gotPersona = true;
      if (msg.type === "message" && msg.nick && msg.nick !== "user_") gotResponse = true;
      if (gotPersona && gotResponse) { ws.close(); resolve(); }
    });
    ws.on("error", reject);
    setTimeout(() => { ws.close(); gotPersona ? resolve() : reject(new Error("no persona response")); }, 30000);
  }));

  // 5. Chat history API
  await test("Chat history endpoint", async () => {
    const res = await fetch(API_URL + "/api/v2/chat/history");
    // May return 401 without session — that's OK
    assert(res.status === 200 || res.status === 401, "unexpected status " + res.status);
  });

  // 6. DPO export
  await test("DPO export endpoint", async () => {
    const res = await fetch(API_URL + "/api/v2/export/dpo");
    assert(res.status === 200 || res.status === 401, "unexpected status " + res.status);
  });

  // Summary
  console.log("\n[e2e] Results: " + passed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[e2e] Fatal:", err);
  process.exit(1);
});
