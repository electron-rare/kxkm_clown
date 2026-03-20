import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { handleUpload } from "./ws-upload-handler.js";
import type { WebSocket } from "ws";
import type { InboundUpload, ClientInfo, OutboundMessage } from "./chat-types.js";

// ── helpers ──────────────────────────────────────────────────────────

function makeClientInfo(overrides?: Partial<ClientInfo>): ClientInfo {
  return {
    nick: "testuser",
    channel: "#test",
    connectedAt: Date.now(),
    messageTimestamps: [],
    uploadBytesWindow: 0,
    lastUploadReset: Date.now(),
    isGuest: false,
    ...overrides,
  };
}

function b64(str: string): string {
  return Buffer.from(str).toString("base64");
}

interface MockDeps {
  ws: WebSocket;
  broadcast: ReturnType<typeof mock.fn>;
  logChatMessage: ReturnType<typeof mock.fn>;
  routeToPersonas: ReturnType<typeof mock.fn>;
  acquireFileProcessor: ReturnType<typeof mock.fn>;
  releaseFileProcessor: ReturnType<typeof mock.fn>;
  isOfficeDocument: ReturnType<typeof mock.fn>;
  analyzeImage: ReturnType<typeof mock.fn>;
  send: ReturnType<typeof mock.fn>;
  sentMessages: OutboundMessage[];
}

function makeMocks(): MockDeps {
  const sentMessages: OutboundMessage[] = [];
  const send = mock.fn((_ws: WebSocket, msg: OutboundMessage) => {
    sentMessages.push(msg);
  });

  return {
    ws: {} as WebSocket,
    broadcast: mock.fn(),
    logChatMessage: mock.fn(),
    routeToPersonas: mock.fn(() => Promise.resolve()),
    acquireFileProcessor: mock.fn(() => Promise.resolve()),
    releaseFileProcessor: mock.fn(),
    isOfficeDocument: mock.fn(() => false),
    analyzeImage: mock.fn(() => Promise.resolve("[image analysis]")),
    send,
    sentMessages,
  };
}

function callUpload(
  parsed: InboundUpload,
  info: ClientInfo,
  deps: MockDeps,
) {
  return handleUpload(
    deps.ws,
    info,
    parsed,
    "http://localhost:11434",
    deps.broadcast as any,
    deps.logChatMessage as any,
    deps.routeToPersonas as any,
    deps.acquireFileProcessor as any,
    deps.releaseFileProcessor as any,
    deps.isOfficeDocument as any,
    deps.analyzeImage as any,
    deps.send as any,
  );
}

// ── tests ────────────────────────────────────────────────────────────

