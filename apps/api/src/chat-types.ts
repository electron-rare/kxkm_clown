import type { LocalRAG } from "./rag.js";
import type { ContextStore } from "./context-store.js";

export interface CorpusEntry {
  type: 'url' | 'pdf' | 'text';
  source: string;
  content?: string;
}

export type PersonaMemoryMode = 'auto' | 'explicit' | 'off';

export interface PersonaRelation {
  personaId: string;
  attitude: 'sceptique' | 'admiratif' | 'rival' | 'ignore' | 'méfiant' | 'complice';
  note: string;
}

export interface ChatPersona {
  id: string;
  nick: string;
  model: string;
  systemPrompt: string;
  color: string;
  maxTokens?: number;
  corpus?: CorpusEntry[];
  relations?: PersonaRelation[];
  memoryMode?: PersonaMemoryMode;
}

export interface ClientInfo {
  nick: string;
  channel: string;
  connectedAt: number;
  messageTimestamps: number[];
  uploadBytesWindow: number;
  lastUploadReset: number;
  mutedPersonas?: Set<string>;
  isGuest: boolean;
}

export interface PersonaLoaderResult {
  id: string;
  nick: string;
  model: string;
  systemPrompt: string;
  color: string;
  enabled: boolean;
  maxTokens?: number;
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
  | { type: "message"; nick: string; text: string; color: string; seq?: number }
  | { type: "system"; text: string; seq?: number }
  | { type: "join"; nick: string; channel: string; text: string; seq?: number }
  | { type: "part"; nick: string; channel: string; text: string; seq?: number }
  | { type: "userlist"; users: string[]; seq?: number }
  | { type: "persona"; nick: string; color: string; seq?: number }
  | { type: "audio"; nick: string; data: string; mimeType: string; seq?: number }
  | { type: "image"; nick: string; text: string; imageData: string; imageMime: string; seq?: number }
  | { type: "music"; nick: string; text: string; audioData: string; audioMime: string; seq?: number }
  | { type: "channelInfo"; channel: string; seq?: number }
  | { type: "chunk"; nick: string; text: string; color: string; seq: number };

// Chat log entry
export interface ChatLogEntry {
  ts: string;
  channel: string;
  nick: string;
  type: "message" | "system";
  text: string;
}

export interface PersonaArchivalFact {
  text: string;
  firstSeenAt: string;
  lastSeenAt: string;
  source: "chat";
}

export interface PersonaArchivalSummary {
  text: string;
  createdAt: string;
}

export interface PersonaWorkingMemory {
  facts: string[];
  summary: string;
  lastSourceMessages: string[];
}

export interface PersonaArchivalMemory {
  facts: PersonaArchivalFact[];
  summaries: PersonaArchivalSummary[];
}

// Persona persistent memory
export interface PersonaMemory {
  nick: string;
  facts: string[];
  summary: string;
  lastUpdated: string;
  personaId?: string;
  version?: 2;
  workingMemory?: PersonaWorkingMemory;
  archivalMemory?: PersonaArchivalMemory;
}
