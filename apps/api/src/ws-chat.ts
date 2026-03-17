import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocketServer, WebSocket } from "ws";
import { generateImage } from "./comfyui.js";
import { searchWeb } from "./web-search.js";
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

const execFileAsync = promisify(execFile);

// PDF extraction now handled by scripts/extract_pdf_docling.py (Docling / PyMuPDF fallback)

// TTS concurrency semaphore (P2-02)
let ttsActive = 0;
const MAX_TTS_CONCURRENT = 2;

// File processing concurrency semaphore (P2-10)
let fileProcessActive = 0;
const MAX_FILE_PROCESSORS = 2;

async function acquireFileProcessor(): Promise<void> {
  while (fileProcessActive >= MAX_FILE_PROCESSORS) {
    await new Promise(r => setTimeout(r, 100));
  }
  fileProcessActive++;
}
function releaseFileProcessor(): void { fileProcessActive--; }

// Simple semaphore for Ollama concurrency
const MAX_OLLAMA_CONCURRENT = Number(process.env.MAX_OLLAMA_CONCURRENT) || 3;
let ollamaActive = 0;
const ollamaQueue: Array<() => void> = [];

async function acquireOllama(): Promise<void> {
  if (ollamaActive < MAX_OLLAMA_CONCURRENT) {
    ollamaActive++;
    return;
  }
  return new Promise<void>(resolve => {
    ollamaQueue.push(() => { ollamaActive++; resolve(); });
  });
}

function releaseOllama(): void {
  ollamaActive--;
  const next = ollamaQueue.shift();
  if (next) next();
}

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
// Persona memory (persistent, file-based)
// ---------------------------------------------------------------------------

const PERSONA_MEMORY_DIR = path.resolve(process.cwd(), "data/persona-memory");

async function loadPersonaMemory(nick: string): Promise<PersonaMemory> {
  const memPath = path.join(PERSONA_MEMORY_DIR, `${nick}.json`);
  try {
    const data = await fs.promises.readFile(memPath, "utf-8");
    return JSON.parse(data) as PersonaMemory;
  } catch { /* missing or corrupted file — start fresh */ }
  return { nick, facts: [], summary: "", lastUpdated: "" };
}

async function savePersonaMemory(memory: PersonaMemory): Promise<void> {
  await fs.promises.mkdir(PERSONA_MEMORY_DIR, { recursive: true });
  memory.lastUpdated = new Date().toISOString();
  await fs.promises.writeFile(
    path.join(PERSONA_MEMORY_DIR, `${memory.nick}.json`),
    JSON.stringify(memory, null, 2),
  );
}

async function updatePersonaMemory(
  persona: ChatPersona,
  recentMessages: string[],
  ollamaUrl: string,
): Promise<void> {
  const memory = await loadPersonaMemory(persona.nick);

  const prompt =
    `Tu es ${persona.nick}. Voici les derniers échanges:\n${recentMessages.join("\n")}\n\n` +
    `Extrais 2-3 faits importants à retenir sur l'utilisateur ou le sujet. ` +
    `Réponds en JSON: {"facts": ["fait1", "fait2"], "summary": "résumé en une phrase"}`;

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: persona.model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        format: "json",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const data = (await response.json()) as { message?: { content?: string } };
    const extracted = JSON.parse(data.message?.content || "{}") as {
      facts?: string[];
      summary?: string;
    };

    if (extracted.facts && Array.isArray(extracted.facts)) {
      const allFacts = [...new Set([...memory.facts, ...extracted.facts])].slice(-20);
      memory.facts = allFacts;
    }
    if (extracted.summary) {
      memory.summary = extracted.summary;
    }

    await savePersonaMemory(memory);
  } catch (err) {
    console.error(
      `[ws-chat] Memory update failed for ${persona.nick}:`,
      err instanceof Error ? err.message : String(err),
    );
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
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* connection closed between check and send */ }
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
  await acquireOllama();
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
    releaseOllama();
  }
}

// ---------------------------------------------------------------------------
// TTS synthesis (Piper TTS via Python script)
// ---------------------------------------------------------------------------

