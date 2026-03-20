import path from "node:path";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { WebSocket } from "ws";
import { generateImage } from "./comfyui.js";
import { saveImage, saveAudio } from "./media-store.js";
import type { OutboundMessage } from "./chat-types.js";
import type { CommandContext, CommandHandlerDeps } from "./ws-commands-types.js";
import { createComposition, getActiveComposition, addTrack, listCompositions } from "./composition-store.js";

export const GENERATE_COMMANDS = new Set([
  "/imagine", "/compose", "/layer", "/mix", "/voice", "/noise",
  "/ambient", "/fx", "/comp", "/imagine-models", "/remix", "/tracks",
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
        send(ws, { type: "system", text: "Usage: /comp new <nom> | /comp list" });
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

        const outPath = path.join(process.cwd(), "data", "compositions", comp.id, "mix.wav");

        try {
          if (comp.tracks.length === 1 && comp.tracks[0].filePath) {
            fs.copyFileSync(comp.tracks[0].filePath, outPath);
          } else {
            const inputs = comp.tracks.filter(t => t.filePath && fs.existsSync(t.filePath));
            const ffmpegArgs: string[] = [];
            for (const t of inputs) {
              ffmpegArgs.push("-i", t.filePath!);
            }
            ffmpegArgs.push("-filter_complex", `amix=inputs=${inputs.length}:duration=longest:dropout_transition=2`);
            ffmpegArgs.push("-ac", "1", "-ar", "32000", "-y", outPath);
            execFileSync("ffmpeg", ffmpegArgs, { timeout: 60000 });
          }

          const mixBuffer = fs.readFileSync(outPath);
          broadcast(info.channel, {
            type: "music", nick: info.nick,
            text: `[Mix: ${comp.name} \u2014 ${comp.tracks.length} pistes]`,
            audioData: mixBuffer.toString("base64"), audioMime: "audio/wav",
          } as any);

          send(ws, { type: "system", text: `\u2705 Mix termine: ${comp.tracks.length} pistes \u2192 mix.wav` });
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
        } catch (err) {
          send(ws, { type: "system", text: `Erreur voix: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/fx": {
        const fxArgs = text.slice(4).trim().split(/\s+/);
        const effect = fxArgs[0];
        const comp = getActiveComposition(info.nick, info.channel);
        if (!comp || comp.tracks.length === 0) {
          send(ws, { type: "system", text: "Aucune piste. /layer d'abord." }); return;
        }
        const lastTrack = comp.tracks[comp.tracks.length - 1];

        switch (effect) {
          case "volume": {
            const vol = Math.min(200, Math.max(0, parseInt(fxArgs[1] || "100")));
            lastTrack.volume = vol;
            send(ws, { type: "system", text: `\u{1F50A} Volume piste #${comp.tracks.length}: ${vol}%` });
            return;
          }
          case "fade-in":
          case "fadein": {
            const fadeDur = parseInt(fxArgs[1] || "3");
            if (lastTrack.filePath && fs.existsSync(lastTrack.filePath)) {
              const tmpPath = lastTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", lastTrack.filePath, "-af", `afade=t=in:d=${fadeDur}`, "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, lastTrack.filePath);
              send(ws, { type: "system", text: `\u{1F50A} Fade-in ${fadeDur}s applique a piste #${comp.tracks.length}` });
            }
            return;
          }
          case "fade-out":
          case "fadeout": {
            const fadeDur = parseInt(fxArgs[1] || "3");
            if (lastTrack.filePath && fs.existsSync(lastTrack.filePath)) {
              const tmpPath = lastTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", lastTrack.filePath, "-af", `areverse,afade=t=in:d=${fadeDur},areverse`, "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, lastTrack.filePath);
              send(ws, { type: "system", text: `\u{1F50A} Fade-out ${fadeDur}s applique a piste #${comp.tracks.length}` });
            }
            return;
          }
          case "reverse": {
            if (lastTrack.filePath && fs.existsSync(lastTrack.filePath)) {
              const tmpPath = lastTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", lastTrack.filePath, "-af", "areverse", "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, lastTrack.filePath);
              send(ws, { type: "system", text: `\u{1F504} Reverse applique a piste #${comp.tracks.length}` });
            }
            return;
          }
          case "reverb": {
            if (lastTrack.filePath && fs.existsSync(lastTrack.filePath)) {
              const tmpPath = lastTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", lastTrack.filePath, "-af", "aecho=0.8:0.88:60:0.4", "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, lastTrack.filePath);
              send(ws, { type: "system", text: `\u{1F30A} Reverb applique a piste #${comp.tracks.length}` });
            }
            return;
          }
          case "pitch": {
            const semitones = parseInt(fxArgs[1] || "2");
            if (lastTrack.filePath && fs.existsSync(lastTrack.filePath)) {
              const tmpPath = lastTrack.filePath + ".tmp.wav";
              const factor = Math.pow(2, semitones / 12);
              execFileSync("ffmpeg", ["-i", lastTrack.filePath, "-af", `asetrate=32000*${factor},aresample=32000`, "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, lastTrack.filePath);
              send(ws, { type: "system", text: `\u{1f3b5} Pitch ${semitones > 0 ? "+" : ""}${semitones} demi-tons piste #${comp.tracks.length}` });
            }
            return;
          }
          case "speed": {
            const speed = parseFloat(fxArgs[1] || "1.5");
            if (lastTrack.filePath && fs.existsSync(lastTrack.filePath)) {
              const tmpPath = lastTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", lastTrack.filePath, "-af", `atempo=${Math.min(4, Math.max(0.25, speed))}`, "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, lastTrack.filePath);
              send(ws, { type: "system", text: `\u23e9 Speed x${speed} piste #${comp.tracks.length}` });
            }
            return;
          }
          case "echo": {
            if (lastTrack.filePath && fs.existsSync(lastTrack.filePath)) {
              const tmpPath = lastTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", lastTrack.filePath, "-af", "aecho=0.6:0.3:500|1000:0.3|0.2", "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, lastTrack.filePath);
              send(ws, { type: "system", text: `\u{1f501} Echo applique piste #${comp.tracks.length}` });
            }
            return;
          }
          case "distortion":
          case "distort": {
            if (lastTrack.filePath && fs.existsSync(lastTrack.filePath)) {
              const tmpPath = lastTrack.filePath + ".tmp.wav";
              execFileSync("ffmpeg", ["-i", lastTrack.filePath, "-af", "acrusher=samples=10:bits=8:mix=0.5", "-y", tmpPath], { timeout: 30000 });
              fs.renameSync(tmpPath, lastTrack.filePath);
              send(ws, { type: "system", text: `\u{1f4a5} Distortion applique piste #${comp.tracks.length}` });
            }
            return;
          }
          default:
            send(ws, { type: "system", text: "Effets: /fx volume <0-200> | /fx fade-in <s> | /fx fade-out <s> | /fx reverse | /fx reverb | /fx pitch <\u00b1demi-tons> | /fx speed <0.25-4> | /fx echo | /fx distortion" });
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
