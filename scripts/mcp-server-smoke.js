#!/usr/bin/env node
/**
 * Smoke test for the local MCP stdio server.
 *
 * Accepts both newline-delimited SDK stdio messages and legacy Content-Length
 * framing so local protocol regressions stay visible while the server migrates.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const SERVER_PATH = path.resolve(__dirname, "mcp-server.js");
const TIMEOUT_MS = 5_000;
const API_URL = process.env.KXKM_API_URL || "http://localhost:3333";

function parseArgs(argv) {
  const options = {
    withToolCall: "auto",
  };

  for (const arg of argv) {
    if (arg === "--with-tool-call") {
      options.withToolCall = "always";
    } else if (arg === "--skip-tool-call") {
      options.withToolCall = "never";
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/mcp-server-smoke.js [options]",
          "",
          "Options:",
          "  --with-tool-call   Require a representative tools/call round-trip",
          "  --skip-tool-call   Validate only initialize + tools/list",
          "  --help             Show this help",
        ].join("\n") + "\n",
      );
      process.exit(0);
    }
  }

  return options;
}

async function isApiReachable() {
  try {
    const response = await fetch(`${API_URL}/api/v2/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function frameMessage(payload) {
  return `${JSON.stringify(payload)}\n`;
}

function parseFrames(buffer, onMessage) {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (match) {
        const contentLength = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + contentLength) break;

        const body = buffer.slice(bodyStart, bodyStart + contentLength);
        buffer = buffer.slice(bodyStart + contentLength);

        try {
          onMessage(JSON.parse(body));
        } catch (err) {
          throw new Error(`Failed to parse MCP frame: ${err.message}`);
        }
        continue;
      }
    }

    const lineEnd = buffer.indexOf("\n");
    if (lineEnd === -1) break;

    const line = buffer.slice(0, lineEnd).replace(/\r$/, "");
    buffer = buffer.slice(lineEnd + 1);
    if (!line.trim()) continue;

    try {
      onMessage(JSON.parse(line));
    } catch (err) {
      throw new Error(`Failed to parse MCP line: ${err.message}`);
    }
  }

  return buffer;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const child = spawn(process.execPath, [SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  const pending = new Map();
  let nextId = 1;
  let stdoutBuffer = "";
  let stderrBuffer = "";

  const cleanup = () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  };

  const onMessage = (message) => {
    if (message && typeof message.id !== "undefined" && pending.has(message.id)) {
      pending.get(message.id).resolve(message);
      pending.delete(message.id);
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    stdoutBuffer = parseFrames(stdoutBuffer, onMessage);
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      for (const entry of pending.values()) {
        entry.reject(new Error(`MCP server exited with code ${code}. stderr=${stderrBuffer.trim()}`));
      }
      pending.clear();
    }
  });

  function request(method, params) {
    const id = nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }, TIMEOUT_MS);

      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timeout);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      child.stdin.write(frameMessage(payload));
    });
  }

  try {
    const init = await request("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "kxkm-smoke", version: "1.0.0" },
      capabilities: {},
    });

    assert.equal(typeof init.result.protocolVersion, "string");
    assert.equal(init.result.serverInfo.name, "kxkm-clown");

    child.stdin.write(frameMessage({ jsonrpc: "2.0", method: "initialized", params: {} }));

    const toolsList = await request("tools/list", {});
    const toolNames = (toolsList.result.tools || []).map((tool) => tool.name);
    assert.deepEqual(
      toolNames.sort(),
      ["kxkm_chat", "kxkm_personas", "kxkm_status", "kxkm_web_search"].sort(),
    );

    const apiReachable = await isApiReachable();
    const shouldCallTool =
      options.withToolCall === "always" ||
      (options.withToolCall === "auto" && apiReachable);

    let toolCall = "skipped";
    if (shouldCallTool) {
      const statusCall = await request("tools/call", {
        name: "kxkm_status",
        arguments: {},
      });

      assert.ok(Array.isArray(statusCall.result.content));
      const statusText = String(statusCall.result.content[0]?.text || "");
      const statusJson = JSON.parse(statusText);
      assert.equal(typeof statusJson, "object");
      toolCall = "ok";
    } else if (options.withToolCall === "always") {
      throw new Error(`KXKM API not reachable at ${API_URL}; cannot require tools/call`);
    }

    console.log(JSON.stringify({
      ok: true,
      server: "scripts/mcp-server.js",
      tools: toolNames.length,
      toolCall,
      apiReachable,
    }));
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(`[mcp-smoke] ${err.message}`);
  process.exit(1);
});
