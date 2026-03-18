import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { DEFAULT_PERSONAS, personaColor } from "./personas-default.js";
import { createCommandHandler } from "./ws-commands.js";
import { createConversationRouter } from "./ws-conversation-router.js";

const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";
import type {
  ChatPersona,
  ClientInfo,
  ChatOptions,
  InboundMessage,
  InboundChatMessage,
  InboundUpload,
  OutboundMessage,
  ChatLogEntry,
} from "./chat-types.js";

import {
  acquireFileProcessor,
  releaseFileProcessor,
  isOfficeDocument,
  analyzeImage,
} from "./ws-multimodal.js";

// ---------------------------------------------------------------------------
// Chat logging (JSONL)
// ---------------------------------------------------------------------------

const CHAT_LOG_DIR = path.resolve(process.cwd(), "data/chat-logs");

let logDirReady = false;

async function ensureLogDir(): Promise<void> {
  if (logDirReady) return;
  await fs.promises.mkdir(CHAT_LOG_DIR, { recursive: true });
  logDirReady = true;
}

// Ensure log dir at startup (fire-and-forget)
ensureLogDir().catch((err) =>
  console.error("[ws-chat] Failed to create log dir:", err instanceof Error ? err.message : String(err)),
);

function logFilePath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(CHAT_LOG_DIR, `v2-${date}.jsonl`);
}

