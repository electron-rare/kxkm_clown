import http from "node:http";
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
}

interface ChatOptions {
  ollamaUrl: string;
  personas?: ChatPersona[];
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

type InboundMessage = InboundChatMessage | InboundCommand;

// Outbound message types
type OutboundMessage =
  | { type: "message"; nick: string; text: string; color: string }
  | { type: "system"; text: string }
  | { type: "join"; nick: string; channel: string; text: string }
  | { type: "part"; nick: string; channel: string; text: string }
  | { type: "userlist"; users: string[] }
  | { type: "persona"; nick: string; color: string };

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
// Helpers
// ---------------------------------------------------------------------------

const MAX_WS_MESSAGE_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 8192;

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
// Main export
// ---------------------------------------------------------------------------

export function attachWebSocketChat(server: http.Server, options: ChatOptions): WebSocketServer {
  const {
    ollamaUrl,
    personas = DEFAULT_PERSONAS,
    maxGeneralResponders = 2,
  } = options;

  const wss = new WebSocketServer({ server, path: "/ws" });
  const clients = new Map<WebSocket, ClientInfo>();

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

  // --- handle chat message ---

  async function handleChatMessage(ws: WebSocket, info: ClientInfo, text: string): Promise<void> {
    // Echo user message to all clients in channel
    broadcast(info.channel, {
      type: "message",
      nick: info.nick,
      text,
      color: "#e0e0e0",
    });

    // Pick personas to respond
    const responders = pickResponders(text);

    for (const persona of responders) {
      // Send a typing indicator
      broadcast(info.channel, {
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
          broadcast(info.channel, {
            type: "message",
            nick: persona.nick,
            text: fullText,
            color: persona.color,
          });
        },
        (err) => {
          console.error(`[ws-chat] Ollama error for ${persona.nick}:`, err.message);
          broadcast(info.channel, {
            type: "system",
            text: `${persona.nick}: erreur Ollama — ${err.message}`,
          });
        },
      );
    }
  }

  // --- connection handler ---

  wss.on("connection", (ws: WebSocket) => {
    const nick = generateNick();
    const info: ClientInfo = {
      nick,
      channel: "#general",
      connectedAt: Date.now(),
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

      let message: InboundMessage;
      try {
        message = JSON.parse(raw.toString()) as InboundMessage;
      } catch {
        return;
      }

      if (!message || typeof message !== "object") return;
      if (typeof message.type !== "string") return;
      if (typeof message.text !== "string") return;
      if (message.text.length > MAX_TEXT_LENGTH) {
        send(ws, { type: "system", text: "Message trop long (max 8192 caracteres)." });
        return;
      }

      if (message.type === "command") {
        handleCommand(ws, info, message.text);
      } else if (message.type === "message") {
        await handleChatMessage(ws, info, message.text);
      }
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
