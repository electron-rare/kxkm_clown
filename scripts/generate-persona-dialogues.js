#!/usr/bin/env node
/**
 * lot-204a: Generate synthetic persona dialogues for SFT/DPO training
 * Usage: node scripts/generate-persona-dialogues.js [--personas all|p1,p2] [--pairs 300] [--model qwen3:8b] [--out data/training/]
 *
 * ============================================================================
 * TRAINING PIPELINE OVERVIEW
 * ============================================================================
 *
 * Step 1 — Dialogue generation (this script)
 *   Reads persona JSON definitions from data/v2-local/personas/ and calls the
 *   local Ollama API to generate synthetic conversational pairs in French.
 *   Produces two JSONL datasets per persona:
 *     • data/training/sft/<persona>.jsonl  — SFT (Supervised Fine-Tuning)
 *       format: { instruction, input, output, persona }
 *     • data/training/dpo/<persona>.jsonl  — DPO (Direct Preference Optimisation)
 *       format: { prompt, chosen, rejected }
 *
 * Step 2 — SFT training
 *   python scripts/train_unsloth.py \
 *     --dataset data/training/sft/<persona>.jsonl \
 *     --model <base_model> --output data/training/checkpoints/
 *
 * Step 3 — DPO fine-tuning
 *   node scripts/v2-dpo-pipeline.js \
 *     --persona-id <id> --output-dir data/training/
 *
 * Step 4 — Import into Ollama
 *   bash scripts/ollama-import-adapter.sh <checkpoint_dir> <model_tag>
 *
 * Step 5 — Evaluate
 *   python scripts/eval_model.py --prompts data/training/test_prompts.jsonl
 *
 * ============================================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PERSONAS = ["Pharmacius", "Leary", "Gibson", "Herbert", "Batty"];
const DEFAULT_PAIRS = 300;
const DEFAULT_MODEL = "qwen3:8b";
const DEFAULT_OUT = "data/training/";
const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const MIN_RESPONSE_LEN = 50;
const TOPICS_PER_BATCH = 10;
const PAIRS_PER_TOPIC = 3;
const BATCH_SIZE = TOPICS_PER_BATCH * PAIRS_PER_TOPIC; // 30 pairs per batch

// ---------------------------------------------------------------------------
// CLI argument helpers
// ---------------------------------------------------------------------------

function readArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] || "" : null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function nowIso() {
  return new Date().toISOString();
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function log(msg) {
  process.stderr.write(`[${nowIso()}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// HTTP helpers (no external deps)
// ---------------------------------------------------------------------------

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") })
      );
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Ollama API calls
// ---------------------------------------------------------------------------

/**
 * Call Ollama /api/generate (non-streaming).
 * Returns the response string or throws on network/API error.
 */
