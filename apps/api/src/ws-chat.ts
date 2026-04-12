import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { DEFAULT_PERSONAS, personaColor } from "./personas-default.js";
import { createCommandHandler } from "./ws-commands.js";
import { createConversationRouter } from "./ws-conversation-router.js";
import logger from "./logger.js";
import { logChatMessage } from "./ws-chat-logger.js";
import { send, generateNick, checkRateLimit, MAX_WS_MESSAGE_BYTES, MAX_TEXT_LENGTH } from "./ws-chat-helpers.js";
import { replayHistory } from "./ws-chat-history.js";
import { wsMessageSchema } from "./schemas.js";
import { recordLatency, incrementCounter, setWsConnections } from "./perf.js";

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
// Chat pause (maintenance mode) — file-based for hot toggle without restart
// ---------------------------------------------------------------------------

const PAUSE_FILE = path.join(process.cwd(), "data", "chat-paused");

export function isChatPaused(): boolean {
  if (process.env.CHAT_PAUSED === "1") return true;
  try { return fs.existsSync(PAUSE_FILE); } catch { return false; }
}

export function setChatPaused(paused: boolean): void {
  if (paused) {
    fs.mkdirSync(path.dirname(PAUSE_FILE), { recursive: true });
    fs.writeFileSync(PAUSE_FILE, new Date().toISOString());
    logger.info("[ws-chat] Chat PAUSED (maintenance mode)");
  } else {
    try { fs.unlinkSync(PAUSE_FILE); } catch {}
    logger.info("[ws-chat] Chat UNPAUSED");
  }
}

// ---------------------------------------------------------------------------
// Per-channel sequence counter
// ---------------------------------------------------------------------------

let guestIdCounter = 0;
const channelSeq = new Map<string, number>();
const channelTopics = new Map<string, string>();
const channelPins = new Map<string, string[]>();
const userStats = new Map<string, { messages: number; firstSeen: number }>();

// ---------------------------------------------------------------------------
// Channel state persistence (lot-146)
// ---------------------------------------------------------------------------

const CHANNEL_STATE_FILE = path.join(process.cwd(), "data", "channel-state.json");

interface ChannelStateSnapshot {
  topics?: Record<string, string>;
  pins?: Record<string, string[]>;
  savedAt?: string;
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  return null;
}

function normalizeChannelState(raw: unknown): ChannelStateSnapshot {
  const parsed = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const topics = Object.fromEntries(
    Object.entries(parsed.topics && typeof parsed.topics === "object" ? parsed.topics as Record<string, unknown> : {})
      .filter(([, value]) => typeof value === "string"),
  ) as Record<string, string>;
  const pins = Object.fromEntries(
    Object.entries(parsed.pins && typeof parsed.pins === "object" ? parsed.pins as Record<string, unknown> : {})
      .map(([channel, value]) => [
        channel,
        Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [],
      ]),
  ) as Record<string, string[]>;
  return {
    topics,
    pins,
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : undefined,
  };
}

function writeChannelStateSync(filePath: string, state: ChannelStateSnapshot): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

async function writeChannelState(filePath: string, state: ChannelStateSnapshot): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.promises.rename(tmp, filePath);
}

export function loadChannelStateFromDiskSync(filePath: string = CHANNEL_STATE_FILE): ChannelStateSnapshot | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    try {
      return normalizeChannelState(JSON.parse(raw));
    } catch (parseErr) {
      const recoveredRaw = extractFirstJsonObject(raw);
      if (recoveredRaw) {
        try {
          const recovered = normalizeChannelState(JSON.parse(recoveredRaw));
          writeChannelStateSync(filePath, recovered);
          logger.warn({ filePath }, "[ws-chat] Recovered corrupted channel state by truncating trailing bytes");
          return recovered;
        } catch {
          // Fall through to quarantine.
        }
      }

      const quarantinePath = path.join(path.dirname(filePath), `channel-state.corrupt.${Date.now().toString(36)}.json`);
      try {
        fs.renameSync(filePath, quarantinePath);
        logger.warn({ err: parseErr, filePath, quarantinePath }, "[ws-chat] Quarantined unrecoverable channel state file");
      } catch (renameErr) {
        logger.warn({ err: renameErr, filePath, originalError: parseErr }, "[ws-chat] Failed to quarantine corrupt channel state file");
      }
      return null;
    }
  } catch {
    return null;
  }
}

function saveChannelState() {
  const state = {
    topics: Object.fromEntries(channelTopics),
    pins: Object.fromEntries([...channelPins].map(([k, v]) => [k, v])),
    savedAt: new Date().toISOString(),
  };
  writeChannelState(CHANNEL_STATE_FILE, state).catch(err => logger.warn({ err: err.message }, "[ws-chat] channel state save failed"));
}

const loadedChannelState = loadChannelStateFromDiskSync();
if (loadedChannelState) {
  if (loadedChannelState.topics) {
    Object.entries(loadedChannelState.topics).forEach(([k, v]) => channelTopics.set(k, v));
  }
  if (loadedChannelState.pins) {
    Object.entries(loadedChannelState.pins).forEach(([k, v]) => channelPins.set(k, v));
  }
  logger.info("[ws-chat] Loaded channel state from disk");
}

