import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import type { CommandContext } from "./ws-commands-types.js";
import { scheduler, VRAM_BUDGETS } from "./inference-scheduler.js";
import { addTrack, createComposition, getActiveComposition, listCompositions, setActiveComposition } from "./composition-store.js";

const execFileAsync = promisify(execFile);

type OutboundMessage = import("./chat-types.js").OutboundMessage;
type ChatLogEntry = import("./chat-types.js").ChatLogEntry;
type WebSocket = import("ws").WebSocket;
type ClientInfo = import("./chat-types.js").ClientInfo;
type BroadcastFn = (channel: string, msg: OutboundMessage, exclude?: WebSocket) => void;
type SendFn = (ws: WebSocket, msg: OutboundMessage) => void;
type LogChatMessageFn = (entry: ChatLogEntry) => void;

function broadcastCompUpdate(broadcast: BroadcastFn, channel: string, compId: string, action: string, data?: Record<string, unknown>) {
  broadcast(channel, { type: "system", text: "__comp_update__" + JSON.stringify({ compId, action, ...data }) } as any);
}

export const COMPOSE_CORE_COMMANDS = new Set([
  "/comp",
  "/layer",
  "/mix",
  "/voice",
]);

export const COMPOSE_MANAGE_COMMANDS = new Set([
  "/tracks",
  "/undo",
  "/solo",
  "/unsolo",
  "/rename",
  "/duplicate",
  "/dup",
  "/bpm",
  "/clear-comp",
  "/preview",
  "/gain",
  "/loop",
  "/swap",
  "/info",
]);

export const COMPOSE_ADVANCED_COMMANDS = new Set([
  "/concat",
  "/silence",
  "/template",
  "/marker",
  "/metronome",
  "/delete",
  "/suggest",
  "/snapshot",
  "/randomize",
]);

