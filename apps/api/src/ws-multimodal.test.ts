import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  acquireFileProcessor,
  releaseFileProcessor,
  isTTSAvailable,
  acquireTTS,
  releaseTTS,
  synthesizeTTS,
  isOfficeDocument,
  analyzeImage,
} from "./ws-multimodal.js";
import type { OutboundMessage } from "./chat-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetch(impl: (...args: any[]) => any) {
  globalThis.fetch = impl as typeof fetch;
}

// ---------------------------------------------------------------------------
// Semaphores — file processor
// ---------------------------------------------------------------------------

describe("file processor semaphore", () => {
  afterEach(() => {
    // drain semaphore back to 0
    for (let i = 0; i < 5; i++) releaseFileProcessor();
  });

  it("acquireFileProcessor resolves immediately under the limit", async () => {
    // Should resolve without delay when count is 0
    await acquireFileProcessor();
    assert.ok(true, "acquired without blocking");
  });

  it("releaseFileProcessor decrements the counter", async () => {
    await acquireFileProcessor();
    await acquireFileProcessor();
    releaseFileProcessor();
    // Should still be able to acquire (now at 1, limit 2)
    await acquireFileProcessor();
    assert.ok(true, "acquired after release");
  });
});

// ---------------------------------------------------------------------------
// Semaphores — TTS
// ---------------------------------------------------------------------------

describe("TTS semaphore", () => {
  afterEach(() => {
    for (let i = 0; i < 5; i++) releaseTTS();
  });

  it("isTTSAvailable returns true under the limit", () => {
    assert.equal(isTTSAvailable(), true);
  });

  it("isTTSAvailable returns false at the limit", () => {
    acquireTTS();
    acquireTTS();
    assert.equal(isTTSAvailable(), false);
  });

  it("acquireTTS/releaseTTS increments and decrements", () => {
    acquireTTS();
    assert.equal(isTTSAvailable(), true); // 1 < 2
    acquireTTS();
    assert.equal(isTTSAvailable(), false); // 2 >= 2
    releaseTTS();
    assert.equal(isTTSAvailable(), true); // back to 1
  });

  it("releaseTTS does not go below 0", () => {
    releaseTTS();
    releaseTTS();
    releaseTTS();
    // Should still be available (counter stays at 0)
    assert.equal(isTTSAvailable(), true);
  });
});

// ---------------------------------------------------------------------------
// isOfficeDocument
// ---------------------------------------------------------------------------

describe("isOfficeDocument", () => {
  it("returns true for office extensions", () => {
    for (const ext of ["docx", "xlsx", "pptx", "odt", "ods", "odp", "rtf", "epub", "doc", "xls", "ppt"]) {
      assert.equal(isOfficeDocument(`file.${ext}`, ""), true, `expected true for .${ext}`);
    }
  });

  it("returns true for office MIME types", () => {
    const mimes = [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/rtf",
      "application/epub+zip",
    ];
    for (const m of mimes) {
      assert.equal(isOfficeDocument("file.bin", m), true, `expected true for ${m}`);
    }
  });

  it("returns false for non-office extensions", () => {
    for (const ext of ["txt", "pdf", "jpg", "png", "mp3"]) {
      assert.equal(isOfficeDocument(`file.${ext}`, ""), false, `expected false for .${ext}`);
    }
  });

  it("returns false for non-office MIME types", () => {
    assert.equal(isOfficeDocument("file.txt", "text/plain"), false);
    assert.equal(isOfficeDocument("file.jpg", "image/jpeg"), false);
  });

  it("is case-insensitive on extension", () => {
    assert.equal(isOfficeDocument("file.DOCX", ""), true);
    assert.equal(isOfficeDocument("file.Xlsx", ""), true);
  });
});

// ---------------------------------------------------------------------------
// synthesizeTTS
// ---------------------------------------------------------------------------

