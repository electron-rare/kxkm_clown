import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OutboundMessage } from "./chat-types.js";
import { resolvePreferredPythonBin, resolveVoiceSamplePath } from "./voice-samples.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// File processing concurrency semaphore (P2-10)
// ---------------------------------------------------------------------------

let fileProcessActive = 0;
const MAX_FILE_PROCESSORS = 2;

export async function acquireFileProcessor(): Promise<void> {
  while (fileProcessActive >= MAX_FILE_PROCESSORS) {
    await new Promise(r => setTimeout(r, 100));
  }
  fileProcessActive++;
}
export function releaseFileProcessor(): void { fileProcessActive--; }

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
// TTS synthesis (Piper TTS via Python script)
// ---------------------------------------------------------------------------

const TTS_URL = process.env.TTS_URL || "http://127.0.0.1:9100";

export async function synthesizeTTS(
  nick: string,
  text: string,
  channel: string,
  broadcastFn: (channel: string, msg: OutboundMessage) => void,
): Promise<void> {
  if (!text || text.length < 10) return;

  const truncated = text.slice(0, 1000);

  try {
    const resp = await fetch(`${TTS_URL}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: truncated, persona: nick }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(`[tts] HTTP ${resp.status} for ${nick}: ${body.slice(0, 200)}`);
      return;
    }

    const audioBuffer = Buffer.from(await resp.arrayBuffer());
    const base64 = audioBuffer.toString("base64");
    broadcastFn(channel, { type: "audio", nick, data: base64, mimeType: "audio/wav" });
  } catch (err) {
    console.error(`[tts] Synthesis failed for ${nick}: ${err instanceof Error ? err.message : String(err)}`);
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
      console.error(`[vision] ${visionModel} returned ${response.status}: ${body.slice(0, 200)}`);
      return `[Image: ${filename} — analyse échouée: modèle ${visionModel} erreur ${response.status}]`;
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