export function createComposeCoreCommandHandler({
  send,
  broadcast,
  logChatMessage,
}: {
  send: SendFn;
  broadcast: BroadcastFn;
  logChatMessage: LogChatMessageFn;
}) {
  return async function handleComposeCoreCommand({ ws, info, text }: CommandContext): Promise<void> {
    const cmd = text.trim().split(/\s+/)[0]?.toLowerCase();

    switch (cmd) {
      case "/comp": {
        const sub = text.slice(6).trim().split(/\s+/);
        const action = sub[0] || "list";

        if (action === "new") {
          const name = sub.slice(1).join(" ") || undefined;
          const comp = createComposition(info.nick, info.channel, name);
          send(ws, { type: "system", text: `\u{1F3BC} Composition creee: ${comp.name} (${comp.id})\n  /layer <prompt> pour ajouter des pistes` });
          send(ws, { type: "system", text: "__comp_loaded__" + JSON.stringify({ compId: comp.id, name: comp.name, trackCount: 0 }) } as any);
          return;
        }

        if (action === "list") {
          const comps = listCompositions(info.nick);
          if (comps.length === 0) {
            send(ws, { type: "system", text: "Aucune composition. /comp new <nom>" });
            return;
          }
          send(ws, { type: "system", text: `Compositions:\n${comps.map((comp) => `  ${comp.id}: ${comp.name} (${comp.tracks.length} pistes)`).join("\n")}` });
          return;
        }

        if (action === "save") {
          const comp = getActiveComposition(info.nick, info.channel);
          if (!comp) {
            send(ws, { type: "system", text: "Pas de composition active." });
            return;
          }
          const dir = path.join(process.cwd(), "data", "compositions", comp.id);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, "composition.json"), JSON.stringify(comp, null, 2));
          send(ws, { type: "system", text: `💾 Composition sauvegardee: ${comp.name} (${comp.tracks.length} pistes)` });
          return;
        }

        if (action === "load") {
          const compId = sub[1];
          if (!compId) {
            send(ws, { type: "system", text: "Usage: /comp load <id>" });
            return;
          }
          const comp = setActiveComposition(info.nick, info.channel, compId);
          if (!comp) {
            send(ws, { type: "system", text: `Composition ${compId} introuvable.` });
            return;
          }
          send(ws, { type: "system", text: `📂 Composition chargee: ${comp.name} (${comp.tracks.length} pistes)` });
          send(ws, { type: "system", text: "__comp_loaded__" + JSON.stringify({ compId: comp.id, name: comp.name, trackCount: comp.tracks.length }) } as any);
          return;
        }

        if (action === "delete") {
          const compId = sub[1];
          if (!compId) {
            send(ws, { type: "system", text: "Usage: /comp delete <id>" });
            return;
          }
          const dir = path.join(process.cwd(), "data", "compositions", compId);
          if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true });
            send(ws, { type: "system", text: `🗑️ Composition ${compId} supprimee` });
          } else {
            send(ws, { type: "system", text: `Composition ${compId} introuvable.` });
          }
          return;
        }

        if (action === "rename") {
          const newName = sub.slice(1).join(" ");
          if (!newName) {
            send(ws, { type: "system", text: "Usage: /comp rename <nouveau nom>" });
            return;
          }
          const comp = getActiveComposition(info.nick, info.channel);
          if (!comp) {
            send(ws, { type: "system", text: "Pas de composition active." });
            return;
          }
          comp.name = newName;
          send(ws, { type: "system", text: `Composition renommee: ${newName}` });
          return;
        }

        send(ws, { type: "system", text: "Usage: /comp new|list|save|load|delete|rename" });
        return;
      }

      case "/layer": {
        const layerPrompt = text.slice(7).trim();
        if (!layerPrompt) {
          send(ws, { type: "system", text: "Usage: /layer <description musicale>. Cree d'abord: /comp new" });
          return;
        }

        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          comp = createComposition(info.nick, info.channel);
          send(ws, { type: "system", text: `\u{1F3BC} Composition auto-creee: ${comp.name}` });
        }

        const durMatch = layerPrompt.match(/(\d+)s\s*$/);
        const duration = durMatch ? Math.min(Math.max(parseInt(durMatch[1], 10), 5), 120) : 30;
        const prompt = durMatch ? layerPrompt.replace(/,?\s*\d+s\s*$/, "").trim() : layerPrompt;

        broadcast(info.channel, { type: "system", text: `\u{1F3B5} ${info.nick} ajoute une piste: "${prompt}" (${duration}s)...` });

        const ttsUrl = process.env.TTS_URL || "http://127.0.0.1:9100";
        try {
          const audioBuffer = await scheduler.submit({
            id: crypto.randomUUID(),
            device: "gpu",
            priority: "normal",
            label: `/layer "${prompt}" ${duration}s`,
            vramMB: VRAM_BUDGETS.musicgen,
            execute: async () => {
              const resp = await fetch(`${ttsUrl}/compose`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt, duration }),
                signal: AbortSignal.timeout(300_000),
              });
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              return Buffer.from(await resp.arrayBuffer());
            },
          });

          const track = addTrack(comp.id, { type: "music", prompt, duration, volume: 100, startMs: 0 });
          if (track) {
            const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
            fs.mkdirSync(trackDir, { recursive: true });
            const trackPath = path.join(trackDir, `${track.id}.wav`);
            fs.writeFileSync(trackPath, audioBuffer);
            track.filePath = trackPath;
          }

          broadcast(info.channel, {
            type: "music",
            nick: info.nick,
            text: `[Layer: "${prompt}" — piste ${comp.tracks.length}/${comp.name}]`,
            audioData: audioBuffer.toString("base64"),
            audioMime: "audio/wav",
          } as any);

          send(ws, { type: "system", text: `\u2705 Piste ajoutee (${comp.tracks.length} total). /mix pour mixer.` });
          broadcastCompUpdate(broadcast, info.channel, comp.id, "track_added", { trackCount: comp.tracks.length });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur layer: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/mix": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || comp.tracks.length === 0) {
          send(ws, { type: "system", text: "Aucune piste a mixer. /layer d'abord." });
          return;
        }

        broadcast(info.channel, { type: "system", text: `\u{1F39B}\uFE0F Mixage de ${comp.tracks.length} pistes...` });
        const outPath = path.join(process.cwd(), "data", "compositions", comp.id, "mix.wav");

        try {
          const inputs = comp.tracks.filter((track) => track.filePath && fs.existsSync(track.filePath));

          if (inputs.length === 1) {
            fs.copyFileSync(inputs[0].filePath!, outPath);
          } else {
            const ffmpegArgs: string[] = [];
            const filterParts: string[] = [];

            inputs.forEach((track, index) => {
              const offsetSec = (track.startMs || 0) / 1000;
              if (offsetSec > 0) {
                ffmpegArgs.push("-itsoffset", String(offsetSec));
              }
              ffmpegArgs.push("-i", track.filePath!);
              const volume = (track.volume ?? 100) / 100;
              filterParts.push(`[${index}]aformat=sample_rates=44100:channel_layouts=stereo,volume=${volume}[a${index}]`);
            });

            const mixInputs = inputs.map((_, index) => `[a${index}]`).join("");
            filterParts.push(`${mixInputs}amix=inputs=${inputs.length}:duration=longest:dropout_transition=2[out]`);
            ffmpegArgs.push("-filter_complex", filterParts.join(";"));
            ffmpegArgs.push("-map", "[out]", "-ar", "44100", "-ac", "2", "-y", outPath);
            await execFileAsync("ffmpeg", ffmpegArgs, { timeout: 60000 });
          }

          const mixBuffer = fs.readFileSync(outPath);
          broadcast(info.channel, {
            type: "music",
            nick: info.nick,
            text: `[Mix: ${comp.name} — ${comp.tracks.length} pistes, 44.1kHz stereo]`,
            audioData: mixBuffer.toString("base64"),
            audioMime: "audio/wav",
          } as any);

          try {
            const mp3Path = outPath.replace(".wav", ".mp3");
            await execFileAsync("ffmpeg", ["-i", outPath, "-codec:a", "libmp3lame", "-b:a", "192k", "-y", mp3Path], { timeout: 30000 });
          } catch {
          }

          send(ws, { type: "system", text: `\u2705 Mix termine. Download: /api/v2/media/compositions/${comp.id}/mix (WAV) | /api/v2/media/compositions/${comp.id}/mp3 (MP3)` });
          broadcastCompUpdate(broadcast, info.channel, comp.id, "mix_complete");
        } catch (err) {
          send(ws, { type: "system", text: `Erreur mixage: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/voice": {
        const voiceMatch = text.match(/^\/voice\s+(\S+)\s+"([^"]+)"(?:\s+(\d+)s)?/);
        if (!voiceMatch) {
          send(ws, { type: "system", text: 'Usage: /voice <persona> "texte" [duree]s\nExemple: /voice Pharmacius "Bienvenue dans le chaos sonore" 10s' });
          return;
        }

        const [, personaNick, voiceText, durStr] = voiceMatch;
        if (voiceText.length > 500) {
          send(ws, { type: "system", text: "Texte trop long (max 500 chars)" });
          return;
        }

        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          comp = createComposition(info.nick, info.channel);
        }

        broadcast(info.channel, { type: "system", text: `\u{1F399}\uFE0F ${info.nick} ajoute une voix: ${personaNick} — "${voiceText}"` });

        const voiceTtsUrl = process.env.TTS_URL || "http://127.0.0.1:9100";
        try {
          const audioBuffer = await scheduler.submit({
            id: crypto.randomUUID(),
            device: "cpu",
            priority: "normal",
            label: `/voice ${personaNick}`,
            execute: async () => {
              const resp = await fetch(`${voiceTtsUrl}/synthesize`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: voiceText, persona: personaNick.toLowerCase() }),
                signal: AbortSignal.timeout(30_000),
              });
              if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}`);
              return Buffer.from(await resp.arrayBuffer());
            },
          });

          const track = addTrack(comp.id, { type: "voice", prompt: `${personaNick}: "${voiceText}"`, duration: parseInt(durStr || "10", 10), volume: 100, startMs: 0 });
          if (track) {
            const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
            fs.mkdirSync(trackDir, { recursive: true });
            const trackPath = path.join(trackDir, `${track.id}.wav`);
            fs.writeFileSync(trackPath, audioBuffer);
            track.filePath = trackPath;
          }

          broadcast(info.channel, {
            type: "audio",
            nick: personaNick,
            data: audioBuffer.toString("base64"),
            mimeType: "audio/wav",
          } as any);

          send(ws, { type: "system", text: `\u2705 Voix ajoutee (piste ${comp.tracks.length}). /mix pour combiner.` });
          broadcastCompUpdate(broadcast, info.channel, comp.id, "track_added", { trackCount: comp.tracks.length });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur voix: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help-compose.` });
        return;
    }
  };
}

export function createComposeManageCommandHandler({
  send,
  broadcast,
}: {
  send: SendFn;
  broadcast: BroadcastFn;
}) {
  return async function handleComposeManageCommand({ ws, info, text }: CommandContext): Promise<void> {
    const cmd = text.trim().split(/\s+/)[0]?.toLowerCase();

    switch (cmd) {
      case "/tracks": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || comp.tracks.length === 0) {
          send(ws, { type: "system", text: "Aucune piste. /comp new puis /layer" });
          return;
        }
        const lines = comp.tracks.map((track, index) => {
          const icon = track.type === "voice" ? "\u{1F399}\uFE0F" : track.type === "sfx" ? "\u{1F50A}" : "\u{1F3B5}";
          return `  ${icon} #${index + 1} [${track.type}] ${track.prompt.slice(0, 60)} (${track.duration}s, vol:${track.volume}%)`;
        });
        send(ws, { type: "system", text: `Composition: ${comp.name}\n${lines.join("\n")}\n\nTotal: ${comp.tracks.length} pistes` });
        return;
      }

      case "/undo": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || comp.tracks.length === 0) {
          send(ws, { type: "system", text: "Rien a annuler." });
          return;
        }
        const removed = comp.tracks.pop();
        if (removed?.filePath && fs.existsSync(removed.filePath)) {
          fs.unlinkSync(removed.filePath);
        }
        send(ws, { type: "system", text: `\u21A9\uFE0F Piste supprimee: "${removed?.prompt?.slice(0, 40)}"` });
        broadcastCompUpdate(broadcast, info.channel, comp.id, "track_removed", { trackCount: comp.tracks.length });
        return;
      }

      case "/solo": {
        const trackNum = parseInt(text.slice(6).trim(), 10);
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /solo <piste#>" });
          return;
        }
        comp.tracks.forEach((track, index) => {
          track.volume = index === trackNum - 1 ? 100 : 0;
        });
        send(ws, { type: "system", text: `\u{1F508} Solo piste #${trackNum}: "${comp.tracks[trackNum - 1].prompt.slice(0, 40)}"` });
        return;
      }

      case "/unsolo": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          send(ws, { type: "system", text: "Pas de composition." });
          return;
        }
        comp.tracks.forEach((track) => {
          track.volume = 100;
        });
        send(ws, { type: "system", text: "\u{1F50A} Toutes les pistes a 100%" });
        return;
      }

      case "/rename": {
        const newName = text.slice(8).trim();
        if (!newName) {
          send(ws, { type: "system", text: "Usage: /rename <nouveau nom>" });
          return;
        }
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          send(ws, { type: "system", text: "Pas de composition active." });
          return;
        }
        comp.name = newName.slice(0, 100);
        send(ws, { type: "system", text: `\u270F\uFE0F Composition renommee: ${comp.name}` });
        return;
      }

      case "/duplicate":
      case "/dup": {
        const trackNum = parseInt(text.split(/\s+/)[1] || "", 10);
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /dup <piste#>" });
          return;
        }
        const source = comp.tracks[trackNum - 1];
        const newTrack = addTrack(comp.id, { type: source.type, prompt: source.prompt + " (copie)", duration: source.duration, volume: source.volume, startMs: 0 });
        if (newTrack && source.filePath && fs.existsSync(source.filePath)) {
          const newPath = path.join(process.cwd(), "data", "compositions", comp.id, `${newTrack.id}.wav`);
          fs.copyFileSync(source.filePath, newPath);
          newTrack.filePath = newPath;
        }
        send(ws, { type: "system", text: `\u{1F4CB} Piste #${trackNum} dupliquee \u2192 #${comp.tracks.length}` });
        return;
      }

      case "/bpm": {
        const bpmVal = parseInt(text.slice(5).trim(), 10);
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          send(ws, { type: "system", text: "Pas de composition active." });
          return;
        }
        if (bpmVal && bpmVal >= 20 && bpmVal <= 300) {
          (comp as any).bpm = bpmVal;
          send(ws, { type: "system", text: `\u{1F941} BPM: ${bpmVal}` });
        } else {
          send(ws, { type: "system", text: `BPM: ${(comp as any).bpm || "non defini"}. Usage: /bpm <20-300>` });
        }
        return;
      }

      case "/clear-comp": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          send(ws, { type: "system", text: "Pas de composition active." });
          return;
        }
        for (const track of comp.tracks) {
          if (track.filePath && fs.existsSync(track.filePath)) {
            fs.unlinkSync(track.filePath);
          }
        }
        comp.tracks = [];
        send(ws, { type: "system", text: `\u{1F5D1}\uFE0F Composition "${comp.name}" videe` });
        return;
      }

      case "/preview": {
        const previewArg = text.slice(9).trim();
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          send(ws, { type: "system", text: "Pas de composition active." });
          return;
        }

        if (!previewArg) {
          const mixPath = path.join(process.cwd(), "data", "compositions", comp.id, "mix.wav");
          const masterPath = path.join(process.cwd(), "data", "compositions", comp.id, "master.wav");
          const sourcePath = fs.existsSync(masterPath) ? masterPath : fs.existsSync(mixPath) ? mixPath : null;
          if (!sourcePath) {
            send(ws, { type: "system", text: "/mix d'abord." });
            return;
          }
          const buffer = fs.readFileSync(sourcePath);
          send(ws, { type: "music", nick: info.nick, text: `[Preview: ${comp.name}]`, audioData: buffer.toString("base64"), audioMime: "audio/wav" } as any);
          return;
        }

        const trackNum = parseInt(previewArg, 10);
        if (isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /preview [piste#]" });
          return;
        }
        const track = comp.tracks[trackNum - 1];
        if (!track.filePath || !fs.existsSync(track.filePath)) {
          send(ws, { type: "system", text: "Piste sans fichier audio." });
          return;
        }
        const buffer = fs.readFileSync(track.filePath);
        send(ws, { type: "music", nick: info.nick, text: `[Preview #${trackNum}: ${track.prompt.slice(0, 40)}]`, audioData: buffer.toString("base64"), audioMime: "audio/wav" } as any);
        return;
      }

      case "/gain": {
        const args = text.slice(6).trim().split(/\s+/);
        const trackNum = parseInt(args[0], 10) - 1;
        const db = parseFloat(args[1] || "0");
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 0 || trackNum >= comp.tracks.length || isNaN(db)) {
          send(ws, { type: "system", text: "Usage: /gain <piste#> <dB> (ex: /gain 1 -3)" });
          return;
        }
        const track = comp.tracks[trackNum];
        if (!track.filePath || !fs.existsSync(track.filePath)) {
          send(ws, { type: "system", text: "Piste sans fichier." });
          return;
        }
        const tmp = track.filePath + ".gain.wav";
        await execFileAsync("ffmpeg", ["-i", track.filePath, "-af", `volume=${db}dB`, "-y", tmp], { timeout: 30000 });
        fs.renameSync(tmp, track.filePath);
        send(ws, { type: "system", text: `\u{1F50A} Gain ${db > 0 ? "+" : ""}${db}dB piste #${trackNum + 1}` });
        return;
      }

      case "/loop": {
        const args = text.slice(6).trim().split(/\s+/);
        const trackNum = parseInt(args[0] || "", 10);
        const times = Math.min(10, Math.max(2, parseInt(args[1] || "2", 10)));
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /loop <piste#> <fois>" });
          return;
        }
        const track = comp.tracks[trackNum - 1];
        if (!track.filePath || !fs.existsSync(track.filePath)) {
          send(ws, { type: "system", text: "Piste sans fichier audio." });
          return;
        }
        const concatFile = track.filePath + ".concat.txt";
        fs.writeFileSync(concatFile, Array(times).fill(`file '${track.filePath}'`).join("\n"));
        const tmpPath = track.filePath + ".loop.wav";
        await execFileAsync("ffmpeg", ["-f", "concat", "-safe", "0", "-i", concatFile, "-y", tmpPath], { timeout: 30000 });
        fs.renameSync(tmpPath, track.filePath);
        fs.unlinkSync(concatFile);
        track.duration *= times;
        send(ws, { type: "system", text: `\u{1F501} Piste #${trackNum} loopee x${times} (${track.duration}s)` });
        return;
      }

      case "/swap": {
        const args = text.slice(6).trim().split(/\s+/);
        const a = parseInt(args[0], 10) - 1;
        const b = parseInt(args[1], 10) - 1;
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(a) || isNaN(b) || a < 0 || b < 0 || a >= comp.tracks.length || b >= comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /swap <piste#> <piste#>" });
          return;
        }
        [comp.tracks[a], comp.tracks[b]] = [comp.tracks[b], comp.tracks[a]];
        send(ws, { type: "system", text: `\u{1F500} Pistes #${a + 1} et #${b + 1} echangees` });
        return;
      }

      case "/info": {
        const trackNum = parseInt(text.slice(6).trim(), 10);
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /info <piste#>" });
          return;
        }
        const track = comp.tracks[trackNum - 1];
        const icon = track.type === "voice" ? "\u{1F399}\uFE0F" : track.type === "sfx" ? "\u{1F50A}" : "\u{1F3B5}";
        let fileInfo = "pas de fichier";
        if (track.filePath && fs.existsSync(track.filePath)) {
          const stat = fs.statSync(track.filePath);
          fileInfo = `${Math.round(stat.size / 1024)} KB`;
        }
        send(ws, { type: "system", text: [
          `${icon} Piste #${trackNum}`,
          `  Type: ${track.type}`,
          `  Prompt: ${track.prompt}`,
          `  Duree: ${track.duration}s`,
          `  Volume: ${track.volume}%`,
          `  Fichier: ${fileInfo}`,
          `  Cree: ${track.createdAt}`,
        ].join("\n") });
        return;
      }

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help-compose.` });
        return;
    }
  };
}

export function createComposeAdvancedCommandHandler({
  send,
  broadcast,
}: {
  send: SendFn;
  broadcast: BroadcastFn;
}) {
  return async function handleComposeAdvancedCommand({ ws, info, text }: CommandContext): Promise<void> {
    const cmd = text.trim().split(/\s+/)[0]?.toLowerCase();

    switch (cmd) {
      case "/concat": {
        const args = text.slice(8).trim().split(/\s+/);
        const a = parseInt(args[0], 10) - 1;
        const b = parseInt(args[1], 10) - 1;
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(a) || isNaN(b) || a < 0 || b < 0 || a >= comp.tracks.length || b >= comp.tracks.length || a === b) {
          send(ws, { type: "system", text: "Usage: /concat <piste#> <piste#> — concatene B apres A" });
          return;
        }
        const trackA = comp.tracks[a];
        const trackB = comp.tracks[b];
        if (!trackA.filePath || !trackB.filePath || !fs.existsSync(trackA.filePath) || !fs.existsSync(trackB.filePath)) {
          send(ws, { type: "system", text: "Les deux pistes doivent avoir des fichiers." });
          return;
        }
        const concatFile = trackA.filePath + ".concat.txt";
        fs.writeFileSync(concatFile, `file '${trackA.filePath}'\nfile '${trackB.filePath}'`);
        const tmp = trackA.filePath + ".cat.wav";
        await execFileAsync("ffmpeg", ["-f", "concat", "-safe", "0", "-i", concatFile, "-y", tmp], { timeout: 30000 });
        fs.renameSync(tmp, trackA.filePath);
        fs.unlinkSync(concatFile);
        trackA.duration += trackB.duration;
        trackA.prompt += " + " + trackB.prompt.slice(0, 30);
        if (trackB.filePath && fs.existsSync(trackB.filePath)) {
          fs.unlinkSync(trackB.filePath);
        }
        comp.tracks.splice(b, 1);
        send(ws, { type: "system", text: `🔗 Pistes #${a + 1} + #${b + 1} concatenees → #${a + 1} (${trackA.duration}s)` });
        return;
      }

      case "/silence": {
        const dur = Math.min(60, Math.max(1, parseInt(text.slice(9).trim() || "5", 10)));
        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          comp = createComposition(info.nick, info.channel);
        }
        const track = addTrack(comp.id, { type: "sfx", prompt: `silence ${dur}s`, duration: dur, volume: 0, startMs: 0 });
        if (track) {
          const trackPath = path.join(process.cwd(), "data", "compositions", comp.id, `${track.id}.wav`);
          fs.mkdirSync(path.dirname(trackPath), { recursive: true });
          await execFileAsync("ffmpeg", ["-f", "lavfi", "-i", "anullsrc=r=32000:cl=mono", "-t", String(dur), trackPath], { timeout: 15000 });
          track.filePath = trackPath;
        }
        send(ws, { type: "system", text: `⏸️ Silence ${dur}s ajoute (piste ${comp.tracks.length})` });
        return;
      }

      case "/template": {
        const templates: Record<string, Array<{ type: string; prompt: string; duration: number }>> = {
          "ambient-4": [
            { type: "noise", prompt: "drone 30", duration: 30 },
            { type: "noise", prompt: "pink 30", duration: 30 },
            { type: "layer", prompt: "ambient drone with deep reverb, ambient", duration: 30 },
            { type: "voice", prompt: "Le son est notre matiere premiere", duration: 10 },
          ],
          "noise-art": [
            { type: "noise", prompt: "brown 15", duration: 15 },
            { type: "noise", prompt: "sine 15", duration: 15 },
            { type: "noise", prompt: "drone 15", duration: 15 },
          ],
          "spoken-word": [
            { type: "voice", prompt: "Bienvenue dans le chaos sonore", duration: 10 },
            { type: "noise", prompt: "drone 20", duration: 20 },
            { type: "voice", prompt: "Le bruit revele ce que le silence cache", duration: 10 },
          ],
        };

        const name = text.slice(10).trim().toLowerCase();
        if (!name || !templates[name]) {
          const list = Object.keys(templates).map((key) => `  ${key} (${templates[key].length} pistes)`).join("\n");
          send(ws, { type: "system", text: `Templates:\n${list}\nUsage: /template <nom>` });
          return;
        }

        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          comp = createComposition(info.nick, info.channel, name);
        }

        broadcast(info.channel, { type: "system", text: `📋 Template "${name}" — ${templates[name].length} pistes en generation...` });

        for (const templateTrack of templates[name]) {
          if (templateTrack.type === "noise") {
            const [noiseType, dur] = templateTrack.prompt.split(" ");
            const track = addTrack(comp.id, { type: "noise" as any, prompt: `${noiseType} noise ${dur}s`, duration: parseInt(dur, 10), volume: 100, startMs: 0 });
            if (track) {
              const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
              fs.mkdirSync(trackDir, { recursive: true });
              const trackPath = path.join(trackDir, `${track.id}.wav`);
              const types: Record<string, string> = {
                white: "anoisesrc=d=DUR:c=white",
                pink: "anoisesrc=d=DUR:c=pink",
                brown: "anoisesrc=d=DUR:c=brown",
                sine: "sine=frequency=220:duration=DUR",
                drone: "sine=frequency=55:duration=DUR,tremolo=f=0.1:d=0.7",
              };
              const filter = (types[noiseType] || types.white).replace(/DUR/g, dur);
              await execFileAsync("ffmpeg", ["-f", "lavfi", "-i", filter, "-t", dur, "-ar", "32000", "-ac", "1", trackPath], { timeout: 15000 });
              track.filePath = trackPath;
            }
          } else if (templateTrack.type === "voice") {
            try {
              const ttsUrl = process.env.TTS_URL || "http://127.0.0.1:9100";
              const resp = await fetch(`${ttsUrl}/synthesize`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: templateTrack.prompt, persona: "pharmacius" }),
                signal: AbortSignal.timeout(30000),
              });
              if (resp.ok) {
                const buf = Buffer.from(await resp.arrayBuffer());
                const track = addTrack(comp.id, { type: "voice" as any, prompt: `Pharmacius: "${templateTrack.prompt}"`, duration: templateTrack.duration, volume: 100, startMs: 0 });
                if (track) {
                  const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
                  fs.mkdirSync(trackDir, { recursive: true });
                  const trackPath = path.join(trackDir, `${track.id}.wav`);
                  fs.writeFileSync(trackPath, buf);
                  track.filePath = trackPath;
                }
              }
            } catch {
            }
          }
        }

        send(ws, { type: "system", text: `\u2705 Template "${name}" charge: ${comp.tracks.length} pistes. /mix pour mixer.` });
        return;
      }

      case "/marker": {
        const markerText = text.slice(8).trim();
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          send(ws, { type: "system", text: "Pas de composition." });
          return;
        }
        if (!markerText) {
          const markers = (comp as any).markers || [];
          send(ws, { type: "system", text: markers.length ? `Markers:\n${markers.map((marker: any, index: number) => `  ${index + 1}. [${marker.time}s] ${marker.label}`).join("\n")}` : "Aucun marker. /marker <label> [at Ns]" });
          return;
        }
        const atMatch = markerText.match(/(.+?)\s+at\s+(\d+)s?$/);
        const label = atMatch ? atMatch[1] : markerText;
        const time = atMatch ? parseInt(atMatch[2], 10) : 0;
        if (!(comp as any).markers) {
          (comp as any).markers = [];
        }
        (comp as any).markers.push({ label, time });
        send(ws, { type: "system", text: `📍 Marker ajoute: "${label}" a ${time}s` });
        return;
      }

      case "/metronome": {
        const bpmVal = parseInt(text.slice(11).trim(), 10) || 120;
        const dur = 30;
        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          comp = createComposition(info.nick, info.channel);
        }
        const track = addTrack(comp.id, { type: "sfx" as any, prompt: `metronome ${bpmVal}bpm`, duration: dur, volume: 50, startMs: 0 });
        if (track) {
          const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
          fs.mkdirSync(trackDir, { recursive: true });
          const trackPath = path.join(trackDir, `${track.id}.wav`);
          const beatInterval = 60 / bpmVal;
          await execFileAsync("ffmpeg", ["-f", "lavfi", "-i", `sine=frequency=1000:duration=0.05,apad=whole_dur=${dur}`, "-af", `aecho=1:1:${Math.round(beatInterval * 1000)}:1`, "-t", String(dur), "-ar", "32000", "-ac", "1", "-y", trackPath], { timeout: 15000 });
          track.filePath = trackPath;
          const buf = fs.readFileSync(trackPath);
          broadcast(info.channel, { type: "music", nick: info.nick, text: `[Metronome ${bpmVal} BPM]`, audioData: buf.toString("base64"), audioMime: "audio/wav" } as any);
          send(ws, { type: "system", text: `🥁 Metronome ${bpmVal} BPM ajoute (piste ${comp.tracks.length})` });
        }
        return;
      }

      case "/delete": {
        const trackNum = parseInt(text.slice(8).trim(), 10);
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: `Usage: /delete <piste# 1-${comp?.tracks.length || "?"}>` });
          return;
        }
        const removed = comp.tracks.splice(trackNum - 1, 1)[0];
        if (removed?.filePath && fs.existsSync(removed.filePath)) {
          fs.unlinkSync(removed.filePath);
        }
        send(ws, { type: "system", text: `🗑️ Piste #${trackNum} supprimee: "${removed?.prompt?.slice(0, 40)}"` });
        broadcastCompUpdate(broadcast, info.channel, comp.id, "track_removed", { trackCount: comp.tracks.length });
        return;
      }

      case "/suggest": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || comp.tracks.length === 0) {
          send(ws, { type: "system", text: "Ajoute d'abord des pistes. /layer ou /noise" });
          return;
        }

        const trackList = comp.tracks.map((track, index) => `#${index + 1} [${track.type}] ${track.prompt} (${track.duration}s)`).join("\n");
        send(ws, { type: "system", text: "🤔 Analyse de la composition..." });

        try {
          const suggestOllamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
          const resp = await fetch(`${suggestOllamaUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "qwen3.5:9b",
              messages: [{ role: "user", content: `Tu es un compositeur expert. Voici une composition multi-pistes:\n${trackList}\n\nSuggere la prochaine piste a ajouter (type, style, duree). Reponds en une phrase avec la commande exacte a taper. Exemples:\n/layer dark pad with filter sweep, ambient, 30s\n/voice Schaeffer "Le son revele l'invisible"\n/noise pink 15\nReponds UNIQUEMENT la commande.` }],
              stream: false,
              options: { num_predict: 100 },
              keep_alive: "30m",
              think: false,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (resp.ok) {
            const data = await resp.json() as { message?: { content?: string } };
            const suggestion = (data.message?.content || "").trim();
            send(ws, { type: "system", text: `💡 Suggestion: ${suggestion}` });
          }
        } catch {
          send(ws, { type: "system", text: "Suggestion indisponible." });
        }
        return;
      }

      case "/snapshot": {
        const label = text.slice(10).trim() || `v${Date.now()}`;
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          send(ws, { type: "system", text: "Pas de composition." });
          return;
        }

        const snapshotDir = path.join(process.cwd(), "data", "compositions", comp.id, "snapshots");
        fs.mkdirSync(snapshotDir, { recursive: true });
        fs.writeFileSync(path.join(snapshotDir, `${label}.json`), JSON.stringify(comp, null, 2));
        send(ws, { type: "system", text: `📸 Snapshot "${label}" sauvegarde` });
        return;
      }

      case "/randomize": {
        const dur = parseInt(text.slice(11).trim(), 10) || 30;
        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          comp = createComposition(info.nick, info.channel, "Random " + Date.now().toString(36));
        }

        broadcast(info.channel, { type: "system", text: `🎲 Generation aleatoire ${dur}s...` });

        const noiseTypes = ["white", "pink", "brown", "sine", "drone"];
        const count = 2 + Math.floor(Math.random() * 3);

        for (let index = 0; index < count; index++) {
          const noiseType = noiseTypes[Math.floor(Math.random() * noiseTypes.length)];
          const trackDur = Math.max(5, Math.min(dur, 10 + Math.floor(Math.random() * 20)));
          const track = addTrack(comp.id, {
            type: "sfx" as any,
            prompt: `${noiseType} noise ${trackDur}s`,
            duration: trackDur,
            volume: 30 + Math.floor(Math.random() * 70),
            startMs: Math.floor(Math.random() * dur * 500),
          });
          if (track) {
            const trackPath = path.join(process.cwd(), "data", "compositions", comp.id, `${track.id}.wav`);
            const types: Record<string, string> = {
              white: "anoisesrc=d=DUR:c=white",
              pink: "anoisesrc=d=DUR:c=pink",
              brown: "anoisesrc=d=DUR:c=brown",
              sine: "sine=frequency=" + (100 + Math.floor(Math.random() * 500)) + ":duration=DUR",
              drone: "sine=frequency=" + (40 + Math.floor(Math.random() * 80)) + ":duration=DUR,tremolo=f=" + (0.05 + Math.random() * 0.2).toFixed(2) + ":d=0.7",
            };
            const filter = (types[noiseType] || types.white).replace(/DUR/g, String(trackDur));
            await execFileAsync("ffmpeg", ["-f", "lavfi", "-i", filter, "-t", String(trackDur), "-ar", "32000", "-ac", "1", "-y", trackPath], { timeout: 15000 });
            track.filePath = trackPath;
          }
        }

        send(ws, { type: "system", text: `🎲 ${comp.tracks.length} pistes generees aleatoirement. /mix pour ecouter.` });
        return;
      }

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help-compose.` });
        return;
    }
  };
}