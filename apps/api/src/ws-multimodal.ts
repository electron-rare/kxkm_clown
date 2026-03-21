import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OutboundMessage } from "./chat-types.js";
import logger from "./logger.js";
import { trackError } from "./error-tracker.js";
import { resolvePreferredPythonBin, resolveVoiceSamplePath } from "./voice-samples.js";
import { getPersonaVoice } from "./persona-voices.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// File processing concurrency semaphore (P2-10)
// ---------------------------------------------------------------------------

let fileProcessActive = 0;
const MAX_FILE_PROCESSORS = 2;
const fileProcessWaiters: Array<() => void> = [];

export async function acquireFileProcessor(): Promise<void> {
  if (fileProcessActive < MAX_FILE_PROCESSORS) {
    fileProcessActive++;
    return;
  }
  return new Promise<void>((resolve) => {
    fileProcessWaiters.push(() => { fileProcessActive++; resolve(); });
  });
}
export function releaseFileProcessor(): void {
  fileProcessActive--;
  const next = fileProcessWaiters.shift();
  if (next) next();
}

// ---------------------------------------------------------------------------
// TTS concurrency semaphore (P2-02)
// ---------------------------------------------------------------------------

let ttsActive = 0;
const MAX_TTS_CONCURRENT = 2;

export function isTTSAvailable(): boolean {
  return ttsActive < MAX_TTS_CONCURRENT;
}

export function acquireTTS(): void {
  ttsActive++;
}

export function releaseTTS(): void {
  if (ttsActive > 0) ttsActive--;
}

// ---------------------------------------------------------------------------
// TTS synthesis (Qwen3-TTS primary, Piper/Chatterbox fallback)
// ---------------------------------------------------------------------------

const TTS_URL = process.env.TTS_URL || "http://127.0.0.1:9100";
const QWEN3_TTS_URL = process.env.QWEN3_TTS_URL || "http://127.0.0.1:9300";
const KOKORO_URL = process.env.KOKORO_URL || "http://127.0.0.1:9201";

// Kokoro voice mapping — English voices only (Kokoro ONNX has no French voices)
// French personas use Piper FR as priority 1 instead
const KOKORO_VOICE_MAP: Record<string, string> = {
  Moorcock: "bm_lewis",
  Eno: "bm_george",
};

// Piper voice mapping — FR-FR for French personas
const PIPER_VOICE_MAP: Record<string, string> = {
  // Female personas → siwis (female FR)
  Radigue: "fr_FR-siwis-medium", Oliveros: "fr_FR-siwis-medium",
  Haraway: "fr_FR-siwis-medium", Oram: "fr_FR-siwis-medium",
  Bjork: "fr_FR-siwis-medium", Hypatia: "fr_FR-siwis-medium",
  Curie: "fr_FR-siwis-medium", LeGuin: "fr_FR-siwis-medium",
  Mnouchkine: "fr_FR-siwis-medium", Pina: "fr_FR-siwis-medium",
  TeamLab: "fr_FR-siwis-medium",
  // Male personas → upmc (male FR academic) or gilles (male FR casual)
  Pharmacius: "fr_FR-upmc-medium", Schaeffer: "fr_FR-upmc-medium",
  Deleuze: "fr_FR-upmc-medium", Foucault: "fr_FR-upmc-medium",
  Batty: "fr_FR-gilles-low", Turing: "fr_FR-upmc-medium",
  Cage: "fr_FR-gilles-low", SunRa: "fr_FR-gilles-low",
  Merzbow: "fr_FR-gilles-low", Picasso: "fr_FR-gilles-low",
  Bookchin: "fr_FR-upmc-medium", Swartz: "fr_FR-gilles-low",
  Ikeda: "fr_FR-upmc-medium", Decroux: "fr_FR-upmc-medium",
  Grotowski: "fr_FR-gilles-low", Fratellini: "fr_FR-gilles-low",
  RoyalDeLuxe: "fr_FR-gilles-low", Fuller: "fr_FR-upmc-medium",
  Tarkovski: "fr_FR-upmc-medium", Sherlock: "fr_FR-upmc-medium",
  Demoscene: "fr_FR-gilles-low",
};

function getKokoroVoice(nick: string): string {
  return KOKORO_VOICE_MAP[nick] || "af_bella"; // English fallback for Kokoro
}

