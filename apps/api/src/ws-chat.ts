import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { DEFAULT_PERSONAS, personaColor } from "./personas-default.js";
import { createCommandHandler } from "./ws-commands.js";
import { createConversationRouter } from "./ws-conversation-router.js";
import logger from "./logger.js";
import { logChatMessage } from "./ws-chat-logger.js";
import { send, generateNick, checkRateLimit, MAX_WS_MESSAGE_BYTES, MAX_TEXT_LENGTH } from "./ws-chat-helpers.js";
import { replayHistory } from "./ws-chat-history.js";
import { wsMessageSchema } from "./schemas.js";

import type {
  ChatPersona,
  ClientInfo,
  ChatOptions,
  InboundMessage,
  InboundChatMessage,
  InboundUpload,
  OutboundMessage,
} from "./chat-types.js";

import {
  acquireFileProcessor,
  releaseFileProcessor,
  isOfficeDocument,
  analyzeImage,
} from "./ws-multimodal.js";

// ---------------------------------------------------------------------------
// Per-channel sequence counter
// ---------------------------------------------------------------------------

const channelSeq = new Map<string, number>();
  const channelTopics = new Map<string, string>();
  const channelPins = new Map<string, string[]>();
const userStats = new Map<string, { messages: number; firstSeen: number }>();

// Moderation: banned nicks (shared with command handler)
export const bannedNicks = new Set<string>();

