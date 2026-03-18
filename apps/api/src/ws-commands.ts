import { promises as fsp } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WebSocket } from "ws";
import { generateImage } from "./comfyui.js";
import { searchWeb } from "./web-search.js";
import { saveImage, saveAudio } from "./media-store.js";
import type { ChatPersona, ClientInfo, OutboundMessage, ChatLogEntry } from "./chat-types.js";

const execFileAsync = promisify(execFile);
const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";

interface CommandContext {
  ws: WebSocket;
  info: ClientInfo;
  text: string;
}

interface CommandHandlerDeps {
  send: (ws: WebSocket, msg: OutboundMessage) => void;
  broadcast: (channel: string, msg: OutboundMessage, exclude?: WebSocket) => void;
  broadcastUserlist: (channel: string) => void;
  channelUsers: (channel: string) => string[];
  listConnectedNicks: () => string[];
  listChannelCounts: () => Map<string, number>;
  routeToPersonas: (channel: string, text: string) => Promise<void>;
  logChatMessage: (entry: ChatLogEntry) => void;
  getPersonas: () => ChatPersona[];
}

export function createCommandHandler(deps: CommandHandlerDeps) {
  const {
    send,
    broadcast,
    broadcastUserlist,
    channelUsers,
    listConnectedNicks,
    listChannelCounts,
    routeToPersonas,
    logChatMessage,
    getPersonas,
  } = deps;

  return async function handleCommand({ ws, info, text }: CommandContext): Promise<void> {
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
            "Mentionne un persona avec @Nom pour lui parler directement.",
          ].join("\n"),
        });
        return;

      case "/nick": {
        const newNick = parts[1];
        if (!newNick || newNick.length < 2 || newNick.length > 24) {
          send(ws, { type: "system", text: "Usage: /nick <nom> (2-24 caracteres)" });
          return;
        }
        const users = listConnectedNicks().map((nick) => nick.toLowerCase());
        if (users.includes(newNick.toLowerCase()) && info.nick.toLowerCase() !== newNick.toLowerCase()) {
          send(ws, { type: "system", text: `Le pseudo "${newNick}" est deja utilise.` });
          return;
        }
        const oldNick = info.nick;
        info.nick = newNick;
        broadcast(info.channel, {
          type: "system",
          text: `${oldNick} est maintenant connu(e) comme ${newNick}`,
        });
        broadcastUserlist(info.channel);
        return;
      }

      case "/who":
        send(ws, {
          type: "userlist",
          users: channelUsers(info.channel),
        });
        return;

      case "/personas":
        send(ws, {
          type: "system",
          text: getPersonas()
            .map((persona) => `  ${persona.nick} (${persona.model}) — ${persona.systemPrompt.slice(0, 60)}...`)
            .join("\n"),
        });
        return;

      case "/web": {
        const query = text.slice(4).trim();
        if (!query) {
          send(ws, { type: "system", text: "Usage: /web <recherche>" });
          return;
        }
        send(ws, { type: "system", text: `Recherche: ${query}...` });
        try {
          const results = await searchWeb(query);
          broadcast(info.channel, {
            type: "system",
            text: `Résultats pour "${query}":\n${results}`,
          });
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
        return;
      }

      case "/join": {
        const newChannel = parts[1] || "";
        if (!newChannel.startsWith("#") || newChannel.length < 2 || newChannel.length > 30) {
          send(ws, { type: "system", text: "Usage: /join #nom-du-canal (2-30 chars, commence par #)" });
          return;
        }
        if (!/^#[a-zA-Z0-9_-]+$/.test(newChannel)) {
          send(ws, { type: "system", text: "Nom de canal invalide (lettres, chiffres, - et _ uniquement)" });
          return;
        }
        const oldChannel = info.channel;
        info.channel = newChannel;
        broadcast(oldChannel, { type: "part", nick: info.nick, channel: oldChannel, text: `${info.nick} a quitte ${oldChannel}` });
        broadcastUserlist(oldChannel);
        broadcast(newChannel, { type: "join", nick: info.nick, channel: newChannel, text: `${info.nick} a rejoint ${newChannel}` });
        broadcastUserlist(newChannel);
        send(ws, { type: "channelInfo", channel: newChannel });
        send(ws, { type: "system", text: `Canal change: ${newChannel}` });
        return;
      }

      case "/channels": {
        const counts = listChannelCounts();
        const list = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([channel, count]) => `  ${channel} (${count} connecte${count > 1 ? "s" : ""})`)
          .join("\n");
        send(ws, { type: "system", text: `Canaux actifs:\n${list || "  (aucun)"}` });
        return;
      }

      case "/compose":
        await handleComposeCommand({ ws, info, text, broadcast, send, logChatMessage });
        return;

      case "/imagine":
        await handleImagineCommand({ ws, info, text, broadcast, send, logChatMessage });
        return;

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
    }
  };
}

