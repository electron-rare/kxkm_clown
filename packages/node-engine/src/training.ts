import { z } from "zod";

// ---------------------------------------------------------------------------
// Training adapter configuration — pure module (no I/O, no child_process)
// ---------------------------------------------------------------------------

export type TrainingJobType = "lora_training" | "qlora_training" | "sft_training";

export interface TrainingHyperparams {
  learningRate: number;
  epochs: number;
  batchSize: number;
  loraRank: number;
  loraAlpha: number;
  warmupSteps: number;
  maxSeqLength: number;
}

export const DEFAULT_HYPERPARAMS: TrainingHyperparams = {
  learningRate: 2e-4,
  epochs: 3,
  batchSize: 4,
  loraRank: 16,
  loraAlpha: 32,
  warmupSteps: 10,
  maxSeqLength: 2048,
};

// ---------------------------------------------------------------------------
// Zod bounds validation for hyperparameters (lot-60)
// ---------------------------------------------------------------------------

/** Coerce non-number values to undefined so they fall through to defaults. */
const numOrUndef = z.preprocess(
  (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined),
  z.number().optional(),
);

export const hyperparamsSchema = z.object({
  learningRate: numOrUndef.pipe(z.number().min(1e-7).max(1).optional()),
  epochs: numOrUndef.pipe(z.number().int().min(1).max(100).optional()),
  batchSize: numOrUndef.pipe(z.number().int().min(1).max(256).optional()),
  warmupSteps: numOrUndef.pipe(z.number().int().min(0).max(10000).optional()),
  maxSeqLength: numOrUndef.pipe(z.number().int().min(32).max(8192).optional()),
  loraRank: numOrUndef.pipe(z.number().int().min(1).max(256).optional()),
  loraAlpha: numOrUndef.pipe(z.number().int().min(1).max(512).optional()),
}).passthrough();

export interface TrainingJobSpec {
  type: TrainingJobType;
  baseModel: string;
  datasetPath: string;
  outputDir: string;
  hyperparams: TrainingHyperparams;
}

export interface TrainingResult {
  status: "completed" | "failed" | "cancelled";
  modelName?: string;
  adapterPath?: string;
  metrics?: { trainLoss: number; evalLoss?: number; duration: number };
  error?: string;
}

// ---------------------------------------------------------------------------
// Shell-safe escaping
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe inclusion in a single-quoted shell argument.
 * Replaces every `'` with `'\''` (end quote, escaped quote, re-open quote).
 */
function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Command builders
// ---------------------------------------------------------------------------

/**
 * Generate the CLI command for TRL SFT training.
 *
 * Returns a string like:
 *   python -m trl sft --model_name 'base' --dataset_path 'path' ...
 */
export function buildTrlCommand(spec: TrainingJobSpec): string {
  const h = spec.hyperparams;
  const parts = [
    "python -m trl sft",
    `--model_name ${shellEscape(spec.baseModel)}`,
    `--dataset_path ${shellEscape(spec.datasetPath)}`,
    `--output_dir ${shellEscape(spec.outputDir)}`,
    `--learning_rate ${h.learningRate}`,
    `--num_train_epochs ${h.epochs}`,
    `--per_device_train_batch_size ${h.batchSize}`,
    `--warmup_steps ${h.warmupSteps}`,
    `--max_seq_length ${h.maxSeqLength}`,
  ];

  if (spec.type === "lora_training" || spec.type === "qlora_training") {
    parts.push(`--lora_r ${h.loraRank}`);
    parts.push(`--lora_alpha ${h.loraAlpha}`);
  }

  if (spec.type === "qlora_training") {
    parts.push("--load_in_4bit");
  }

  return parts.join(" ");
}

/**
 * Generate the CLI command for Unsloth training.
 *
 * Returns a string like:
 *   python scripts/train_unsloth.py --model 'base' --data 'path' ...
 */
