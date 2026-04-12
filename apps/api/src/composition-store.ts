import crypto from "node:crypto";
import fs from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import logger from "./logger.js";

const COMP_DIR = path.join(process.cwd(), "data", "compositions");

// Hard limits — prevent unbounded Map growth and runaway JSON files
const MAX_COMPOSITIONS = Number(process.env.KXKM_MAX_COMPOSITIONS) || 500;
const MAX_COMPOSITION_BYTES = Number(process.env.KXKM_MAX_COMPOSITION_BYTES) || 524_288; // 512 KB
const MAX_TRACKS_PER_COMPOSITION = Number(process.env.KXKM_MAX_TRACKS) || 100;

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

export interface TimelineClip {
  id: string;
  trackId: string;
  startMs: number;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  gain: number; // 0-200
}

export interface TimelineMarker {
  id: string;
  label: string;
  atMs: number;
  color?: string;
  createdAt: string;
}

export interface TimelineModelV1 {
  version: 1;
  bpm: number;
  timeSignature: [number, number];
  tracks: Track[];
  clips: TimelineClip[];
  markers: TimelineMarker[];
}

export interface Composition {
  id: string;
  name: string;
  channel: string;
  nick: string;
  // Legacy alias kept for compatibility with existing command handlers.
  tracks: Track[];
  timeline: TimelineModelV1;
  createdAt: string;
  updatedAt: string;
}

const compositions = new Map<string, Composition>();
const saveChains = new Map<string, Promise<void>>();

function toDurationMs(seconds: number): number {
  return Math.max(1000, Math.round((seconds || 0) * 1000));
}

function makeDefaultClip(track: Track): TimelineClip {
  const clipId = `clp_${Date.now().toString(36)}_${crypto.randomBytes(2).toString("hex")}`;
  return {
    id: clipId,
    trackId: track.id,
    startMs: Math.max(0, track.startMs || 0),
    durationMs: toDurationMs(track.duration),
    trimStartMs: 0,
    trimEndMs: 0,
    gain: Math.min(200, Math.max(0, track.volume ?? 100)),
  };
}

function normalizeComposition(input: Composition): Composition {
  const tracks = Array.isArray(input.tracks) ? input.tracks : [];

  const timeline: TimelineModelV1 = input.timeline
    ? {
        version: 1,
        bpm: Number.isFinite(input.timeline.bpm) ? input.timeline.bpm : 120,
        timeSignature:
          Array.isArray(input.timeline.timeSignature) && input.timeline.timeSignature.length === 2
            ? [input.timeline.timeSignature[0], input.timeline.timeSignature[1]]
            : [4, 4],
        tracks,
        clips: Array.isArray(input.timeline.clips) ? input.timeline.clips : [],
        markers: Array.isArray(input.timeline.markers) ? input.timeline.markers : [],
      }
    : {
        version: 1,
        bpm: 120,
        timeSignature: [4, 4],
        tracks,
        clips: tracks.map(makeDefaultClip),
        markers: [],
      };

  if (timeline.clips.length === 0 && tracks.length > 0) {
    timeline.clips = tracks.map(makeDefaultClip);
  }

  return {
    ...input,
    tracks,
    timeline,
  };
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  return null;
}

