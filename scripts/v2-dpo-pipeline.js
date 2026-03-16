#!/usr/bin/env node

/**
 * V2 DPO Training Pipeline
 *
 * Orchestrates the full DPO (Direct Preference Optimisation) training flow:
 *   1. Fetch DPO pairs from the V2 API → save as JSONL file
 *   2. Run train_unsloth.py directly via child_process
 *   3. Run eval_model.py if prompts file exists
 *   4. Run ollama-import-adapter.sh if training succeeded
 *
 * Usage:
 *   node scripts/v2-dpo-pipeline.js [options]
 *
 * Options:
 *   --persona-id <id>      Filter DPO pairs for a specific persona
 *   --model <name>         Base model name (default: unsloth/Llama-3.2-1B-Instruct)
 *   --output-dir <dir>     Training output directory (default: data/training)
 *   --api-url <url>        V2 API base URL (default: http://localhost:4180)
 *   --dry-run              Print plan without executing
 *   --token <token>        Admin token for API auth
 *   --python-bin <path>    Python binary (default: PYTHON_BIN env or "python3")
 *   --scripts-dir <dir>    Scripts directory (default: SCRIPTS_DIR env or "scripts")
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function readArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : "";
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ---------------------------------------------------------------------------
// HTTP fetch helper (no external deps)
// ---------------------------------------------------------------------------

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: headers || {} }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", reject);
  });
}

function httpPost(url, data, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const parsed = new URL(url);
    const payload = JSON.stringify(data);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...(headers || {}),
      },
    };
    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Step 1: Fetch DPO pairs from API and save as JSONL
// ---------------------------------------------------------------------------

async function fetchDPOPairs(apiUrl, personaId, token) {
  let url = `${apiUrl}/api/v2/export/dpo`;
  if (personaId) {
    url += `?persona_id=${encodeURIComponent(personaId)}`;
  }

  const headers = {};
  if (token) {
    headers["Cookie"] = `kxkm_v2_session=${token}`;
  }

  console.log("[dpo-pipeline] fetching DPO pairs from " + url);
  const res = await httpGet(url, headers);

  if (res.status !== 200) {
    throw new Error(
      `API returned status ${res.status}: ${res.body.slice(0, 200)}`
    );
  }

  const lines = res.body.trim().split("\n").filter(Boolean);
  const pairs = lines.map((line) => JSON.parse(line));
  console.log("[dpo-pipeline] received " + pairs.length + " DPO pairs");
  return { pairs, rawBody: res.body };
}

function saveDPODataset(outputDir, rawBody) {
  const ts = timestamp();
  const filename = `dpo-${ts}.jsonl`;
  const filePath = path.resolve(process.cwd(), outputDir, filename);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rawBody, "utf8");
  console.log("[dpo-pipeline] saved dataset to " + filePath);
  return filePath;
}

// ---------------------------------------------------------------------------
// Step 2: Run training directly via child_process
// ---------------------------------------------------------------------------

async function runTrainingDirect(config) {
  const { datasetPath, model, outputDir, pythonBin, scriptsDir } = config;

  console.log("[dpo-pipeline] Starting training: " + model);

  const trainArgs = [
    path.join(scriptsDir, "train_unsloth.py"),
    "--model", model,
    "--data", datasetPath,
    "--output", outputDir,
    "--method", "dpo",
    "--quantize", "4bit",
    "--epochs", "3",
  ];

  const { stdout, stderr } = await execFileAsync(pythonBin, trainArgs, {
    timeout: 3600000, // 1h
    maxBuffer: 50 * 1024 * 1024,
  });

  if (stderr) console.log("[dpo-pipeline] " + stderr.slice(-500));

  const jsonLine = stdout.trim().split("\n").pop() || "{}";
  return JSON.parse(jsonLine);
}

// ---------------------------------------------------------------------------
// Step 3: Run eval if prompts file exists
// ---------------------------------------------------------------------------

async function runEvalDirect(config) {
  const { outputDir, pythonBin, scriptsDir } = config;
  const promptsFile = path.join(outputDir, "eval_prompts.jsonl");

  if (!fs.existsSync(promptsFile)) {
    console.log("[dpo-pipeline] No eval prompts file found, skipping eval");
    return null;
  }

  console.log("[dpo-pipeline] Running eval_model.py");

  const evalArgs = [
    path.join(scriptsDir, "eval_model.py"),
    "--model-dir", outputDir,
    "--prompts", promptsFile,
  ];

  const { stdout, stderr } = await execFileAsync(pythonBin, evalArgs, {
    timeout: 1800000, // 30 min
    maxBuffer: 50 * 1024 * 1024,
  });

  if (stderr) console.log("[dpo-pipeline] eval stderr: " + stderr.slice(-500));

  const jsonLine = stdout.trim().split("\n").pop() || "{}";
  return JSON.parse(jsonLine);
}

// ---------------------------------------------------------------------------
// Step 4: Import adapter into Ollama
// ---------------------------------------------------------------------------

async function runOllamaImport(config) {
  const { outputDir, scriptsDir } = config;
  const importScript = path.join(scriptsDir, "ollama-import-adapter.sh");

  if (!fs.existsSync(importScript)) {
    console.log("[dpo-pipeline] ollama-import-adapter.sh not found, skipping");
    return null;
  }

  console.log("[dpo-pipeline] Running ollama-import-adapter.sh");

  const { stdout, stderr } = await execFileAsync("bash", [importScript, outputDir], {
    timeout: 600000, // 10 min
    maxBuffer: 10 * 1024 * 1024,
  });

  if (stderr) console.log("[dpo-pipeline] ollama stderr: " + stderr.slice(-500));
  if (stdout) console.log("[dpo-pipeline] ollama: " + stdout.trim().split("\n").pop());

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiUrl = readArg("--api-url") || "http://localhost:4180";
  const personaId = readArg("--persona-id") || "";
  const baseModel =
    readArg("--model") || "unsloth/Llama-3.2-1B-Instruct";
  const outputDir = readArg("--output-dir") || "data/training";
  const dryRun = hasFlag("--dry-run");
  const token = readArg("--token") || process.env.ADMIN_TOKEN || "";
  const pythonBin = readArg("--python-bin") || process.env.PYTHON_BIN || "python3";
  const scriptsDir = readArg("--scripts-dir") || process.env.SCRIPTS_DIR || "scripts";

  console.log("[dpo-pipeline] === DPO Training Pipeline ===");
  console.log("[dpo-pipeline] api:         " + apiUrl);
  console.log("[dpo-pipeline] model:       " + baseModel);
  console.log("[dpo-pipeline] output:      " + outputDir);
  console.log("[dpo-pipeline] python:      " + pythonBin);
  console.log("[dpo-pipeline] scripts-dir: " + scriptsDir);
  if (personaId) {
    console.log("[dpo-pipeline] persona:     " + personaId);
  }
  if (dryRun) {
    console.log("[dpo-pipeline] mode:        DRY RUN");
  }
  console.log("");

  // ---- Step 1: Fetch and save DPO dataset ----
  console.log("[dpo-pipeline] Step 1/4: Fetch DPO pairs from API");
  const { pairs, rawBody } = await fetchDPOPairs(apiUrl, personaId, token);

  if (pairs.length === 0) {
    console.log("[dpo-pipeline] No DPO pairs found — nothing to train on. Exiting.");
    return;
  }

  const datasetFile = saveDPODataset(outputDir, rawBody);
  const resolvedOutputDir = path.resolve(process.cwd(), outputDir);

  if (dryRun) {
    console.log("");
    console.log("[dpo-pipeline] DRY RUN — planned steps:");
    console.log("  Step 2: Run train_unsloth.py --model " + baseModel + " --data " + datasetFile);
    console.log("  Step 3: Run eval_model.py (if eval_prompts.jsonl exists)");
    console.log("  Step 4: Run ollama-import-adapter.sh");
    console.log("    output_dir:   " + resolvedOutputDir);
    console.log("    pair_count:   " + pairs.length);
    console.log("");
    console.log("[dpo-pipeline] dry run complete");
    return;
  }

  // ---- Step 2: Run training directly ----
  const started = Date.now();
  console.log("");
  console.log("[dpo-pipeline] Step 2/4: Run training");
  const trainConfig = {
    datasetPath: datasetFile,
    model: baseModel,
    outputDir: resolvedOutputDir,
    pythonBin,
    scriptsDir,
  };
  const trainResult = await runTrainingDirect(trainConfig);
  console.log("[dpo-pipeline] Training result: " + JSON.stringify(trainResult));

  // ---- Step 3: Run eval ----
  console.log("");
  console.log("[dpo-pipeline] Step 3/4: Eval");
  const evalResult = await runEvalDirect(trainConfig);
  if (evalResult) {
    console.log("[dpo-pipeline] Eval result: " + JSON.stringify(evalResult));
  }

  // ---- Step 4: Import adapter into Ollama ----
  console.log("");
  console.log("[dpo-pipeline] Step 4/4: Ollama import");
  await runOllamaImport(trainConfig);

  const elapsedMs = Date.now() - started;
  console.log("");
  console.log("[dpo-pipeline] === Results ===");
  console.log("  status:     completed");
  console.log("  elapsed:    " + (elapsedMs / 1000).toFixed(1) + "s");
  console.log("  dataset:    " + datasetFile);
  console.log("  pairs:      " + pairs.length);
  console.log("");
  console.log("[dpo-pipeline] Pipeline completed successfully.");
}

main().catch((err) => {
  console.error(
    "[dpo-pipeline] fatal",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
