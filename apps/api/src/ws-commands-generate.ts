import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { scheduler, VRAM_BUDGETS } from "./inference-scheduler.js";
import type { WebSocket } from "ws";
import { generateImage, type ImageProgress } from "./comfyui.js";
import { saveImage, saveAudio } from "./media-store.js";
import type { OutboundMessage } from "./chat-types.js";
import type { CommandContext, CommandHandlerDeps } from "./ws-commands-types.js";
import { createComposition, getComposition, getActiveComposition, setActiveComposition, addTrack, listCompositions } from "./composition-store.js";


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
  "/play", "/stop-all", "/template", "/marker",
  "/metronome", "/delete", "/preview", "/gain",
  "/suggest", "/snapshot", "/randomize",
  "/glitch", "/stretch", "/bounce", "/stem",
  "/mp3",
  "/drone", "/grain", "/circus", "/honk", "/kokoro",
  "/variations",
  "/imagine-queue",
  "/upscale",
  "/imagine-gallery",
  "/imagine-redo",
  "/help-imagine",
  "/sfx",
  "/jam",
  "/mixtape",
  "/imagine-compare",
  "/help-compose",
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

      case "/imagine-queue": {
        const prompts = text.slice(15).split("|").map(p => p.trim()).filter(p => p.length > 0);
        if (prompts.length === 0) { send(ws, { type: "system", text: "Usage: /imagine-queue prompt1 | prompt2 | prompt3" }); return; }
        if (prompts.length > 8) { send(ws, { type: "system", text: "Maximum 8 prompts par queue." }); return; }

        broadcast(info.channel, { type: "system", text: `Queue de ${prompts.length} images...` });

        for (let i = 0; i < prompts.length; i++) {
          broadcast(info.channel, { type: "system", text: `[${i + 1}/${prompts.length}] "${prompts[i].slice(0, 40)}..."` });
          try {
            const result = await scheduler.submit({
              id: crypto.randomUUID(), device: "gpu", priority: "normal",
              label: `queue-${i + 1}`, vramMB: VRAM_BUDGETS.comfyui,
              execute: () => generateImage(prompts[i]),
            });
            if (result) {
              broadcast(info.channel, {
                type: "image", nick: info.nick,
                text: `[Queue ${i + 1}/${prompts.length}: "${prompts[i]}"]`,
                imageData: result.imageBase64, imageMime: "image/png",
              } as OutboundMessage);
            }
          } catch {}
        }
        send(ws, { type: "system", text: `Queue terminee: ${prompts.length} images.` });
        return;
      }

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
        lines.push(`  --- Total: ${models.length} modeles (${checkpoints.length} checkpoints, ${loras.length} LoRAs) | /imagine --model <name> pour forcer`);
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
          send(ws, { type: "system", text: "__comp_loaded__" + JSON.stringify({ compId: comp.id, name: comp.name, trackCount: 0 }) } as any);
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
          const comp = setActiveComposition(info.nick, info.channel, compId);
          if (!comp) { send(ws, { type: "system", text: `Composition ${compId} introuvable.` }); return; }
          send(ws, { type: "system", text: `📂 Composition chargee: ${comp.name} (${comp.tracks.length} pistes)` });
          send(ws, { type: "system", text: "__comp_loaded__" + JSON.stringify({ compId: comp.id, name: comp.name, trackCount: comp.tracks.length }) } as any);
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
        if (action === "rename") {
          const newName = sub.slice(1).join(" ");
          if (!newName) { send(ws, { type: "system", text: "Usage: /comp rename <nouveau nom>" }); return; }
          const comp = getActiveComposition(info.nick, info.channel);
          if (!comp) { send(ws, { type: "system", text: "Pas de composition active." }); return; }
          comp.name = newName;
          send(ws, { type: "system", text: `Composition renommee: ${newName}` });
          return;
        }
        send(ws, { type: "system", text: "Usage: /comp new|list|save|load|delete|rename" });
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
          const audioBuffer = await scheduler.submit({
            id: crypto.randomUUID(),
            device: "gpu",
            priority: "normal",
            label: `/layer "${prompt}" ${duration}s`,
            vramMB: VRAM_BUDGETS.musicgen,
            execute: async () => {
              const resp = await fetch(`${ttsUrl}/compose`, {
                method: "POST", headers: { "Content-Type": "application/json" },
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
          // Also generate MP3 version
          try {
            const mp3Path = outPath.replace(".wav", ".mp3");
            execFileSync("ffmpeg", ["-i", outPath, "-codec:a", "libmp3lame", "-b:a", "192k", "-y", mp3Path], { timeout: 30000 });
          } catch { /* MP3 conversion optional */ }

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

        broadcast(info.channel, { type: "system", text: `\u{1F399}\uFE0F ${info.nick} ajoute une voix: ${personaNick} \u2014 "${voiceText}"` });

        const voiceTtsUrl = process.env.TTS_URL || "http://127.0.0.1:9100";
        try {
          const audioBuffer = await scheduler.submit({
            id: crypto.randomUUID(),
            device: "cpu",
            priority: "normal",
            label: `/voice ${personaNick}`,
            execute: async () => {
              const resp = await fetch(`${voiceTtsUrl}/synthesize`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: voiceText, persona: personaNick.toLowerCase() }),
                signal: AbortSignal.timeout(30_000),
              });
              if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}`);
              return Buffer.from(await resp.arrayBuffer());
            },
          });
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
        // /master [ref_track#] — auto-master mix. With ref track: Matchering AI. Without: ffmpeg loudnorm.
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) { send(ws, { type: "system", text: "Pas de composition." }); return; }
        const mixPath = path.join(process.cwd(), "data", "compositions", comp.id, "mix.wav");
        if (!fs.existsSync(mixPath)) { send(ws, { type: "system", text: "/mix d'abord." }); return; }

        const refArg = parts[1];
        const masterPath = path.join(process.cwd(), "data", "compositions", comp.id, "master.wav");

        // If reference track specified → Matchering AI mastering
        if (refArg && /^\d+$/.test(refArg)) {
          const refIdx = parseInt(refArg) - 1;
          const refTrack = comp.tracks[refIdx];
          if (!refTrack?.filePath || !fs.existsSync(refTrack.filePath)) {
            send(ws, { type: "system", text: `Piste #${refArg} introuvable. /master <piste#>` }); return;
          }
          broadcast(info.channel, { type: "system", text: `\u{1F39B}\uFE0F Mastering AI (reference: piste #${refArg})...` });
          try {
            const AI_BRIDGE_URL = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";
            const targetBuf = fs.readFileSync(mixPath);
            const refBuf = fs.readFileSync(refTrack.filePath);
            const resp = await fetch(`${AI_BRIDGE_URL}/master`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ target: targetBuf.toString("base64"), reference: refBuf.toString("base64") }),
              signal: AbortSignal.timeout(120_000),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const masterBuf = Buffer.from(await resp.arrayBuffer());
            fs.writeFileSync(masterPath, masterBuf);
          } catch (err) {
            send(ws, { type: "system", text: `Erreur Matchering: ${err instanceof Error ? err.message : String(err)}. Fallback ffmpeg...` });
            execFileSync("ffmpeg", ["-i", mixPath, "-af", "loudnorm,acompressor=threshold=-20dB:ratio=4:attack=5:release=50,alimiter=limit=0.95", "-ar", "44100", "-y", masterPath], { timeout: 60000 });
          }
        } else {
          // No reference → ffmpeg mastering
          broadcast(info.channel, { type: "system", text: "\u{1F39B}\uFE0F Mastering (loudnorm + compressor)..." });
          execFileSync("ffmpeg", ["-i", mixPath, "-af", "loudnorm,acompressor=threshold=-20dB:ratio=4:attack=5:release=50,alimiter=limit=0.95", "-ar", "44100", "-y", masterPath], { timeout: 60000 });
        }

        const audioBuffer = fs.readFileSync(masterPath);
        broadcast(info.channel, {
          type: "music", nick: info.nick,
          text: `[Master: ${comp.name} \u2014 ${comp.tracks.length} pistes, 44.1kHz${refArg ? " (AI ref)" : ""}]`,
          audioData: audioBuffer.toString("base64"), audioMime: "audio/wav",
        } as any);
        send(ws, { type: "system", text: `\u2705 Master termine. Download: /api/v2/media/compositions/${comp.id}/master` });
        broadcastCompUpdate(broadcast, info.channel, comp.id, "master_complete");
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

          await scheduler.submit({
            id: crypto.randomUUID(),
            device: "cpu",
            priority: "low",
            label: `/noise ${noiseType} ${noiseDur}s`,
            execute: async () => {
              execFileSync("ffmpeg", ["-f", "lavfi", "-i", filter, "-t", String(noiseDur), "-ar", "32000", "-ac", "1", trackPath], { timeout: 30000 });
            },
          });

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

        // Fast AI ambient (uses ffmpeg instruments, instant)
        if (ambPrompt.includes("ai") || ambPrompt.includes("generatif") || ambPrompt.includes("instant")) {
          const AI_BRIDGE_URL = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";
          try {
            const resp = await fetch(`${AI_BRIDGE_URL}/instrument/pad`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "warm", duration: 60, chord: "Am" }),
              signal: AbortSignal.timeout(15_000),
            });
            if (resp.ok) {
              const audioBuffer = Buffer.from(await resp.arrayBuffer());
              broadcast(info.channel, {
                type: "music", nick: info.nick,
                text: `[Ambient AI: "${ambPrompt}" \u2014 generatif instantane]`,
                audioData: audioBuffer.toString("base64"), audioMime: "audio/wav",
              } as any);
              return;
            }
          } catch { /* Fall through to MusicGen */ }
        }

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
        // Slight prompt variation for remix: append a variation hint + random seed
        const variations = ["avec plus d'energie", "version alternative", "plus experimental", "variation subtile", "remix libre", "plus atmospherique"];
        const variation = variations[Math.floor(Math.random() * variations.length)];
        const remixPrompt = `${track.prompt} (${variation})`;
        const remixSeed = Math.floor(Math.random() * 2147483647);
        broadcast(info.channel, { type: "system", text: `\u{1F504} Remix piste #${trackNum}: "${track.prompt}" \u2192 ${variation} (seed ${remixSeed})...` });

        const remixTtsUrl = process.env.TTS_URL || "http://127.0.0.1:9100";
        try {
          const resp = await fetch(`${remixTtsUrl}/compose`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: remixPrompt, duration: track.duration, seed: remixSeed }),
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



      case "/preview": {
        const previewArg = text.slice(9).trim();
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) { send(ws, { type: "system", text: "Pas de composition active." }); return; }

        // No argument: preview full mix/master
        if (!previewArg) {
          const mixPath = path.join(process.cwd(), "data", "compositions", comp.id, "mix.wav");
          const masterPath = path.join(process.cwd(), "data", "compositions", comp.id, "master.wav");
          const sourcePath = fs.existsSync(masterPath) ? masterPath : fs.existsSync(mixPath) ? mixPath : null;
          if (!sourcePath) { send(ws, { type: "system", text: "/mix d'abord." }); return; }
          const buf = fs.readFileSync(sourcePath);
          send(ws, {
            type: "music", nick: info.nick,
            text: `[Preview: ${comp.name}]`,
            audioData: buf.toString("base64"), audioMime: "audio/wav",
          } as any);
          return;
        }

        // With track number: preview single track
        const trackNum = parseInt(previewArg);
        if (isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: `Usage: /preview [piste#]` }); return;
        }
        const track = comp.tracks[trackNum - 1];
        if (!track.filePath || !fs.existsSync(track.filePath)) {
          send(ws, { type: "system", text: "Piste sans fichier audio." }); return;
        }
        const buf = fs.readFileSync(track.filePath);
        send(ws, { type: "music", nick: info.nick, text: `[Preview #${trackNum}: ${track.prompt.slice(0, 40)}]`, audioData: buf.toString("base64"), audioMime: "audio/wav" } as any);
        return;
      }

      case "/gain": {
        const args = text.slice(6).trim().split(/\s+/);
        const trackNum = parseInt(args[0]) - 1;
        const db = parseFloat(args[1] || "0");
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 0 || trackNum >= comp.tracks.length || isNaN(db)) {
          send(ws, { type: "system", text: "Usage: /gain <piste#> <dB> (ex: /gain 1 -3)" }); return;
        }
        const track = comp.tracks[trackNum];
        if (!track.filePath || !fs.existsSync(track.filePath)) { send(ws, { type: "system", text: "Piste sans fichier." }); return; }
        const tmp = track.filePath + ".gain.wav";
        execFileSync("ffmpeg", ["-i", track.filePath, "-af", `volume=${db}dB`, "-y", tmp], { timeout: 30000 });
        fs.renameSync(tmp, track.filePath);
        send(ws, { type: "system", text: `\u{1F50A} Gain ${db > 0 ? "+" : ""}${db}dB piste #${trackNum + 1}` });
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
          const list = Object.keys(templates).map(k => `  ${k} (${templates[k].length} pistes)`).join("\n");
          send(ws, { type: "system", text: `Templates:\n${list}\nUsage: /template <nom>` });
          return;
        }

        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) comp = createComposition(info.nick, info.channel, name);

        broadcast(info.channel, { type: "system", text: `\ud83d\udccb Template "${name}" \u2014 ${templates[name].length} pistes en generation...` });

        // Generate each track sequentially
        for (const t of templates[name]) {
          if (t.type === "noise") {
            const [noiseType, dur] = t.prompt.split(" ");
            // Generate noise inline
            const track = addTrack(comp.id, { type: "noise" as any, prompt: `${noiseType} noise ${dur}s`, duration: parseInt(dur), volume: 100, startMs: 0 });
            if (track) {
              const { execFileSync } = await import("node:child_process");
              const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
              fs.mkdirSync(trackDir, { recursive: true });
              const trackPath = path.join(trackDir, `${track.id}.wav`);
              const types: Record<string, string> = { white: "anoisesrc=d=DUR:c=white", pink: "anoisesrc=d=DUR:c=pink", brown: "anoisesrc=d=DUR:c=brown", sine: "sine=frequency=220:duration=DUR", drone: "sine=frequency=55:duration=DUR,tremolo=f=0.1:d=0.7" };
              const filter = (types[noiseType] || types.white).replace(/DUR/g, dur);
              execFileSync("ffmpeg", ["-f", "lavfi", "-i", filter, "-t", dur, "-ar", "32000", "-ac", "1", trackPath], { timeout: 15000 });
              track.filePath = trackPath;
            }
          } else if (t.type === "voice") {
            // TTS
            try {
              const ttsUrl = process.env.TTS_URL || "http://127.0.0.1:9100";
              const resp = await fetch(`${ttsUrl}/synthesize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t.prompt, persona: "pharmacius" }), signal: AbortSignal.timeout(30000) });
              if (resp.ok) {
                const buf = Buffer.from(await resp.arrayBuffer());
                const track = addTrack(comp.id, { type: "voice" as any, prompt: `Pharmacius: "${t.prompt}"`, duration: t.duration, volume: 100, startMs: 0 });
                if (track) {
                  const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
                  fs.mkdirSync(trackDir, { recursive: true });
                  const trackPath = path.join(trackDir, `${track.id}.wav`);
                  fs.writeFileSync(trackPath, buf);
                  track.filePath = trackPath;
                }
              }
            } catch { /* TTS unavailable, skip voice track */ }
          }
          // Skip /layer type for now (requires GPU, too slow for template)
        }

        send(ws, { type: "system", text: `\u2705 Template "${name}" charge: ${comp.tracks.length} pistes. /mix pour mixer.` });
        return;
      }

      case "/marker": {
        const markerText = text.slice(8).trim();
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) { send(ws, { type: "system", text: "Pas de composition." }); return; }
        if (!markerText) {
          const markers = (comp as any).markers || [];
          send(ws, { type: "system", text: markers.length ? `Markers:\n${markers.map((m: any, i: number) => `  ${i+1}. [${m.time}s] ${m.label}`).join("\n")}` : "Aucun marker. /marker <label> [at Ns]" });
          return;
        }
        const atMatch = markerText.match(/(.+?)\s+at\s+(\d+)s?$/);
        const label = atMatch ? atMatch[1] : markerText;
        const time = atMatch ? parseInt(atMatch[2]) : 0;
        if (!(comp as any).markers) (comp as any).markers = [];
        (comp as any).markers.push({ label, time });
        send(ws, { type: "system", text: `\ud83d\udccd Marker ajoute: "${label}" a ${time}s` });
        return;
      }

      case "/metronome": {
        const bpmVal = parseInt(text.slice(11).trim()) || 120;
        const dur = 30;
        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) comp = createComposition(info.nick, info.channel);
        const track = addTrack(comp.id, { type: "sfx" as any, prompt: `metronome ${bpmVal}bpm`, duration: dur, volume: 50, startMs: 0 });
        if (track) {
          const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
          fs.mkdirSync(trackDir, { recursive: true });
          const trackPath = path.join(trackDir, `${track.id}.wav`);
          const beatInterval = 60 / bpmVal;
          execFileSync("ffmpeg", ["-f", "lavfi", "-i", `sine=frequency=1000:duration=0.05,apad=whole_dur=${dur}`, "-af", `aecho=1:1:${Math.round(beatInterval*1000)}:1`, "-t", String(dur), "-ar", "32000", "-ac", "1", "-y", trackPath], { timeout: 15000 });
          track.filePath = trackPath;
          const buf = fs.readFileSync(trackPath);
          broadcast(info.channel, { type: "music", nick: info.nick, text: `[Metronome ${bpmVal} BPM]`, audioData: buf.toString("base64"), audioMime: "audio/wav" } as any);
          send(ws, { type: "system", text: `\ud83e\udd41 Metronome ${bpmVal} BPM ajoute (piste ${comp.tracks.length})` });
        }
        return;
      }

      case "/delete": {
        const trackNum = parseInt(text.slice(8).trim());
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 1 || trackNum > comp.tracks.length) {
          send(ws, { type: "system", text: `Usage: /delete <piste# 1-${comp?.tracks.length || "?"}>` }); return;
        }
        const removed = comp.tracks.splice(trackNum - 1, 1)[0];
        if (removed?.filePath && fs.existsSync(removed.filePath)) fs.unlinkSync(removed.filePath);
        send(ws, { type: "system", text: `\ud83d\uddd1\ufe0f Piste #${trackNum} supprimee: "${removed?.prompt?.slice(0, 40)}"` });
        broadcastCompUpdate(broadcast, info.channel, comp.id, "track_removed", { trackCount: comp.tracks.length });
        return;
      }

      case "/suggest": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || comp.tracks.length === 0) {
          send(ws, { type: "system", text: "Ajoute d'abord des pistes. /layer ou /noise" }); return;
        }

        const trackList = comp.tracks.map((t, i) => `#${i+1} [${t.type}] ${t.prompt} (${t.duration}s)`).join("\n");

        send(ws, { type: "system", text: "\ud83e\udd14 Analyse de la composition..." });

        try {
          const suggestOllamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
          const resp = await fetch(`${suggestOllamaUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "qwen3.5:9b",
              messages: [{ role: "user", content: `Tu es un compositeur expert. Voici une composition multi-pistes:\n${trackList}\n\nSuggere la prochaine piste a ajouter (type, style, duree). Reponds en une phrase avec la commande exacte a taper. Exemples:\n/layer dark pad with filter sweep, ambient, 30s\n/voice Schaeffer "Le son revele l'invisible"\n/noise pink 15\nReponds UNIQUEMENT la commande.` }],
              stream: false, options: { num_predict: 100 }, keep_alive: "30m", think: false,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (resp.ok) {
            const data = await resp.json() as { message?: { content?: string } };
            const suggestion = (data.message?.content || "").trim();
            send(ws, { type: "system", text: `\ud83d\udca1 Suggestion: ${suggestion}` });
          }
        } catch {
          send(ws, { type: "system", text: "Suggestion indisponible." });
        }
        return;
      }

      case "/snapshot": {
        const label = text.slice(10).trim() || `v${Date.now()}`;
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) { send(ws, { type: "system", text: "Pas de composition." }); return; }

        const snapshotDir = path.join(process.cwd(), "data", "compositions", comp.id, "snapshots");
        fs.mkdirSync(snapshotDir, { recursive: true });
        fs.writeFileSync(path.join(snapshotDir, `${label}.json`), JSON.stringify(comp, null, 2));
        send(ws, { type: "system", text: `\ud83d\udcf8 Snapshot "${label}" sauvegarde` });
        return;
      }

      case "/randomize": {
        const dur = parseInt(text.slice(11).trim()) || 30;
        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) comp = createComposition(info.nick, info.channel, "Random " + Date.now().toString(36));

        broadcast(info.channel, { type: "system", text: `\ud83c\udfb2 Generation aleatoire ${dur}s...` });

        const noiseTypes = ["white", "pink", "brown", "sine", "drone"];
        const count = 2 + Math.floor(Math.random() * 3); // 2-4 tracks

        for (let i = 0; i < count; i++) {
          const noiseType = noiseTypes[Math.floor(Math.random() * noiseTypes.length)];
          const trackDur = Math.max(5, Math.min(dur, 10 + Math.floor(Math.random() * 20)));
          const track = addTrack(comp.id, { type: "sfx" as any, prompt: `${noiseType} noise ${trackDur}s`, duration: trackDur, volume: 30 + Math.floor(Math.random() * 70), startMs: Math.floor(Math.random() * dur * 500) });
          if (track) {
            const trackPath = path.join(process.cwd(), "data", "compositions", comp.id, `${track.id}.wav`);
            const types: Record<string, string> = { white: "anoisesrc=d=DUR:c=white", pink: "anoisesrc=d=DUR:c=pink", brown: "anoisesrc=d=DUR:c=brown", sine: "sine=frequency=" + (100 + Math.floor(Math.random() * 500)) + ":duration=DUR", drone: "sine=frequency=" + (40 + Math.floor(Math.random() * 80)) + ":duration=DUR,tremolo=f=" + (0.05 + Math.random() * 0.2).toFixed(2) + ":d=0.7" };
            const filter = (types[noiseType] || types.white).replace(/DUR/g, String(trackDur));
            execFileSync("ffmpeg", ["-f", "lavfi", "-i", filter, "-t", String(trackDur), "-ar", "32000", "-ac", "1", "-y", trackPath], { timeout: 15000 });
            track.filePath = trackPath;
          }
        }

        send(ws, { type: "system", text: `\ud83c\udfb2 ${comp.tracks.length} pistes generees aleatoirement. /mix pour ecouter.` });
        return;
      }


      case "/glitch": {
        const trackNum = parseInt(text.slice(8).trim().split(/\s+/)[0]) - 1;
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 0 || trackNum >= comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /glitch <piste#>" }); return;
        }
        const track = comp.tracks[trackNum];
        if (!track.filePath || !fs.existsSync(track.filePath)) { send(ws, { type: "system", text: "Piste sans fichier." }); return; }
        const tmp = track.filePath + ".glitch.wav";
        const bits = 4 + Math.floor(Math.random() * 8);
        const freq = (1 + Math.random() * 10).toFixed(1);
        execFileSync("ffmpeg", ["-i", track.filePath, "-af", `acrusher=bits=${bits}:mix=0.7,tremolo=f=${freq}:d=0.8,aphaser=type=t:speed=2`, "-y", tmp], { timeout: 30000 });
        fs.renameSync(tmp, track.filePath);
        send(ws, { type: "system", text: `\ud83d\udd00 Glitch piste #${trackNum+1} (bits:${bits} trem:${freq}Hz)` });
        return;
      }

      case "/stretch": {
        const args = text.slice(9).trim().split(/\s+/);
        const trackNum = parseInt(args[0]) - 1;
        const factor = parseFloat(args[1] || "2");
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || isNaN(trackNum) || trackNum < 0 || trackNum >= comp.tracks.length) {
          send(ws, { type: "system", text: "Usage: /stretch <piste#> <facteur 0.5-4>" }); return;
        }
        const track = comp.tracks[trackNum];
        if (!track.filePath || !fs.existsSync(track.filePath)) { send(ws, { type: "system", text: "Piste sans fichier." }); return; }
        const clamp = Math.min(4, Math.max(0.5, factor));
        const tmp = track.filePath + ".stretch.wav";
        execFileSync("ffmpeg", ["-i", track.filePath, "-af", `atempo=${1/clamp}`, "-y", tmp], { timeout: 30000 });
        fs.renameSync(tmp, track.filePath);
        track.duration = Math.round(track.duration * clamp);
        send(ws, { type: "system", text: `\u23f3 Stretch x${clamp} piste #${trackNum+1} (${track.duration}s)` });
        return;
      }

      case "/bounce": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || comp.tracks.length === 0) {
          send(ws, { type: "system", text: "Pas de pistes. /layer d'abord." }); return;
        }

        const format = text.slice(8).trim().toLowerCase() || "wav";
        if (!["wav", "mp3", "flac"].includes(format)) {
          send(ws, { type: "system", text: "Formats: wav, mp3, flac" }); return;
        }

        broadcast(info.channel, { type: "system", text: `\uD83C\uDFA7 Bounce ${format.toUpperCase()} en cours...` });

        const outDir = path.join(process.cwd(), "data", "compositions", comp.id);
        const outPath = path.join(outDir, `bounce.${format}`);

        try {
          // First mix to WAV if not already done
          const mixPath = path.join(outDir, "mix.wav");
          if (!fs.existsSync(mixPath)) {
            const inputs = comp.tracks.filter((t: any) => t.filePath && fs.existsSync(t.filePath));
            if (inputs.length === 0) { send(ws, { type: "system", text: "Aucun fichier audio." }); return; }
            const ffArgs: string[] = [];
            const filterParts: string[] = [];
            inputs.forEach((t: any, i: number) => {
              const offset = (t.startMs || 0) / 1000;
              if (offset > 0) ffArgs.push("-itsoffset", String(offset));
              ffArgs.push("-i", t.filePath!);
              filterParts.push(`[${i}]aformat=sample_rates=44100:channel_layouts=stereo,volume=${(t.volume ?? 100) / 100}[a${i}]`);
            });
            const mixInputs = inputs.map((_: any, i: number) => `[a${i}]`).join("");
            filterParts.push(`${mixInputs}amix=inputs=${inputs.length}:duration=longest[out]`);
            ffArgs.push("-filter_complex", filterParts.join(";"), "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", mixPath);
            execFileSync("ffmpeg", ffArgs, { timeout: 60000 });
          }

          // Convert to target format
          if (format === "wav") {
            fs.copyFileSync(mixPath, outPath);
          } else if (format === "mp3") {
            execFileSync("ffmpeg", ["-i", mixPath, "-codec:a", "libmp3lame", "-b:a", "320k", "-y", outPath], { timeout: 30000 });
          } else if (format === "flac") {
            execFileSync("ffmpeg", ["-i", mixPath, "-codec:a", "flac", "-y", outPath], { timeout: 30000 });
          }

          const size = fs.statSync(outPath).size;
          send(ws, { type: "system", text: `\u2705 Bounce ${format.toUpperCase()}: ${Math.round(size / 1024)} KB\nDownload: /api/v2/media/compositions/${comp.id}/bounce?format=${format}` });
          broadcastCompUpdate(broadcast, info.channel, comp.id, "bounce_complete");
        } catch (err) {
          send(ws, { type: "system", text: `Erreur bounce: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/stem": {
        // /stem [track#] — separate last generated audio (or specific track) into stems
        const trackNum = parseInt(parts[1]) - 1;
        const comp = getActiveComposition(info.nick, info.channel);

        // Find the audio to separate
        let audioPath: string | null = null;
        let label = "dernier audio";

        if (comp && !isNaN(trackNum) && trackNum >= 0 && trackNum < comp.tracks.length) {
          const track = comp.tracks[trackNum];
          if (track.filePath && fs.existsSync(track.filePath)) {
            audioPath = track.filePath;
            label = `piste #${trackNum + 1}`;
          }
        } else if (comp && comp.tracks.length > 0) {
          // Use last track with a file
          for (let i = comp.tracks.length - 1; i >= 0; i--) {
            if (comp.tracks[i].filePath && fs.existsSync(comp.tracks[i].filePath!)) {
              audioPath = comp.tracks[i].filePath!;
              label = `piste #${i + 1}`;
              break;
            }
          }
        }

        if (!audioPath) {
          send(ws, { type: "system", text: "Aucune piste audio a separer. /layer d'abord." });
          return;
        }

        broadcast(info.channel, { type: "system", text: `Separation stems de ${label}...` });

        try {
          const audioBuf = fs.readFileSync(audioPath);
          const AI_BRIDGE_URL = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";

          const resp = await fetch(`${AI_BRIDGE_URL}/separate`, {
            method: "POST",
            headers: { "Content-Type": "audio/wav" },
            body: audioBuf,
            signal: AbortSignal.timeout(120_000),
          });

          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const result = await resp.json();

          if (result.ok && result.data) {
            // Add each stem as a new track in the composition
            for (const [stemName, stemBase64] of Object.entries(result.data)) {
              const stemBuf = Buffer.from(stemBase64 as string, "base64");
              const track = addTrack(comp!.id, {
                type: "sfx",
                prompt: `[stem: ${stemName}] ${label}`,
                duration: comp!.tracks[0]?.duration || 30,
                volume: 100,
                startMs: 0,
              });
              if (track) {
                const trackDir = path.join(process.cwd(), "data", "compositions", comp!.id);
                fs.mkdirSync(trackDir, { recursive: true });
                const trackPath = path.join(trackDir, `${track.id}.wav`);
                fs.writeFileSync(trackPath, stemBuf);
                track.filePath = trackPath;
              }
            }

            const stemNames = Object.keys(result.data).join(", ");
            broadcast(info.channel, { type: "system", text: `Stems separes: ${stemNames}. ${comp!.tracks.length} pistes total.` });
            broadcastCompUpdate(broadcast, info.channel, comp!.id, "stems_separated", { trackCount: comp!.tracks.length });
          } else {
            throw new Error("Separation failed");
          }
        } catch (err) {
          send(ws, { type: "system", text: `Erreur stems: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/mp3": {
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp) { send(ws, { type: "system", text: "Pas de composition." }); return; }

        const compDir = path.join(process.cwd(), "data", "compositions", comp.id);
        const masterPath = path.join(compDir, "master.wav");
        const mixPath = path.join(compDir, "mix.wav");
        const sourcePath = fs.existsSync(masterPath) ? masterPath : fs.existsSync(mixPath) ? mixPath : null;

        if (!sourcePath) {
          send(ws, { type: "system", text: "Pas de mix/master. /mix ou /master d'abord." });
          return;
        }

        const mp3Path = path.join(compDir, "export.mp3");
        broadcast(info.channel, { type: "system", text: "Export MP3 en cours..." });

        try {
          execFileSync("ffmpeg", [
            "-i", sourcePath,
            "-codec:a", "libmp3lame",
            "-b:a", "192k",
            "-y", mp3Path,
          ], { timeout: 60000 });

          const mp3Buf = fs.readFileSync(mp3Path);
          const sizeMB = (mp3Buf.length / (1024 * 1024)).toFixed(1);

          await saveAudio({
            base64: mp3Buf.toString("base64"),
            prompt: comp.name,
            nick: info.nick,
            channel: info.channel,
            mime: "audio/mpeg",
          }).catch(() => {});

          broadcast(info.channel, {
            type: "music", nick: info.nick,
            text: `[MP3: ${comp.name} \u2014 ${sizeMB}MB, 192kbps]`,
            audioData: mp3Buf.toString("base64"), audioMime: "audio/mpeg",
          } as any);

          send(ws, { type: "system", text: `MP3 exporte (${sizeMB}MB). /api/v2/media/compositions/${comp.id}/export.mp3` });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur MP3: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/drone":
      case "/grain":
      case "/circus":
      case "/honk": {
        const instrArgs = text.slice(cmd.length + 1).trim().split(/\s+/);
        const instrDur = Math.min(60, Math.max(3, parseInt(instrArgs[0] || "15")));
        const instrType = cmd.slice(1);
        const params: Record<string, unknown> = { duration: instrDur };
        if (instrType === "drone") {
          const note = instrArgs[1] || "C2";
          Object.assign(params, { note, voices: 5, waveform: "saw", detune: 8, lfoRate: 0.1, lfoDepth: 0.4, cutoff: 1200 });
        } else if (instrType === "grain") {
          Object.assign(params, { source: instrArgs[1] || "noise", density: 15, grainSize: 0.05, pitchSpread: 400 });
        } else if (instrType === "circus") {
          const notes = instrArgs[1] || "C4,E4,G4";
          Object.assign(params, { notes, register: instrArgs[2] || "mixture", wobble: 0.15, air: 0.2 });
        } else if (instrType === "honk") {
          Object.assign(params, { mode: instrArgs[1] || "klaxon", frequency: 440, sweepRange: 800 });
        }
        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) comp = createComposition(info.nick, info.channel);
        const track = addTrack(comp.id, { type: "sfx", prompt: `${instrType} ${instrDur}s`, duration: instrDur, volume: 80, startMs: 0 });
        if (!track) { send(ws, { type: "system", text: "Erreur creation piste." }); return; }
        const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
        fs.mkdirSync(trackDir, { recursive: true });
        const trackPath = path.join(trackDir, `${track.id}.wav`);
        const AI_BRIDGE_URL = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";
        broadcast(info.channel, { type: "system", text: `\uD83C\uDFB9 Generation ${instrType} (${instrDur}s)...` });
        try {
          const resp = await fetch(`${AI_BRIDGE_URL}/instrument/${instrType}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params), signal: AbortSignal.timeout(60000),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buf = Buffer.from(await resp.arrayBuffer());
          fs.writeFileSync(trackPath, buf);
          track.filePath = trackPath;
          broadcast(info.channel, {
            type: "music", nick: info.nick,
            text: `[${instrType.toUpperCase()}: ${instrDur}s]`,
            audioData: buf.toString("base64"), audioMime: "audio/wav",
          } as any);
          send(ws, { type: "system", text: `\u2705 ${instrType} ajoute (piste ${comp.tracks.length}). /mix pour combiner.` });
          broadcastCompUpdate(broadcast, info.channel, comp.id, "track_added", { trackCount: comp.tracks.length });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur ${instrType}: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/kokoro": {
        const kokoroText = text.slice(8).trim();
        if (!kokoroText) {
          send(ws, { type: "system", text: "Usage: /kokoro <texte> — synthese vocale rapide (Kokoro TTS)\n  Voix: af_heart, af_bella, am_adam, bf_emma..." });
          return;
        }
        const parts = kokoroText.match(/^(\w+)\s+(.+)$/);
        const voice = parts && ["ff_siwis","af_heart","af_bella","af_nicole","af_sarah","af_sky","am_adam","am_michael","bf_emma","bf_isabella","bm_george","bm_lewis"].includes(parts[1]) ? parts[1] : "af_heart";
        const ttsText = parts && voice !== "af_heart" ? parts[2] : kokoroText;
        let comp = getActiveComposition(info.nick, info.channel);
        if (!comp) comp = createComposition(info.nick, info.channel);
        const track = addTrack(comp.id, { type: "voice", prompt: `kokoro/${voice}: "${ttsText.slice(0, 50)}"`, duration: 10, volume: 100, startMs: 0 });
        if (!track) { send(ws, { type: "system", text: "Erreur creation piste." }); return; }
        const trackDir = path.join(process.cwd(), "data", "compositions", comp.id);
        fs.mkdirSync(trackDir, { recursive: true });
        const trackPath = path.join(trackDir, `${track.id}.wav`);
        const AI_BRIDGE_URL = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";
        broadcast(info.channel, { type: "system", text: `\uD83D\uDDE3\uFE0F Kokoro TTS (${voice})...` });
        try {
          const resp = await fetch(`${AI_BRIDGE_URL}/generate/voice-fast`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: ttsText, voice, speed: 1.0 }), signal: AbortSignal.timeout(30000),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buf = Buffer.from(await resp.arrayBuffer());
          fs.writeFileSync(trackPath, buf);
          track.filePath = trackPath;
          broadcast(info.channel, {
            type: "music", nick: info.nick,
            text: `[Kokoro ${voice}: "${ttsText.slice(0, 80)}"]`,
            audioData: buf.toString("base64"), audioMime: "audio/wav",
          } as any);
          send(ws, { type: "system", text: `\u2705 Voix kokoro/${voice} ajoutee (piste ${comp.tracks.length}). /mix pour combiner.` });
          broadcastCompUpdate(broadcast, info.channel, comp.id, "track_added", { trackCount: comp.tracks.length });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur kokoro: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/variations": {
        // /variations <prompt> — generate 4 seed variations of same prompt
        const varPrompt = text.slice(12).trim();
        if (!varPrompt) { send(ws, { type: "system", text: "Usage: /variations <prompt> — genere 4 variations" }); return; }

        broadcast(info.channel, { type: "system", text: `Generating 4 variations: "${varPrompt.slice(0, 60)}..."` });

        const seeds = Array.from({ length: 4 }, () => Math.floor(Math.random() * 2 ** 32));

        // Generate sequentially (GPU can only do 1 at a time)
        for (let i = 0; i < seeds.length; i++) {
          try {
            const result = await scheduler.submit({
              id: crypto.randomUUID(),
              device: "gpu",
              priority: "normal",
              label: `variation-${i + 1}`,
              vramMB: VRAM_BUDGETS.comfyui,
              execute: () => generateImage(varPrompt),
            });
            if (result) {
              broadcast(info.channel, {
                type: "image", nick: info.nick,
                text: `[Variation ${i + 1}/4: "${varPrompt}" seed:${result.seed}]`,
                imageData: result.imageBase64,
                imageMime: "image/png",
              } as OutboundMessage);
            }
          } catch {}
        }

        send(ws, { type: "system", text: `4 variations generees pour "${varPrompt.slice(0, 40)}"` });
        return;
      }

      case "/upscale": {
        // /upscale — upscale last generated image 2x (placeholder, needs ESRGAN model)
        send(ws, { type: "system", text: "Upscale non implemente (necessite modele ESRGAN). Utilisez /imagine avec un prompt plus detaille." });
        return;
      }

      case "/imagine-gallery": {
        try {
          const imagesDir = path.join(process.cwd(), "data", "media", "images");
          const files = fs.readdirSync(imagesDir).filter(f => f.endsWith(".json"));
          if (files.length === 0) { send(ws, { type: "system", text: "Aucune image sauvegardee." }); return; }

          const images = files.slice(-20).map(f => {
            try {
              const meta = JSON.parse(fs.readFileSync(path.join(imagesDir, f), "utf-8"));
              return `  ${meta.prompt?.slice(0, 50) || "?"} — ${meta.createdAt?.slice(0, 10) || "?"}`;
            } catch { return null; }
          }).filter(Boolean);

          send(ws, { type: "system", text: `=== GALERIE (${files.length} images) ===\n${images.join("\n")}\n\nVoir F6 (Mediatheque) pour la vue complete.` });
        } catch {
          send(ws, { type: "system", text: "Galerie non disponible." });
        }
        return;
      }

      case "/imagine-redo": {
        // Regenerate last image with new seed
        try {
          const imagesDir = path.join(process.cwd(), "data", "media", "images");
          const files = fs.readdirSync(imagesDir).filter(f => f.endsWith(".json")).sort().reverse();
          if (files.length === 0) { send(ws, { type: "system", text: "Aucune image precedente." }); return; }
          const meta = JSON.parse(fs.readFileSync(path.join(imagesDir, files[0]), "utf-8"));
          const prompt = meta.prompt;
          if (!prompt) { send(ws, { type: "system", text: "Prompt introuvable." }); return; }
          broadcast(info.channel, { type: "system", text: `Redo: "${prompt.slice(0, 50)}..." (nouveau seed)` });
          const result = await scheduler.submit({
            id: crypto.randomUUID(), device: "gpu", priority: "normal",
            label: "imagine-redo", vramMB: VRAM_BUDGETS.comfyui,
            execute: () => generateImage(prompt),
          });
          if (result) {
            broadcast(info.channel, { type: "image", nick: info.nick, text: `[Redo: "${prompt}" seed:${result.seed}]`, imageData: result.imageBase64, imageMime: "image/png" } as OutboundMessage);
            saveImage({ base64: result.imageBase64, prompt, nick: info.nick, channel: info.channel, seed: result.seed }).catch(() => {});
          }
        } catch (err) { send(ws, { type: "system", text: `Erreur redo: ${(err as Error).message}` }); }
        return;
      }

      case "/help-imagine": {
        send(ws, { type: "system", text: [
          "=== /imagine — Guide complet ===",
          "",
          "Usage: /imagine <prompt> [options]",
          "",
          "Options:",
          "  --ar 16:9|9:16|4:3|3:4    Aspect ratio (defaut: 1:1)",
          "  --style photo|anime|cyberpunk|painting|pixel|minitel",
          "  --no <negative>            Negative prompt",
          "  --seed <number>            Seed reproductible",
          "  --steps <1-50>             Nombre de steps",
          "  --model <checkpoint>       Forcer un modele",
          "",
          "Exemples:",
          "  /imagine a cat in space --ar 16:9 --style cyberpunk",
          "  /imagine portrait --no glasses,hat --seed 42",
          "  /imagine forest --steps 30 --model dreamshaperXL_lightningDPMSDE",
          "",
          "Commandes liees:",
          "  /imagine-queue p1|p2|p3    Batch generation",
          "  /variations <prompt>       4 variations",
          "  /imagine-redo              Refaire avec nouveau seed",
          "  /imagine-history           Historique des prompts",
          "  /imagine-gallery           Galerie sauvegardee",
          "  /imagine-models            Modeles disponibles",
        ].join("\n") });
        return;
      }

      case "/sfx": {
        const sfxType = parts[1] || "impact";
        const types = ["riser", "drop", "sweep", "impact", "stutter"];
        if (!types.includes(sfxType)) {
          send(ws, { type: "system", text: `Usage: /sfx ${types.join("|")}` }); return;
        }
        broadcast(info.channel, { type: "system", text: `SFX: ${sfxType}...` });
        const AI_BRIDGE_SFX = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";
        try {
          const resp = await fetch(`${AI_BRIDGE_SFX}/instrument/fx`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: sfxType, duration: 3 }),
            signal: AbortSignal.timeout(15_000),
          });
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            broadcast(info.channel, {
              type: "music", nick: info.nick,
              text: `[SFX: ${sfxType}]`,
              audioData: buf.toString("base64"), audioMime: "audio/wav",
            } as any);
          }
        } catch { send(ws, { type: "system", text: "SFX indisponible." }); }
        return;
      }

      case "/jam": {
        const bpm = parseInt(parts[1]) || 120;
        broadcast(info.channel, { type: "system", text: `🎶 Jam session a ${bpm} BPM...` });
        const AI_BRIDGE_JAM = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";
        const tasks = [
          fetch(`${AI_BRIDGE_JAM}/instrument/drums`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bpm, pattern: "kick|snare|hihat", bars: 4 }), signal: AbortSignal.timeout(15_000) }),
          fetch(`${AI_BRIDGE_JAM}/instrument/bass`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "C2", waveform: "saw", duration: 10, pattern: "pulse", bpm }), signal: AbortSignal.timeout(15_000) }),
          fetch(`${AI_BRIDGE_JAM}/instrument/pad`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "warm", duration: 10, chord: "Cm" }), signal: AbortSignal.timeout(15_000) }),
        ];
        const results = await Promise.allSettled(tasks);
        const names = ["Drums", "Bass", "Pad"];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === "fulfilled" && r.value.ok) {
            const buf = Buffer.from(await r.value.arrayBuffer());
            broadcast(info.channel, {
              type: "music", nick: info.nick,
              text: `[Jam: ${names[i]} @ ${bpm}BPM]`,
              audioData: buf.toString("base64"), audioMime: "audio/wav",
            } as any);
          }
        }
        broadcast(info.channel, { type: "system", text: `🎶 Jam terminee: ${results.filter(r => r.status === "fulfilled").length}/3 pistes.` });
        return;
      }

      case "/mixtape": {
        // /mixtape [style] — auto-generate 4-track composition (Lot 485)
        const mixStyle = text.slice(9).trim() || "experimental";
        broadcast(info.channel, { type: "system", text: `🎵 Mixtape "${mixStyle}" — generation de 4 pistes...` });
        const AI_BRIDGE = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";
        const mixTracks = [
          { name: "Drums", endpoint: "/instrument/drums", body: { bpm: 120, pattern: "kick|snare|hihat", bars: 8 } },
          { name: "Bass", endpoint: "/instrument/bass", body: { note: "C2", waveform: "saw", duration: 20, pattern: "pulse", bpm: 120 } },
          { name: "Pad", endpoint: "/instrument/pad", body: { type: "warm", duration: 20, chord: "Cm" } },
          { name: "FX", endpoint: "/instrument/fx", body: { type: "sweep", duration: 20 } },
        ];
        for (const t of mixTracks) {
          try {
            const resp = await fetch(`${AI_BRIDGE}${t.endpoint}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(t.body), signal: AbortSignal.timeout(15_000),
            });
            if (resp.ok) {
              const buf = Buffer.from(await resp.arrayBuffer());
              broadcast(info.channel, {
                type: "music", nick: info.nick,
                text: `[Mixtape: ${t.name} — ${mixStyle}]`,
                audioData: buf.toString("base64"), audioMime: "audio/wav",
              } as any);
            }
          } catch {}
        }
        broadcast(info.channel, { type: "system", text: `🎵 Mixtape "${mixStyle}" terminee. /mix pour combiner.` });
        return;
      }

      case "/imagine-compare": {
        // /imagine-compare <prompt> — compare 2 models (Lot 489)
        const comparePrompt = text.slice(17).trim();
        if (!comparePrompt) { send(ws, { type: "system", text: "Usage: /imagine-compare <prompt> — compare 2 modeles" }); return; }
        const models = ["sdxl_lightning_4step.safetensors", "dreamshaperXL_lightningDPMSDE.safetensors"];
        broadcast(info.channel, { type: "system", text: `Comparaison: "${comparePrompt.slice(0, 40)}..." sur ${models.length} modeles...` });
        for (const model of models) {
          try {
            const result = await scheduler.submit({
              id: crypto.randomUUID(), device: "gpu", priority: "normal",
              label: `compare-${model.slice(0, 15)}`, vramMB: VRAM_BUDGETS.comfyui,
              execute: () => generateImage(comparePrompt, { checkpoint: model }),
            });
            if (result) {
              broadcast(info.channel, {
                type: "image", nick: info.nick,
                text: `[Compare: ${model.replace(".safetensors", "")} — "${comparePrompt}"]`,
                imageData: (result as any).imageBase64, imageMime: "image/png",
              } as OutboundMessage);
            }
          } catch {}
        }
        return;
      }

      case "/help-compose": {
        // Lot 499 — comprehensive compose help
        send(ws, { type: "system", text: [
          "=== COMPOSE — Guide complet ===",
          "",
          "CREATION:",
          "  /comp new [nom]    Nouvelle composition",
          "  /layer <prompt>    Piste musicale (MusicGen/ACE-Step)",
          "  /voice <p> \"texte\" Piste voix",
          "  /noise <type> <dur> Bruit (white/pink/brown/sine/drone)",
          "  /drone [note] [dur] Drone synthetique",
          "  /grain [dur]       Texture granulaire",
          "  /sfx <type>        Effet sonore (riser/drop/sweep/impact)",
          "  /jam [bpm]         Jam instant (drums+bass+pad)",
          "  /mixtape [style]   4 pistes auto-generees",
          "",
          "EDITION:",
          "  /fx [#] <effet>    Appliquer effet",
          "  /stem [#]          Separer en stems (Demucs)",
          "  /normalize [#]     Normaliser volume",
          "  /trim # <start> <end>  Couper",
          "",
          "MIX/EXPORT:",
          "  /mix               Mixer toutes les pistes",
          "  /master [ref#]     Masteriser (AI ou ffmpeg)",
          "  /mp3               Export MP3 192kbps",
          "  /preview [#]       Ecouter",
          "  /bounce            Exporter le mix final",
        ].join("\n") });
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

  // Parse --ar aspect ratio (Lot 440)
  let aspectRatio: string | undefined;
  const arMatch = imagePrompt.match(/\s*--ar\s+([\d:]+)/i);
  let cleanPrompt = imagePrompt;
  if (arMatch) {
    aspectRatio = arMatch[1];
    cleanPrompt = cleanPrompt.replace(/\s*--ar\s+[\d:]+/i, "").trim();
  }

  // Parse --seed for reproducible generation (Lot 445)
  let userSeed: number | undefined;
  const seedMatch = cleanPrompt.match(/\s*--seed\s+(\d+)/i);
  if (seedMatch) {
    userSeed = parseInt(seedMatch[1]);
    cleanPrompt = cleanPrompt.replace(/\s*--seed\s+\d+/i, "").trim();
  }

  // Parse --style for quick style presets (Lot 446)
  const stylePresets: Record<string, string> = {
    "photo": ", ultra realistic photograph, 8k, cinematic lighting",
    "anime": ", anime style, studio ghibli, cel shading",
    "cyberpunk": ", cyberpunk aesthetic, neon lights, blade runner",
    "painting": ", oil painting, masterful brushwork, gallery quality",
    "pixel": ", pixel art, 16-bit retro style",
    "minitel": ", green phosphor CRT screen, vintage terminal, scanlines",
  };
  const styleMatch = cleanPrompt.match(/\s*--style\s+(\w+)/i);
  if (styleMatch && stylePresets[styleMatch[1]]) {
    cleanPrompt = cleanPrompt.replace(/\s*--style\s+\w+/i, "").trim() + stylePresets[styleMatch[1]];
  }

  // Parse --model to override smart model selection (Lot 450)
  let userCheckpoint: string | undefined;
  const modelMatch = cleanPrompt.match(/\s*--model\s+(\S+)/i);
  if (modelMatch) {
    userCheckpoint = modelMatch[1];
    cleanPrompt = cleanPrompt.replace(/\s*--model\s+\S+/i, "").trim();
  }

  // Parse --no for negative prompt (Lot 426)
  let negativePrompt = "ugly, blurry, low quality, deformed";
  const noMatch = cleanPrompt.match(/\s*--no\s+(.+)$/i);
  if (noMatch) {
    negativePrompt = noMatch[1].trim();
    cleanPrompt = cleanPrompt.replace(/\s*--no\s+.+$/i, "").trim();
  }

  broadcast(info.channel, {
    type: "system",
    text: `${info.nick} genere une image: "${cleanPrompt}"${noMatch ? ` (sans: ${negativePrompt})` : ""}...`,
  });

  // Send real progress from ComfyUI WebSocket (including preview frames)
  const onProgress = (p: ImageProgress) => {
    send(ws, {
      type: "image_progress",
      step: p.step,
      totalSteps: p.totalSteps,
      percent: p.percent,
      phase: p.phase,
      model: p.model,
      lora: p.lora,
      elapsed: p.elapsed,
      preview: (p as any).preview || undefined,
    } as any);
  };

  try {
    const result = await scheduler.submit({
      id: crypto.randomUUID(),
      device: "gpu",
      priority: "normal",
      label: `/imagine "${cleanPrompt.slice(0, 40)}"`,
      vramMB: VRAM_BUDGETS.comfyui,
      execute: () => generateImage(cleanPrompt, { onProgress, aspectRatio: aspectRatio as any, seed: userSeed, checkpoint: userCheckpoint }),
    });
    if (!result) {
      broadcast(info.channel, { type: "system", text: "\u{1F3A8} Generation echouee \u2014 verifiez ComfyUI" });
      return;
    }

    broadcast(info.channel, {
      type: "image",
      nick: info.nick,
      text: `[Image generee: "${cleanPrompt}" seed:${result.seed}${result.model ? ` model:${result.model}` : ""}${result.lora ? ` lora:${result.lora}` : ""}]`,
      imageData: result.imageBase64,
      imageMime: "image/png",
    } as OutboundMessage);

    saveImage({ base64: result.imageBase64, prompt: cleanPrompt, nick: info.nick, channel: info.channel, seed: result.seed }).catch(() => {});

    logChatMessage({
      ts: new Date().toISOString(),
      channel: info.channel,
      nick: info.nick,
      type: "system",
      text: `[Image generee: "${cleanPrompt}"]`,
    });
  } catch (err) {
    send(ws, {
      type: "system",
      text: `Erreur ComfyUI: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
