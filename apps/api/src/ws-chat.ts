import http from "node:http";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocketServer, WebSocket } from "ws";
import { generateImage } from "./comfyui.js";
import { searchWeb } from "./web-search.js";
import { getToolsForPersona, type ToolDefinition } from "./mcp-tools.js";

const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";
import { DEFAULT_PERSONAS, personaColor } from "./personas-default.js";
import type {
  ChatPersona,
  ClientInfo,
  ChatOptions,
  InboundMessage,
  InboundChatMessage,
  InboundUpload,
  OutboundMessage,
  ChatLogEntry,
  PersonaMemory,
} from "./chat-types.js";

// --- Extracted modules ---
import { streamOllamaChat, streamOllamaChatWithTools } from "./ws-ollama.js";
import {
  acquireFileProcessor,
  releaseFileProcessor,
  synthesizeTTS,
  isTTSAvailable,
  acquireTTS,
  releaseTTS,
  isOfficeDocument,
  analyzeImage,
} from "./ws-multimodal.js";
import {
  loadPersonaMemory,
  updatePersonaMemory,
  pickResponders,
} from "./ws-persona-router.js";

const execFileAsync = promisify(execFile);

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
      }));

      // Clean up maps for removed personas (P0-02)
      const currentNicks = new Set(personas.map(p => p.nick));
      for (const [nick] of personaMessageCounts) {
        if (!currentNicks.has(nick)) {
          personaMessageCounts.delete(nick);
          personaRecentMessages.delete(nick);
          personaMemoryLocks.delete(nick);
        }
      }

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

  // Persona memory: message counters and recent message buffers
  const personaMessageCounts = new Map<string, number>();
  const personaRecentMessages = new Map<string, string[]>();
  const personaMemoryLocks = new Map<string, Promise<void>>();

  function trackPersonaMessage(nick: string, text: string): void {
    const count = (personaMessageCounts.get(nick) || 0) + 1;
    personaMessageCounts.set(nick, count);

    const recent = personaRecentMessages.get(nick) || [];
    recent.push(text);
    // Keep last 10 messages for context
    if (recent.length > 10) recent.shift();
    personaRecentMessages.set(nick, recent);
  }

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

  // --- handle slash commands ---

  async function handleCommand(ws: WebSocket, info: ClientInfo, text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    switch (cmd) {
      case "/help":
        send(ws, {
          type: "system",
          text: [
            "=== Commandes disponibles ===",
            "/help            — affiche cette aide",
            "/nick <nom>      — change ton pseudo",
            "/join #canal     — rejoindre un canal",
            "/channels        — liste les canaux actifs",
            "/who             — liste les utilisateurs connectes",
            "/personas        — liste les personas actives",
            "/web <recherche> — recherche sur le web",
            "/imagine <desc>  — genere une image via ComfyUI",
            "/compose <desc>  — genere de la musique via ACE-Step",
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

      case "/web": {
        const query = text.slice(4).trim();
        if (!query) {
          send(ws, { type: "system", text: "Usage: /web <recherche>" });
          break;
        }
        send(ws, { type: "system", text: `Recherche: ${query}...` });

        try {
          const results = await searchWeb(query);
          broadcast(info.channel, {
            type: "system",
            text: `Résultats pour "${query}":\n${results}`,
          });
          // Route to personas for commentary
          await routeToPersonas(
            info.channel,
            `L'utilisateur a cherché "${query}" sur le web. Résultats:\n${results}\n\nCommente ces résultats.`,
          );
        } catch (err) {
          send(ws, {
            type: "system",
            text: `Recherche échouée: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        break;
      }

      case "/join": {
        const newChannel = parts[1] || "";
        if (!newChannel.startsWith("#") || newChannel.length < 2 || newChannel.length > 30) {
          send(ws, { type: "system", text: "Usage: /join #nom-du-canal (2-30 chars, commence par #)" });
          break;
        }
        // Sanitize: only alphanumeric, hyphens, underscores
        if (!/^#[a-zA-Z0-9_-]+$/.test(newChannel)) {
          send(ws, { type: "system", text: "Nom de canal invalide (lettres, chiffres, - et _ uniquement)" });
          break;
        }
        const oldChannel = info.channel;
        info.channel = newChannel;

        // Notify old channel
        broadcast(oldChannel, { type: "part", nick: info.nick, channel: oldChannel, text: `${info.nick} a quitte ${oldChannel}` });
        broadcastUserlist(oldChannel);

        // Notify new channel
        broadcast(newChannel, { type: "join", nick: info.nick, channel: newChannel, text: `${info.nick} a rejoint ${newChannel}` });
        broadcastUserlist(newChannel);

        // Send channel info to user
        send(ws, { type: "channelInfo", channel: newChannel });
        send(ws, { type: "system", text: `Canal change: ${newChannel}` });
        break;
      }

      case "/channels": {
        const channelCounts = new Map<string, number>();
        for (const [, client] of clients) {
          const count = channelCounts.get(client.channel) || 0;
          channelCounts.set(client.channel, count + 1);
        }
        const list = [...channelCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([ch, count]) => `  ${ch} (${count} connecte${count > 1 ? "s" : ""})`)
          .join("\n");
        send(ws, { type: "system", text: `Canaux actifs:\n${list || "  (aucun)"}` });
        break;
      }

      case "/compose": {
        const musicPrompt = text.slice(9).trim();
        if (!musicPrompt) {
          send(ws, { type: "system", text: "Usage: /compose <description musicale>" });
          break;
        }

        broadcast(info.channel, {
          type: "system",
          text: `${info.nick} compose: "${musicPrompt}"...`,
        });

        try {
          const outputPath = `/tmp/kxkm-music-${Date.now()}.wav`;
          const pythonBin = process.env.PYTHON_BIN || "python3";
          const scriptPath = path.resolve(
            process.env.SCRIPTS_DIR || path.join(process.cwd(), "scripts"),
            "compose_music.py",
          );

          const { stdout, stderr } = await execFileAsync(pythonBin, [
            scriptPath, "--prompt", musicPrompt, "--duration", "30", "--output", outputPath,
          ], { timeout: 300_000, maxBuffer: 50 * 1024 * 1024 });

          if (stderr && DEBUG) console.log(`[compose] ${stderr.slice(-200)}`);

          let result: { status?: string; error?: string } = {};
          try {
            result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
          } catch (parseErr) {
            console.error("[compose] Failed to parse JSON output:", parseErr);
          }

          if (result.status === "completed") {
            const audioBuffer = await fsp.readFile(outputPath);
            const base64 = audioBuffer.toString("base64");

            broadcast(info.channel, {
              type: "music",
              nick: info.nick,
              text: `[Musique: "${musicPrompt}"]`,
              audioData: base64,
              audioMime: "audio/wav",
            } as any);

            logChatMessage({
              ts: new Date().toISOString(),
              channel: info.channel,
              nick: info.nick,
              type: "system",
              text: `[Musique generee: "${musicPrompt}"]`,
            });
            fsp.unlink(outputPath).catch(() => {});
          } else {
            send(ws, { type: "system", text: `Composition echouee: ${result.error || "unknown"}` });
          }
        } catch (err) {
          send(ws, {
            type: "system",
            text: `Erreur composition: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        break;
      }

      case "/imagine": {
        const imagePrompt = text.slice(9).trim();
        if (!imagePrompt) {
          send(ws, { type: "system", text: "Usage: /imagine <description de l'image>" });
          break;
        }

        broadcast(info.channel, {
          type: "system",
          text: `${info.nick} genere une image: "${imagePrompt}"...`,
        });

        try {
          const result = await generateImage(imagePrompt);
          if (result) {
            broadcast(info.channel, {
              type: "image",
              nick: info.nick,
              text: `[Image generee: "${imagePrompt}" seed:${result.seed}]`,
              imageData: result.imageBase64,
              imageMime: "image/png",
            });

            logChatMessage({
              ts: new Date().toISOString(),
              channel: info.channel,
              nick: info.nick,
              type: "system",
              text: `[Image generee: "${imagePrompt}"]`,
            });
          } else {
            send(ws, { type: "system", text: "Generation echouee — verifiez ComfyUI" });
          }
        } catch (err) {
          send(ws, {
            type: "system",
            text: `Erreur ComfyUI: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        break;
      }

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
    }
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
      return await contextStore.getContext(channel, 6000);
    } catch { return ""; }
  }

  // --- route text to personas (shared by chat messages and uploads) ---

  const MAX_INTER_PERSONA_DEPTH = 3;

  async function routeToPersonas(channel: string, text: string, depth: number = 0): Promise<void> {
    const personasSnapshot = [...personas];
    const responders = pickResponders(text, personasSnapshot);

    // RAG: enrich user message with relevant context from indexed documents
    let enrichedText = text;

    // Add persistent conversation context (with auto-compaction)
    const contextStr = await getContextString(channel);
    if (contextStr) enrichedText = text + "\n\n" + contextStr;
    if (rag && rag.size > 0) {
      try {
        const results = await rag.search(text, 2);
        if (results.length > 0) {
          const ragContext = results.map((r) => r.text).join("\n---\n");
          enrichedText = text + "\n\n[Contexte pertinent]\n" + ragContext;
        }
      } catch {
        // Ignore RAG errors — fall back to plain message
      }
    }

    for (const persona of responders) {
      // Send a typing indicator
      broadcast(channel, {
        type: "system",
        text: `${persona.nick} est en train d'ecrire...`,
      });

      // Enrich persona with memory context
      const memory = await loadPersonaMemory(persona.nick);
      let personaWithMemory = persona;
      if (memory.facts.length > 0 || memory.summary) {
        const memoryBlock = [
          "\n\n[Mémoire]",
          memory.facts.length > 0 ? `Faits retenus: ${memory.facts.join(", ")}` : "",
          memory.summary ? `Résumé: ${memory.summary}` : "",
        ].filter(Boolean).join("\n");

        personaWithMemory = {
          ...persona,
          systemPrompt: persona.systemPrompt + memoryBlock,
        };
      }

      let accumulated = "";

      // Get tools for this persona (MCP tool-calling)
      const personaTools = getToolsForPersona(persona.nick);

      // Choose streaming function based on tool availability
      const streamFn = personaTools.length > 0
        ? (
            url: string, p: ChatPersona, msg: string,
            onChunk: (t: string) => void, onDone: (t: string) => void, onErr: (e: Error) => void,
          ) => streamOllamaChatWithTools(url, p, msg, personaTools, rag, onChunk, onDone, onErr)
        : streamOllamaChat;

      try {
        await streamFn(
          ollamaUrl,
          personaWithMemory,
          enrichedText,
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

            // Add persona response to conversation context
            addToContext(channel, persona.nick, fullText);

            // Track message for memory updates
            trackPersonaMessage(persona.nick, `User: ${text}\n${persona.nick}: ${fullText}`);

            // Update memory every 5 messages (async, non-blocking, serialized per persona)
            const count = personaMessageCounts.get(persona.nick) || 0;
            if (count > 0 && count % 5 === 0) {
              const recentMessages = personaRecentMessages.get(persona.nick) || [];
              const lockKey = persona.nick;
              const prev = personaMemoryLocks.get(lockKey) || Promise.resolve();
              const next = prev.then(() => updatePersonaMemory(persona, recentMessages, ollamaUrl)).catch(err => {
                console.error(`[ws-chat] Memory update failed for ${persona.nick}:`, err);
              });
              personaMemoryLocks.set(lockKey, next);
            }

            // TTS synthesis (async, non-blocking, with concurrency limit)
            if (process.env.TTS_ENABLED === "1" && isTTSAvailable()) {
              acquireTTS();
              synthesizeTTS(persona.nick, fullText, channel, broadcast)
                .catch((err) => {
                  console.error(`[tts] Error for ${persona.nick}: ${err}`);
                })
                .finally(() => {
                  releaseTTS();
                });
            }

            // Inter-persona dialogue: check if persona mentioned another persona
            if (depth < MAX_INTER_PERSONA_DEPTH) {
              const mentionRegex = /@(\w+)/g;
              let mentionMatch: RegExpExecArray | null;
              const mentionedNicks = new Set<string>();

              while ((mentionMatch = mentionRegex.exec(fullText)) !== null) {
                const mentionedNick = mentionMatch[1];
                const mentionedPersona = personasSnapshot.find(
                  p => p.nick.toLowerCase() === mentionedNick.toLowerCase() && p.nick !== persona.nick
                );
                if (mentionedPersona && !mentionedNicks.has(mentionedPersona.nick)) {
                  mentionedNicks.add(mentionedPersona.nick);
                }
              }

              // Trigger mentioned personas to respond (max 1 per response to avoid flooding)
              if (mentionedNicks.size > 0) {
                const nextPersona = personasSnapshot.find(p => mentionedNicks.has(p.nick));
                if (nextPersona) {
                  setTimeout(async () => {
                    const contextMsg = `${persona.nick} a dit: "${fullText.slice(0, 500)}". @${nextPersona.nick}, réponds-lui.`;
                    try {
                      await routeToPersonas(channel, contextMsg, depth + 1);
                    } catch (err) {
                      console.error(`[ws-chat] Inter-persona error for ${nextPersona.nick}:`, err);
                    }
                  }, 2000);
                }
              }
            }
          },
          (err) => {
            console.error(`[ws-chat] Ollama error for ${persona.nick}:`, err.message);
            broadcast(channel, {
              type: "system",
              text: `${persona.nick}: erreur Ollama — ${err.message}`,
            });
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        broadcast(channel, { type: "system", text: `${persona.nick}: erreur de connexion` });
        console.error(`[ws-chat] Ollama error for ${persona.nick}:`, msg);
      }
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

  wss.on("connection", (ws: WebSocket) => {
    const nick = generateNick();
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
        await handleCommand(ws, info, text);
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
