import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import http from "node:http";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Send a JSON-RPC request to the MCP server over stdin and read the response. */
function sendRpc(
  proc: ChildProcess,
  method: string,
  params: Record<string, unknown> = {},
  id = 1,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`RPC timeout for ${method}`)), 10_000);

    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      // MCP SDK sends JSON-RPC messages delimited by newlines
      const lines = buffer.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          // Match response by id (ignore notifications)
          if (parsed.id === id || parsed.method === undefined) {
            clearTimeout(timeout);
            proc.stdout?.removeListener("data", onData);
            resolve(parsed);
            return;
          }
        } catch {
          // partial line, continue buffering
        }
      }
    };

    proc.stdout?.on("data", onData);

    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    proc.stdin?.write(msg + "\n");
  });
}

// ---------------------------------------------------------------------------
// Fake API server — serves minimal persona/health/perf/search data
// ---------------------------------------------------------------------------

function createFakeApi(): http.Server {
  return http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/api/personas") {
      res.end(
        JSON.stringify({
          ok: true,
          data: [
            { name: "Schaeffer", model: "llama3", enabled: true, summary: "Musique concrète" },
            { name: "Batty", model: "mistral", enabled: true, summary: "Blade Runner" },
            { name: "Merzbow", model: "llama3", enabled: false, summary: "Noise" },
          ],
        }),
      );
      return;
    }

    if (req.url === "/api/v2/health") {
      res.end(JSON.stringify({ ok: true, data: { app: "@kxkm/api", uptime: 42 } }));
      return;
    }

    if (req.url === "/api/v2/perf") {
      res.end(JSON.stringify({ ok: true, data: { rss: 100, heapUsed: 50 } }));
      return;
    }

    if (req.url?.startsWith("/api/v2/chat/search")) {
      res.end(
        JSON.stringify({
          ok: true,
          data: [
            { title: "Result 1", url: "https://example.com/1", content: "test content" },
          ],
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP Server (JSON-RPC over stdio)", () => {
  let fakeApi: http.Server;
  let fakeApiPort: number;
  let mcpProc: ChildProcess;

  before(async () => {
    // Start fake API
    fakeApi = createFakeApi();
    await new Promise<void>((resolve) => fakeApi.listen(0, resolve));
    const addr = fakeApi.address();
    assert.ok(addr && typeof addr !== "string");
    fakeApiPort = addr.port;

    // Start MCP server
    const mcpScript = path.resolve(import.meta.dirname, "../../../scripts/mcp-server.js");
    mcpProc = spawn(process.execPath, [mcpScript], {
      env: {
        ...process.env,
        KXKM_API_URL: `http://127.0.0.1:${fakeApiPort}`,
        SEARXNG_URL: `http://127.0.0.1:${fakeApiPort}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Wait for server to be ready (it prints to stderr)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("MCP server startup timeout")), 5000);
      mcpProc.stderr?.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("started")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      mcpProc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      mcpProc.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`MCP server exited early with code ${code}`));
      });
    });

    // Initialize MCP session (required by the SDK)
    const initResp = await sendRpc(mcpProc, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    }, 0);
    assert.ok(initResp.result, "initialize should return a result");

    // Send initialized notification
    mcpProc.stdin?.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );

    // Small delay for notification processing
    await new Promise((r) => setTimeout(r, 200));
  });

  after(async () => {
    if (mcpProc && !mcpProc.killed) {
      mcpProc.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        mcpProc.on("exit", () => resolve());
        setTimeout(resolve, 2000);
      });
    }
    if (fakeApi) {
      await new Promise<void>((resolve) => fakeApi.close(() => resolve()));
    }
  });

  it("lists available tools via tools/list", async () => {
    const resp = await sendRpc(mcpProc, "tools/list", {}, 1);
    const result = resp.result as { tools: Array<{ name: string }> };
    assert.ok(Array.isArray(result.tools), "tools/list should return an array");

    const toolNames = result.tools.map((t) => t.name);
    assert.ok(toolNames.includes("kxkm_personas"), "should have kxkm_personas tool");
    assert.ok(toolNames.includes("kxkm_status"), "should have kxkm_status tool");
    assert.ok(toolNames.includes("kxkm_chat"), "should have kxkm_chat tool");
    assert.ok(toolNames.includes("kxkm_web_search"), "should have kxkm_web_search tool");
  });

  it("kxkm_personas returns persona list", async () => {
    const resp = await sendRpc(mcpProc, "tools/call", {
      name: "kxkm_personas",
      arguments: {},
    }, 2);

    const result = resp.result as { content: Array<{ type: string; text: string }> };
    assert.ok(result.content, "should have content");
    assert.equal(result.content[0].type, "text");
    const text = result.content[0].text;
    assert.ok(text.includes("Schaeffer"), "should list Schaeffer persona");
    assert.ok(text.includes("Batty"), "should list Batty persona");
    assert.ok(text.includes("Merzbow"), "should list Merzbow persona");
    assert.ok(text.includes("Personas KXKM (3)"), "should show persona count");
  });

  it("kxkm_status returns health data", async () => {
    const resp = await sendRpc(mcpProc, "tools/call", {
      name: "kxkm_status",
      arguments: {},
    }, 3);

    const result = resp.result as { content: Array<{ type: string; text: string }> };
    assert.ok(result.content, "should have content");
    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.health, "should have health data");
    assert.equal(parsed.health.app, "@kxkm/api");
    assert.ok(parsed.perf, "should have perf data");
    assert.equal(parsed.perf.rss, 100);
  });

  it("kxkm_web_search returns results", async () => {
    const resp = await sendRpc(mcpProc, "tools/call", {
      name: "kxkm_web_search",
      arguments: { query: "test query" },
    }, 4);

    const result = resp.result as { content: Array<{ type: string; text: string }> };
    assert.ok(result.content, "should have content");
    const text = result.content[0].text;
    // The search tool tries API first, which returns our fake data
    assert.ok(text.includes("Result 1") || text.includes("test content"), "should contain search results");
  });
});