export function buildUnslothCommand(spec: TrainingJobSpec): string {
  const h = spec.hyperparams;
  const parts = [
    "python scripts/train_unsloth.py",
    `--model ${shellEscape(spec.baseModel)}`,
    `--data ${shellEscape(spec.datasetPath)}`,
    `--output ${shellEscape(spec.outputDir)}`,
    `--lr ${h.learningRate}`,
    `--epochs ${h.epochs}`,
    `--batch-size ${h.batchSize}`,
    `--warmup-steps ${h.warmupSteps}`,
    `--max-seq-length ${h.maxSeqLength}`,
    `--lora-rank ${h.loraRank}`,
    `--lora-alpha ${h.loraAlpha}`,
  ];

  if (spec.type === "qlora_training") {
    parts.push("--quantize 4bit");
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_JOB_TYPES = new Set<string>(["lora_training", "qlora_training", "sft_training"]);

/**
 * Validate an unknown input as a TrainingJobSpec, applying defaults for
 * missing hyperparams.  Throws on invalid input.
 */
export function validateJobSpec(spec: unknown): TrainingJobSpec {
  if (!spec || typeof spec !== "object") {
    throw new Error("TrainingJobSpec must be a non-null object");
  }

  const raw = spec as Record<string, unknown>;

  // type
  if (typeof raw.type !== "string" || !VALID_JOB_TYPES.has(raw.type)) {
    throw new Error(
      `TrainingJobSpec.type must be one of: ${[...VALID_JOB_TYPES].join(", ")}`,
    );
  }
  const type = raw.type as TrainingJobType;

  // baseModel
  if (typeof raw.baseModel !== "string" || raw.baseModel.length === 0) {
    throw new Error("TrainingJobSpec.baseModel must be a non-empty string");
  }

  // datasetPath
  if (typeof raw.datasetPath !== "string" || raw.datasetPath.length === 0) {
    throw new Error("TrainingJobSpec.datasetPath must be a non-empty string");
  }

  // outputDir
  if (typeof raw.outputDir !== "string" || raw.outputDir.length === 0) {
    throw new Error("TrainingJobSpec.outputDir must be a non-empty string");
  }

  // hyperparams — validate bounds with Zod, then merge with defaults
  const rawHp =
    raw.hyperparams && typeof raw.hyperparams === "object"
      ? (raw.hyperparams as Record<string, unknown>)
      : {};

  const parsed = hyperparamsSchema.safeParse(rawHp);
  if (!parsed.success) {
    throw new Error(
      `Invalid hyperparams: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    );
  }
  const hp = parsed.data;

  const hyperparams: TrainingHyperparams = {
    learningRate: validNumber(hp.learningRate, DEFAULT_HYPERPARAMS.learningRate),
    epochs: validNumber(hp.epochs, DEFAULT_HYPERPARAMS.epochs),
    batchSize: validNumber(hp.batchSize, DEFAULT_HYPERPARAMS.batchSize),
    loraRank: validNumber((hp as Record<string, unknown>).loraRank, DEFAULT_HYPERPARAMS.loraRank),
    loraAlpha: validNumber((hp as Record<string, unknown>).loraAlpha, DEFAULT_HYPERPARAMS.loraAlpha),
    warmupSteps: validNumber(hp.warmupSteps, DEFAULT_HYPERPARAMS.warmupSteps),
    maxSeqLength: validNumber(hp.maxSeqLength, DEFAULT_HYPERPARAMS.maxSeqLength),
  };

  return {
    type,
    baseModel: raw.baseModel as string,
    datasetPath: raw.datasetPath as string,
    outputDir: raw.outputDir as string,
    hyperparams,
  };
}

function validNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

// ---------------------------------------------------------------------------
// Metrics parsing
// ---------------------------------------------------------------------------

/**
 * Parse TRL / Unsloth stdout to extract loss values.
 *
 * Looks for patterns like:
 *   {'train_loss': 0.1234, ...}
 *   {'loss': 0.1234, 'eval_loss': 0.5678, ...}
 *   train_loss: 0.1234
 */
export function parseTrainingMetrics(
  stdout: string,
): { trainLoss: number; evalLoss?: number } | null {
  // Try JSON-ish dict format first (TRL output)
  const dictMatch = stdout.match(
    /['"](?:train_)?loss['"]\s*:\s*([\d.]+(?:e[+-]?\d+)?)/,
  );

  if (dictMatch) {
    const trainLoss = parseFloat(dictMatch[1]);
    if (!Number.isFinite(trainLoss)) return null;

    const evalMatch = stdout.match(
      /['"]eval_loss['"]\s*:\s*([\d.]+(?:e[+-]?\d+)?)/,
    );
    const evalLoss = evalMatch ? parseFloat(evalMatch[1]) : undefined;

    return {
      trainLoss,
      evalLoss: evalLoss !== undefined && Number.isFinite(evalLoss)
        ? evalLoss
        : undefined,
    };
  }

  // Try plain key: value format
  const plainMatch = stdout.match(
    /train_loss\s*[:=]\s*([\d.]+(?:e[+-]?\d+)?)/,
  );
  if (plainMatch) {
    const trainLoss = parseFloat(plainMatch[1]);
    if (!Number.isFinite(trainLoss)) return null;

    const evalPlain = stdout.match(
      /eval_loss\s*[:=]\s*([\d.]+(?:e[+-]?\d+)?)/,
    );
    const evalLoss = evalPlain ? parseFloat(evalPlain[1]) : undefined;

    return {
      trainLoss,
      evalLoss: evalLoss !== undefined && Number.isFinite(evalLoss)
        ? evalLoss
        : undefined,
    };
  }

  return null;
}
