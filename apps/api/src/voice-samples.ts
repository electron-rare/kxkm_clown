import { existsSync } from "node:fs";
import path from "node:path";

export function toVoiceSampleBasename(value: string): string {
  return path.basename(value.toLowerCase().replace(/[^a-z0-9_-]/g, "_")).slice(0, 64);
}

export function resolveVoiceSamplesRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.KXKM_VOICE_SAMPLES_DIR && env.KXKM_VOICE_SAMPLES_DIR.trim().length > 0) {
    return path.resolve(env.KXKM_VOICE_SAMPLES_DIR);
  }
  if (env.KXKM_LOCAL_DATA_DIR && env.KXKM_LOCAL_DATA_DIR.trim().length > 0) {
    return path.resolve(env.KXKM_LOCAL_DATA_DIR, "voice-samples");
  }
  return path.resolve(process.cwd(), "data", "voice-samples");
}

export function resolveVoiceSamplePath(personaName: string, rootDir = resolveVoiceSamplesRoot()): string | null {
  const basename = toVoiceSampleBasename(personaName);
  if (!basename || basename === "." || basename === "..") {
    return null;
  }

  const resolved = path.join(rootDir, `${basename}.wav`);
  if (!path.resolve(resolved).startsWith(rootDir)) {
    return null;
  }

  return resolved;
}

export function resolvePreferredPythonBin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PYTHON_BIN && env.PYTHON_BIN.trim().length > 0) {
    return env.PYTHON_BIN;
  }

  const projectVenvPython = path.resolve(process.cwd(), ".venvs", "voice-clone", "bin", "python");
  if (existsSync(projectVenvPython)) {
    return projectVenvPython;
  }

  const legacyPython = "/home/kxkm/venv/bin/python3";
  if (existsSync(legacyPython)) {
    return legacyPython;
  }

  return "python3";
}
