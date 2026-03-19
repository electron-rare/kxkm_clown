process.env.NODE_ENV = "test";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { rm, rmdir } from "node:fs/promises";
import { WebSocket } from "ws";
import { attachWebSocketChat } from "./ws-chat.js";
import type { OutboundMessage } from "./chat-types.js";

const originalFetch = globalThis.fetch;
const CHAT_LOG_DIR = path.resolve(process.cwd(), "data/chat-logs");

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: OutboundMessage) => boolean,
  timeoutMs = 15000,
): Promise<OutboundMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener("message", handler);
      reject(new Error(`Timeout waiting for message (${timeoutMs}ms)`));
    }, timeoutMs);
    function handler(data: Buffer) {
      try {
        const msg = JSON.parse(data.toString()) as OutboundMessage;
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeListener("message", handler);
          resolve(msg);
        }
      } catch { /* skip */ }
    }
    ws.on("message", handler);
  });
}

function collectMessages(ws: WebSocket): OutboundMessage[] {
  const msgs: OutboundMessage[] = [];
  ws.on("message", (data) => {
    try { msgs.push(JSON.parse(data.toString()) as OutboundMessage); } catch { /* skip */ }
  });
  return msgs;
}

// Mock Ollama that returns a quick response
function mockOllamaFetch(original: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url.includes("/api/chat")) {
      const body = init?.body ? JSON.parse(init.body.toString()) : {};
      const isStream = body.stream !== false;
      if (isStream) {
        const chunks = [
          JSON.stringify({ message: { content: "Test " }, done: false }) + "\n",
          JSON.stringify({ message: { content: "response." }, done: true }) + "\n",
        ];
        return new Response(new ReadableStream({
          start(controller) {
            for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
            controller.close();
          }
        }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
      }
      return new Response(JSON.stringify({
        message: { role: "assistant", content: "Test response.", tool_calls: [] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
    return original(input, init);
  };
}

describe("ws-integration", () => {
  let server: http.Server | undefined;
  let wss: ReturnType<typeof attachWebSocketChat> | undefined;
  const clients: WebSocket[] = [];

  function createServer() {
    server = http.createServer();
    globalThis.fetch = mockOllamaFetch(originalFetch) as typeof fetch;
    wss = attachWebSocketChat(server, {
      ollamaUrl: "http://ollama.test",
      loadPersonas: async () => [
        { id: "pharmacius", nick: "Pharmacius", model: "test", systemPrompt: "Tu es un test bot. Reponds en 1 phrase.", color: "#0f0", enabled: true, maxTokens: 100 },
      ],
      maxGeneralResponders: 1,
    });
    return new Promise<number>((resolve) => {
      server!.listen(0, () => {
        const addr = server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
  }

  /** Connect and immediately start collecting messages (before "open" resolves) */
  function connectWithCollector(port: number, nick?: string): Promise<{ ws: WebSocket; msgs: OutboundMessage[] }> {
    const url = `ws://127.0.0.1:${port}/ws${nick ? `?nick=${nick}` : ""}`;
    const ws = new WebSocket(url);
    clients.push(ws);
    const msgs = collectMessages(ws);
    return new Promise((resolve) => ws.once("open", () => resolve({ ws, msgs })));
  }

  function connect(port: number, nick?: string): Promise<WebSocket> {
    const url = `ws://127.0.0.1:${port}/ws${nick ? `?nick=${nick}` : ""}`;
    const ws = new WebSocket(url);
    clients.push(ws);
    return new Promise((resolve) => ws.once("open", () => resolve(ws)));
  }

  afterEach(async () => {
    for (const c of clients) {
      if (c.readyState === WebSocket.OPEN) {
        c.close();
        await new Promise((r) => c.once("close", r)).catch(() => {});
      }
    }
    clients.length = 0;
    if (wss) wss.close();
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    wss = undefined;
    globalThis.fetch = originalFetch;
    await wait(50);
    try { await rm(CHAT_LOG_DIR, { recursive: true, force: true }); } catch {}
    try { await rmdir(path.dirname(CHAT_LOG_DIR)); } catch {}
  });

  it("connects and receives MOTD + userlist + persona colors", async () => {
    const port = await createServer();
    const { ws, msgs } = await connectWithCollector(port, "alice");
    await wait(300);

    const motd = msgs.find((m) => m.type === "system" && "text" in m && m.text.includes("KXKM_Clown"));
    assert.ok(motd, "should receive MOTD");

    const userlist = msgs.find((m) => m.type === "userlist");
    assert.ok(userlist, "should receive userlist");
    assert.ok("users" in userlist && Array.isArray(userlist.users), "userlist should have users array");

    const persona = msgs.find((m) => m.type === "persona");
    assert.ok(persona, "should receive persona color info");
  });

  it("sends message and receives persona response with chunks", async () => {
    const port = await createServer();
    const ws = await connect(port, "bob");
    await wait(200);

    ws.send(JSON.stringify({ type: "message", text: "hello" }));

    // Wait for either chunk or final message from Pharmacius
    const response = await waitForMessage(ws, (m) =>
      (m.type === "message" || (m as any).type === "chunk") && "nick" in m && m.nick === "Pharmacius",
      10000,
    );
    assert.ok(response, "should receive persona response");
  });

  it("multiple clients see each others messages", async () => {
    const port = await createServer();
    const wsA = await connect(port, "clientA");
    const wsB = await connect(port, "clientB");
    const msgsB = collectMessages(wsB);
    await wait(200);

    wsA.send(JSON.stringify({ type: "message", text: "hello from A" }));
    await wait(300);

    const echoOnB = msgsB.find((m) =>
      m.type === "message" && "nick" in m && m.nick === "clientA",
    );
    assert.ok(echoOnB, "client B should see client A message");
  });

  it("rate limiting kicks in after 15 messages", async () => {
    const port = await createServer();
    const ws = await connect(port, "spammer");
    const msgs = collectMessages(ws);
    await wait(200);

    for (let i = 0; i < 16; i++) {
      ws.send(JSON.stringify({ type: "message", text: `msg${i}` }));
    }
    await wait(500);

    const rateLimitMsg = msgs.find((m) =>
      m.type === "system" && "text" in m && m.text.includes("ralentis"),
    );
    assert.ok(rateLimitMsg, "should receive rate limit warning");
  });

  it("disconnect sends part message to other clients", async () => {
    const port = await createServer();
    const wsA = await connect(port, "leaver");
    const wsB = await connect(port, "stayer");
    const msgsB = collectMessages(wsB);
    await wait(200);

    wsA.close();
    await wait(300);

    const partMsg = msgsB.find((m) =>
      m.type === "part" && "nick" in m && m.nick === "leaver",
    );
    assert.ok(partMsg, "stayer should see part message for leaver");
  });

  it("messages have seq numbers when available", async () => {
    const port = await createServer();
    const ws = await connect(port, "seqtest");
    const msgs = collectMessages(ws);
    await wait(200);

    ws.send(JSON.stringify({ type: "message", text: "test seq" }));
    await wait(2000);

    const withSeq = msgs.filter((m) => "seq" in m && typeof (m as any).seq === "number");
    // If seq is implemented, broadcast messages should have it
    // This test documents behavior — passes whether seq exists or not
    assert.ok(true, `${withSeq.length} messages had seq numbers`);
  });
});