async function handleComposeCommand({
  ws,
  info,
  text,
  broadcast,
  send,
  logChatMessage,
}: {
  ws: WebSocket;
  info: ClientInfo;
  text: string;
  broadcast: (channel: string, msg: OutboundMessage, exclude?: WebSocket) => void;
  send: (ws: WebSocket, msg: OutboundMessage) => void;
  logChatMessage: (entry: ChatLogEntry) => void;
}): Promise<void> {
  const musicPrompt = text.slice(9).trim();
  if (!musicPrompt) {
    send(ws, { type: "system", text: "Usage: /compose <description musicale>" });
    return;
  }

  broadcast(info.channel, {
    type: "system",
    text: `${info.nick} compose: "${musicPrompt}"...`,
  });

  const outputPath = `/tmp/kxkm-music-${Date.now()}.wav`;
  try {
    const pythonBin = process.env.PYTHON_BIN || "python3";
    const scriptPath = path.resolve(
      process.env.SCRIPTS_DIR || path.join(process.cwd(), "scripts"),
      "compose_music.py",
    );

    const { stdout, stderr } = await execFileAsync(pythonBin, [
      scriptPath,
      "--prompt",
      musicPrompt,
      "--duration",
      "30",
      "--output",
      outputPath,
    ], { timeout: 300_000, maxBuffer: 50 * 1024 * 1024 });

    if (stderr && DEBUG) {
      process.stdout.write(`[compose] ${stderr.slice(-200)}\n`);
    }

    let result: { status?: string; error?: string } = {};
    try {
      result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
    } catch (parseErr) {
      console.error("[compose] Failed to parse JSON output:", parseErr);
    }

    if (result.status === "completed") {
      const audioBuffer = await fsp.readFile(outputPath);
      const audioBase64 = audioBuffer.toString("base64");
      broadcast(info.channel, {
        type: "music",
        nick: info.nick,
        text: `[Musique: "${musicPrompt}"]`,
        audioData: audioBase64,
        audioMime: "audio/wav",
      } as OutboundMessage);

      // Persist to media store
      saveAudio({ base64: audioBase64, prompt: musicPrompt, nick: info.nick, channel: info.channel }).catch(() => {});

      logChatMessage({
        ts: new Date().toISOString(),
        channel: info.channel,
        nick: info.nick,
        type: "system",
        text: `[Musique generee: "${musicPrompt}"]`,
      });
      return;
    }

    send(ws, { type: "system", text: `Composition echouee: ${result.error || "unknown"}` });
  } catch (err) {
    send(ws, {
      type: "system",
      text: `Erreur composition: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    await fsp.unlink(outputPath).catch(() => undefined);
  }
}

async function handleImagineCommand({
  ws,
  info,
  text,
  broadcast,
  send,
  logChatMessage,
}: {
  ws: WebSocket;
  info: ClientInfo;
  text: string;
  broadcast: (channel: string, msg: OutboundMessage, exclude?: WebSocket) => void;
  send: (ws: WebSocket, msg: OutboundMessage) => void;
  logChatMessage: (entry: ChatLogEntry) => void;
}): Promise<void> {
  const imagePrompt = text.slice(9).trim();
  if (!imagePrompt) {
    send(ws, { type: "system", text: "Usage: /imagine <description de l'image>" });
    return;
  }

  broadcast(info.channel, {
    type: "system",
    text: `${info.nick} genere une image: "${imagePrompt}"...`,
  });

  try {
    const result = await generateImage(imagePrompt);
    if (!result) {
      send(ws, { type: "system", text: "Generation echouee — verifiez ComfyUI" });
      return;
    }

    broadcast(info.channel, {
      type: "image",
      nick: info.nick,
      text: `[Image generee: "${imagePrompt}" seed:${result.seed}]`,
      imageData: result.imageBase64,
      imageMime: "image/png",
    } as OutboundMessage);

    // Persist to media store
    saveImage({ base64: result.imageBase64, prompt: imagePrompt, nick: info.nick, channel: info.channel, seed: result.seed }).catch(() => {});

    logChatMessage({
      ts: new Date().toISOString(),
      channel: info.channel,
      nick: info.nick,
      type: "system",
      text: `[Image generee: "${imagePrompt}"]`,
    });
  } catch (err) {
    send(ws, {
      type: "system",
      text: `Erreur ComfyUI: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
