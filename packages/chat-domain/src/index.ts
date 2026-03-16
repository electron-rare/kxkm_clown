import { createId, createIsoTimestamp } from "@kxkm/core";
import type { ChatChannel } from "@kxkm/core";

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const DEFAULT_CHANNELS: ChatChannel[] = [
  { id: "general", label: "#general", kind: "general" },
  { id: "admin", label: "#admin", kind: "admin" },
];

export function normalizeDedicatedChannelId(model: string): string {
  return model
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function createDedicatedChannel(model: string): ChatChannel {
  const channelId = normalizeDedicatedChannelId(model);
  return {
    id: channelId,
    label: `#${channelId}`,
    kind: "dedicated",
    model,
  };
}

export function buildChatChannels(models: string[]): ChatChannel[] {
  return [
    ...DEFAULT_CHANNELS,
    ...models.map(createDedicatedChannel),
  ];
}

// ---------------------------------------------------------------------------
// Chat message types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  channel: string;
  nick: string;
  personaId?: string;
  content: string;
  timestamp: string;
  replyTo?: string;
}

export interface ChatSession {
  id: string;
  userId: string;
  channel: string;
  model: string | null;
  persona: string | null;
  createdAt: string;
  lastActivity: string;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function createChatMessage(
  channel: string,
  nick: string,
  content: string,
  personaId?: string,
): ChatMessage {
  return {
    id: createId("msg"),
    channel,
    nick,
    personaId,
    content,
    timestamp: createIsoTimestamp(),
  };
}

export function createChatSession(
  userId: string,
  channel = "general",
): ChatSession {
  const now = createIsoTimestamp();
  return {
    id: createId("session"),
    userId,
    channel,
    model: null,
    persona: null,
    createdAt: now,
    lastActivity: now,
  };
}

// ---------------------------------------------------------------------------
// Context window management
// ---------------------------------------------------------------------------

/**
 * Compact a message history by dropping older messages while keeping the most
 * recent ones.  Inspired by the V1 `compactContext` logic in chat-routing.js
 * which summarised old messages and kept the last N.  This pure version simply
 * trims the array — the caller can choose to summarise the dropped portion via
 * an LLM separately.
 *
 * If the total number of messages is within `maxMessages`, the array is
 * returned unchanged.  Otherwise the oldest messages are dropped, keeping only
 * `keepRecent` entries from the tail.
 */
export function compactHistory(
  messages: ChatMessage[],
  maxMessages: number,
  keepRecent: number,
): ChatMessage[] {
  if (messages.length <= maxMessages) {
    return messages;
  }
  // Guard: keepRecent should not exceed array length
  const safeKeep = Math.min(keepRecent, messages.length);
  return messages.slice(-safeKeep);
}

// ---------------------------------------------------------------------------
// Channel validation
// ---------------------------------------------------------------------------

const CHANNEL_NAME_RE = /^[a-z][a-z0-9_-]{0,39}$/;

/**
 * Returns `true` when `name` is a syntactically valid channel name:
 * lower-case alphanumeric, hyphens and underscores, 1-40 chars, must start
 * with a letter.
 */
export function isValidChannelName(name: string): boolean {
  return CHANNEL_NAME_RE.test(name);
}

/**
 * Normalize a free-form string into a valid channel name.  Strips a leading
 * `#`, lower-cases, replaces illegal chars with hyphens, and trims edges.
 */
export function normalizeChannelName(name: string): string {
  return name
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}
