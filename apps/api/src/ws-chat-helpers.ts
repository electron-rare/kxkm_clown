import { WebSocket } from "ws";
import type { ClientInfo, OutboundMessage } from "./chat-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_WS_MESSAGE_BYTES = 16 * 1024 * 1024; // 16 MB to support file uploads
export const MAX_TEXT_LENGTH = 8192;
export const RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
export const RATE_LIMIT_MAX_MESSAGES = 15; // max messages per window

// ---------------------------------------------------------------------------
// Client ID / nick generation
// ---------------------------------------------------------------------------

let clientIdCounter = 0;

export function generateNick(): string {
  return `user_${++clientIdCounter}`;
}

// ---------------------------------------------------------------------------
// Safe WebSocket send
// ---------------------------------------------------------------------------

export type SendFn = (ws: WebSocket, msg: OutboundMessage) => void;

export function send(ws: WebSocket, msg: OutboundMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* connection closed between check and send */ }
  }
}

// ---------------------------------------------------------------------------
// Rate-limit check
// ---------------------------------------------------------------------------

/**
 * Returns true if the client is rate-limited (message should be dropped).
 * Mutates info.messageTimestamps to prune old entries.
 */
export function checkRateLimit(info: ClientInfo): boolean {
  const now = Date.now();
  info.messageTimestamps = info.messageTimestamps.filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (info.messageTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
    return true;
  }
  info.messageTimestamps.push(now);
  return false;
}
