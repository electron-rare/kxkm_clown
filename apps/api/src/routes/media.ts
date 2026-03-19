import { Router } from "express";
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

export default router;
