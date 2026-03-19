import fs from "node:fs";
import path from "node:path";
import logger from "./logger.js";
import type { ChatLogEntry } from "./chat-types.js";

// ---------------------------------------------------------------------------
// Chat logging (JSONL)
// ---------------------------------------------------------------------------

const CHAT_LOG_DIR = path.resolve(process.cwd(), "data/chat-logs");

let logDirReady = false;

async function ensureLogDir(): Promise<void> {
  if (logDirReady) return;
  await fs.promises.mkdir(CHAT_LOG_DIR, { recursive: true });
  logDirReady = true;
}

// Ensure log dir at startup (fire-and-forget)
ensureLogDir().catch((err) =>
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "[ws-chat-logger] Failed to create log dir"),
);

function logFilePath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(CHAT_LOG_DIR, `v2-${date}.jsonl`);
}

export function logChatMessage(entry: ChatLogEntry): void {
  ensureLogDir()
    .then(() => fs.promises.appendFile(logFilePath(), JSON.stringify(entry) + "\n", "utf8"))
    .catch((err) => {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        return;
      }
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "[ws-chat-logger] Failed to log chat message");
    });
}
