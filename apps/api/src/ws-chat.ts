import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatPersona {
  id: string;
  nick: string;
  model: string;
  systemPrompt: string;
  color: string;
}

interface ClientInfo {
  nick: string;
  channel: string;
  connectedAt: number;
  messageTimestamps: number[];
}

interface PersonaLoaderResult {
  id: string;
  nick: string;
  model: string;
  systemPrompt: string;
  color: string;
  enabled: boolean;
}

interface ChatOptions {
  ollamaUrl: string;
  loadPersonas?: () => Promise<PersonaLoaderResult[]>;
  maxGeneralResponders?: number;
}

// Inbound message types
interface InboundChatMessage {
  type: "message";
  text: string;
}

interface InboundCommand {
  type: "command";
  text: string;
}

interface InboundUpload {
  type: "upload";
  filename?: string;
  mimeType?: string;
  data?: string; // base64-encoded file content
  size?: number;
}

type InboundMessage = InboundChatMessage | InboundCommand | InboundUpload;

// Outbound message types
type OutboundMessage =
  | { type: "message"; nick: string; text: string; color: string }
  | { type: "system"; text: string }
  | { type: "join"; nick: string; channel: string; text: string }
  | { type: "part"; nick: string; channel: string; text: string }
  | { type: "userlist"; users: string[] }
  | { type: "persona"; nick: string; color: string };

// Chat log entry
interface ChatLogEntry {
  ts: string;
  channel: string;
  nick: string;
  type: "message" | "system";
  text: string;
}

// ---------------------------------------------------------------------------
// Default personas (used when none are passed via options)
// ---------------------------------------------------------------------------

const DEFAULT_PERSONAS: ChatPersona[] = [
  {
    id: "schaeffer",
    nick: "Schaeffer",
    model: "qwen2.5:14b",
    systemPrompt:
      "Tu es Schaeffer, un agent d'ecoute structuree inspire de Pierre Schaeffer. " +
      "Tu analyses la matiere sonore des mots, tu reponds de maniere precise et musicale. " +
      "Reponds en francais, de facon concise.",
    color: "#4fc3f7",
  },
  {
    id: "batty",
    nick: "Batty",
    model: "mistral:7b",
    systemPrompt:
      "Tu es Batty, un agent d'intensite lyrique inspire de Roy Batty. " +
      "Tu reponds avec urgence et tension poetique. Tes phrases sont courtes et percutantes. " +
      "Reponds en francais.",
    color: "#ef5350",
  },
  {
    id: "radigue",
    nick: "Radigue",
    model: "qwen2.5:14b",
    systemPrompt:
      "Tu es Radigue, un agent contemplatif inspire d'Eliane Radigue. " +
      "Tu reponds lentement, avec precision et profondeur. Tu privilegies le silence et l'ecoute. " +
      "Reponds en francais, de facon minimale.",
    color: "#ab47bc",
  },
];

// ---------------------------------------------------------------------------
// Deterministic color palette for personas loaded from DB
// ---------------------------------------------------------------------------

const PERSONA_COLORS = [
  "#4fc3f7", "#ef5350", "#ab47bc", "#66bb6a", "#ffa726",
  "#26c6da", "#ec407a", "#7e57c2", "#9ccc65", "#ffca28",
  "#42a5f5", "#ff7043", "#5c6bc0", "#8d6e63", "#78909c",
];

function personaColor(id: string, index: number): string {
  // Simple hash-based color assignment
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PERSONA_COLORS[Math.abs(hash) % PERSONA_COLORS.length] || PERSONA_COLORS[index % PERSONA_COLORS.length];
}

// ---------------------------------------------------------------------------
// Chat logging (JSONL)
// ---------------------------------------------------------------------------

const CHAT_LOG_DIR = path.resolve(process.cwd(), "data/chat-logs");

function ensureLogDir(): void {
  fs.mkdirSync(CHAT_LOG_DIR, { recursive: true });
}

function logFilePath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(CHAT_LOG_DIR, `v2-${date}.jsonl`);
}

function logChatMessage(entry: ChatLogEntry): void {
  try {
    ensureLogDir();
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(logFilePath(), line, "utf8");
  } catch (err) {
    console.error("[ws-chat] Failed to log chat message:", err instanceof Error ? err.message : String(err));
  }
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
    ws.send(JSON.stringify(msg));
  }
}

// ---------------------------------------------------------------------------
// Ollama streaming chat
// ---------------------------------------------------------------------------

