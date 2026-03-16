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

// ---------------------------------------------------------------------------
// Conversational memory
// ---------------------------------------------------------------------------

export interface ConversationMemory {
  sessionId: string;
  messages: ChatMessage[];
  maxSize: number;
}

export function createConversationMemory(
  sessionId: string,
  maxSize = 100,
): ConversationMemory {
  return { sessionId, messages: [], maxSize };
}

/** Add a message to memory, evicting oldest if over capacity. */
export function addToMemory(
  memory: ConversationMemory,
  message: ChatMessage,
): void {
  memory.messages.push(message);
  if (memory.messages.length > memory.maxSize) {
    memory.messages.splice(0, memory.messages.length - memory.maxSize);
  }
}

/** Build the LLM context from memory — returns the last N messages as role/content pairs. */
export function buildLlmContext(
  memory: ConversationMemory,
  limit = 50,
): Array<{ role: string; content: string }> {
  const recent = memory.messages.slice(-limit);
  return recent.map((m) => ({
    role: m.personaId ? "assistant" : "user",
    content: m.content,
  }));
}

/** Clear all messages from memory. */
export function clearMemory(memory: ConversationMemory): void {
  memory.messages.length = 0;
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

export interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  adminOnly: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "List available commands", usage: "/help", adminOnly: false },
  { name: "clear", description: "Clear current channel messages", usage: "/clear", adminOnly: false },
  { name: "nick", description: "Change your nickname", usage: "/nick <name>", adminOnly: false },
  { name: "join", description: "Join a channel", usage: "/join <channel>", adminOnly: false },
  { name: "msg", description: "Send a private message to a persona", usage: "/msg <persona> <message>", adminOnly: false },
  { name: "web", description: "Search the web", usage: "/web <query>", adminOnly: false },
  { name: "status", description: "Show server status", usage: "/status", adminOnly: false },
  { name: "model", description: "Change the active model", usage: "/model <name>", adminOnly: true },
  { name: "persona", description: "Switch active persona", usage: "/persona <name>", adminOnly: true },
  { name: "reload", description: "Reload persona definitions", usage: "/reload", adminOnly: true },
  { name: "export", description: "Export conversation as HTML", usage: "/export", adminOnly: false },
];

export interface ParsedCommand {
  name: string;
  args: string;
  raw: string;
}

/** Parse a slash command from user input. Returns null if not a command. */
export function parseSlashCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIdx = trimmed.indexOf(" ");
  const name = spaceIdx === -1
    ? trimmed.slice(1).toLowerCase()
    : trimmed.slice(1, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  if (!name || !/^[a-z][a-z0-9_-]*$/.test(name)) return null;

  return { name, args, raw: trimmed };
}

/** Check if a command exists and if the user has permission. */
export function resolveCommand(
  parsed: ParsedCommand,
  isAdmin: boolean,
): { command: SlashCommand | null; denied: boolean } {
  const command = SLASH_COMMANDS.find((c) => c.name === parsed.name) ?? null;
  if (!command) return { command: null, denied: false };
  if (command.adminOnly && !isAdmin) return { command, denied: true };
  return { command, denied: false };
}

/** Generate help text listing all accessible commands. */
export function generateHelpText(isAdmin: boolean): string {
  return SLASH_COMMANDS
    .filter((c) => !c.adminOnly || isAdmin)
    .map((c) => `${c.usage}  —  ${c.description}`)
    .join("\n");
}
