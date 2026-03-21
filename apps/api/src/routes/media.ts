import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import { listMedia, getMediaFilePath } from "../media-store.js";

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
    const comps = entries.map(e => {
      const raw = fs.readFileSync(path.join(compDir, e, "composition.json"), "utf-8");
      return JSON.parse(raw);
    });
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
    const comp = JSON.parse(fs.readFileSync(compPath, "utf-8"));
    res.json({ ok: true, data: comp });
  } catch { res.status(500).json({ error: "Failed to read composition" }); }
});

// GET /api/v2/media/compositions/:id/tracks/:trackId — serve individual track WAV
router.get("/compositions/:id/tracks/:trackId", (req, res) => {
  const trackPath = path.join(process.cwd(), "data", "compositions", req.params.id, req.params.trackId + ".wav");
  if (!fs.existsSync(trackPath)) return res.status(404).json({ error: "Track not found" });
  res.sendFile(trackPath);
});

export default router;
