import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolvePreferredPythonBin, resolveVoiceSamplePath, resolveVoiceSamplesRoot, toVoiceSampleBasename } from "./voice-samples.js";

describe("voice sample helpers", () => {
  it("sanitizes persona names consistently for upload and runtime lookup", () => {
    assert.equal(toVoiceSampleBasename("Sun Ra"), "sun_ra");
    assert.equal(toVoiceSampleBasename("Batty!"), "batty_");
  });

  it("resolves a stable wav path inside the voice-samples directory", () => {
    const rootDir = path.resolve("/tmp", "voice-samples");
    const samplePath = resolveVoiceSamplePath("Sun Ra", rootDir);
    assert.equal(samplePath, path.join(rootDir, "sun_ra.wav"));
  });

  it("rejects empty persona names", () => {
    assert.equal(resolveVoiceSamplePath(""), null);
  });

  it("prefers the local data dir when resolving the voice sample root", () => {
    const env = { KXKM_LOCAL_DATA_DIR: path.join("/tmp", "kxkm-local") };
    assert.equal(resolveVoiceSamplesRoot(env), path.join("/tmp", "kxkm-local", "voice-samples"));
  });

  it("prefers an explicit PYTHON_BIN over fallbacks", () => {
    assert.equal(resolvePreferredPythonBin({ PYTHON_BIN: "/tmp/custom-python" }), "/tmp/custom-python");
  });
});