function writeCompositionSync(jsonPath: string, serialized: string): void {
  const dir = path.dirname(jsonPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${jsonPath}.${process.pid}.${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, serialized.endsWith("\n") ? serialized : `${serialized}\n`, "utf8");
  fs.renameSync(tmp, jsonPath);
}

function quarantineCorruptComposition(jsonPath: string, entry: string, parseErr: unknown): void {
  const quarantinePath = path.join(path.dirname(jsonPath), `composition.corrupt.${Date.now().toString(36)}.json`);
  try {
    fs.renameSync(jsonPath, quarantinePath);
    logger.warn({ err: parseErr, entry, quarantinePath }, "[composition] Quarantined unrecoverable composition file");
  } catch (renameErr) {
    logger.warn({ err: renameErr, entry, originalError: parseErr }, "[composition] Failed to quarantine corrupt composition file");
  }
}

function loadCompositionFromDisk(jsonPath: string, entry: string): Composition | null {
  const raw = fs.readFileSync(jsonPath, "utf-8");
  try {
    return normalizeComposition(JSON.parse(raw) as Composition);
  } catch (parseErr) {
    const recoveredRaw = extractFirstJsonObject(raw);
    if (recoveredRaw) {
      try {
        const recovered = normalizeComposition(JSON.parse(recoveredRaw) as Composition);
        writeCompositionSync(jsonPath, JSON.stringify(recovered, null, 2));
        logger.warn({ entry }, "[composition] Recovered corrupted composition file by truncating trailing bytes");
        return recovered;
      } catch {
        // Fall through to quarantine
      }
    }

    quarantineCorruptComposition(jsonPath, entry, parseErr);
    return null;
  }
}

export function readCompositionFile(jsonPath: string): Composition | null {
  return loadCompositionFromDisk(jsonPath, path.basename(path.dirname(jsonPath)));
}

export function createComposition(nick: string, channel: string, name?: string): Composition | undefined {
  if (compositions.size >= MAX_COMPOSITIONS) {
    logger.warn({ size: compositions.size, max: MAX_COMPOSITIONS }, "[composition] MAX_COMPOSITIONS reached — refusing to create new entry");
    return undefined;
  }
  const id = `comp_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const tracks: Track[] = [];
  const comp: Composition = {
    id, name: name || `Composition ${id}`,
    channel,
    nick,
    tracks,
    timeline: {
      version: 1,
      bpm: 120,
      timeSignature: [4, 4],
      tracks,
      clips: [],
      markers: [],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  compositions.set(id, comp);
  saveComposition(comp).catch((err) => logger.error({ err, id }, "[composition] Failed to persist new composition"));
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

export function setActiveComposition(nick: string, channel: string, compId: string): Composition | undefined {
  const comp = compositions.get(compId);
  if (!comp) return undefined;
  const normalized = normalizeComposition(comp);
  // Reassign nick/channel so getActiveComposition finds it for this user
  normalized.nick = nick;
  normalized.channel = channel;
  normalized.updatedAt = new Date().toISOString();
  compositions.set(compId, normalized);
  saveComposition(normalized).catch((err) => logger.error({ err, compId }, "[composition] Failed to persist setActiveComposition"));
  return normalized;
}

export function addTrack(compId: string, track: Omit<Track, "id" | "createdAt">): Track | null {
  const comp = compositions.get(compId);
  if (!comp) return null;
  const normalized = normalizeComposition(comp);
  if (normalized.timeline.tracks.length >= MAX_TRACKS_PER_COMPOSITION) {
    logger.warn({ compId, max: MAX_TRACKS_PER_COMPOSITION }, "[composition] MAX_TRACKS_PER_COMPOSITION reached");
    return null;
  }
  const t: Track = { ...track, id: `trk_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`, createdAt: new Date().toISOString() };
  normalized.timeline.tracks.push(t);
  normalized.tracks = normalized.timeline.tracks;
  normalized.timeline.clips.push(makeDefaultClip(t));
  normalized.updatedAt = new Date().toISOString();
  compositions.set(compId, normalized);
  saveComposition(normalized).catch((err) => logger.error({ err, compId }, "[composition] Failed to persist addTrack"));
  return t;
}

export function getTimeline(compId: string): TimelineModelV1 | undefined {
  const comp = compositions.get(compId);
  if (!comp) return undefined;
  const normalized = normalizeComposition(comp);
  compositions.set(compId, normalized);
  return normalized.timeline;
}

export function updateTimelineSettings(
  compId: string,
  updates: { bpm?: number; timeSignature?: [number, number] },
): TimelineModelV1 | null {
  const comp = compositions.get(compId);
  if (!comp) return null;
  const normalized = normalizeComposition(comp);

  if (typeof updates.bpm === "number" && Number.isFinite(updates.bpm)) {
    normalized.timeline.bpm = Math.min(300, Math.max(20, Math.round(updates.bpm)));
  }
  if (
    Array.isArray(updates.timeSignature) &&
    updates.timeSignature.length === 2 &&
    Number.isFinite(updates.timeSignature[0]) &&
    Number.isFinite(updates.timeSignature[1])
  ) {
    normalized.timeline.timeSignature = [
      Math.max(1, Math.round(updates.timeSignature[0])),
      Math.max(1, Math.round(updates.timeSignature[1])),
    ];
  }

  normalized.updatedAt = new Date().toISOString();
  compositions.set(compId, normalized);
  saveComposition(normalized).catch((err) => logger.error({ err, compId }, "[composition] Failed to persist updateTimelineSettings"));
  return normalized.timeline;
}

export function addTimelineMarker(
  compId: string,
  marker: { label: string; atMs: number; color?: string },
): TimelineMarker | null {
  const comp = compositions.get(compId);
  if (!comp) return null;
  const normalized = normalizeComposition(comp);
  const created: TimelineMarker = {
    id: `mrk_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
    label: marker.label.trim() || "Marker",
    atMs: Math.max(0, Math.round(marker.atMs || 0)),
    color: marker.color,
    createdAt: new Date().toISOString(),
  };
  normalized.timeline.markers.push(created);
  normalized.updatedAt = new Date().toISOString();
  compositions.set(compId, normalized);
  saveComposition(normalized).catch((err) => logger.error({ err, compId }, "[composition] Failed to persist addTimelineMarker"));
  return created;
}

