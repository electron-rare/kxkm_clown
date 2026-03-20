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

export default router;
