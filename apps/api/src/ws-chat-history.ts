import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import type { ChatPersona } from "./chat-types.js";
import type { SendFn } from "./ws-chat-helpers.js";

// ---------------------------------------------------------------------------
// History replay — send recent messages to a newly connected client
// ---------------------------------------------------------------------------

export async function replayHistory(
  ws: WebSocket,
  channel: string,
  personas: ChatPersona[],
  sendFn: SendFn,
): Promise<void> {
  try {
    const channelSafe = channel.replace(/[^a-zA-Z0-9_-]/g, "_");
    const contextFile = path.join(process.cwd(), "data", "context", channelSafe + ".jsonl");
    const raw = await fs.promises.readFile(contextFile, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const recent = lines.slice(-20);
    sendFn(ws, { type: "system", text: "--- Historique recent ---" });
    for (const line of recent) {
      try {
        const entry = JSON.parse(line);
        const ts = entry.ts ? new Date(entry.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
        const prefix = ts ? `[${ts}] ` : "";
        sendFn(ws, {
          type: "message",
          nick: entry.nick,
          text: prefix + entry.text,
          color: (entry.nick && personas.find(p => p.nick === entry.nick)?.color) || "#888888",
        });
      } catch { /* skip malformed */ }
    }
    sendFn(ws, { type: "system", text: "--- Fin de l'historique ---" });
  } catch { /* no history file yet */ }
}
