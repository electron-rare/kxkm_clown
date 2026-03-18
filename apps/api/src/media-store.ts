/**
 * media-store — Persists generated images and audio to disk.
 *
 * Storage layout:
 *   data/media/images/<id>.png   + data/media/images/<id>.json
 *   data/media/audio/<id>.wav    + data/media/audio/<id>.json
 *
 * Metadata JSON: { id, type, prompt, nick, channel, createdAt, mime, filename }
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const IMAGES_DIR = path.join(DATA_DIR, "media", "images");
const AUDIO_DIR = path.join(DATA_DIR, "media", "audio");

// Ensure directories exist
for (const dir of [IMAGES_DIR, AUDIO_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export interface MediaMeta {
  id: string;
  type: "image" | "audio";
  prompt: string;
  nick: string;
  channel: string;
  createdAt: string;
  mime: string;
  filename: string;
}

function generateId(): string {
  return `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export async function saveImage(opts: {
  base64: string;
  prompt: string;
  nick: string;
  channel: string;
  mime?: string;
  seed?: number;
}): Promise<MediaMeta> {
  const id = generateId();
  const ext = opts.mime === "image/jpeg" ? "jpg" : "png";
  const filename = `${id}.${ext}`;
  const filePath = path.join(IMAGES_DIR, filename);

  await fsp.writeFile(filePath, Buffer.from(opts.base64, "base64"));

  const meta: MediaMeta = {
    id,
    type: "image",
    prompt: opts.prompt,
    nick: opts.nick,
    channel: opts.channel,
    createdAt: new Date().toISOString(),
    mime: opts.mime || "image/png",
    filename,
  };

  await fsp.writeFile(
    path.join(IMAGES_DIR, `${id}.json`),
    JSON.stringify(meta, null, 2),
  );

  return meta;
}

export async function saveAudio(opts: {
  base64: string;
  prompt: string;
  nick: string;
  channel: string;
  mime?: string;
}): Promise<MediaMeta> {
  const id = generateId();
  const ext = opts.mime === "audio/mp3" ? "mp3" : "wav";
  const filename = `${id}.${ext}`;
  const filePath = path.join(AUDIO_DIR, filename);

  await fsp.writeFile(filePath, Buffer.from(opts.base64, "base64"));

  const meta: MediaMeta = {
    id,
    type: "audio",
    prompt: opts.prompt,
    nick: opts.nick,
    channel: opts.channel,
    createdAt: new Date().toISOString(),
    mime: opts.mime || "audio/wav",
    filename,
  };

  await fsp.writeFile(
    path.join(AUDIO_DIR, `${id}.json`),
    JSON.stringify(meta, null, 2),
  );

  return meta;
}

export async function listMedia(type: "image" | "audio"): Promise<MediaMeta[]> {
  const dir = type === "image" ? IMAGES_DIR : AUDIO_DIR;
  let files: string[];
  try {
    files = await fsp.readdir(dir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();
  const results: MediaMeta[] = [];

  for (const f of jsonFiles.slice(0, 200)) {
    try {
      const raw = await fsp.readFile(path.join(dir, f), "utf-8");
      results.push(JSON.parse(raw));
    } catch {
      // skip corrupted metadata
    }
  }

  return results;
}

export function getMediaFilePath(type: "image" | "audio", filename: string): string | null {
  const dir = type === "image" ? IMAGES_DIR : AUDIO_DIR;
  // Prevent directory traversal
  const safe = path.basename(filename);
  const filePath = path.join(dir, safe);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}
