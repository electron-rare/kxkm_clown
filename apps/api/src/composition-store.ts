import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import logger from "./logger.js";

const COMP_DIR = path.join(process.cwd(), "data", "compositions");
fs.mkdirSync(COMP_DIR, { recursive: true });

export interface Track {
  id: string;
  type: "music" | "voice" | "sfx";
  prompt: string;
  style?: string;
  duration: number;
  volume: number; // 0-100
  startMs: number; // offset in timeline
  filePath?: string; // path to WAV
  createdAt: string;
}

export interface Composition {
  id: string;
  name: string;
  channel: string;
  nick: string;
  tracks: Track[];
  createdAt: string;
  updatedAt: string;
}

const compositions = new Map<string, Composition>();

export function createComposition(nick: string, channel: string, name?: string): Composition {
  const id = `comp_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const comp: Composition = {
    id, name: name || `Composition ${id}`,
    channel, nick, tracks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  compositions.set(id, comp);
  saveComposition(comp);
  return comp;
}

export function getComposition(id: string): Composition | undefined {
  return compositions.get(id);
}

export function getActiveComposition(nick: string, channel: string): Composition | undefined {
  for (const comp of compositions.values()) {
    if (comp.nick === nick && comp.channel === channel) return comp;
  }
  return undefined;
}

export function addTrack(compId: string, track: Omit<Track, "id" | "createdAt">): Track | null {
  const comp = compositions.get(compId);
  if (!comp) return null;
  const t: Track = { ...track, id: `trk_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`, createdAt: new Date().toISOString() };
  comp.tracks.push(t);
  comp.updatedAt = new Date().toISOString();
  saveComposition(comp);
  return t;
}

export function listCompositions(nick?: string): Composition[] {
  const all = [...compositions.values()];
  return nick ? all.filter(c => c.nick === nick) : all;
}

function saveComposition(comp: Composition): void {
  const dir = path.join(COMP_DIR, comp.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "composition.json"), JSON.stringify(comp, null, 2));
}

// Load existing compositions on startup
try {
  for (const entry of fs.readdirSync(COMP_DIR)) {
    const jsonPath = path.join(COMP_DIR, entry, "composition.json");
    if (fs.existsSync(jsonPath)) {
      const comp = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Composition;
      compositions.set(comp.id, comp);
    }
  }
  if (compositions.size > 0) logger.info({ count: compositions.size }, "[composition] Loaded compositions");
} catch { /* no compositions yet */ }
