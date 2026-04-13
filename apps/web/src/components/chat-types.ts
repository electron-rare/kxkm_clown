export interface ChatMsg {
  id: number;
  type: "system" | "message" | "join" | "part" | "persona" | "channelInfo" | "userlist" | "command" | "uploadCapability" | "audio" | "image" | "music" | "chunk" | "thinking";
  nick?: string;
  text?: string;
  color?: string;
  channel?: string;
  users?: string[];
  audioData?: string;
  audioMime?: string;
  imageData?: string;
  imageMime?: string;
  seq?: number;
  timestamp: number;
}

export interface PersonaColor {
  [nick: string]: string;
}
