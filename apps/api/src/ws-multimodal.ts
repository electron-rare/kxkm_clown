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

export async function synthesizeTTS(
  nick: string,
  text: string,
  channel: string,
  broadcastFn: (channel: string, msg: OutboundMessage) => void,
): Promise<void> {
  if (!text || text.length < 10) return;

  const truncated = text.slice(0, 1000);
  const voice = getPersonaVoice(nick);

  // --- Try Qwen3-TTS first (per-persona voice routing) ---
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
      const base64 = audioBuffer.toString("base64");
      broadcastFn(channel, { type: "audio", nick, data: base64, mimeType: "audio/wav" });
      logger.info(`[tts] Qwen3-TTS OK for ${nick} (speaker=${voice.speaker})`);
      return;
    }
    logger.warn(`[tts] Qwen3-TTS HTTP ${resp.status} for ${nick}, falling back to ${TTS_URL}`);
  } catch (err) {
    logger.warn(`[tts] Qwen3-TTS unreachable for ${nick}: ${err instanceof Error ? err.message : String(err)}, falling back`);
  }

  // --- Fallback to existing TTS (Chatterbox/Piper via sidecar) ---
  try {
    const resp = await fetch(`${TTS_URL}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: truncated, persona: nick }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      trackError("tts_fallback", new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`), { nick, backend: "piper" });
      return;
    }

    const audioBuffer = Buffer.from(await resp.arrayBuffer());
    const base64 = audioBuffer.toString("base64");
    broadcastFn(channel, { type: "audio", nick, data: base64, mimeType: "audio/wav" });
  } catch (err) {
    trackError("tts_fallback", err, { nick, backend: "piper" });
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