function getPiperVoice(nick: string): string {
  return PIPER_VOICE_MAP[nick] || "fr_FR-siwis-medium";
}

function isEnglishPersona(nick: string): boolean {
  return nick === "Moorcock" || nick === "Eno";
}

export async function synthesizeTTS(
  nick: string,
  text: string,
  channel: string,
  broadcastFn: (channel: string, msg: OutboundMessage) => void,
): Promise<void> {
  if (!text || text.length < 10) return;

  const truncated = text.slice(0, 1000);
  const english = isEnglishPersona(nick);

  // --- For English personas: Kokoro first (fast, good EN quality) ---
  if (english) {
    try {
      const kokoroVoice = getKokoroVoice(nick);
      const resp = await fetch(`${KOKORO_URL}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: truncated, voice: kokoroVoice, speed: 1.0 }),
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        const audioBuffer = Buffer.from(await resp.arrayBuffer());
        broadcastFn(channel, { type: "audio", nick, data: audioBuffer.toString("base64"), mimeType: "audio/wav" });
        logger.debug({ nick, voice: kokoroVoice, ms: resp.headers.get("X-Elapsed-Ms") }, "[tts] Kokoro EN OK");
        return;
      }
    } catch { /* fall through */ }
  }

  // --- For French personas: Piper FR first (proper pronunciation, ~50ms) ---
  try {
    const piperVoice = getPiperVoice(nick);
    const resp = await fetch(`${TTS_URL}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: truncated, persona: nick, voice: piperVoice }),
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.ok) {
      const audioBuffer = Buffer.from(await resp.arrayBuffer());
      broadcastFn(channel, { type: "audio", nick, data: audioBuffer.toString("base64"), mimeType: "audio/wav" });
      logger.debug({ nick, voice: piperVoice }, "[tts] Piper FR OK");
      return;
    }
    logger.warn(`[tts] Piper HTTP ${resp.status} for ${nick}`);
  } catch (err) {
    logger.warn(`[tts] Piper unreachable: ${(err as Error).message}`);
  }

  // --- Fallback: Qwen3-TTS (higher quality but slower, GPU) ---
  const voice = getPersonaVoice(nick);
  try {
    const resp = await fetch(`${QWEN3_TTS_URL}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: truncated,
        persona: nick.toLowerCase(),
        speaker: voice.speaker,
        instruct: voice.instruct,
        language: voice.language,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (resp.ok) {
      const audioBuffer = Buffer.from(await resp.arrayBuffer());
      broadcastFn(channel, { type: "audio", nick, data: audioBuffer.toString("base64"), mimeType: "audio/wav" });
      logger.info(`[tts] Qwen3-TTS OK for ${nick}`);
      return;
    }
  } catch { /* fall through */ }

  // --- Last resort: Kokoro EN (wrong accent but works) ---
  try {
    const resp = await fetch(`${KOKORO_URL}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: truncated, voice: "af_bella", speed: 1.0 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) {
      const audioBuffer = Buffer.from(await resp.arrayBuffer());
      broadcastFn(channel, { type: "audio", nick, data: audioBuffer.toString("base64"), mimeType: "audio/wav" });
      return;
    }
  } catch (err) {
    trackError("tts_all_failed", err, { nick });
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

export function isOfficeDocument(filename: string, mimeType: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return OFFICE_EXTENSIONS.has(ext) || OFFICE_MIMES.has(mimeType);
}

// ---------------------------------------------------------------------------

export async function analyzeImage(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  ollamaUrl: string,
): Promise<string> {
  const base64 = buffer.toString("base64");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60_000);

  try {
    const visionModel = process.env.VISION_MODEL || "qwen3-vl:8b";
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
      const body = await response.text().catch(() => "");
      trackError("vision", new Error(`${visionModel} returned ${response.status}: ${body.slice(0, 200)}`), { filename, model: visionModel });
      return `[Image: ${filename} — analyse échouée: modèle ${visionModel} erreur ${response.status}]`;
    }

    const result = (await response.json()) as {
      message?: { content?: string };
    };
    const caption = result.message?.content || "Pas de description disponible";
    return `[Image: ${filename}]\n${caption}`;
  } catch (err) {
    trackError("vision", err, { filename });
    return `[Image: ${filename} — erreur d'analyse: ${err instanceof Error ? err.message : String(err)}]`;
  } finally {
    clearTimeout(timeout);
  }
}
