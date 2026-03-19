process.env.NODE_ENV = "test";

import { mkdtempSync, rmSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

// Create temp dir and set DATA_DIR BEFORE dynamic-importing media-store
const testDataDir = mkdtempSync(path.join(os.tmpdir(), "kxkm-media-test-"));
process.env.DATA_DIR = testDataDir;

// Small 1x1 PNG as base64
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
// Small WAV (44-byte header, silence)
const TINY_WAV_B64 = Buffer.from(
  "UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=",
  "base64",
).toString("base64");

// Use dynamic import so DATA_DIR is already set when the module initializes
const mediaStorePromise = import("./media-store.js");

after(() => {
  rmSync(testDataDir, { recursive: true, force: true });
});

describe("media-store", () => {
  it("saveImage creates PNG file and metadata JSON", async () => {
    const { saveImage } = await mediaStorePromise;

    const meta = await saveImage({
      base64: TINY_PNG_B64,
      prompt: "test image",
      nick: "tester",
      channel: "#test",
    });

    assert.equal(meta.type, "image");
    assert.equal(meta.nick, "tester");
    assert.ok(meta.filename.endsWith(".png"), "filename should end with .png");

    const imagesDir = path.join(testDataDir, "media", "images");
    const files = await readdir(imagesDir);
    assert.ok(files.includes(meta.filename), "PNG file should exist");
    assert.ok(files.includes(`${meta.id}.json`), "metadata JSON should exist");

    const jsonContent = JSON.parse(await readFile(path.join(imagesDir, `${meta.id}.json`), "utf-8"));
    assert.equal(jsonContent.prompt, "test image");
    assert.equal(jsonContent.channel, "#test");
  });

  it("saveAudio creates WAV file and metadata JSON", async () => {
    const { saveAudio } = await mediaStorePromise;

    const meta = await saveAudio({
      base64: TINY_WAV_B64,
      prompt: "test audio",
      nick: "tester",
      channel: "#test",
    });

    assert.equal(meta.type, "audio");
    assert.ok(meta.filename.endsWith(".wav"), "filename should end with .wav");

    const audioDir = path.join(testDataDir, "media", "audio");
    const files = await readdir(audioDir);
    assert.ok(files.includes(meta.filename), "WAV file should exist");
    assert.ok(files.includes(`${meta.id}.json`), "metadata JSON should exist");
  });

  it("listMedia returns saved items sorted newest first", async () => {
    const { saveImage, listMedia } = await mediaStorePromise;

    await saveImage({ base64: TINY_PNG_B64, prompt: "alpha", nick: "a", channel: "#c" });
    await new Promise(r => setTimeout(r, 20));
    await saveImage({ base64: TINY_PNG_B64, prompt: "beta", nick: "b", channel: "#c" });

    const items = await listMedia("image");
    assert.ok(items.length >= 3, `expected >= 3 items, got ${items.length}`);
    // Sorted reverse by filename (timestamp-based), newest first
    assert.equal(items[0].prompt, "beta");
    assert.equal(items[1].prompt, "alpha");
  });

  it("listMedia returns array for audio type", async () => {
    const { listMedia } = await mediaStorePromise;
    const items = await listMedia("audio");
    assert.ok(Array.isArray(items));
  });

  it("getMediaFilePath returns null for nonexistent file", async () => {
    const { getMediaFilePath } = await mediaStorePromise;
    const result = getMediaFilePath("image", "nonexistent-file.png");
    assert.equal(result, null);
  });

  it("getMediaFilePath prevents directory traversal", async () => {
    const { getMediaFilePath } = await mediaStorePromise;
    const result = getMediaFilePath("image", "../../../etc/passwd");
    assert.equal(result, null);
  });

  it("saveImage with JPEG mime uses .jpg extension", async () => {
    const { saveImage } = await mediaStorePromise;

    const meta = await saveImage({
      base64: TINY_PNG_B64,
      prompt: "jpeg test",
      nick: "tester",
      channel: "#test",
      mime: "image/jpeg",
    });

    assert.ok(meta.filename.endsWith(".jpg"), "filename should end with .jpg");
    assert.equal(meta.mime, "image/jpeg");
  });
});
