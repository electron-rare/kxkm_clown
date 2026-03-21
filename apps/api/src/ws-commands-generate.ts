import path from "node:path";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { WebSocket } from "ws";
import { generateImage } from "./comfyui.js";
import { saveImage, saveAudio } from "./media-store.js";
import type { OutboundMessage } from "./chat-types.js";
import type { CommandContext, CommandHandlerDeps } from "./ws-commands-types.js";
import { createComposition, getComposition, getActiveComposition, addTrack, listCompositions } from "./composition-store.js";


type BroadcastFn = (channel: string, msg: import("./chat-types.js").OutboundMessage, exclude?: import("ws").WebSocket) => void;
function broadcastCompUpdate(broadcast: BroadcastFn, channel: string, compId: string, action: string, data?: Record<string, unknown>) {
  broadcast(channel, { type: "system", text: "__comp_update__" + JSON.stringify({ compId, action, ...data }) } as any);
}

export const GENERATE_COMMANDS = new Set([
  "/imagine", "/compose", "/layer", "/mix", "/voice", "/noise",
  "/ambient", "/fx", "/comp", "/imagine-models", "/remix", "/tracks",
  "/undo", "/solo", "/unsolo", "/rename", "/duplicate", "/dup", "/bpm", "/clear-comp",
  "/loop", "/swap", "/info", "/normalize", "/crossfade", "/trim",
  "/stutter", "/pan", "/master", "/concat", "/silence",
  "/play", "/stop-all",
]);