async function streamOllamaChat(
  ollamaUrl: string,
  persona: ChatPersona,
  userMessage: string,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60_000);

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: persona.model,
        messages: [
          { role: "system", content: persona.systemPrompt },
          { role: "user", content: userMessage },
        ],
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body from Ollama");
    }

    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Ollama streams newline-delimited JSON
      const lines = chunk.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          if (parsed.message?.content) {
            fullText += parsed.message.content;
            onChunk(parsed.message.content);
          }
        } catch {
          // Partial JSON — skip
        }
      }
    }

    onDone(fullText);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Image analysis via Ollama vision
// ---------------------------------------------------------------------------

async function analyzeImage(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  ollamaUrl: string,
): Promise<string> {
  const base64 = buffer.toString("base64");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60_000);

  try {
    const visionModel = process.env.VISION_MODEL || "minicpm-v";
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: visionModel,
        messages: [
          {
            role: "user",
            content:
              "Analyse cette image en détail. Décris ce que tu vois, le contexte, " +
              "et tout élément notable. Réponds en français.",
            images: [base64],
          },
        ],
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return `[Image: ${filename} — analyse échouée: ${response.status}]`;
    }

    const result = (await response.json()) as {
      message?: { content?: string };
    };
    const caption = result.message?.content || "Pas de description disponible";
    return `[Image: ${filename}]\n${caption}`;
  } catch (err) {
    return `[Image: ${filename} — erreur d'analyse: ${err instanceof Error ? err.message : String(err)}]`;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function attachWebSocketChat(server: http.Server, options: ChatOptions): WebSocketServer {
  const {
    ollamaUrl,
    loadPersonas,
    maxGeneralResponders = 2,
  } = options;

  // Mutable personas list — refreshed from DB periodically
  let personas: ChatPersona[] = [...DEFAULT_PERSONAS];

  async function refreshPersonas(): Promise<void> {
    if (!loadPersonas) return;

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
      }));

      console.log(`[ws-chat] Refreshed personas: ${personas.map((p) => p.nick).join(", ")}`);
    } catch (err) {
      console.error("[ws-chat] Failed to refresh personas, keeping current list:", err instanceof Error ? err.message : String(err));
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

  function broadcastAll(msg: OutboundMessage): void {
    for (const [ws] of clients) {
      send(ws, msg);
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

  // --- pick personas for #general ---

  function pickResponders(text: string): ChatPersona[] {
    // Check for direct @mention
    const mentioned = personas.filter((p) =>
      text.toLowerCase().includes(`@${p.nick.toLowerCase()}`),
    );
    if (mentioned.length > 0) return mentioned;

    // Pick random subset up to maxGeneralResponders
    const shuffled = [...personas].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(maxGeneralResponders, shuffled.length));
  }

  // --- handle slash commands ---

  function handleCommand(ws: WebSocket, info: ClientInfo, text: string): void {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    switch (cmd) {
      case "/help":
        send(ws, {
          type: "system",
          text: [
            "=== Commandes disponibles ===",
            "/help       — affiche cette aide",
            "/nick <nom> — change ton pseudo",
            "/who        — liste les utilisateurs connectes",
            "/personas   — liste les personas actives",
            `Mentionne un persona avec @Nom pour lui parler directement.`,
          ].join("\n"),
        });
        break;

      case "/nick": {
        const newNick = parts[1];
        if (!newNick || newNick.length < 2 || newNick.length > 24) {
          send(ws, { type: "system", text: "Usage: /nick <nom> (2-24 caracteres)" });
          return;
        }
        // Check for nick collision
        for (const [, other] of clients) {
          if (other.nick.toLowerCase() === newNick.toLowerCase() && other !== info) {
            send(ws, { type: "system", text: `Le pseudo "${newNick}" est deja utilise.` });
            return;
          }
        }
        const oldNick = info.nick;
        info.nick = newNick;
        broadcast(info.channel, {
          type: "system",
          text: `${oldNick} est maintenant connu(e) comme ${newNick}`,
        });
        broadcastUserlist(info.channel);
        break;
      }

      case "/who":
        send(ws, {
          type: "userlist",
          users: channelUsers(info.channel),
        });
        break;

      case "/personas":
        send(ws, {
          type: "system",
          text: personas
            .map((p) => `  ${p.nick} (${p.model}) — ${p.systemPrompt.slice(0, 60)}...`)
            .join("\n"),
        });
        break;

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
    }
  }

  // --- route text to personas (shared by chat messages and uploads) ---

  async function routeToPersonas(channel: string, text: string): Promise<void> {
    const responders = pickResponders(text);

    for (const persona of responders) {
      // Send a typing indicator
      broadcast(channel, {
        type: "system",
        text: `${persona.nick} est en train d'ecrire...`,
      });

      let accumulated = "";

      await streamOllamaChat(
        ollamaUrl,
        persona,
        text,
        (chunk) => {
          accumulated += chunk;
          // Send streamed chunks — buffer ~100 chars to avoid flooding
          // We send the full accumulated text each time (frontend can replace)
        },
        (fullText) => {
          broadcast(channel, {
            type: "message",
            nick: persona.nick,
            text: fullText,
            color: persona.color,
          });

          // Log persona response
          logChatMessage({
            ts: new Date().toISOString(),
            channel,
            nick: persona.nick,
            type: "message",
            text: fullText,
          });
        },
        (err) => {
          console.error(`[ws-chat] Ollama error for ${persona.nick}:`, err.message);
          broadcast(channel, {
            type: "system",
            text: `${persona.nick}: erreur Ollama — ${err.message}`,
          });
        },
      );
    }
  }

  // --- handle chat message ---

  async function handleChatMessage(ws: WebSocket, info: ClientInfo, text: string): Promise<void> {
    // Echo user message to all clients in channel
    broadcast(info.channel, {
      type: "message",
      nick: info.nick,
      text,
      color: "#e0e0e0",
    });

    // Log user message
    logChatMessage({
      ts: new Date().toISOString(),
      channel: info.channel,
      nick: info.nick,
      type: "message",
      text,
    });

    await routeToPersonas(info.channel, text);
  }

  // --- handle file upload ---

  async function handleUpload(ws: WebSocket, info: ClientInfo, parsed: InboundUpload): Promise<void> {
    const filename = typeof parsed.filename === "string" ? parsed.filename : "unknown";
    const mimeType = typeof parsed.mimeType === "string" ? parsed.mimeType : "";
    const dataB64 = typeof parsed.data === "string" ? parsed.data : "";
    const size = typeof parsed.size === "number" ? parsed.size : 0;

    if (!dataB64 || size > 12 * 1024 * 1024) {
      send(ws, { type: "system", text: "Upload rejeté (vide ou > 12 MB)." });
      return;
    }

    const buffer = Buffer.from(dataB64, "base64");

    // Broadcast upload notification
    broadcast(info.channel, {
      type: "system",
      text: `${info.nick} a envoyé: ${filename} (${(size / 1024).toFixed(1)} KB)`,
    });

    // Log upload event
    logChatMessage({
      ts: new Date().toISOString(),
      channel: info.channel,
      nick: info.nick,
      type: "message",
      text: `[upload: ${filename}, ${(size / 1024).toFixed(1)} KB]`,
    });

    // Analyze file based on MIME type
    let analysis = "";

    if (
      mimeType.startsWith("text/") ||
      mimeType === "application/json" ||
      filename.endsWith(".csv") ||
      filename.endsWith(".jsonl")
    ) {
      const text = buffer.toString("utf-8").slice(0, 12000);
      analysis = `[Fichier texte: ${filename}]\n${text}`;
    } else if (mimeType.startsWith("image/")) {
      analysis = await analyzeImage(buffer, mimeType, filename, ollamaUrl);
    } else if (mimeType === "application/pdf") {
      try {
        const pdfParse = (await import("pdf-parse")).default;
        const pdfData = await pdfParse(buffer);
        const text = pdfData.text.slice(0, 12000);
        const pages = pdfData.numpages;
        analysis = `[PDF: ${filename}, ${pages} page(s)]\n${text}`;
      } catch (err) {
        analysis = `[PDF: ${filename} — extraction échouée: ${err instanceof Error ? err.message : String(err)}]`;
      }
    } else {
      analysis = `[Fichier: ${filename}, type: ${mimeType}, ${(size / 1024).toFixed(0)} KB]`;
    }

    if (analysis) {
      const contextMessage =
        `[L'utilisateur ${info.nick} a partagé un fichier: ${filename}]\n${analysis}\n\nAnalyse ce fichier et donne ton avis.`;

      await routeToPersonas(info.channel, contextMessage);
    }
  }

  // --- connection handler ---

  wss.on("connection", (ws: WebSocket) => {
    const nick = generateNick();
    const info: ClientInfo = {
      nick,
      channel: "#general",
      connectedAt: Date.now(),
      messageTimestamps: [],
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
        await handleUpload(ws, info, message as InboundUpload);
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
        handleCommand(ws, info, text);
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

  console.log(`[ws-chat] WebSocket chat attached on /ws (Ollama: ${ollamaUrl})`);
  return wss;
}
