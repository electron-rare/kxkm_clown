import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WebSocket } from "ws";
import type { InboundUpload, ClientInfo, OutboundMessage } from "./chat-types.js";

const execFileAsync = promisify(execFile);

const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";

export async function handleUpload(
  ws: WebSocket,
  info: ClientInfo,
  parsed: InboundUpload,
  ollamaUrl: string,
  broadcast: (channel: string, msg: OutboundMessage, exclude?: WebSocket) => void,
  logChatMessage: (entry: any) => void,
  routeToPersonas: (channel: string, text: string) => Promise<void>,
  acquireFileProcessor: () => Promise<void>,
  releaseFileProcessor: () => void,
  isOfficeDocument: (filename: string, mimeType: string) => boolean,
  analyzeImage: (buffer: Buffer, mimeType: string, filename: string, ollamaUrl: string) => Promise<string>,
  send: (ws: WebSocket, msg: OutboundMessage) => void
): Promise<void> {
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
      await fsp.writeFile(tmpFile, buffer);
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
        if (stderr && DEBUG) console.log(`[ws-chat][audio] ${stderr.trim().slice(-200)}`);
        const lastLine = stdout.trim().split("\n").pop() || "{}";
        const result = JSON.parse(lastLine);
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
      try { await fsp.unlink(tmpFile); } catch { /* ignore cleanup errors */ }
    }
  } else if (mimeType === "application/pdf") {
    const tmpFile = path.join("/tmp", `kxkm-pdf-${Date.now()}.pdf`);
    try {
      await fsp.writeFile(tmpFile, buffer);
      await acquireFileProcessor();
      try {
        const pythonBin = process.env.PYTHON_BIN || "python3";
        const scriptPath = path.join(process.env.SCRIPTS_DIR || "scripts", "extract_pdf_docling.py");
        const { stdout, stderr } = await execFileAsync(pythonBin, [scriptPath, "--input", tmpFile], { timeout: 60_000 });
        if (stderr && DEBUG) console.log(`[upload] pdf: ${stderr.slice(-200)}`);
        const result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
        if (result.text) {
          analysis = `[PDF: ${filename}, ${result.pages || "?"} page(s)]\n${result.text}`;
        } else {
          analysis = `[PDF: ${filename} — extraction échouée: ${result.error || "unknown"}]`;
        }
      } finally {
        releaseFileProcessor();
      }
    } catch (err) {
      analysis = `[PDF: ${filename} — erreur: ${err instanceof Error ? err.message : String(err)}]`;
    } finally {
      try { await fsp.unlink(tmpFile); } catch {}
    }
  } else if (isOfficeDocument(filename, mimeType)) {
    const ext = filename.split(".").pop() || "";
    const tmpFile = path.join("/tmp", `kxkm-doc-${Date.now()}.${ext}`);
    try {
      await fsp.writeFile(tmpFile, buffer);
      const pythonBin = process.env.PYTHON_BIN || "python3";
      const scriptPath = path.join(process.env.SCRIPTS_DIR || "scripts", "extract_document.py");
      await acquireFileProcessor();
      try {
        const { stdout, stderr } = await execFileAsync(pythonBin, [
          scriptPath, "--input", tmpFile,
        ], { timeout: 60_000 });
        if (stderr && DEBUG) console.log(`[upload] doc extract: ${stderr.slice(-200)}`);
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
      try { await fsp.unlink(tmpFile); } catch { /* ignore */ }
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