function logChatMessage(entry: ChatLogEntry): void {
  ensureLogDir()
    .then(() => fs.promises.appendFile(logFilePath(), JSON.stringify(entry) + "\n", "utf8"))
    .catch((err) => {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        return;
      }
      console.error("[ws-chat] Failed to log chat message:", err instanceof Error ? err.message : String(err));
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_WS_MESSAGE_BYTES = 16 * 1024 * 1024; // 16 MB to support file uploads
const MAX_TEXT_LENGTH = 8192;
const RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
const RATE_LIMIT_MAX_MESSAGES = 15; // max messages per window
const PERSONA_REFRESH_INTERVAL_MS = 60_000; // 60 seconds

let clientIdCounter = 0;

function generateNick(): string {
  return `user_${++clientIdCounter}`;
}

function send(ws: WebSocket, msg: OutboundMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* connection closed between check and send */ }
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function attachWebSocketChat(server: http.Server, options: ChatOptions): WebSocketServer {
  const {
    ollamaUrl,
    rag,
    loadPersonas,
    maxGeneralResponders = 2,
  } = options;

  // Mutable personas list — refreshed from DB periodically
  let personas: ChatPersona[] = [...DEFAULT_PERSONAS];
  let refreshInProgress = false;

  async function refreshPersonas(): Promise<void> {
    if (!loadPersonas) return;
    if (refreshInProgress) return;
    refreshInProgress = true;

    try {
      const loaded = await loadPersonas();
      const enabled = loaded.filter((p) => p.enabled);
      if (enabled.length === 0) {
        console.warn("[ws-chat] Persona loader returned no enabled personas — keeping current list");
        return;
      }

      personas = enabled.map((p, i) => ({
        id: p.id,
        nick: p.nick,
        model: p.model,
        systemPrompt: p.systemPrompt,
        color: p.color || personaColor(p.id, i),
        maxTokens: p.maxTokens,
      }));

      if (DEBUG) console.log(`[ws-chat] Refreshed personas: ${personas.map((p) => p.nick).join(", ")}`);
    } catch (err) {
      console.error("[ws-chat] Failed to refresh personas, keeping current list:", err instanceof Error ? err.message : String(err));
    } finally {
      refreshInProgress = false;
    }
  }

  // Initial load + periodic refresh
  refreshPersonas();
  const refreshTimer = setInterval(refreshPersonas, PERSONA_REFRESH_INTERVAL_MS);

  const wss = new WebSocketServer({ server, path: "/ws" });
  const clients = new Map<WebSocket, ClientInfo>();

  // Clean up refresh timer when server closes
  wss.on("close", () => {
    clearInterval(refreshTimer);
  });

  // --- broadcast helpers ---

  function broadcast(channel: string, msg: OutboundMessage, exclude?: WebSocket): void {
    for (const [ws, info] of clients) {
      if (info.channel === channel && ws !== exclude) {
        send(ws, msg);
      }
    }
  }

  function channelUsers(channel: string): string[] {
    const users: string[] = [];
    for (const [, info] of clients) {
      if (info.channel === channel) {
        users.push(info.nick);
      }
    }
    // Append persona nicks
    for (const p of personas) {
      users.push(p.nick);
    }
    return users;
  }

  function broadcastUserlist(channel: string): void {
    const msg: OutboundMessage = { type: "userlist", users: channelUsers(channel) };
    broadcast(channel, msg);
  }

  // --- persistent conversation context (with auto-compaction) ---
  const contextStore = options.contextStore;

  function addToContext(channel: string, nick: string, text: string): void {
    if (contextStore) {
      contextStore.append(channel, nick, text).catch(() => {});
    }
  }

  async function getContextString(channel: string): Promise<string> {
    if (!contextStore) return "";
    try {
      return await contextStore.getContext(channel, 4000);
    } catch { return ""; }
  }
  const routeToPersonas = createConversationRouter({
    ollamaUrl,
    rag,
    broadcast,
    logChatMessage,
    addToContext,
    getContextString,
    getPersonas: () => personas,
    maxGeneralResponders,
  });

  // --- handle chat message ---

  async function handleChatMessage(ws: WebSocket, info: ClientInfo, text: string): Promise<void> {
    // Echo user message to all clients in channel
    broadcast(info.channel, {
      type: "message",
      nick: info.nick,
      text,
      color: "#e0e0e0",
    });

    // Log user message + add to context
    logChatMessage({
      ts: new Date().toISOString(),
      channel: info.channel,
      nick: info.nick,
      type: "message",
      text,
    });
    addToContext(info.channel, info.nick, text);

    await routeToPersonas(info.channel, text);
  }

  // --- handle file upload (delegated to ws-upload-handler) ---

  async function handleUploadMessage(ws: WebSocket, info: ClientInfo, parsed: InboundUpload): Promise<void> {
    const { handleUpload } = await import("./ws-upload-handler.js");
    await handleUpload(
      ws,
      info,
      parsed,
      ollamaUrl,
      broadcast,
      logChatMessage,
      routeToPersonas,
      acquireFileProcessor,
      releaseFileProcessor,
      isOfficeDocument,
      analyzeImage,
      send,
    );
  }

  // --- connection handler ---

  const handleCommand = createCommandHandler({
    send,
    broadcast,
    broadcastUserlist,
    channelUsers,
    listConnectedNicks: () => [...clients.values()].map((client) => client.nick),
    listChannelCounts: () => {
      const counts = new Map<string, number>();
      for (const [, client] of clients) {
        counts.set(client.channel, (counts.get(client.channel) || 0) + 1);
      }
      return counts;
    },
    routeToPersonas,
    logChatMessage,
    getPersonas: () => personas,
  });

  wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
    // Read nick from query param ?nick=, fallback to generated
    const reqUrl = new URL(req.url || "/ws", "http://localhost");
    const paramNick = reqUrl.searchParams.get("nick")?.trim().slice(0, 24);
    const nick = paramNick && /^[a-zA-Z0-9_\-À-ÿ]+$/.test(paramNick) ? paramNick : generateNick();
    const info: ClientInfo = {
      nick,
      channel: "#general",
      connectedAt: Date.now(),
      messageTimestamps: [],
      uploadBytesWindow: 0,
      lastUploadReset: Date.now(),
    };

    clients.set(ws, info);

    // Send MOTD
    send(ws, {
      type: "system",
      text: [
        "***",
        "***  KXKM_Clown V2 — WebSocket Chat",
        "***",
        `***  Personas actives: ${personas.map((p) => p.nick).join(", ")}`,
        "***  Tape /help pour les commandes.",
        `***  Ton nick: ${nick}`,
        "***",
      ].join("\n"),
    });

    // Send persona color info
    for (const p of personas) {
      send(ws, { type: "persona", nick: p.nick, color: p.color });
    }

    // Broadcast join
    broadcast(info.channel, {
      type: "join",
      nick: info.nick,
      channel: info.channel,
      text: `${info.nick} a rejoint ${info.channel}`,
    }, ws);

    // Send userlist
    send(ws, { type: "userlist", users: channelUsers(info.channel) });

    // --- message handler ---

    ws.on("message", async (raw: Buffer) => {
      if (raw.length > MAX_WS_MESSAGE_BYTES) return;

      // Rate limiting
      const now = Date.now();
      info.messageTimestamps = info.messageTimestamps.filter(
        (t) => now - t < RATE_LIMIT_WINDOW_MS,
      );
      if (info.messageTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
        send(ws, { type: "system", text: "Trop de messages — ralentis un peu." });
        return;
      }
      info.messageTimestamps.push(now);

      let message: InboundMessage;
      try {
        message = JSON.parse(raw.toString()) as InboundMessage;
      } catch {
        return;
      }

      if (!message || typeof message !== "object") return;
      if (typeof message.type !== "string") return;

      if (message.type === "upload") {
        await handleUploadMessage(ws, info, message as InboundUpload);
        return;
      }

      // For message and command types, text is required
      if (typeof (message as InboundChatMessage).text !== "string") return;
      const text = (message as InboundChatMessage).text;
      if (text.length > MAX_TEXT_LENGTH) {
        send(ws, { type: "system", text: "Message trop long (max 8192 caracteres)." });
        return;
      }

      if (message.type === "command") {
        await handleCommand({ ws, info, text });
      } else if (message.type === "message") {
        await handleChatMessage(ws, info, text);
      }
    });

    // --- error handler (prevent unhandled error crash) ---

    ws.on("error", (err) => {
      console.error(`[ws-chat] WebSocket error for ${info.nick}:`, err.message);
    });

    // --- close handler ---

    ws.on("close", () => {
      broadcast(info.channel, {
        type: "part",
        nick: info.nick,
        channel: info.channel,
        text: `${info.nick} a quitte ${info.channel}`,
      });
      clients.delete(ws);
      broadcastUserlist(info.channel);
    });
  });

  if (DEBUG) console.log(`[ws-chat] WebSocket chat attached on /ws (Ollama: ${ollamaUrl})`);
  return wss;
}
