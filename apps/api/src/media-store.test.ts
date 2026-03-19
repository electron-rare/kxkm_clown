import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

// Set DATA_DIR before importing the module so the top-level mkdirSync
// creates directories inside our tmpdir instead of ./data.
const TEST_DATA_DIR = path.join(
  os.tmpdir(),
  `media-store-test-${crypto.randomBytes(6).toString("hex")}`,
);
process.env.DATA_DIR = TEST_DATA_DIR;

// Dynamic import so DATA_DIR is already set when the module evaluates.
const { saveImage, saveAudio, listMedia, getMediaFilePath } = await import(
  "./media-store.js"
);

const IMAGES_DIR = path.join(TEST_DATA_DIR, "media", "images");
const AUDIO_DIR = path.join(TEST_DATA_DIR, "media", "audio");

const DUMMY_PNG_B64 = Buffer.from("fake-png-bytes").toString("base64");
const DUMMY_WAV_B64 = Buffer.from("fake-wav-bytes").toString("base64");

const baseOpts = { prompt: "test prompt", nick: "tester", channel: "#test" };

after(async () => {
  await fsp.rm(TEST_DATA_DIR, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

// -----------------------------------------------------------------------
describe("saveImage()", () => {
  it("creates an image file and a metadata JSON file", async () => {
    const meta = await saveImage({ ...baseOpts, base64: DUMMY_PNG_B64 });

    const imgPath = path.join(IMAGES_DIR, meta.filename);
    const jsonPath = path.join(IMAGES_DIR, `${meta.id}.json`);

    assert.ok(fs.existsSync(imgPath), "image file should exist");
    assert.ok(fs.existsSync(jsonPath), "metadata JSON should exist");

    // Verify image content matches decoded base64
    const imgContent = await fsp.readFile(imgPath);
    assert.deepStrictEqual(imgContent, Buffer.from(DUMMY_PNG_B64, "base64"));
  });

  it("returns a MediaMeta with the correct fields", async () => {
    const meta = await saveImage({
      ...baseOpts,
      base64: DUMMY_PNG_B64,
      mime: "image/jpeg",
    });

    assert.equal(meta.type, "image");
    assert.equal(meta.prompt, "test prompt");
    assert.equal(meta.nick, "tester");
    assert.equal(meta.channel, "#test");
    assert.equal(meta.mime, "image/jpeg");
    assert.ok(meta.filename.endsWith(".jpg"), "jpeg mime should produce .jpg");
    assert.ok(meta.id, "id should be present");
    assert.ok(meta.createdAt, "createdAt should be present");
  });
});

// -----------------------------------------------------------------------
describe("saveAudio()", () => {
  it("creates an audio file and metadata", async () => {
    const meta = await saveAudio({ ...baseOpts, base64: DUMMY_WAV_B64 });

    const audioPath = path.join(AUDIO_DIR, meta.filename);
    const jsonPath = path.join(AUDIO_DIR, `${meta.id}.json`);

    assert.ok(fs.existsSync(audioPath), "audio file should exist");
    assert.ok(fs.existsSync(jsonPath), "metadata JSON should exist");
    assert.equal(meta.type, "audio");
    assert.equal(meta.mime, "audio/wav");
    assert.ok(meta.filename.endsWith(".wav"));
  });
});

// -----------------------------------------------------------------------
describe("listMedia()", () => {
  it('returns metadata entries for "image" type', async () => {
    // saveImage was already called above; list should find them
    const list = await listMedia("image");
    assert.ok(list.length >= 1, "should find at least one image meta");
    assert.equal(list[0].type, "image");
  });

  it("returns [] when there are no JSON files", async () => {
    // Create a fresh empty dir to test the empty case
    const emptyDir = path.join(TEST_DATA_DIR, "media", "empty-test");
    await fsp.mkdir(emptyDir, { recursive: true });

    // listMedia only knows "image" | "audio", so test "audio" after
    // clearing the audio dir temporarily.
    const audioFiles = await fsp.readdir(AUDIO_DIR);
    // Move files away
    const backupDir = path.join(TEST_DATA_DIR, "backup-audio");
    await fsp.mkdir(backupDir, { recursive: true });
    for (const f of audioFiles) {
      await fsp.rename(path.join(AUDIO_DIR, f), path.join(backupDir, f));
    }

    const list = await listMedia("audio");
    assert.deepStrictEqual(list, []);

    // Restore files
    for (const f of audioFiles) {
      await fsp.rename(path.join(backupDir, f), path.join(AUDIO_DIR, f));
    }
  });
});

// -----------------------------------------------------------------------
describe("getMediaFilePath()", () => {
  it("returns null when the file does not exist", () => {
    const result = getMediaFilePath("image", "nonexistent.png");
    assert.equal(result, null);
  });

  it("prevents directory traversal (../../etc/passwd → basename)", () => {
    const result = getMediaFilePath("image", "../../etc/passwd");
    // Should resolve to basename "passwd" which doesn't exist → null
    assert.equal(result, null);
  });

  it("returns the full path for an existing file", async () => {
    const meta = await saveImage({ ...baseOpts, base64: DUMMY_PNG_B64 });
    const result = getMediaFilePath("image", meta.filename);
    assert.ok(result, "should return a path for existing file");
    assert.ok(result!.startsWith(IMAGES_DIR), "path should be inside IMAGES_DIR");
    assert.ok(result!.endsWith(meta.filename));
  });
});

// -----------------------------------------------------------------------
describe("generateId() uniqueness", () => {
  it("produces unique IDs across two successive saves", async () => {
    const meta1 = await saveImage({ ...baseOpts, base64: DUMMY_PNG_B64 });
    const meta2 = await saveImage({ ...baseOpts, base64: DUMMY_PNG_B64 });
    assert.notEqual(meta1.id, meta2.id, "IDs should be unique");
  });
});