describe("ws-upload-handler", () => {
  it("rejects upload > 12 MB", async () => {
    const deps = makeMocks();
    const info = makeClientInfo();
    const parsed: InboundUpload = {
      type: "upload",
      filename: "big.bin",
      mimeType: "application/octet-stream",
      data: b64("x"),
      size: 13 * 1024 * 1024, // 13 MB
    };

    await callUpload(parsed, info, deps);

    assert.equal(deps.sentMessages.length, 1);
    assert.ok(deps.sentMessages[0].type === "system");
    assert.ok((deps.sentMessages[0] as any).text.includes("Upload rejeté"));
    assert.equal(deps.broadcast.mock.callCount(), 0);
  });

  it("rejects upload with empty data", async () => {
    const deps = makeMocks();
    const info = makeClientInfo();
    const parsed: InboundUpload = {
      type: "upload",
      filename: "empty.txt",
      mimeType: "text/plain",
      data: "",
      size: 100,
    };

    await callUpload(parsed, info, deps);

    assert.equal(deps.sentMessages.length, 1);
    assert.ok((deps.sentMessages[0] as any).text.includes("Upload rejeté"));
    assert.equal(deps.broadcast.mock.callCount(), 0);
  });

  it("rate limits: rejects if > 50 MB/min", async () => {
    const deps = makeMocks();
    const info = makeClientInfo({
      uploadBytesWindow: 49 * 1024 * 1024, // already uploaded 49 MB
      lastUploadReset: Date.now(), // within current window
    });
    const parsed: InboundUpload = {
      type: "upload",
      filename: "more.bin",
      mimeType: "application/octet-stream",
      data: b64("x"),
      size: 2 * 1024 * 1024, // 2 MB → total 51 MB > limit
    };

    await callUpload(parsed, info, deps);

    assert.equal(deps.sentMessages.length, 1);
    assert.ok((deps.sentMessages[0] as any).text.includes("limite de débit"));
    assert.equal(deps.broadcast.mock.callCount(), 0);
  });

  it("processes text/plain file", async () => {
    const deps = makeMocks();
    const info = makeClientInfo();
    const content = "Hello world content";
    const parsed: InboundUpload = {
      type: "upload",
      filename: "note.txt",
      mimeType: "text/plain",
      data: b64(content),
      size: Buffer.byteLength(content),
    };

    await callUpload(parsed, info, deps);

    // Should broadcast notification
    assert.equal(deps.broadcast.mock.callCount(), 1);
    // Should log
    assert.equal(deps.logChatMessage.mock.callCount(), 1);
    // Should route to personas with analysis containing the text
    assert.equal(deps.routeToPersonas.mock.callCount(), 1);
    const routeArgs = deps.routeToPersonas.mock.calls[0].arguments as any[];
    assert.equal(routeArgs[0], "#test");
    assert.ok(routeArgs[1].includes("Fichier texte"));
    assert.ok(routeArgs[1].includes(content));
  });

  it("processes application/json file", async () => {
    const deps = makeMocks();
    const info = makeClientInfo();
    const content = '{"key": "value"}';
    const parsed: InboundUpload = {
      type: "upload",
      filename: "data.json",
      mimeType: "application/json",
      data: b64(content),
      size: Buffer.byteLength(content),
    };

    await callUpload(parsed, info, deps);

    assert.equal(deps.routeToPersonas.mock.callCount(), 1);
    const routeArgs = deps.routeToPersonas.mock.calls[0].arguments as any[];
    assert.ok(routeArgs[1].includes("Fichier texte"));
    assert.ok(routeArgs[1].includes(content));
  });

  it("broadcasts upload notification", async () => {
    const deps = makeMocks();
    const info = makeClientInfo({ nick: "alice", channel: "#chat" });
    const parsed: InboundUpload = {
      type: "upload",
      filename: "pic.txt",
      mimeType: "text/plain",
      data: b64("hi"),
      size: 2,
    };

    await callUpload(parsed, info, deps);

    assert.equal(deps.broadcast.mock.callCount(), 1);
    const [channel, msg] = deps.broadcast.mock.calls[0].arguments;
    assert.equal(channel, "#chat");
    assert.ok((msg as any).text.includes("alice"));
    assert.ok((msg as any).text.includes("pic.txt"));
  });

  it("logs the upload event", async () => {
    const deps = makeMocks();
    const info = makeClientInfo({ nick: "bob" });
    const parsed: InboundUpload = {
      type: "upload",
      filename: "doc.txt",
      mimeType: "text/plain",
      data: b64("data"),
      size: 4,
    };

    await callUpload(parsed, info, deps);

    assert.equal(deps.logChatMessage.mock.callCount(), 1);
    const entry = deps.logChatMessage.mock.calls[0].arguments[0] as any;
    assert.equal(entry.nick, "bob");
    assert.ok(entry.text.includes("doc.txt"));
  });

  it("calls routeToPersonas with analysis", async () => {
    const deps = makeMocks();
    const info = makeClientInfo({ nick: "carol", channel: "#room" });
    const parsed: InboundUpload = {
      type: "upload",
      filename: "readme.txt",
      mimeType: "text/plain",
      data: b64("important text"),
      size: 14,
    };

    await callUpload(parsed, info, deps);

    assert.equal(deps.routeToPersonas.mock.callCount(), 1);
    const [ch, text] = deps.routeToPersonas.mock.calls[0].arguments as any[];
    assert.equal(ch, "#room");
    assert.ok(text.includes("carol"));
    assert.ok(text.includes("readme.txt"));
    assert.ok(text.includes("Analyse ce fichier"));
  });

  it("rejects unknown file type (SEC-03 MIME validation)", async () => {
    const deps = makeMocks();
    const info = makeClientInfo();
    const parsed: InboundUpload = {
      type: "upload",
      filename: "mystery.xyz",
      mimeType: "application/x-custom",
      data: b64("binary stuff"),
      size: 1234,
    };

    await callUpload(parsed, info, deps);

    // SEC-03: unknown extension without valid magic bytes is rejected
    assert.equal(deps.routeToPersonas.mock.callCount(), 0);
  });
});