async function ollamaGenerate(ollamaUrl, model, prompt, systemPrompt) {
  const url = `${ollamaUrl}/api/generate`;
  const body = {
    model,
    prompt,
    system: systemPrompt || "",
    stream: false,
    options: {
      temperature: 0.85,
      top_p: 0.9,
      num_predict: 512,
    },
  };

  const res = await httpPost(url, body);

  if (res.status !== 200) {
    throw new Error(`Ollama HTTP ${res.status}: ${res.body.slice(0, 200)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new Error(`Ollama response not valid JSON: ${res.body.slice(0, 200)}`);
  }

  if (!parsed.response) {
    throw new Error(`Ollama returned no 'response' field: ${JSON.stringify(parsed).slice(0, 200)}`);
  }

  return parsed.response.trim();
}

// ---------------------------------------------------------------------------
// Persona loading
// ---------------------------------------------------------------------------

/**
 * Load all persona JSON files from the personas directory.
 * Supports KXKM_LOCAL_DATA_DIR env override.
 */
function loadPersonas(projectRoot) {
  const baseDir =
    process.env.KXKM_LOCAL_DATA_DIR
      ? path.join(process.env.KXKM_LOCAL_DATA_DIR, "personas")
      : path.join(projectRoot, "data", "v2-local", "personas");

  if (!fs.existsSync(baseDir)) {
    throw new Error(`Personas directory not found: ${baseDir}`);
  }

  const files = fs.readdirSync(baseDir).filter((f) => f.endsWith(".json"));
  const personas = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(baseDir, file), "utf8");
      const p = JSON.parse(raw);
      if (p.id && p.name && p.systemPrompt) {
        personas.push(p);
      } else {
        log(`WARN: Skipping ${file} — missing id/name/systemPrompt`);
      }
    } catch (e) {
      log(`WARN: Could not parse ${file}: ${e.message}`);
    }
  }

  if (personas.length === 0) {
    throw new Error(`No valid persona files found in ${baseDir}`);
  }

  return personas;
}

/**
 * Filter personas by a comma-separated list of IDs/nicks (case-insensitive).
 * Passes "all" through unchanged.
 */
function filterPersonas(personas, selector) {
  if (!selector || selector === "all") return personas;

  const keys = selector.split(",").map((s) => s.trim().toLowerCase());
  const matched = personas.filter(
    (p) => keys.includes(p.id.toLowerCase()) || keys.includes(p.name.toLowerCase())
  );

  if (matched.length === 0) {
    throw new Error(`No personas matched selector: ${selector}`);
  }

  return matched;
}

// ---------------------------------------------------------------------------
// Generation helpers
// ---------------------------------------------------------------------------

/**
 * Generate TOPICS_PER_BATCH diverse topic prompts for a persona using Ollama.
 * Returns an array of topic strings.
 */
async function generateTopics(ollamaUrl, model, persona) {
  const metaPrompt = `Tu es un générateur de sujets de conversation pour un assistant IA.
La persona suivante a ce prompt système:
"${persona.systemPrompt}"

Génère exactement ${TOPICS_PER_BATCH} sujets de conversation variés et pertinents pour cette persona.
Chaque sujet doit être une question ou une amorce de discussion courte (1-2 phrases maximum), en français.
Format: une ligne par sujet, sans numérotation ni liste.`;

  const raw = await ollamaGenerate(ollamaUrl, model, metaPrompt, null);

  const topics = raw
    .split("\n")
    .map((l) => l.replace(/^[-•*\d.]+\s*/, "").trim())
    .filter((l) => l.length > 10);

  if (topics.length === 0) {
    throw new Error(`Topic generation returned no usable lines for ${persona.name}`);
  }

  // Return up to TOPICS_PER_BATCH, pad with fallback if needed
  while (topics.length < TOPICS_PER_BATCH) {
    topics.push(`Parle-moi de ta vision du monde selon ta perspective unique.`);
  }

  return topics.slice(0, TOPICS_PER_BATCH);
}

/**
 * Generate a single in-character response for the persona.
 */
async function generateChosenResponse(ollamaUrl, model, persona, userMessage) {
  return ollamaGenerate(ollamaUrl, model, userMessage, persona.systemPrompt);
}

/**
 * Generate a generic, out-of-character "rejected" response for DPO.
 * Uses a neutral assistant persona to produce a bland reply.
 */
async function generateRejectedResponse(ollamaUrl, model, userMessage) {
  const neutralSystem =
    "Tu es un assistant généraliste neutre. Réponds de façon générique et impersonnelle, sans style particulier, sans opinion tranchée. Reste factuel et conventionnel.";
  return ollamaGenerate(ollamaUrl, model, userMessage, neutralSystem);
}

// ---------------------------------------------------------------------------
// DRY RUN mode
// ---------------------------------------------------------------------------

/**
 * In dry-run mode, simulate 3 pairs per persona and print to stdout.
 * No Ollama calls are made.
 */
function dryRunPersona(persona) {
  log(`[DRY-RUN] Persona: ${persona.name} (${persona.id})`);
  log(`[DRY-RUN] systemPrompt: ${persona.systemPrompt.slice(0, 80)}...`);

  const fakePairs = [
    {
      topic: `Quelle est ta vision du monde selon ta perspective ?`,
      chosen: `[réponse simulée en caractère pour ${persona.name}]`,
      rejected: `[réponse générique simulée]`,
    },
    {
      topic: `Comment abordes-tu les questions complexes dans ton domaine ?`,
      chosen: `[réponse simulée 2 en caractère pour ${persona.name}]`,
      rejected: `[réponse générique simulée 2]`,
    },
    {
      topic: `Que penses-tu de l'état actuel de la société ?`,
      chosen: `[réponse simulée 3 en caractère pour ${persona.name}]`,
      rejected: `[réponse générique simulée 3]`,
    },
  ];

  for (let i = 0; i < fakePairs.length; i++) {
    const p = fakePairs[i];

    const sftRecord = {
      instruction: "Réponds en restant dans le personnage.",
      input: p.topic,
      output: p.chosen,
      persona: persona.id,
    };

    const dpoRecord = {
      prompt: p.topic,
      chosen: p.chosen,
      rejected: p.rejected,
    };

    console.log(`--- SFT pair ${i + 1} ---`);
    console.log(JSON.stringify(sftRecord, null, 2));
    console.log(`--- DPO pair ${i + 1} ---`);
    console.log(JSON.stringify(dpoRecord, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Main generation loop for a single persona
// ---------------------------------------------------------------------------

async function generateForPersona(persona, targetPairs, model, ollamaUrl, outDir, dryRun) {
  if (dryRun) {
    dryRunPersona(persona);
    return { sft: 3, dpo: 3 };
  }

  const sftPath = path.join(outDir, "sft", `${persona.id}.jsonl`);
  const dpoPath = path.join(outDir, "dpo", `${persona.id}.jsonl`);

  // Append mode — resume if file already exists
  const sftStream = fs.createWriteStream(sftPath, { flags: "a" });
  const dpoStream = fs.createWriteStream(dpoPath, { flags: "a" });

  let sftCount = 0;
  let dpoCount = 0;
  let attempts = 0;
  const maxAttempts = Math.ceil(targetPairs / BATCH_SIZE) * 3; // allow retries

  log(`Generating ${targetPairs} pairs for persona: ${persona.name}`);

  while (sftCount < targetPairs && attempts < maxAttempts) {
    attempts++;
    log(`  Batch ${attempts}: generating topics for ${persona.name}...`);

    let topics;
    try {
      topics = await generateTopics(ollamaUrl, model, persona);
    } catch (e) {
      log(`  WARN: Topic generation failed (attempt ${attempts}): ${e.message}`);
      continue;
    }

    for (const topic of topics) {
      if (sftCount >= targetPairs) break;

      for (let j = 0; j < PAIRS_PER_TOPIC; j++) {
        if (sftCount >= targetPairs) break;

        let chosen, rejected;

        try {
          chosen = await generateChosenResponse(ollamaUrl, model, persona, topic);
        } catch (e) {
          log(`  WARN: chosen generation failed for topic "${topic.slice(0, 40)}": ${e.message}`);
          continue;
        }

        // Validate chosen response length
        if (chosen.length < MIN_RESPONSE_LEN) {
          log(`  SKIP: chosen response too short (${chosen.length} chars) for "${topic.slice(0, 40)}"`);
          continue;
        }

        try {
          rejected = await generateRejectedResponse(ollamaUrl, model, topic);
        } catch (e) {
          log(`  WARN: rejected generation failed: ${e.message}`);
          // DPO pair skipped but SFT still valid
          rejected = null;
        }

        // Write SFT record
        const sftRecord = {
          instruction: "Réponds en restant dans le personnage.",
          input: topic,
          output: chosen,
          persona: persona.id,
        };
        sftStream.write(JSON.stringify(sftRecord) + "\n");
        sftCount++;

        // Write DPO record only if rejected is valid
        if (rejected && rejected.length >= MIN_RESPONSE_LEN) {
          const dpoRecord = {
            prompt: topic,
            chosen,
            rejected,
          };
          dpoStream.write(JSON.stringify(dpoRecord) + "\n");
          dpoCount++;
        }

        if (sftCount % 10 === 0) {
          log(`  Progress: ${sftCount}/${targetPairs} SFT pairs, ${dpoCount} DPO pairs`);
        }
      }
    }
  }

  sftStream.end();
  dpoStream.end();

  await new Promise((resolve) => sftStream.on("finish", resolve));
  await new Promise((resolve) => dpoStream.on("finish", resolve));

  log(`  Done: ${sftCount} SFT pairs → ${sftPath}`);
  log(`  Done: ${dpoCount} DPO pairs → ${dpoPath}`);

  return { sft: sftCount, dpo: dpoCount };
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const personasArg = readArg("--personas") || DEFAULT_PERSONAS.join(",");
  const targetPairs = parseInt(readArg("--pairs") || DEFAULT_PAIRS, 10);
  const model = readArg("--model") || DEFAULT_MODEL;
  const ollamaUrl = (readArg("--ollama-url") || DEFAULT_OLLAMA_URL).replace(/\/$/, "");
  const dryRun = hasFlag("--dry-run");

  // Resolve output dir relative to project root (script is in scripts/)
  const projectRoot = path.resolve(__dirname, "..");
  const outDirRaw = readArg("--out") || DEFAULT_OUT;
  const outDir = path.isAbsolute(outDirRaw)
    ? outDirRaw
    : path.join(projectRoot, outDirRaw);

  // Ensure output directories exist
  fs.mkdirSync(path.join(outDir, "sft"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "dpo"), { recursive: true });

  log(`=== generate-persona-dialogues (lot-204a) ===`);
  log(`model      : ${model}`);
  log(`ollama-url : ${ollamaUrl}`);
  log(`pairs/persona: ${targetPairs}`);
  log(`output dir : ${outDir}`);
  log(`dry-run    : ${dryRun}`);

  // Load personas
  let allPersonas;
  try {
    allPersonas = loadPersonas(projectRoot);
  } catch (e) {
    log(`ERROR: ${e.message}`);
    process.exit(1);
  }

  log(`Loaded ${allPersonas.length} personas from data/v2-local/personas/`);

  // Filter personas by selector
  let selected;
  try {
    selected = filterPersonas(allPersonas, personasArg);
  } catch (e) {
    log(`ERROR: ${e.message}`);
    log(`Available personas: ${allPersonas.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }

  log(`Selected ${selected.length} persona(s): ${selected.map((p) => p.name).join(", ")}`);

  // Summary table header
  const results = [];

  for (const persona of selected) {
    try {
      const counts = await generateForPersona(
        persona,
        targetPairs,
        model,
        ollamaUrl,
        outDir,
        dryRun
      );
      results.push({ persona: persona.name, ...counts });
    } catch (e) {
      log(`ERROR generating for ${persona.name}: ${e.message}`);
      results.push({ persona: persona.name, sft: 0, dpo: 0, error: e.message });
    }
  }

  // Final summary
  log(`\n=== Summary ===`);
  for (const r of results) {
    if (r.error) {
      log(`  ${r.persona}: ERROR — ${r.error}`);
    } else {
      log(`  ${r.persona}: ${r.sft} SFT pairs, ${r.dpo} DPO pairs`);
    }
  }

  if (!dryRun) {
    log(`\nSFT files: ${path.join(outDir, "sft")}/`);
    log(`DPO files: ${path.join(outDir, "dpo")}/`);
    log(`\nNext step: python scripts/train_unsloth.py --dataset <sft_file>`);
  }
}

main().catch((e) => {
  process.stderr.write(`FATAL: ${e.message}\n${e.stack}\n`);
  process.exit(1);
});
