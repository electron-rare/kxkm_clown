// ---------------------------------------------------------------------------
// Runtime sandbox configuration — pure module (no I/O, no child_process)
// ---------------------------------------------------------------------------

export type SandboxMode = "none" | "subprocess" | "container";

export interface SandboxConfig {
  mode: SandboxMode;
  /** Maximum execution time in milliseconds. */
  timeoutMs: number;
  /** Maximum memory in megabytes. */
  memoryLimitMb: number;
  /** Whether the sandboxed process may access the network. */
  networkAccess: boolean;
  /** Working directory inside the sandbox. */
  workDir: string;
}

export const DEFAULT_SANDBOX: SandboxConfig = {
  mode: "subprocess",
  timeoutMs: 30 * 60_000,   // 30 min
  memoryLimitMb: 4096,      // 4 GB
  networkAccess: false,
  workDir: "/tmp/kxkm-sandbox",
};

// ---------------------------------------------------------------------------
// Shell-safe escaping
// ---------------------------------------------------------------------------

function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Command wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a command string with the appropriate sandbox constraints.
 *
 * - `none`: pass through unchanged.
 * - `subprocess`: use `timeout` and `ulimit -v` for resource limits.
 * - `container`: docker run with memory, cpu, and network limits.
 */
export function wrapCommand(command: string, config: SandboxConfig): string {
  if (config.mode === "none") return command;

  if (config.mode === "subprocess") {
    const timeoutSec = Math.ceil(config.timeoutMs / 1000);
    const memKb = config.memoryLimitMb * 1024;
    const escaped = command.replace(/'/g, "'\\''");
    return `timeout ${timeoutSec} bash -c 'ulimit -v ${memKb} && ${escaped}'`;
  }

  if (config.mode === "container") {
    const networkFlag = config.networkAccess ? "" : " --network=none";
    const escaped = command.replace(/'/g, "'\\''");
    return (
      `docker run --rm` +
      ` --memory=${config.memoryLimitMb}m` +
      ` --cpus=2` +
      networkFlag +
      ` -v ${shellEscape(config.workDir)}:/work` +
      ` -w /work` +
      ` kxkm-worker:latest` +
      ` bash -c '${escaped}'`
    );
  }

  // Exhaustive fallback — should never be reached with valid SandboxMode
  return command;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_MODES = new Set<string>(["none", "subprocess", "container"]);

/**
 * Validate an unknown input as a SandboxConfig, applying defaults for
 * missing fields.  Throws on invalid input.
 */
export function validateSandboxConfig(input: unknown): SandboxConfig {
  if (!input || typeof input !== "object") {
    throw new Error("SandboxConfig must be a non-null object");
  }

  const raw = input as Record<string, unknown>;

  const mode: SandboxMode =
    typeof raw.mode === "string" && VALID_MODES.has(raw.mode)
      ? (raw.mode as SandboxMode)
      : DEFAULT_SANDBOX.mode;

  const timeoutMs =
    typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0
      ? raw.timeoutMs
      : DEFAULT_SANDBOX.timeoutMs;

  const memoryLimitMb =
    typeof raw.memoryLimitMb === "number" && Number.isFinite(raw.memoryLimitMb) && raw.memoryLimitMb > 0
      ? raw.memoryLimitMb
      : DEFAULT_SANDBOX.memoryLimitMb;

  const networkAccess =
    typeof raw.networkAccess === "boolean"
      ? raw.networkAccess
      : DEFAULT_SANDBOX.networkAccess;

  const workDir =
    typeof raw.workDir === "string" && raw.workDir.length > 0
      ? raw.workDir
      : DEFAULT_SANDBOX.workDir;

  return { mode, timeoutMs, memoryLimitMb, networkAccess, workDir };
}
