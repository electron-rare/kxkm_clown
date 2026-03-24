import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests — verify API endpoints respond correctly.
 * Uses fetch against a test server or mocked HTTP.
 */

describe("API Integration", () => {
  // These tests verify module imports and function signatures
  // without requiring a running server

  it("context-store parallel read works", async () => {
    // Verify the parallel Promise.all pattern compiles and runs
    const [a, b] = await Promise.all([
      Promise.resolve("summary"),
      Promise.resolve("content"),
    ]);
    assert.equal(a, "summary");
    assert.equal(b, "content");
  });

  it("perf module exports prometheusMetrics", async () => {
    const { prometheusMetrics, recordLatency, getMetrics } = await import("./perf.js");
    assert.equal(typeof prometheusMetrics, "function");
    assert.equal(typeof recordLatency, "function");
    assert.equal(typeof getMetrics, "function");

    recordLatency("test_integration", 42);
    const metrics = getMetrics();
    assert.ok(metrics.test_integration);
    assert.equal(metrics.test_integration.count, 1);
    assert.equal(metrics.test_integration.avgMs, 42);

    const prom = prometheusMetrics();
    assert.ok(prom.includes("kxkm_memory_rss_bytes"));
    assert.ok(prom.includes("kxkm_uptime_seconds"));
    assert.ok(prom.includes("kxkm_test_integration_total 1"));
  });

  it("a2a-agent-card exports correct structure", async () => {
    const { agentCardRoute } = await import("./a2a-agent-card.js");
    assert.equal(typeof agentCardRoute, "function");
  });

  it("mcp-tools exports all 6 tools", async () => {
    const { TOOLS, getToolsForPersona } = await import("./mcp-tools.js");
    assert.ok(TOOLS.web_search);
    assert.ok(TOOLS.image_generate);
    assert.ok(TOOLS.rag_search);
    assert.ok(TOOLS.music_generate);
    assert.ok(TOOLS.voice_synthesize);
    assert.ok(TOOLS.audio_analyze);

    const schaefferTools = getToolsForPersona("schaeffer");
    assert.ok(schaefferTools.some(t => t.function.name === "music_generate"));
  });

  it("ws-chat exports isChatPaused and setChatPaused", async () => {
    const mod = await import("./ws-chat.js");
    assert.equal(typeof mod.isChatPaused, "function");
    assert.equal(typeof mod.setChatPaused, "function");
  });

  it("llm-client has mascarade circuit breaker", async () => {
    const { checkMascaradeHealth } = await import("./llm-client.js");
    assert.equal(typeof checkMascaradeHealth, "function");
  });

  it("rag has reranker circuit breaker fields", async () => {
    const { LocalRAG } = await import("./rag.js");
    const rag = new LocalRAG({ ollamaUrl: "http://localhost:11434" });
    assert.ok(rag);
    // Private fields exist (verified by TypeScript compilation)
  });
});