function nextSeq(channel: string): number {
  const n = (channelSeq.get(channel) || 0) + 1;
  channelSeq.set(channel, n);
  return n;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERSONA_REFRESH_INTERVAL_MS = 60_000; // 60 seconds
const IDLE_WARN_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_KICK_MS = 5 * 60 * 1000;  // 5 minutes after warning

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
        logger.warn("[ws-chat] Persona loader returned no enabled personas — keeping current list");
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

      logger.debug(`[ws-chat] Refreshed personas: ${personas.map((p) => p.nick).join(", ")}`);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "[ws-chat] Failed to refresh personas, keeping current list");
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
    const stamped = { ...msg, seq: nextSeq(channel), timestamp: Date.now() };
    for (const [ws, info] of clients) {
      if (info.channel === channel && ws !== exclude) {
        // Skip if persona is muted for this client
        if ('nick' in stamped && info.mutedPersonas?.has((stamped as any).nick?.toLowerCase())) continue;
        send(ws, stamped);
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

  // Mutable responder count — can be changed at runtime via /responders command
  let currentMaxResponders = maxGeneralResponders;

  const routeToPersonas = createConversationRouter({
    ollamaUrl,
    rag,
    broadcast,
    logChatMessage,
    addToContext,
    getContextString,
    getPersonas: () => personas,
    maxGeneralResponders: () => currentMaxResponders,
  });

  // --- handle chat message ---

  async function handleChatMessage(ws: WebSocket, info: ClientInfo, text: string): Promise<void> {
    // Track user stats
    const existing = userStats.get(info.nick);
    if (existing) { existing.messages++; } else { userStats.set(info.nick, { messages: 1, firstSeen: Date.now() }); }

    broadcast(info.channel, {
      type: "message",
      nick: info.nick,
      text,
      color: "#e0e0e0",
    });

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
    getChannelTopics: () => channelTopics,
    getChannelPins: () => channelPins,
    getUserStats: () => userStats,
    getClients: () => clients,
    getMaxResponders: () => currentMaxResponders,
    setMaxResponders: (n: number) => { currentMaxResponders = n; },
    getActiveUserCount: () => clients.size,
    getContextStore: () => contextStore,
    refreshPersonas,
    bannedNicks,
  });

  // Max 5 connections per IP
  const ipConnections = new Map<string, number>();
  const MAX_CONNECTIONS_PER_IP = 5;

  wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
    const ip = req.socket.remoteAddress || "unknown";
    const count = ipConnections.get(ip) || 0;
    if (count >= MAX_CONNECTIONS_PER_IP) {
      send(ws, { type: "system", text: "Trop de connexions depuis cette IP." });
      ws.close();
      return;
    }
    ipConnections.set(ip, count + 1);

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
      mutedPersonas: new Set(),
    };

    // Check ban
    if (bannedNicks.has(nick.toLowerCase())) {
      send(ws, { type: "system", text: "Tu es banni de ce serveur." });
      ws.close();
      return;
    }

    clients.set(ws, info);

    // Initialize user stats if first time
    if (!userStats.has(nick)) {
      userStats.set(nick, { messages: 0, firstSeen: Date.now() });
    }

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
        `***  Uptime: ${Math.floor(process.uptime() / 3600)}h${Math.floor((process.uptime() % 3600) / 60)}m`,
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

    // Send pinned messages to new joiners
    const pins = channelPins.get(info.channel);
    if (pins?.length) {
      send(ws, { type: "system", text: `Pins:\n${pins.map((p: string, i: number) => `  ${i + 1}. ${p}`).join("\n")}` });
    }

    // Send recent chat history
    if (contextStore) {
      replayHistory(ws, info.channel, personas, send);
    }

    // --- idle auto-disconnect ---
    function startIdleTimer() {
      return setTimeout(() => {
        send(ws, { type: "system", text: "Tu es inactif depuis 30min. Deconnexion dans 5min..." });
        idleTimer = setTimeout(() => {
          send(ws, { type: "system", text: "Deconnexion pour inactivite." });
          ws.close();
        }, IDLE_KICK_MS);
      }, IDLE_WARN_MS);
    }
    let idleTimer: ReturnType<typeof setTimeout> = startIdleTimer();

    // --- message handler (Promise chain to prevent async reordering) ---

    let processingChain = Promise.resolve();

    ws.on("message", (raw: Buffer) => {
      // Reset idle timer on activity
      clearTimeout(idleTimer);
      idleTimer = startIdleTimer();

      processingChain = processingChain.then(async () => {
        if (raw.length > MAX_WS_MESSAGE_BYTES) return;

        if (checkRateLimit(info)) {
          send(ws, { type: "system", text: "Trop de messages — ralentis un peu." });
          return;
        }

        let rawParsed: unknown;
        try {
          rawParsed = JSON.parse(raw.toString());
        } catch {
          return;
        }

        // Validate with Zod schema (non-breaking: log invalid, drop message)
        const validated = wsMessageSchema.safeParse(rawParsed);
        if (!validated.success) {
          logger.warn({ issues: validated.error.issues }, "[ws-chat] Invalid WS message rejected by schema");
          send(ws, { type: "system", text: "Message invalide (format incorrect)." });
          return;
        }

        const message = validated.data as InboundMessage;

        if (message.type === "upload") {
          await handleUploadMessage(ws, info, message as InboundUpload);
          return;
        }

        const text = (message as InboundChatMessage).text;

        if (message.type === "command") {
          await handleCommand({ ws, info, text });
        } else if (message.type === "message") {
          await handleChatMessage(ws, info, text);
        }
      }).catch((err) => {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, "[ws-chat] handler error");
      });
    });

    ws.on("error", (err) => {
      logger.error({ err: err.message, nick: info.nick }, "[ws-chat] WebSocket error");
    });

    ws.on("close", () => {
      clearTimeout(idleTimer);
      const sessionDuration = Math.floor((Date.now() - info.connectedAt) / 60000);
      const stats = userStats.get(info.nick);
      logger.info({ nick: info.nick, duration: sessionDuration, messages: stats?.messages || 0 }, "User disconnected");

      const remaining = (ipConnections.get(ip) || 1) - 1;
      if (remaining <= 0) ipConnections.delete(ip);
      else ipConnections.set(ip, remaining);

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

  logger.debug(`[ws-chat] WebSocket chat attached on /ws (Ollama: ${ollamaUrl})`);
  return wss;
}