export function createGenerateCommandHandler(deps: CommandHandlerDeps) {
  const {
    send,
    broadcast,
    logChatMessage,
    getPersonas,
  } = deps;

  return async function handleGenerateCommand({ ws, info, text }: CommandContext): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    switch (cmd) {
      case "/compose":
        await handleComposeCommand({ ws, info, text, broadcast, send, logChatMessage });
        return;

      case "/imagine":
        await handleImagineCommand({ ws, info, text, broadcast, send, logChatMessage });
        return;

      case "/imagine-models": {
        const { getComfyUIModels } = await import("./comfyui-models.js");
        const models = await getComfyUIModels();
        const checkpoints = models.filter(m => m.type === "checkpoint");
        const loras = models.filter(m => m.type === "lora");
        const lines = [
          `=== ComfyUI Models ===`,
          `  Checkpoints (${checkpoints.length}):`,
          ...checkpoints.map(m => `    ${m.name}`),
          `  LoRAs (${loras.length}):`,
          ...loras.map(m => `    ${m.name}`),
        ];
        if (models.length === 0) lines.push("  (ComfyUI non disponible ou aucun modele trouve)");
        send(ws, { type: "system", text: lines.join("\n") });
        return;
      }

      case "/comp": {
        const sub = text.slice(6).trim().split(/\s+/);
        const action = sub[0] || "list";

        if (action === "new") {
          const name = sub.slice(1).join(" ") || undefined;
          const comp = createComposition(info.nick, info.channel, name);
          send(ws, { type: "system", text: `\u{1F3BC} Composition creee: ${comp.name} (${comp.id})\n  /layer <prompt> pour ajouter des pistes` });
          return;
        }
        if (action === "list") {
          const comps = listCompositions(info.nick);
          if (comps.length === 0) { send(ws, { type: "system", text: "Aucune composition. /comp new <nom>" }); return; }
          send(ws, { type: "system", text: `Compositions:\n${comps.map(c => `  ${c.id}: ${c.name} (${c.tracks.length} pistes)`).join("\n")}` });
          return;
        }
        if (action === "save") {
          const comp = getActiveComposition(info.nick, info.channel);
          if (!comp) { send(ws, { type: "system", text: "Pas de composition active." }); return; }
          const dir = path.join(process.cwd(), "data", "compositions", comp.id);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, "composition.json"), JSON.stringify(comp, null, 2));
          send(ws, { type: "system", text: `💾 Composition sauvegardee: ${comp.name} (${comp.tracks.length} pistes)` });
          return;
        }
        if (action === "load") {
          const compId = sub[1];
          if (!compId) { send(ws, { type: "system", text: "Usage: /comp load <id>" }); return; }
          const comp = getComposition(compId);
          if (!comp) { send(ws, { type: "system", text: `Composition ${compId} introuvable.` }); return; }
          send(ws, { type: "system", text: `📂 Composition chargee: ${comp.name} (${comp.tracks.length} pistes)` });
          return;
        }
        if (action === "delete") {
          const compId = sub[1];
          if (!compId) { send(ws, { type: "system", text: "Usage: /comp delete <id>" }); return; }
          const dir = path.join(process.cwd(), "data", "compositions", compId);
          if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true });
            send(ws, { type: "system", text: `🗑️ Composition ${compId} supprimee` });
          } else {
            send(ws, { type: "system", text: `Composition ${compId} introuvable.` });
          }
          return;
        }
        send(ws, { type: "system", text: "Usage: /comp new|list|save|load|delete" });
        return;
      }

      case "/layer": {
        const layerPrompt = text.slice(7).trim();
        if (!layerPrompt) { send(ws, { type: "system", text: "Usage: /layer <description musicale>. Cree d'abord: /comp new" }); return; }

        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) {
          comp = createComposition(info.nick, info.channel);
          send(ws, { type: "system", text: `\u{1F3BC} Composition auto-creee: ${comp.name}` });
        }

        const durMatch = layerPrompt.match(/(\d+)s\s*$/);
        const duration = durMatch ? Math.min(Math.max(parseInt(durMatch[1]), 5), 120) : 30;
        const prompt = durMatch ? layerPrompt.replace(/,?\s*\d+s\s*$/, "").trim() : layerPrompt;

        broadcast(info.channel, { type: "system", text: `\u{1F3B5} ${info.nick} ajoute une piste: "${prompt}" (${duration}s)...` });

        const ttsUrl = process.env.TTS_URL || "http://127.0.0.1:9100";
        try {
          const resp = await fetch(`${ttsUrl}/compose`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, duration }),
            signal: AbortSignal.timeout(300_000),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

          const audioBuffer = Buffer.from(await resp.arrayBuffer());
          const track = addTrack(comp.id, { type: "music", prompt, duration, volume: 100, startMs: 0 });

          if (track) {
            const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
            fs.mkdirSync(trackDir, { recursive: true });
            const trackPath = path.join(trackDir, `${track.id}.wav`);
            fs.writeFileSync(trackPath, audioBuffer);
            track.filePath = trackPath;
          }

          broadcast(info.channel, {
            type: "music", nick: info.nick,
            text: `[Layer: "${prompt}" \u2014 piste ${comp.tracks.length}/${comp.name}]`,
            audioData: audioBuffer.toString("base64"), audioMime: "audio/wav",
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
          send(ws, { type: "system", text: "Aucune piste a mixer. /layer d'abord." }); return;
        }

        broadcast(info.channel, { type: "system", text: `\u{1F39B}\uFE0F Mixage de ${comp.tracks.length} pistes...` });
        const { execFileSync } = await import("node:child_process");
        const outPath = path.join(process.cwd(), "data", "compositions", comp.id, "mix.wav");

        try {
          const inputs = comp.tracks.filter(t => t.filePath && fs.existsSync(t.filePath));

          if (inputs.length === 1) {
            fs.copyFileSync(inputs[0].filePath!, outPath);
          } else {
            const ffmpegArgs: string[] = [];
            const filterParts: string[] = [];

            // Add each track with its offset and volume
            inputs.forEach((t, i) => {
              const offsetSec = (t.startMs || 0) / 1000;
              if (offsetSec > 0) {
                ffmpegArgs.push("-itsoffset", String(offsetSec));
              }
              ffmpegArgs.push("-i", t.filePath!);

              // Apply volume scaling per track
              const vol = (t.volume ?? 100) / 100;
              filterParts.push(`[${i}]aformat=sample_rates=44100:channel_layouts=stereo,volume=${vol}[a${i}]`);
            });

            // Combine all scaled tracks
            const mixInputs = inputs.map((_, i) => `[a${i}]`).join("");
            filterParts.push(`${mixInputs}amix=inputs=${inputs.length}:duration=longest:dropout_transition=2[out]`);

            ffmpegArgs.push("-filter_complex", filterParts.join(";"));
            ffmpegArgs.push("-map", "[out]", "-ar", "44100", "-ac", "2", "-y", outPath);

            execFileSync("ffmpeg", ffmpegArgs, { timeout: 60000 });
          }

          const mixBuffer = fs.readFileSync(outPath);
          broadcast(info.channel, {
            type: "music", nick: info.nick,
            text: `[Mix: ${comp.name} \u2014 ${comp.tracks.length} pistes, 44.1kHz stereo]`,
            audioData: mixBuffer.toString("base64"), audioMime: "audio/wav",
          } as any);
          send(ws, { type: "system", text: `\u2705 Mix termine. Download: /api/v2/media/compositions/${comp.id}/mix` });
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

        broadcast(info.channel, { type: "system", text: `\u{1F399}\uFE0F ${info.nick} ajoute une voix: ${personaNick} \u2014 "${voiceText}"` });

        const voiceTtsUrl = process.env.TTS_URL || "http://127.0.0.1:9100";
        try {
          const resp = await fetch(`${voiceTtsUrl}/synthesize`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: voiceText, persona: personaNick.toLowerCase() }),
            signal: AbortSignal.timeout(30_000),
          });
          if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}`);

          const audioBuffer = Buffer.from(await resp.arrayBuffer());
          const track = addTrack(comp.id, { type: "voice", prompt: `${personaNick}: "${voiceText}"`, duration: parseInt(durStr || "10"), volume: 100, startMs: 0 });

          if (track) {
            const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
            fs.mkdirSync(trackDir, { recursive: true });
            const trackPath = path.join(trackDir, `${track.id}.wav`);
            fs.writeFileSync(trackPath, audioBuffer);
            track.filePath = trackPath;
          }

          broadcast(info.channel, {
            type: "audio", nick: personaNick,
            data: audioBuffer.toString("base64"), mimeType: "audio/wav",
          } as any);

          send(ws, { type: "system", text: `\u2705 Voix ajoutee (piste ${comp.tracks.length}). /mix pour combiner.` });
          broadcastCompUpdate(broadcast, info.channel, comp.id, "track_added", { trackCount: comp.tracks.length });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur voix: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/fx": {
        const fxArgs = text.slice(4).trim().split(/\s+/);

        // Check if first arg is a track number
        let trackIdx = -1;
        let effectStart = 0;
        if (fxArgs[0] && /^\d+$/.test(fxArgs[0])) {
          trackIdx = parseInt(fxArgs[0]) - 1;
          effectStart = 1;
        }

        const effect = fxArgs[effectStart];
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || comp.tracks.length === 0) {
          send(ws, { type: "system", text: "Aucune piste. /layer d'abord." }); return;
        }

        const targetTrack = trackIdx >= 0 && trackIdx < comp.tracks.length
          ? comp.tracks[trackIdx]
          : comp.tracks[comp.tracks.length - 1];
        const targetNum = trackIdx >= 0 ? trackIdx + 1 : comp.tracks.length;
        const fxParam = fxArgs[effectStart + 1];

        if (!effect || effect === "list") {
          send(ws, { type: "system", text: "FX: /fx [piste#] volume|fade-in|fade-out|reverse|reverb|pitch|speed|echo|distortion [param]\nExemple: /fx 2 reverb | /fx pitch -3 | /fx 1 fade-in 3" });
          return;
        }

        switch (effect) {
          case "volume": {
            const vol = Math.min(200, Math.max(0, parseInt(fxParam || "100")));
            targetTrack.volume = vol;
            send(ws, { type: "system", text: `\u{1F50A} Volume piste #${targetNum}: ${vol}%` });
            broadcastCompUpdate(broadcast, info.channel, comp.id, "fx_applied", { trackIdx: targetNum, effect: "volume" });
            return;
          }
          case "fade-in":
          case "fadein": {
            const fadeDur = parseInt(fxParam || "3");
            if (targetTrack.filePath && fs.existsSync(targetTrack.filePath)) {
              const tmpPath = targetTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", targetTrack.filePath, "-af", `afade=t=in:d=${fadeDur}`, "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, targetTrack.filePath);
              send(ws, { type: "system", text: `\u{1F50A} Fade-in ${fadeDur}s applique a piste #${targetNum}` });
              broadcastCompUpdate(broadcast, info.channel, comp.id, "fx_applied", { trackIdx: targetNum, effect: "fade-in" });
            }
            return;
          }
          case "fade-out":
          case "fadeout": {
            const fadeDur = parseInt(fxParam || "3");
            if (targetTrack.filePath && fs.existsSync(targetTrack.filePath)) {
              const tmpPath = targetTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", targetTrack.filePath, "-af", `areverse,afade=t=in:d=${fadeDur},areverse`, "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, targetTrack.filePath);
              send(ws, { type: "system", text: `\u{1F50A} Fade-out ${fadeDur}s applique a piste #${targetNum}` });
              broadcastCompUpdate(broadcast, info.channel, comp.id, "fx_applied", { trackIdx: targetNum, effect: "fade-out" });
            }
            return;
          }
          case "reverse": {
            if (targetTrack.filePath && fs.existsSync(targetTrack.filePath)) {
              const tmpPath = targetTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", targetTrack.filePath, "-af", "areverse", "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, targetTrack.filePath);
              send(ws, { type: "system", text: `\u{1F504} Reverse applique a piste #${targetNum}` });
              broadcastCompUpdate(broadcast, info.channel, comp.id, "fx_applied", { trackIdx: targetNum, effect: "reverse" });
            }
            return;
          }
          case "reverb": {
            if (targetTrack.filePath && fs.existsSync(targetTrack.filePath)) {
              const tmpPath = targetTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", targetTrack.filePath, "-af", "aecho=0.8:0.88:60:0.4", "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, targetTrack.filePath);
              send(ws, { type: "system", text: `\u{1F30A} Reverb applique a piste #${targetNum}` });
              broadcastCompUpdate(broadcast, info.channel, comp.id, "fx_applied", { trackIdx: targetNum, effect: "reverb" });
            }
            return;
          }
          case "pitch": {
            const semitones = parseInt(fxParam || "2");
            if (targetTrack.filePath && fs.existsSync(targetTrack.filePath)) {
              const tmpPath = targetTrack.filePath + ".tmp.wav";
              const factor = Math.pow(2, semitones / 12);
              execFileSync("ffmpeg", ["-i", targetTrack.filePath, "-af", `asetrate=32000*${factor},aresample=32000`, "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, targetTrack.filePath);
              send(ws, { type: "system", text: `\u{1f3b5} Pitch ${semitones > 0 ? "+" : ""}${semitones} demi-tons piste #${targetNum}` });
              broadcastCompUpdate(broadcast, info.channel, comp.id, "fx_applied", { trackIdx: targetNum, effect: "pitch" });
            }
            return;
          }
          case "speed": {
            const speed = parseFloat(fxParam || "1.5");
            if (targetTrack.filePath && fs.existsSync(targetTrack.filePath)) {
              const tmpPath = targetTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", targetTrack.filePath, "-af", `atempo=${Math.min(4, Math.max(0.25, speed))}`, "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, targetTrack.filePath);
              send(ws, { type: "system", text: `\u23e9 Speed x${speed} piste #${targetNum}` });
              broadcastCompUpdate(broadcast, info.channel, comp.id, "fx_applied", { trackIdx: targetNum, effect: "speed" });
            }
            return;
          }
          case "echo": {
            if (targetTrack.filePath && fs.existsSync(targetTrack.filePath)) {
              const tmpPath = targetTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", targetTrack.filePath, "-af", "aecho=0.6:0.3:500|1000:0.3|0.2", "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, targetTrack.filePath);
              send(ws, { type: "system", text: `\u{1f501} Echo applique piste #${targetNum}` });
              broadcastCompUpdate(broadcast, info.channel, comp.id, "fx_applied", { trackIdx: targetNum, effect: "echo" });
            }
            return;
          }
          case "distortion":
          case "distort": {
            if (targetTrack.filePath && fs.existsSync(targetTrack.filePath)) {
              const tmpPath = targetTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", targetTrack.filePath, "-af", "acrusher=samples=10:bits=8:mix=0.5", "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, targetTrack.filePath);
              send(ws, { type: "system", text: `\u{1f4a5} Distortion applique piste #${targetNum}` });
              broadcastCompUpdate(broadcast, info.channel, comp.id, "fx_applied", { trackIdx: targetNum, effect: "distortion" });
            }
            return;
          }

      case "/normalize": {
        const trackNum = parseInt(text.slice(11).trim() || "");
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) { send(ws, { type: "system", text: "Pas de composition." }); return; }
        const track = (trackNum >= 1 && trackNum <= comp.tracks.length) ? comp.tracks[trackNum - 1] : comp.tracks[comp.tracks.length - 1];
        const num = trackNum || comp.tracks.length;
        if (!track.filePath || !fs.existsSync(track.filePath)) { send(ws, { type: "system", text: "Piste sans fichier." }); return; }
        const tmp = track.filePath + ".norm.wav";
        execFileSync("ffmpeg", ["-i", track.filePath, "-af", "loudnorm", "-y", tmp], { timeout: 30000 });
        fs.renameSync(tmp, track.filePath);
        send(ws, { type: "system", text: `\u{1F4CA} Piste #${num} normalisee` });
        return;
      }

      case "/crossfade": {
        const args = text.slice(11).trim().split(/\s+/);
        const a = parseInt(args[0]) - 1;
        const dur = parseInt(args[1] || "3");
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(a) || a < 0 || a >= comp.tracks.length - 1) {
          send(ws, { type: "system", text: "Usage: /crossfade <piste#> [duree_s]. Crossfade entre piste N et N+1." }); return;
        }
        const tA = comp.tracks[a], tB = comp.tracks[a + 1];
        if (!tA.filePath || !tB.filePath || !fs.existsSync(tA.filePath) || !fs.existsSync(tB.filePath)) {
          send(ws, { type: "system", text: "Les deux pistes doivent avoir des fichiers." }); return;
        }
        const out = tA.filePath + ".xfade.wav";
        execFileSync("ffmpeg", ["-i", tA.filePath, "-i", tB.filePath, "-filter_complex", `acrossfade=d=${dur}:c1=tri:c2=tri`, "-y", out], { timeout: 60000 });
        fs.renameSync(out, tA.filePath);
        tA.prompt += ` + ${tB.prompt.slice(0, 30)}`;
        tA.duration += tB.duration - dur;
        if (tB.filePath && fs.existsSync(tB.filePath)) fs.unlinkSync(tB.filePath);
        comp.tracks.splice(a + 1, 1);
        send(ws, { type: "system", text: `\u{1F517} Crossfade ${dur}s entre pistes #${a+1} et #${a+2} \u2192 piste #${a+1}` });
        return;
      }

      case "/trim": {
        const args = text.slice(6).trim().split(/\s+/);
        const trackNum = parseInt(args[0]) - 1;
        const start = parseFloat(args[1] || "0");
        const end = parseFloat(args[2] || "0");
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 0 || trackNum >= comp.tracks.length || (!start && !end)) {
          send(ws, { type: "system", text: "Usage: /trim <piste#> <debut_s> <fin_s>. Ex: /trim 1 2 10" }); return;
        }
        const track = comp.tracks[trackNum];
        if (!track.filePath || !fs.existsSync(track.filePath)) { send(ws, { type: "system", text: "Piste sans fichier." }); return; }
        const tmp = track.filePath + ".trim.wav";
        const ffArgs: string[] = ["-i", track.filePath];
        if (start > 0) ffArgs.push("-ss", String(start));
        if (end > 0) ffArgs.push("-to", String(end));
        ffArgs.push("-y", tmp);
        execFileSync("ffmpeg", ffArgs, { timeout: 30000 });
        fs.renameSync(tmp, track.filePath);
        track.duration = end > 0 ? end - start : track.duration - start;
        send(ws, { type: "system", text: `\u2702\uFE0F Piste #${trackNum+1} trimmee: ${start}s \u2192 ${end || "fin"}s (${track.duration}s)` });
        return;
      }

      case "/stutter": {
        const args = text.slice(9).trim().split(/\s+/);
        const trackNum = parseInt(args[0]) - 1;
        const count = Math.min(16, Math.max(2, parseInt(args[1] || "8")));
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 0 || trackNum >= comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /stutter <piste#> [repetitions 2-16]" }); return;
        }
        const track = comp.tracks[trackNum];
        if (!track.filePath || !fs.existsSync(track.filePath)) { send(ws, { type: "system", text: "Piste sans fichier." }); return; }
        const tmp = track.filePath + ".stutter.wav";
        const segDur = 0.1;
        const filter = `[0]atrim=0:${segDur},aloop=${count}:size=${Math.floor(32000*segDur)}[s];[0][s]amix=inputs=2:duration=first`;
        execFileSync("ffmpeg", ["-i", track.filePath, "-filter_complex", filter, "-y", tmp], { timeout: 30000 });
        fs.renameSync(tmp, track.filePath);
        send(ws, { type: "system", text: `\u26A1 Stutter x${count} piste #${trackNum+1}` });
        return;
      }

      case "/pan": {
        const args = text.slice(5).trim().split(/\s+/);
        const trackNum = parseInt(args[0]) - 1;
        const panVal = parseFloat(args[1] || "0");
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 0 || trackNum >= comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /pan <piste#> <-1 to 1> (-1=gauche, 0=centre, 1=droite)" }); return;
        }
        const track = comp.tracks[trackNum];
        if (!track.filePath || !fs.existsSync(track.filePath)) { send(ws, { type: "system", text: "Piste sans fichier." }); return; }
        const tmp = track.filePath + ".pan.wav";
        const clampedPan = Math.min(1, Math.max(-1, panVal));
        execFileSync("ffmpeg", ["-i", track.filePath, "-af", `pan=stereo|c0=${1-clampedPan}*c0|c1=${1+clampedPan}*c0`, "-y", tmp], { timeout: 30000 });
        fs.renameSync(tmp, track.filePath);
        const label = clampedPan < -0.3 ? "gauche" : clampedPan > 0.3 ? "droite" : "centre";
        send(ws, { type: "system", text: `\u{1F508} Pan piste #${trackNum+1}: ${clampedPan} (${label})` });
        return;
      }

      case "/master": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) { send(ws, { type: "system", text: "Pas de composition." }); return; }
        const mixPath = path.join(process.cwd(), "data", "compositions", comp.id, "mix.wav");
        if (!fs.existsSync(mixPath)) { send(ws, { type: "system", text: "/mix d'abord." }); return; }
        broadcast(info.channel, { type: "system", text: "\u{1F39B}\uFE0F Mastering en cours..." });
        const masterPath = path.join(process.cwd(), "data", "compositions", comp.id, "master.wav");
        execFileSync("ffmpeg", ["-i", mixPath, "-af", "loudnorm,acompressor=threshold=-20dB:ratio=4:attack=5:release=50,alimiter=limit=0.95", "-ar", "44100", "-y", masterPath], { timeout: 60000 });
        const audioBuffer = fs.readFileSync(masterPath);
        broadcast(info.channel, {
          type: "music", nick: info.nick,
          text: `[Master: ${comp.name} \u2014 ${comp.tracks.length} pistes, 44.1kHz]`,
          audioData: audioBuffer.toString("base64"), audioMime: "audio/wav",
        } as any);
        send(ws, { type: "system", text: `\u2705 Master termine. Download: /api/v2/media/compositions/${comp.id}/master` });
        broadcastCompUpdate(broadcast, info.channel, comp.id, "mix_complete");
        return;
      }

      default:
            send(ws, { type: "system", text: "FX: /fx [piste#] volume|fade-in|fade-out|reverse|reverb|pitch|speed|echo|distortion [param]\nExemple: /fx 2 reverb | /fx pitch -3 | /fx 1 fade-in 3" });
            return;
        }
      }

      case "/noise": {
        const noiseArgs = text.slice(7).trim().split(/\s+/);
        const noiseType = noiseArgs[0] || "white";
        const noiseDur = Math.min(120, Math.max(1, parseInt(noiseArgs[1] || "10")));

        const noiseTypes: Record<string, string> = {
          white: "anoisesrc=d=DUR:c=white",
          pink: "anoisesrc=d=DUR:c=pink",
          brown: "anoisesrc=d=DUR:c=brown",
          sine: "sine=frequency=220:duration=DUR",
          drone: "sine=frequency=55:duration=DUR,tremolo=f=0.1:d=0.7",
        };

        if (!noiseTypes[noiseType]) {
          send(ws, { type: "system", text: "Types: white, pink, brown, sine, drone. Usage: /noise <type> <duree>" });
          return;
        }

        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) comp = createComposition(info.nick, info.channel);

        const filter = noiseTypes[noiseType].replace(/DUR/g, String(noiseDur));
        const track = addTrack(comp.id, { type: "sfx", prompt: `${noiseType} noise ${noiseDur}s`, duration: noiseDur, volume: 50, startMs: 0 });

        if (track) {
          const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
          fs.mkdirSync(trackDir, { recursive: true });
          const trackPath = path.join(trackDir, `${track.id}.wav`);
          execFileSync("ffmpeg", ["-f", "lavfi", "-i", filter, "-t", String(noiseDur), "-ar", "32000", "-ac", "1", trackPath], { timeout: 30000 });
          track.filePath = trackPath;

          const audioBuffer = fs.readFileSync(trackPath);
          broadcast(info.channel, {
            type: "music", nick: info.nick,
            text: `[Noise: ${noiseType} ${noiseDur}s]`,
            audioData: audioBuffer.toString("base64"), audioMime: "audio/wav",
          } as any);
          send(ws, { type: "system", text: `\u2705 ${noiseType} noise ajoute (piste ${comp.tracks.length}). /mix pour combiner.` });
          broadcastCompUpdate(broadcast, info.channel, comp.id, "track_added", { trackCount: comp.tracks.length });
        }
        return;
      }

      case "/ambient": {
        const ambPrompt = text.slice(9).trim();
        if (!ambPrompt) {
          send(ws, { type: "system", text: "Usage: /ambient <description> \u2014 genere un fond sonore pour le canal\n  /ambient off \u2014 arreter" });
          return;
        }
        if (ambPrompt === "off" || ambPrompt === "stop") {
          broadcast(info.channel, { type: "system", text: "\u{1f507} Ambient arrete" });
          return;
        }
        broadcast(info.channel, { type: "system", text: `\u{1f30a} Generation ambient: "${ambPrompt}"...` });

        const ttsUrl = process.env.TTS_URL || "http://127.0.0.1:9100";
        try {
          const resp = await fetch(`${ttsUrl}/compose`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: `${ambPrompt}, ambient loop, seamless`, duration: 60 }),
            signal: AbortSignal.timeout(300_000),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const audioBuffer = Buffer.from(await resp.arrayBuffer());
          broadcast(info.channel, {
            type: "music", nick: info.nick,
            text: `[Ambient: "${ambPrompt}" \u2014 en boucle]`,
            audioData: audioBuffer.toString("base64"), audioMime: "audio/wav",
          } as any);
        } catch (err) {
          send(ws, { type: "system", text: `Erreur ambient: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/remix": {
        const trackNum = parseInt(text.slice(7).trim());
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: `Usage: /remix <numero piste 1-${comp?.tracks.length || "?"}` });
          return;
        }
        const track = comp.tracks[trackNum - 1];
        broadcast(info.channel, { type: "system", text: `\u{1F504} Remix piste #${trackNum}: "${track.prompt}"...` });

        const remixTtsUrl = process.env.TTS_URL || "http://127.0.0.1:9100";
        try {
          const resp = await fetch(`${remixTtsUrl}/compose`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: track.prompt, duration: track.duration }),
            signal: AbortSignal.timeout(300_000),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const audioBuffer = Buffer.from(await resp.arrayBuffer());

          if (track.filePath) {
            fs.writeFileSync(track.filePath, audioBuffer);
          }

          broadcast(info.channel, {
            type: "music", nick: info.nick,
            text: `[Remix piste #${trackNum}: "${track.prompt}"]`,
            audioData: audioBuffer.toString("base64"), audioMime: "audio/wav",
          } as any);
          send(ws, { type: "system", text: `\u2705 Piste #${trackNum} remixee` });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur remix: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/tracks": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || comp.tracks.length === 0) {
          send(ws, { type: "system", text: "Aucune piste. /comp new puis /layer" });
          return;
        }
        const lines = comp.tracks.map((t, i) => {
          const icon = t.type === "voice" ? "\u{1F399}\uFE0F" : t.type === "sfx" ? "\u{1F50A}" : "\u{1F3B5}";
          return `  ${icon} #${i+1} [${t.type}] ${t.prompt.slice(0, 60)} (${t.duration}s, vol:${t.volume}%)`;
        });
        send(ws, { type: "system", text: `Composition: ${comp.name}\n${lines.join("\n")}\n\nTotal: ${comp.tracks.length} pistes` });
        return;
      }

      case "/undo": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || comp.tracks.length === 0) {
          send(ws, { type: "system", text: "Rien a annuler." }); return;
        }
        const removed = comp.tracks.pop();
        // Delete the audio file
        if (removed?.filePath && fs.existsSync(removed.filePath)) {
          fs.unlinkSync(removed.filePath);
        }
        send(ws, { type: "system", text: `\u21A9\uFE0F Piste supprimee: "${removed?.prompt?.slice(0, 40)}"` });
        broadcastCompUpdate(broadcast, info.channel, comp.id, "track_removed", { trackCount: comp.tracks.length });
        return;
      }

      case "/solo": {
        const trackNum = parseInt(text.slice(6).trim());
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: `Usage: /solo <piste#>` }); return;
        }
        // Set all tracks volume to 0 except target
        comp.tracks.forEach((t, i) => { t.volume = i === trackNum - 1 ? 100 : 0; });
        send(ws, { type: "system", text: `\u{1F508} Solo piste #${trackNum}: "${comp.tracks[trackNum-1].prompt.slice(0, 40)}"` });
        return;
      }

      case "/unsolo": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) { send(ws, { type: "system", text: "Pas de composition." }); return; }
        comp.tracks.forEach(t => { t.volume = 100; });
        send(ws, { type: "system", text: "\u{1F50A} Toutes les pistes a 100%" });
        return;
      }

      case "/rename": {
        const newName = text.slice(8).trim();
        if (!newName) { send(ws, { type: "system", text: "Usage: /rename <nouveau nom>" }); return; }
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) { send(ws, { type: "system", text: "Pas de composition active." }); return; }
        comp.name = newName.slice(0, 100);
        send(ws, { type: "system", text: `\u270F\uFE0F Composition renommee: ${comp.name}` });
        return;
      }

      case "/duplicate":
      case "/dup": {
        const trackNum = parseInt(text.split(/\s+/)[1] || "");
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: `Usage: /dup <piste#>` }); return;
        }
        const src = comp.tracks[trackNum - 1];
        const newTrack = addTrack(comp.id, { type: src.type, prompt: src.prompt + " (copie)", duration: src.duration, volume: src.volume, startMs: 0 });
        if (newTrack && src.filePath && fs.existsSync(src.filePath)) {
          const newPath = path.join(process.cwd(), "data", "compositions", comp.id, newTrack.id + ".wav");
          fs.copyFileSync(src.filePath, newPath);
          newTrack.filePath = newPath;
        }
        send(ws, { type: "system", text: `\u{1f4cb} Piste #${trackNum} dupliquee \u2192 #${comp.tracks.length}` });
        return;
      }

      case "/bpm": {
        const bpmVal = parseInt(text.slice(5).trim());
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) { send(ws, { type: "system", text: "Pas de composition active." }); return; }
        if (bpmVal && bpmVal >= 20 && bpmVal <= 300) {
          (comp as any).bpm = bpmVal;
          send(ws, { type: "system", text: `\u{1f941} BPM: ${bpmVal}` });
        } else {
          send(ws, { type: "system", text: `BPM: ${(comp as any).bpm || "non defini"}. Usage: /bpm <20-300>` });
        }
        return;
      }

      case "/clear-comp": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) { send(ws, { type: "system", text: "Pas de composition active." }); return; }
        for (const t of comp.tracks) {
          if (t.filePath && fs.existsSync(t.filePath)) fs.unlinkSync(t.filePath);
        }
        comp.tracks = [];
        send(ws, { type: "system", text: `\u{1f5d1}\ufe0f Composition "${comp.name}" videe` });
        return;
      }



      case "/loop": {
        const args = text.slice(6).trim().split(/\s+/);
        const trackNum = parseInt(args[0] || "");
        const times = Math.min(10, Math.max(2, parseInt(args[1] || "2")));
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /loop <piste#> <fois>" }); return;
        }
        const track = comp.tracks[trackNum - 1];
        if (!track.filePath || !fs.existsSync(track.filePath)) {
          send(ws, { type: "system", text: "Piste sans fichier audio." }); return;
        }
        // Create concat file
        const concatFile = track.filePath + ".concat.txt";
        fs.writeFileSync(concatFile, Array(times).fill(`file '${track.filePath}'`).join("\n"));
        const tmpPath = track.filePath + ".loop.wav";
        execFileSync("ffmpeg", ["-f", "concat", "-safe", "0", "-i", concatFile, "-y", tmpPath], { timeout: 30000 });
        fs.renameSync(tmpPath, track.filePath);
        fs.unlinkSync(concatFile);
        track.duration *= times;
        send(ws, { type: "system", text: `\u{1F501} Piste #${trackNum} loopee x${times} (${track.duration}s)` });
        return;
      }

      case "/swap": {
        const args = text.slice(6).trim().split(/\s+/);
        const a = parseInt(args[0]) - 1;
        const b = parseInt(args[1]) - 1;
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(a) || isNaN(b) || a < 0 || b < 0 || a >= comp.tracks.length || b >= comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /swap <piste#> <piste#>" }); return;
        }
        [comp.tracks[a], comp.tracks[b]] = [comp.tracks[b], comp.tracks[a]];
        send(ws, { type: "system", text: `\u{1F500} Pistes #${a+1} et #${b+1} echangees` });
        return;
      }

      case "/info": {
        const trackNum = parseInt(text.slice(6).trim());
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /info <piste#>" }); return;
        }
        const t = comp.tracks[trackNum - 1];
        const icon = t.type === "voice" ? "\u{1F399}\uFE0F" : t.type === "sfx" ? "\u{1F50A}" : "\u{1F3B5}";
        let fileInfo = "pas de fichier";
        if (t.filePath && fs.existsSync(t.filePath)) {
          const stat = fs.statSync(t.filePath);
          fileInfo = `${Math.round(stat.size / 1024)} KB`;
        }
        send(ws, { type: "system", text: [
          `${icon} Piste #${trackNum}`,
          `  Type: ${t.type}`,
          `  Prompt: ${t.prompt}`,
          `  Duree: ${t.duration}s`,
          `  Volume: ${t.volume}%`,
          `  Fichier: ${fileInfo}`,
          `  Cree: ${t.createdAt}`,
        ].join("\n") });
        return;
      }

      case "/concat": {
        const args = text.slice(8).trim().split(/\s+/);
        const a = parseInt(args[0]) - 1;
        const b = parseInt(args[1]) - 1;
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(a) || isNaN(b) || a < 0 || b < 0 || a >= comp.tracks.length || b >= comp.tracks.length || a === b) {
          send(ws, { type: "system", text: "Usage: /concat <piste#> <piste#> — concatene B apres A" }); return;
        }
        const tA = comp.tracks[a], tB = comp.tracks[b];
        if (!tA.filePath || !tB.filePath || !fs.existsSync(tA.filePath) || !fs.existsSync(tB.filePath)) {
          send(ws, { type: "system", text: "Les deux pistes doivent avoir des fichiers." }); return;
        }
        const concatFile = tA.filePath + ".concat.txt";
        fs.writeFileSync(concatFile, `file '${tA.filePath}'\nfile '${tB.filePath}'`);
        const tmp = tA.filePath + ".cat.wav";
        execFileSync("ffmpeg", ["-f", "concat", "-safe", "0", "-i", concatFile, "-y", tmp], { timeout: 30000 });
        fs.renameSync(tmp, tA.filePath);
        fs.unlinkSync(concatFile);
        tA.duration += tB.duration;
        tA.prompt += " + " + tB.prompt.slice(0, 30);
        if (tB.filePath && fs.existsSync(tB.filePath)) fs.unlinkSync(tB.filePath);
        comp.tracks.splice(b, 1);
        send(ws, { type: "system", text: `🔗 Pistes #${a+1} + #${b+1} concatenees → #${a+1} (${tA.duration}s)` });
        return;
      }

      case "/silence": {
        const dur = Math.min(60, Math.max(1, parseInt(text.slice(9).trim() || "5")));
        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) comp = createComposition(info.nick, info.channel);
        const track = addTrack(comp.id, { type: "sfx", prompt: `silence ${dur}s`, duration: dur, volume: 0, startMs: 0 });
        if (track) {
          const trackPath = path.join(process.cwd(), "data", "compositions", comp.id, `${track.id}.wav`);
          fs.mkdirSync(path.dirname(trackPath), { recursive: true });
          execFileSync("ffmpeg", ["-f", "lavfi", "-i", "anullsrc=r=32000:cl=mono", "-t", String(dur), trackPath], { timeout: 15000 });
          track.filePath = trackPath;
        }
        send(ws, { type: "system", text: `⏸️ Silence ${dur}s ajoute (piste ${comp.tracks.length})` });
        return;
      }

      case "/play": {
        broadcast(info.channel, { type: "system", text: `__playback__play__${info.nick}` } as any);
        return;
      }

      case "/stop-all": {
        broadcast(info.channel, { type: "system", text: `__playback__stop__${info.nick}` } as any);
        return;
      }

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
    }
  };
}