export function listTimelineMarkers(compId: string): TimelineMarker[] {
  const timeline = getTimeline(compId);
  if (!timeline) return [];
  return [...timeline.markers].sort((a, b) => a.atMs - b.atMs);
}

export function listCompositions(nick?: string): Composition[] {
  const all = [...compositions.values()];
  return nick ? all.filter(c => c.nick === nick) : all;
}

async function persistComposition(comp: Composition): Promise<void> {
  const serialized = JSON.stringify(comp, null, 2);
  if (serialized.length > MAX_COMPOSITION_BYTES) {
    logger.warn(
      { id: comp.id, bytes: serialized.length, max: MAX_COMPOSITION_BYTES },
      "[composition] Composition exceeds MAX_COMPOSITION_BYTES — skipping persist",
    );
    return;
  }
  const dir = path.join(COMP_DIR, comp.id);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, "composition.json");
  const tmp = `${target}.${process.pid}.${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, target); // atomic: prevents partial-read corruption on concurrent saves
}

async function saveComposition(comp: Composition): Promise<void> {
  const previous = saveChains.get(comp.id) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => persistComposition(comp))
    .finally(() => {
      if (saveChains.get(comp.id) === next) {
        saveChains.delete(comp.id);
      }
    });
  saveChains.set(comp.id, next);
  return next;
}

// Load existing compositions on startup (sync is acceptable once at boot, but errors are now logged individually)
try {
  fs.mkdirSync(COMP_DIR, { recursive: true });
  for (const entry of fs.readdirSync(COMP_DIR)) {
    const jsonPath = path.join(COMP_DIR, entry, "composition.json");
    if (!fs.existsSync(jsonPath)) continue;
    const normalized = loadCompositionFromDisk(jsonPath, entry);
    if (normalized) {
      compositions.set(normalized.id, normalized);
    }
  }
  if (compositions.size > 0) logger.info({ count: compositions.size }, "[composition] Loaded compositions");
} catch (dirErr) {
  logger.warn({ err: dirErr }, "[composition] Could not read compositions directory");
}
