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

export async function synthesizeTTS(
  nick: string,
  text: string,
  channel: string,
  broadcastFn: (channel: string, msg: OutboundMessage) => void,
): Promise<void> {
  if (!text || text.length < 10) return; // skip very short texts

  const truncated = text.slice(0, 1000); // limit TTS to ~1000 chars
  const outputPath = `/tmp/kxkm-tts-${Date.now()}.wav`;
  const pythonBin = resolvePreferredPythonBin();
  const scriptsDir = process.env.SCRIPTS_DIR || path.join(process.cwd(), "scripts");

  // Check for voice sample (XTTS-v2 cloning)
  const samplePath = resolveVoiceSamplePath(nick) ?? "";
  let useXtts = false;
  try {
    if (samplePath.length === 0) {
      throw new Error("invalid sample path");
    }
    await fs.promises.access(samplePath);
    useXtts = true;
  } catch { /* no voice sample — use Piper fallback */ }

  try {
    let args: string[];
    if (useXtts) {
      args = [
        path.resolve(scriptsDir, "tts_clone_voice.py"),
        "--text", truncated,
        "--reference", samplePath,
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

    let result: { status?: string; error?: string } = {};
    try {
      result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
    } catch (parseErr) {
      console.error("[multimodal] Failed to parse JSON output:", parseErr);
    }

    if (result.status === "completed") {
      try {
        const audioBuffer = await fsp.readFile(outputPath);
        const base64 = audioBuffer.toString("base64");

        // Broadcast audio to channel
        broadcastFn(channel, { type: "audio", nick, data: base64, mimeType: "audio/wav" });
      } catch { /* file missing — ignore */ }
    }
  } catch (err) {
    // TTS failure is non-critical, just log
    console.error(`[tts] Synthesis failed for ${nick}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try { await fsp.unlink(outputPath); } catch { /* ignore cleanup errors */ }
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
