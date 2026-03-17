import type { LocalRAG } from "./rag.js";
import type { ContextStore } from "./context-store.js";

export interface ChatPersona {
  id: string;
  nick: string;
  model: string;
  systemPrompt: string;
  color: string;
}

export interface ClientInfo {
  nick: string;
  channel: string;
  connectedAt: number;
  messageTimestamps: number[];
  uploadBytesWindow: number;
  lastUploadReset: number;
}

export interface PersonaLoaderResult {
  id: string;
  nick: string;
  model: string;
  systemPrompt: string;
  color: string;
  enabled: boolean;
}

export interface ChatOptions {
  ollamaUrl: string;
  rag?: LocalRAG;
  contextStore?: ContextStore;
  loadPersonas?: () => Promise<PersonaLoaderResult[]>;
  maxGeneralResponders?: number;
}

// Inbound message types
export interface InboundChatMessage {
  type: "message";
  text: string;
}

export interface InboundCommand {
  type: "command";
  text: string;
}

export interface InboundUpload {
  type: "upload";
  filename?: string;
  mimeType?: string;
  data?: string; // base64-encoded file content
  size?: number;
}

export type InboundMessage = InboundChatMessage | InboundCommand | InboundUpload;

// Outbound message types
export type OutboundMessage =
  | { type: "message"; nick: string; text: string; color: string }
  | { type: "system"; text: string }
  | { type: "join"; nick: string; channel: string; text: string }
  | { type: "part"; nick: string; channel: string; text: string }
  | { type: "userlist"; users: string[] }
  | { type: "persona"; nick: string; color: string }
  | { type: "audio"; nick: string; data: string; mimeType: string }
  | { type: "image"; nick: string; text: string; imageData: string; imageMime: string }
  | { type: "music"; nick: string; text: string; audioData: string; audioMime: string }
  | { type: "channelInfo"; channel: string };

// Chat log entry
export interface ChatLogEntry {
  ts: string;
  channel: string;
  nick: string;
  type: "message" | "system";
  text: string;
}

// Persona persistent memory
export interface PersonaMemory {
  nick: string;
  facts: string[];
  summary: string;
  lastUpdated: string;
}