async function synthesizeTTS(
  nick: string,
  text: string,
  channel: string,
  broadcastFn: (channel: string, msg: OutboundMessage) => void,
): Promise<void> {
  if (!text || text.length < 10) return; // skip very short texts

  const truncated = text.slice(0, 1000); // limit TTS to ~1000 chars
  const outputPath = `/tmp/kxkm-tts-${Date.now()}.wav`;
  const pythonBin = process.env.PYTHON_BIN || "/home/kxkm/venv/bin/python3";
  const scriptsDir = process.env.SCRIPTS_DIR || path.join(process.cwd(), "scripts");

  // Check for voice sample (XTTS-v2 cloning)
  const samplePath = path.resolve(process.cwd(), "data", "voice-samples", `${nick.toLowerCase()}.wav`);
  let useXtts = false;
  try {
    await fs.promises.access(samplePath);
    useXtts = true;
  } catch { /* no voice sample — use Piper fallback */ }

  try {
    let args: string[];
    if (useXtts) {
      args = [
        path.resolve(scriptsDir, "xtts_clone.py"),
        "--text", truncated,
        "--speaker-wav", samplePath,
        "--output", outputPath,
      ];
    } else {
      args = [
        path.resolve(scriptsDir, "tts_synthesize.py"),
        "--text", truncated,
        "--voice", nick,
        "--output", outputPath,
      ];
    }

    const { stdout } = await execFileAsync(pythonBin, args, { timeout: 60_000 });

    const result = JSON.parse(stdout.trim().split("\n").pop() || "{}") as {
      status?: string;
      error?: string;
    };

    if (result.status === "completed" && fs.existsSync(outputPath)) {
      const audioBuffer = fs.readFileSync(outputPath);
      const base64 = audioBuffer.toString("base64");

      // Broadcast audio to channel
      broadcastFn(channel, { type: "audio", nick, data: base64, mimeType: "audio/wav" });
    }
  } catch (err) {
    // TTS failure is non-critical, just log
    console.error(`[tts] Synthesis failed for ${nick}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try { fs.unlinkSync(outputPath); } catch { /* ignore cleanup errors */ }
  }
}

// ---------------------------------------------------------------------------
// Image analysis via Ollama vision
// ---------------------------------------------------------------------------

const OFFICE_EXTENSIONS = new Set([
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "odt", "ods", "odp", "rtf", "epub",
]);

const OFFICE_MIMES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/rtf",
  "application/epub+zip",
]);

function isOfficeDocument(filename: string, mimeType: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return OFFICE_EXTENSIONS.has(ext) || OFFICE_MIMES.has(mimeType);
}

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
    const visionModel = process.env.VISION_MODEL || "qwen3.5:9b";
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

      console.log(`[ws-chat] Refreshed personas: ${personas.map((p) => p.nick).join(", ")}`);
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

  // --- pick personas for #general ---

  function pickResponders(text: string, pool: ChatPersona[] = personas): ChatPersona[] {
    // Check for direct @mention — only mentioned personas respond
    const mentioned = pool.filter((p) =>
      text.toLowerCase().includes(`@${p.nick.toLowerCase()}`),
    );
    if (mentioned.length > 0) return mentioned;

    // Default: only Pharmacius responds (or first persona if Pharmacius not found)
    const defaultPersona = pool.find((p) => p.nick.toLowerCase() === "pharmacius");
    if (defaultPersona) return [defaultPersona];

    // Fallback: first persona in pool
    return pool.length > 0 ? [pool[0]] : [];
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

          if (stderr) console.log(`[compose] ${stderr.slice(-200)}`);

          const result = JSON.parse(stdout.trim().split("\n").pop() || "{}") as {
            status?: string;
            error?: string;
          };

          if (result.status === "completed" && fs.existsSync(outputPath)) {
            const audioBuffer = fs.readFileSync(outputPath);
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
            fs.unlinkSync(outputPath);
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

      try {
        await streamOllamaChat(
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
            if (process.env.TTS_ENABLED === "1" && ttsActive < MAX_TTS_CONCURRENT) {
              ttsActive++;
              synthesizeTTS(persona.nick, fullText, channel, broadcast)
                .catch((err) => {
                  console.error(`[tts] Error for ${persona.nick}: ${err}`);
                })
                .finally(() => { ttsActive--; });
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

  // --- handle file upload ---

  async function handleUpload(ws: WebSocket, info: ClientInfo, parsed: InboundUpload): Promise<void> {
    const filename = typeof parsed.filename === "string" ? parsed.filename : "unknown";
    const mimeType = typeof parsed.mimeType === "string" ? parsed.mimeType : "";
    const dataB64 = typeof parsed.data === "string" ? parsed.data : "";
    const size = typeof parsed.size === "number" ? parsed.size : 0;

    // Per-client upload rate limiting (50 MB/min)
    const now = Date.now();
    if (now - info.lastUploadReset > 60_000) {
      info.uploadBytesWindow = 0;
      info.lastUploadReset = now;
    }
    if (info.uploadBytesWindow + size > 50 * 1024 * 1024) {
      send(ws, { type: "system", text: "Upload rejeté — limite de débit dépassée (50 MB/min)" });
      return;
    }
    info.uploadBytesWindow += size;

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
      const text = buffer.slice(0, 12000).toString("utf-8");
      analysis = `[Fichier texte: ${filename}]\n${text}`;
    } else if (mimeType.startsWith("image/")) {
      analysis = await analyzeImage(buffer, mimeType, filename, ollamaUrl);
    } else if (mimeType.startsWith("audio/")) {
      // Transcribe audio via Whisper (faster-whisper or openai-whisper)
      const ext = filename.split(".").pop() || "wav";
      const tmpFile = path.join("/tmp", `kxkm-audio-${Date.now()}.${ext}`);

      try {
        fs.writeFileSync(tmpFile, buffer);
        const scriptPath = path.resolve(
          process.env.SCRIPTS_DIR || path.join(process.cwd(), "scripts"),
          "transcribe_audio.py",
        );
        const pythonBin = process.env.PYTHON_BIN || "python3";

        await acquireFileProcessor();
        try {
          const { stdout, stderr } = await execFileAsync(pythonBin, [
            scriptPath, "--input", tmpFile, "--language", "fr",
          ], { timeout: 120_000 });

          if (stderr) console.log(`[ws-chat][audio] ${stderr.trim().slice(-200)}`);

          // stdout may contain multiple lines; the JSON result is on the last line
          const lastLine = stdout.trim().split("\n").pop() || "{}";
          const result = JSON.parse(lastLine) as { status?: string; transcript?: string; error?: string };

          if (result.transcript) {
            analysis = `[Audio: ${filename}]\nTranscription: ${result.transcript}`;
          } else {
            analysis = `[Audio: ${filename} — transcription échouée: ${result.error || "unknown"}]`;
          }
        } finally {
          releaseFileProcessor();
        }
      } catch (err) {
        analysis = `[Audio: ${filename} — erreur: ${err instanceof Error ? err.message : String(err)}]`;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
      }
    } else if (mimeType === "application/pdf") {
      const tmpFile = path.join("/tmp", `kxkm-pdf-${Date.now()}.pdf`);
      try {
        fs.writeFileSync(tmpFile, buffer);
        await acquireFileProcessor();
        const pythonBin = process.env.PYTHON_BIN || "python3";
        const scriptPath = path.join(process.env.SCRIPTS_DIR || "scripts", "extract_pdf_docling.py");
        const { stdout, stderr } = await execFileAsync(pythonBin, [scriptPath, "--input", tmpFile], { timeout: 60_000 });
        releaseFileProcessor();
        if (stderr) console.log(`[upload] pdf: ${stderr.slice(-200)}`);
        const result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
        if (result.text) {
          analysis = `[PDF: ${filename}, ${result.pages || "?"} page(s)]\n${result.text}`;
        } else {
          analysis = `[PDF: ${filename} — extraction échouée: ${result.error || "unknown"}]`;
        }
      } catch (err) {
        releaseFileProcessor();
        analysis = `[PDF: ${filename} — erreur: ${err instanceof Error ? err.message : String(err)}]`;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    } else if (isOfficeDocument(filename, mimeType)) {
      // Word, Excel, PowerPoint, LibreOffice, RTF, EPUB
      const ext = filename.split(".").pop() || "";
      const tmpFile = path.join("/tmp", `kxkm-doc-${Date.now()}.${ext}`);
      try {
        fs.writeFileSync(tmpFile, buffer);
        const pythonBin = process.env.PYTHON_BIN || "python3";
        const scriptPath = path.join(process.env.SCRIPTS_DIR || "scripts", "extract_document.py");
        await acquireFileProcessor();
        try {
          const { stdout, stderr } = await execFileAsync(pythonBin, [
            scriptPath, "--input", tmpFile,
          ], { timeout: 60_000 });
          if (stderr) console.log(`[upload] doc extract: ${stderr.slice(-200)}`);
          const jsonLine = stdout.trim().split("\n").pop() || "{}";
          const result = JSON.parse(jsonLine);
          if (result.text) {
            analysis = `[Document ${ext.toUpperCase()}: ${filename}]\n${result.text}`;
          } else {
            analysis = `[Document: ${filename} — extraction échouée: ${result.error || "unknown"}]`;
          }
        } finally {
          releaseFileProcessor();
        }
      } catch (err) {
        analysis = `[Document: ${filename} — erreur: ${err instanceof Error ? err.message : String(err)}]`;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
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

  console.log(`[ws-chat] WebSocket chat attached on /ws (Ollama: ${ollamaUrl})`);
  return wss;
}