setInterval(saveChannelState, 5 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Periodic cleanup of unbounded Maps (every 30 min)
// ---------------------------------------------------------------------------

const CLEANUP_INTERVAL = 30 * 60 * 1000;

// NOTE: `clients` is created inside attachWebSocketChat; we store a ref here
// so the module-level interval can access it once set.
let _clients: Map<WebSocket, ClientInfo> | undefined;

setInterval(() => {
  if (!_clients) return;
  // Get active channels
  const activeChannels = new Set<string>();
  for (const [, info] of _clients) {
    activeChannels.add(info.channel);
  }
  // Clean inactive channels
  for (const key of channelSeq.keys()) {
    if (!activeChannels.has(key)) channelSeq.delete(key);
  }
  for (const key of channelTopics.keys()) {
    if (!activeChannels.has(key)) channelTopics.delete(key);
  }
  for (const key of channelPins.keys()) {
    if (!activeChannels.has(key)) channelPins.delete(key);
  }
  // Clean disconnected users from stats (keep last 1000)
  if (userStats.size > 1000) {
    const entries = [...userStats.entries()].sort((a, b) => b[1].firstSeen - a[1].firstSeen);
    userStats.clear();
    for (const [k, v] of entries.slice(0, 500)) userStats.set(k, v);
  }
}, CLEANUP_INTERVAL).unref();

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
  refreshTimer.unref();

  const wss = new WebSocketServer({ server, path: "/ws" });
  const clients = new Map<WebSocket, ClientInfo>();
  _clients = clients; // expose to module-level cleanup interval

  // Clean up refresh timer when server closes
  wss.on("close", () => {
    clearInterval(refreshTimer);
  });

  // --- broadcast helpers ---

  function broadcast(channel: string, msg: OutboundMessage, exclude?: WebSocket): void {
    const stamped = { ...msg, seq: nextSeq(channel), timestamp: Date.now() };
    // Pre-serialize once for all clients (avoids N × JSON.stringify for N clients)
    const hasMuteCheck = 'nick' in stamped;
    const muteKey = hasMuteCheck ? (stamped as any).nick?.toLowerCase() : undefined;
    let serialized: string | undefined;
    for (const [ws, info] of clients) {
      if (info.channel === channel && ws !== exclude) {
        if (muteKey && info.mutedPersonas?.has(muteKey)) continue;
        if (ws.readyState === WebSocket.OPEN) {
          try {
            if (!serialized) serialized = JSON.stringify(stamped);
            ws.send(serialized);
          } catch { /* connection closed */ }
        }
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
      return await contextStore.getContext(channel, 2000);
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

    await routeToPersonas(info.channel, text, 0, info.nick);
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
    const validNick = paramNick && /^[a-zA-Z0-9_\-À-ÿ]+$/.test(paramNick) ? paramNick : "";
    const nick = validNick || `guest_${++guestIdCounter}`;
    const isGuest = !validNick || nick.startsWith("guest_");
    const info: ClientInfo = {
      nick,
      channel: "#general",
      connectedAt: Date.now(),
      messageTimestamps: [],
      uploadBytesWindow: 0,
      lastUploadReset: Date.now(),
      mutedPersonas: new Set(),
      isGuest,
    };

    // Check ban
    if (bannedNicks.has(nick.toLowerCase())) {
      send(ws, { type: "system", text: "Tu es banni de ce serveur." });
      ws.close();
      return;
    }

    clients.set(ws, info);
    incrementCounter("ws_connections");
    setWsConnections(clients.size);

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
        ...(isGuest ? ["***  Mode invit\u00e9 (lecture seule) — /nick <pseudo> pour participer."] : []),
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
        const wsStart = performance.now();
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

        // Handle ping/pong for latency measurement (bypass schema validation)
        if (rawParsed && typeof rawParsed === "object" && (rawParsed as any).type === "__ping") {
          send(ws, { type: "__pong" } as any);
          return;
        }

        // Validate with Zod schema (non-breaking: log invalid, drop message silently)
        const validated = wsMessageSchema.safeParse(rawParsed);
        if (!validated.success) {
          // Don't spam the client with "format incorrect" — just drop silently
          return;
        }

        const message = validated.data as InboundMessage;

        if (message.type === "upload") {
          await handleUploadMessage(ws, info, message as InboundUpload);
          return;
        }

        const text = (message as InboundChatMessage).text;

        // Maintenance pause: block all chat except /help /who /status /pause /unpause
        if (isChatPaused()) {
          const PAUSE_ALLOWED = ["/help", "/who", "/status", "/nick ", "/unpause"];
          if (message.type === "command" && PAUSE_ALLOWED.some((c) => text.startsWith(c))) {
            await handleCommand({ ws, info, text });
          } else {
            send(ws, { type: "system", text: "\u23F8 Chat en pause — session de fine-tuning en cours. Les personas seront bientôt de retour !" });
          }
          return;
        }

        // Guest mode: allow /nick + read-only commands, block chat
        if (info.isGuest) {
          const GUEST_ALLOWED = ["/nick ", "/help", "/who", "/channels"];
          if (message.type === "command" && GUEST_ALLOWED.some((c) => text.startsWith(c))) {
            await handleCommand({ ws, info, text });
            // If nick changed successfully, leave guest mode
            if (text.startsWith("/nick ") && !info.nick.startsWith("guest_")) {
              info.isGuest = false;
              send(ws, { type: "system", text: `Mode invit\u00e9 d\u00e9sactiv\u00e9 — bienvenue ${info.nick} !` });
            }
          } else {
            send(ws, { type: "system", text: "Mode invit\u00e9 \u2014 connexion requise pour envoyer des messages. /nick <pseudo> pour te connecter." });
          }
          return;
        }

        if (message.type === "command") {
          incrementCounter("ws_commands");
          await handleCommand({ ws, info, text });
        } else if (message.type === "message") {
          incrementCounter("ws_messages");
          await handleChatMessage(ws, info, text);
        }
        recordLatency("ws_message", performance.now() - wsStart);
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
      setWsConnections(clients.size);
      broadcastUserlist(info.channel);
    });
  });

  logger.debug(`[ws-chat] WebSocket chat attached on /ws (Ollama: ${ollamaUrl})`);
  return wss;
}