describe("synthesizeTTS", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does nothing if text is shorter than 10 chars", async () => {
    let fetchCalled = false;
    mockFetch(() => { fetchCalled = true; });
    await synthesizeTTS("Nick", "short", "ch1", () => {});
    assert.equal(fetchCalled, false);
  });

  it("does nothing if text is empty", async () => {
    let fetchCalled = false;
    mockFetch(() => { fetchCalled = true; });
    await synthesizeTTS("Nick", "", "ch1", () => {});
    assert.equal(fetchCalled, false);
  });

  it("calls fetch with the correct URL and body", async () => {
    let capturedUrl = "";
    let capturedBody: any = {};
    mockFetch(async (url: string, opts: any) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    });

    await synthesizeTTS("Pharmacius", "Hello world this is a test text", "ch1", () => {});
    assert.match(capturedUrl, /\/synthesize$/);
    assert.equal(capturedBody.text, "Hello world this is a test text");
    // Qwen3-TTS sends lowercase persona, fallback TTS sends original nick
    assert.ok(capturedBody.persona === "pharmacius" || capturedBody.persona === "Pharmacius", "persona should match");
  });

  it("truncates text to 1000 chars", async () => {
    let capturedBody: any = {};
    mockFetch(async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    });

    const longText = "a".repeat(2000);
    await synthesizeTTS("Nick", longText, "ch1", () => {});
    assert.equal(capturedBody.text.length, 1000);
  });

  it("broadcasts audio message in base64", async () => {
    const audioBytes = Buffer.from("fake-audio-data");
    mockFetch(async () => ({
      ok: true,
      arrayBuffer: async () => audioBytes.buffer.slice(audioBytes.byteOffset, audioBytes.byteOffset + audioBytes.byteLength),
    }));

    const broadcasts: { channel: string; msg: OutboundMessage }[] = [];
    await synthesizeTTS("Pharmacius", "This is enough text for TTS", "room1", (ch, msg) => {
      broadcasts.push({ channel: ch, msg });
    });

    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].channel, "room1");
    assert.equal(broadcasts[0].msg.type, "audio");
    assert.equal((broadcasts[0].msg as any).nick, "Pharmacius");
    assert.equal((broadcasts[0].msg as any).mimeType, "audio/wav");
    assert.equal(typeof (broadcasts[0].msg as any).data, "string");
    // Verify base64 round-trip
    const decoded = Buffer.from((broadcasts[0].msg as any).data, "base64");
    assert.deepEqual(decoded, audioBytes);
  });

  it("does not throw on fetch error", async () => {
    mockFetch(async () => { throw new Error("network down"); });
    // Should complete without throwing
    await synthesizeTTS("Nick", "This is enough text for TTS", "ch1", () => {});
    assert.ok(true, "did not throw");
  });

  it("does not throw on non-ok response", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 500,
      text: async () => "server error",
    }));
    await synthesizeTTS("Nick", "This is enough text for TTS", "ch1", () => {});
    assert.ok(true, "did not throw");
  });
});

// ---------------------------------------------------------------------------
// analyzeImage
// ---------------------------------------------------------------------------

describe("analyzeImage", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls Ollama /api/chat with correct model and images", async () => {
    let capturedUrl = "";
    let capturedBody: any = {};
    const imgBuffer = Buffer.from("fake-image");

    mockFetch(async (url: string, opts: any) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ message: { content: "Une photo" } }),
      };
    });

    await analyzeImage(imgBuffer, "image/png", "photo.png", "http://localhost:11434");

    assert.equal(capturedUrl, "http://localhost:11434/api/chat");
    assert.equal(capturedBody.model, "qwen3-vl:8b");
    assert.equal(capturedBody.stream, false);
    assert.equal(capturedBody.messages.length, 1);
    assert.equal(capturedBody.messages[0].role, "user");
    assert.equal(capturedBody.messages[0].images[0], imgBuffer.toString("base64"));
  });

  it("returns '[Image: filename]\\ncaption' on success", async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ message: { content: "Un beau paysage" } }),
    }));

    const result = await analyzeImage(Buffer.from("img"), "image/png", "landscape.png", "http://localhost:11434");
    assert.equal(result, "[Image: landscape.png]\nUn beau paysage");
  });

  it("returns default caption when response has no content", async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ message: {} }),
    }));

    const result = await analyzeImage(Buffer.from("img"), "image/png", "test.png", "http://localhost:11434");
    assert.equal(result, "[Image: test.png]\nPas de description disponible");
  });

  it("returns error message on non-ok response", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 503,
      text: async () => "model not loaded",
    }));

    const result = await analyzeImage(Buffer.from("img"), "image/png", "test.png", "http://localhost:11434");
    assert.match(result, /analyse échouée/);
    assert.match(result, /503/);
    assert.match(result, /test\.png/);
  });

  it("returns error message on fetch exception", async () => {
    mockFetch(async () => { throw new Error("connection refused"); });

    const result = await analyzeImage(Buffer.from("img"), "image/png", "test.png", "http://localhost:11434");
    assert.match(result, /erreur d'analyse/);
    assert.match(result, /connection refused/);
    assert.match(result, /test\.png/);
  });

  it("uses VISION_MODEL env var when set", async () => {
    const origModel = process.env.VISION_MODEL;
    process.env.VISION_MODEL = "llava:13b";

    let capturedBody: any = {};
    mockFetch(async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ message: { content: "caption" } }),
      };
    });

    await analyzeImage(Buffer.from("img"), "image/png", "test.png", "http://localhost:11434");
    assert.equal(capturedBody.model, "llava:13b");

    // Restore
    if (origModel === undefined) delete process.env.VISION_MODEL;
    else process.env.VISION_MODEL = origModel;
  });
});
