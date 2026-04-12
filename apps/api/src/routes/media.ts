import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import { listMedia, getMediaFilePath } from "../media-store.js";
import { createComposition, addTrack, getComposition, readCompositionFile } from "../composition-store.js";

const router = Router();

// GET /api/v2/media/images — list image metadata
router.get("/images", async (_req, res) => {
  try {
    const items = await listMedia("image");
    res.json({ ok: true, data: items });
  } catch (err) {
    res.status(500).json({ error: "Failed to list images" });
  }
});

// GET /api/v2/media/audio — list audio metadata
router.get("/audio", async (_req, res) => {
  try {
    const items = await listMedia("audio");
    res.json({ ok: true, data: items });
  } catch (err) {
    res.status(500).json({ error: "Failed to list audio" });
  }
});

// GET /api/v2/media/images/:filename — serve image file
router.get("/images/:filename", (req, res) => {
  const filePath = getMediaFilePath("image", req.params.filename);
  if (!filePath) return res.status(404).json({ error: "Not found" });
  res.sendFile(filePath);
});

// GET /api/v2/media/audio/:filename — serve audio file
router.get("/audio/:filename", (req, res) => {
  const filePath = getMediaFilePath("audio", req.params.filename);
  if (!filePath) return res.status(404).json({ error: "Not found" });
  res.sendFile(filePath);
});

// GET /api/v2/media/compositions/:id/mix — serve mix WAV
router.get("/compositions/:id/mix", (req, res) => {
  const compDir = path.join(process.cwd(), "data", "compositions", req.params.id);
  const mixPath = path.join(compDir, "mix.wav");
  if (!fs.existsSync(mixPath)) return res.status(404).json({ error: "Mix not found. /mix first." });
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}-mix.wav"`);
  res.sendFile(mixPath);
});

// GET /api/v2/media/compositions/:id/mp3 — serve mix MP3
router.get("/compositions/:id/mp3", (req, res) => {
  const mp3Path = path.join(process.cwd(), "data", "compositions", req.params.id, "mix.mp3");
  if (!fs.existsSync(mp3Path)) {
    const wavPath = mp3Path.replace(".mp3", ".wav");
    if (!fs.existsSync(wavPath)) return res.status(404).json({ error: "Mix not found" });
    try {
      const { execFileSync } = require("child_process");
      execFileSync("ffmpeg", ["-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "192k", "-y", mp3Path], { timeout: 30000 });
    } catch { return res.status(500).json({ error: "MP3 conversion failed" }); }
  }
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}-mix.mp3"`);
  res.sendFile(mp3Path);
});

// GET /api/v2/media/compositions/:id/master -- serve master WAV
router.get("/compositions/:id/master", (req, res) => {
  const masterPath = path.join(process.cwd(), "data", "compositions", req.params.id, "master.wav");
  if (!fs.existsSync(masterPath)) return res.status(404).json({ error: "Master not found. /master first." });
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}-master.wav"`);
  res.sendFile(masterPath);
});

// GET /api/v2/media/compositions/:id/bounce — serve bounced audio (wav/mp3/flac)
router.get("/compositions/:id/bounce", (req, res) => {
  const format = (req.query.format as string) || "wav";
  if (!["wav", "mp3", "flac"].includes(format)) return res.status(400).json({ error: "Invalid format. Use wav, mp3, or flac." });
  const bouncePath = path.join(process.cwd(), "data", "compositions", req.params.id, `bounce.${format}`);
  if (!fs.existsSync(bouncePath)) return res.status(404).json({ error: "Bounce not found. /bounce first." });
  const mimeMap: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac" };
  res.setHeader("Content-Type", mimeMap[format] || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}-bounce.${format}"`);
  res.sendFile(bouncePath);
});

// GET /api/v2/media/compositions — list compositions
router.get("/compositions", async (_req, res) => {
  const compDir = path.join(process.cwd(), "data", "compositions");
  try {
    const entries = fs.readdirSync(compDir).filter(e => fs.existsSync(path.join(compDir, e, "composition.json")));
    const comps = entries
      .map((entry) => readCompositionFile(path.join(compDir, entry, "composition.json")))
      .filter((comp): comp is NonNullable<typeof comp> => !!comp);
    res.json({ ok: true, data: comps });
  } catch {
    res.json({ ok: true, data: [] });
  }
});

// GET /api/v2/media/compositions/:id — get full composition with tracks
router.get("/compositions/:id", (req, res) => {
  const compPath = path.join(process.cwd(), "data", "compositions", req.params.id, "composition.json");
  if (!fs.existsSync(compPath)) return res.status(404).json({ error: "Not found" });
  try {
    const comp = getComposition(req.params.id) || readCompositionFile(compPath);
    if (!comp) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, data: comp });
  } catch { res.status(500).json({ error: "Failed to read composition" }); }
});

