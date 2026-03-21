import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { attachWebSocketChat } from "./ws-chat.js";
import type { OutboundMessage } from "./chat-types.js";

const originalFetch = globalThis.fetch;
const CHAT_LOG_DIR = path.resolve(process.cwd(), "data/chat-logs");

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ws-chat smoke", () => {
  let server: http.Server | undefined;
  let wss: ReturnType<typeof attachWebSocketChat> | undefined;
  let client: WebSocket | undefined;

  afterEach(async () => {
    if (client && client.readyState === WebSocket.OPEN) {
      client.close();
      await new Promise((resolve) => client?.once("close", resolve));
    }
    if (wss) {
      wss.close();
    }
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    client = undefined;
    wss = undefined;
    server = undefined;
    globalThis.fetch = originalFetch;
    await wait(50);
    try { await rm(CHAT_LOG_DIR, { recursive: true, force: true }); } catch { /* EACCES on root-owned dirs */ }
    try {
      await rmdir(path.dirname(CHAT_LOG_DIR));
    } catch {
      // Keep parent dir if something else lives there.
    }
  });

  it("ignores malformed JSON and rate limits command bursts", async () => {
    server = http.createServer();
    wss = attachWebSocketChat(server, {
      ollamaUrl: "http://ollama.test",
      loadPersonas: async () => [],
    });

    await new Promise<void>((resolve) => server?.listen(0, resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string", "expected numeric server address");

    client = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    const messages: OutboundMessage[] = [];
    const errors: string[] = [];

    client.on("message", (data) => {
      try {
        messages.push(JSON.parse(data.toString()) as OutboundMessage);
      } catch {
        // Ignore non-JSON frames
      }
    });
    client.on("error", (err) => {
      errors.push(err.message);
    });

    await new Promise<void>((resolve) => client?.once("open", resolve));
    await wait(150);
    const baseline = messages.length;

    client.send("not-json");
    await wait(50);
    assert.equal(messages.length, baseline);

    for (let i = 0; i < 16; i += 1) {
      client.send(JSON.stringify({ type: "command", text: "/help" }));
    }

    await wait(300);
    assert.ok(messages.some((msg) => msg.type === "system" && /commandes|Commandes/i.test(msg.text)));
    assert.ok(messages.some((msg) => msg.type === "system" && /Trop de messages/.test(msg.text)));
    assert.equal(errors.length, 0);
    assert.equal(client.readyState, WebSocket.OPEN);
  });

  it("dispatches command, upload and chat messages to their dedicated seams", async () => {
    globalThis.fetch = (async (_input, init) => {
      let body: Record<string, unknown> = {};
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
      if (body.stream === false) {
        return new Response(
          JSON.stringify({
            message: {
              content: "reponse stub",
              tool_calls: [],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response('{"message":{"content":"reponse stub"},"done":true}\n', {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }) as typeof fetch;

    server = http.createServer();
    wss = attachWebSocketChat(server, {
      ollamaUrl: "http://ollama.test",
      loadPersonas: async () => [],
    });

    await new Promise<void>((resolve) => server?.listen(0, resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string", "expected numeric server address");

    client = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    const messages: OutboundMessage[] = [];

    client.on("message", (data) => {
      try {
        messages.push(JSON.parse(data.toString()) as OutboundMessage);
      } catch {
        // Ignore non-JSON frames
      }
    });

    await new Promise<void>((resolve) => client?.once("open", resolve));
    await wait(150);
    await wait(100);
    messages.length = 0;

    // Leave guest mode so chat messages are accepted
    client.send(JSON.stringify({ type: "command", text: "/nick smoketest" }));
    await wait(150);
    messages.length = 0;

    client.send(JSON.stringify({ type: "command", text: "/help" }));
    await wait(100);
    assert.ok(messages.some((msg) => msg.type === "system" && /commandes|Commandes/i.test(msg.text)));

    client.send(JSON.stringify({ type: "upload", filename: "empty.txt", mimeType: "text/plain", data: "", size: 0 }));
    await wait(100);
    assert.ok(messages.some((msg) => msg.type === "system" && /Upload rejeté/.test(msg.text)));

    client.send(JSON.stringify({ type: "message", text: "bonjour pharmacius" }));
    await wait(200);
    assert.ok(messages.some((msg) => msg.type === "message" && msg.nick === "smoketest"));
    assert.ok(messages.some((msg) => msg.type === "message" && msg.nick === "Pharmacius" && msg.text === "reponse stub"));
  });
});