/* ------------------------------------------------------------------ */
/*  /compose handler                                                   */
/* ------------------------------------------------------------------ */

async function handleComposeCommand({
  ws,
  info,
  text,
  broadcast,
  send,
  logChatMessage,
}: {
  ws: import("ws").WebSocket;
  info: import("./chat-types.js").ClientInfo;
  text: string;
  broadcast: (channel: string, msg: import("./chat-types.js").OutboundMessage, exclude?: import("ws").WebSocket) => void;
  send: (ws: import("ws").WebSocket, msg: import("./chat-types.js").OutboundMessage) => void;
  logChatMessage: (entry: import("./chat-types.js").ChatLogEntry) => void;
}): Promise<void> {
  const rawPrompt = text.slice(9).trim();
  const durationMatch = rawPrompt.match(/(\d+)s\s*$/);
  const duration = durationMatch ? Math.min(Math.max(parseInt(durationMatch[1], 10), 5), 120) : 30;
  let musicPrompt = durationMatch ? rawPrompt.replace(/,?\s*\d+s\s*$/, '').trim() : rawPrompt;

  if (!musicPrompt) {
    send(ws, { type: "system", text: "Usage: /compose <description>, <style>, <duree>s" });
    return;
  }

  if (musicPrompt.length > 1000) {
    send(ws, { type: "system", text: "Prompt trop long (max 1000 chars)" });
    return;
  }

  const styleKeywords = [
    "ambient", "drone", "noise", "glitch", "industrial", "techno", "house",
    "jazz", "free-jazz", "experimental", "electroacoustique", "concrete",
    "classical", "orchestral", "cinematic", "epic", "dark", "minimal",
    "hip-hop", "trap", "lo-fi", "chillwave", "synthwave", "vaporwave",
    "metal", "punk", "post-rock", "shoegaze", "dream-pop",
    "world", "african", "arabic", "indian", "gamelan", "folk",
    "acousmatic", "granular", "spectral", "field-recording",
  ];
  const detectedStyles = styleKeywords.filter(s => musicPrompt.toLowerCase().includes(s));
  if (detectedStyles.length === 0 && !musicPrompt.toLowerCase().includes("style")) {
    musicPrompt += ", experimental style";
  }
  if (!musicPrompt) {
    send(ws, { type: "system", text: [
      "Usage: /compose <description>, <style>, <duree>s",
      "",
      "Styles disponibles:",
      "  ambient, drone, noise, glitch, industrial, techno, house",
      "  jazz, free-jazz, experimental, electroacoustique, concrete",
      "  classical, orchestral, cinematic, epic, dark, minimal",
      "  hip-hop, trap, lo-fi, chillwave, synthwave, vaporwave",
      "  metal, punk, post-rock, shoegaze, dream-pop",
      "  world, african, arabic, indian, gamelan, folk",
      "  acousmatic, granular, spectral, field-recording",
      "",
      "Exemples:",
      "  /compose ambient drone with deep bass, experimental, 30s",
      "  /compose dark industrial noise, glitch, 60s",
      "  /compose lo-fi hip-hop beats, chill, 120s",
      "  /compose musique concrete avec sons metalliques, acousmatic, 30s",
    ].join("\n") });
    return;
  }

  broadcast(info.channel, {
    type: "system",
    text: `${info.nick} compose: "${musicPrompt}" (${duration}s)... generation en cours`,
  });

  const ttsUrl = process.env.TTS_URL || "http://127.0.0.1:9100";
  const startTime = Date.now();

  const progressInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const dots = "\u00b7".repeat(Math.min(elapsed, 30));
    const spinner = ["\u280b","\u2819","\u2839","\u2838","\u283c","\u2834","\u2826","\u2827","\u2807","\u280f"][elapsed % 10];
    broadcast(info.channel, { type: "system", text: `\u{1F3B5} ${spinner} Composition en cours ${dots} ${elapsed}s` });
  }, 5000);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);

    const resp = await fetch(`${ttsUrl}/compose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: musicPrompt, duration }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    clearInterval(progressInterval);

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
      send(ws, { type: "system", text: `Composition echouee (${elapsed}s): ${body.error || "unknown"}` });
      return;
    }

    const audioBuffer = Buffer.from(await resp.arrayBuffer());
    if (audioBuffer.length > 50 * 1024 * 1024) {
      send(ws, { type: "system", text: "Audio trop volumineux (>50MB) \u2014 essaie une duree plus courte." });
      return;
    }
    const audioBase64 = audioBuffer.toString("base64");

    broadcast(info.channel, {
      type: "music",
      nick: info.nick,
      text: `[Musique: "${musicPrompt}" \u2014 ${elapsed}s]`,
      audioData: audioBase64,
      audioMime: "audio/wav",
    } as OutboundMessage);

    saveAudio({ base64: audioBase64, prompt: musicPrompt, nick: info.nick, channel: info.channel }).catch(() => {});

    logChatMessage({
      ts: new Date().toISOString(),
      channel: info.channel,
      nick: info.nick,
      type: "system",
      text: `[Musique generee: "${musicPrompt}" (${elapsed}s)]`,
    });
  } catch (err) {
    clearInterval(progressInterval);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("timeout");
    send(ws, {
      type: "system",
      text: isTimeout
        ? `Composition timeout apres ${elapsed}s \u2014 la generation a pris trop de temps.`
        : `Erreur composition (${elapsed}s): ${msg}`,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  /imagine handler                                                   */
/* ------------------------------------------------------------------ */

async function handleImagineCommand({
  ws,
  info,
  text,
  broadcast,
  send,
  logChatMessage,
}: {
  ws: import("ws").WebSocket;
  info: import("./chat-types.js").ClientInfo;
  text: string;
  broadcast: (channel: string, msg: import("./chat-types.js").OutboundMessage, exclude?: import("ws").WebSocket) => void;
  send: (ws: import("ws").WebSocket, msg: import("./chat-types.js").OutboundMessage) => void;
  logChatMessage: (entry: import("./chat-types.js").ChatLogEntry) => void;
}): Promise<void> {
  const imagePrompt = text.slice(9).trim();
  if (!imagePrompt) {
    send(ws, { type: "system", text: "Usage: /imagine <description de l'image>" });
    return;
  }
  if (imagePrompt.length > 500) {
    send(ws, { type: "system", text: "Prompt trop long (max 500 chars)" });
    return;
  }

  broadcast(info.channel, {
    type: "system",
    text: `${info.nick} genere une image: "${imagePrompt}"... (generation ~10-30s)`,
  });

  const startTime = Date.now();
  const progressInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const spinnerImg = ["\u280b","\u2819","\u2839","\u2838","\u283c","\u2834","\u2826","\u2827","\u2807","\u280f"][elapsed % 10];
    const dotsImg = "\u00b7".repeat(Math.min(elapsed, 20));
    broadcast(info.channel, { type: "system", text: `\u{1F3A8} ${spinnerImg} Generation image ${dotsImg} ${elapsed}s` });
  }, 5000);

  try {
    const result = await generateImage(imagePrompt);
    clearInterval(progressInterval);
    if (!result) {
      broadcast(info.channel, { type: "system", text: "\u{1F3A8} Generation echouee \u2014 verifiez ComfyUI" });
      return;
    }

    broadcast(info.channel, {
      type: "image",
      nick: info.nick,
      text: `[Image generee: "${imagePrompt}" seed:${result.seed}${result.model ? ` model:${result.model}` : ""}${result.lora ? ` lora:${result.lora}` : ""}]`,
      imageData: result.imageBase64,
      imageMime: "image/png",
    } as OutboundMessage);

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