// POST /api/v2/media/compositions — create a composition with track metadata from ComposePage
router.post("/compositions", (req, res) => {
  try {
    const { name, nick, tracks } = req.body as {
      name?: string;
      nick?: string;
      tracks?: Array<{
        type?: string;
        prompt?: string;
        style?: string;
        duration?: number;
        volume?: number;
        startOffset?: number;
      }>;
    };
    const resolvedNick = String(nick || "composer").slice(0, 64);
    const comp = createComposition(resolvedNick, "web", name ? String(name).slice(0, 128) : undefined);
    if (!comp) {
      return res.status(503).json({ error: "Limite compositions atteinte." });
    }
    const addedTracks = [];
    if (Array.isArray(tracks)) {
      for (const t of tracks) {
        const trackType = (["music", "voice", "sfx"].includes(String(t.type ?? "")) ? t.type : "music") as "music" | "voice" | "sfx";
        const added = addTrack(comp.id, {
          type: trackType,
          prompt: String(t.prompt ?? "").slice(0, 256),
          style: t.style ? String(t.style).slice(0, 64) : undefined,
          duration: Math.max(1, Math.min(600, Number(t.duration) || 30)),
          volume: Math.max(0, Math.min(100, Number(t.volume) || 100)),
          startMs: Math.max(0, Math.round((Number(t.startOffset) || 0) * 1000)),
        });
        if (added) addedTracks.push(added);
      }
    }
    res.json({ ok: true, data: { id: comp.id, name: comp.name, trackCount: addedTracks.length } });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save composition" });
  }
});

// GET /api/v2/media/compositions/:id/tracks/:trackId — serve individual track WAV
router.get("/compositions/:id/tracks/:trackId", (req, res) => {
  const trackPath = path.join(process.cwd(), "data", "compositions", req.params.id, req.params.trackId + ".wav");
  if (!fs.existsSync(trackPath)) return res.status(404).json({ error: "Track not found" });
  res.sendFile(trackPath);
});

// ── Shared Files ──

const SHARED_DIR = path.join(process.cwd(), "data", "shared");
const SHARED_INDEX = path.join(SHARED_DIR, "index.jsonl");

function writeSharedIndexSync(indexPath: string, records: unknown[]): void {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const tmp = `${indexPath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  const payload = records.length > 0
    ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
    : "";
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, indexPath);
}

function loadSharedIndexSync(indexPath: string = SHARED_INDEX): unknown[] {
  if (!fs.existsSync(indexPath)) return [];

  const raw = fs.readFileSync(indexPath, "utf-8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const records: unknown[] = [];
  let invalidCount = 0;

  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      invalidCount += 1;
    }
  }

  if (invalidCount === 0) return records;

  if (records.length > 0) {
    writeSharedIndexSync(indexPath, records);
    return records;
  }

  const quarantinePath = path.join(
    path.dirname(indexPath),
    `index.corrupt.${Date.now().toString(36)}.jsonl`,
  );
  try {
    fs.renameSync(indexPath, quarantinePath);
  } catch {}
  return [];
}

// POST /api/v2/media/shared — upload a file to shared gallery
router.post("/shared", (req, res, next) => {
  // Parse raw body manually for ESM compatibility
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => { (req as any).body = Buffer.concat(chunks); next(); });
}, (req, res) => {
  try {
    fs.mkdirSync(SHARED_DIR, { recursive: true });
    const nick = String(req.query.nick || "anonymous");
    const name = String(req.query.name || `file-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = name.includes(".") ? "" : ".bin";
    const filename = `${Date.now()}-${nick}-${name}${ext}`;
    const filepath = path.join(SHARED_DIR, filename);
    fs.writeFileSync(filepath, req.body);
    const meta = { filename, nick, name, size: req.body.length, uploadedAt: new Date().toISOString() };
    const records = loadSharedIndexSync();
    records.push(meta);
    writeSharedIndexSync(SHARED_INDEX, records);
    res.json({ ok: true, url: `/api/v2/media/shared/${filename}`, ...meta });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Upload failed" });
  }
});

// GET /api/v2/media/shared — list shared files
router.get("/shared", (_req, res) => {
  try {
    const files = loadSharedIndexSync(SHARED_INDEX);
    res.json(files.reverse().slice(0, 100));
  } catch {
    res.json([]);
  }
});

// GET /api/v2/media/shared/:filename — serve shared file
router.get("/shared/:filename", (req, res) => {
  const safe = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, "");
  const filepath = path.join(SHARED_DIR, safe);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Not found" });
  res.sendFile(filepath);
});

// DELETE /api/v2/media/shared/:filename — delete shared file
router.delete("/shared/:filename", (req, res) => {
  const safe = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, "");
  const filepath = path.join(SHARED_DIR, safe);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Not found" });
  fs.unlinkSync(filepath);
  res.json({ ok: true });
});

export default router;
