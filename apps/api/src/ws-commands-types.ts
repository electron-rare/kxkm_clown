import type { WebSocket } from "ws";
import type { ChatPersona, ClientInfo, OutboundMessage, ChatLogEntry } from "./chat-types.js";
import type { ContextStore } from "./context-store.js";

export interface CommandContext {
  ws: WebSocket;
  info: ClientInfo;
  text: string;
}

export interface CommandHandlerDeps {
  send: (ws: WebSocket, msg: OutboundMessage) => void;
  broadcast: (channel: string, msg: OutboundMessage, exclude?: WebSocket) => void;
  broadcastUserlist: (channel: string) => void;
  channelUsers: (channel: string) => string[];
  listConnectedNicks: () => string[];
  listChannelCounts: () => Map<string, number>;
  routeToPersonas: (channel: string, text: string) => Promise<void>;
  logChatMessage: (entry: ChatLogEntry) => void;
  getPersonas: () => ChatPersona[];
  getChannelTopics?: () => Map<string, string>;
  getClients?: () => Map<any, { nick: string; channel: string }>;
  getMaxResponders: () => number;
  setMaxResponders: (n: number) => void;
  getActiveUserCount: () => number;
  getContextStore?: () => ContextStore | undefined;
  refreshPersonas?: () => Promise<void>;
  getChannelPins?: () => Map<string, string[]>;
  getUserStats?: () => Map<string, { messages: number; firstSeen: number }>;
  bannedNicks?: Set<string>;
}
