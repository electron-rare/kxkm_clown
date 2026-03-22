#!/usr/bin/env node
/**
 * DPO Pipeline — automated preference pair extraction + training data export
 *
 * Usage:
 *   node scripts/dpo-pipeline.js                 # Extract pairs for all personas
 *   node scripts/dpo-pipeline.js --persona kafka  # Single persona
 *   node scripts/dpo-pipeline.js --train          # Extract + trigger training
 *   node scripts/dpo-pipeline.js --dry-run        # Preview without writing
 */

const fs = require("node:fs");
const path = require("node:path");

const FEEDBACK_DIR = path.join(process.cwd(), "data", "feedback");
const OUTPUT_DIR = path.join(process.cwd(), "data", "dpo-training");
const MIN_PAIRS = 5;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const doTrain = args.includes("--train");
const targetPersona = args.find(a => a.startsWith("--persona="))?.split("=")[1]
  || (args.includes("--persona") ? args[args.indexOf("--persona") + 1] : null);

function log(msg) { console.log(`[dpo-pipeline] ${msg}`); }

function readFeedbackFile(filepath) {
  const lines = fs.readFileSync(filepath, "utf-8").trim().split("\n").filter(Boolean);
  return lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function extractPairs(entries) {
  const pairs = [];
  const byMessage = new Map();

  for (const entry of entries) {
    const key = entry.messageId || entry.response?.slice(0, 100);
    if (!key) continue;
    if (!byMessage.has(key)) byMessage.set(key, []);
    byMessage.get(key).push(entry);
  }

  for (const [, group] of byMessage) {
    const upvotes = group.filter(e => e.vote === "up" || e.vote === "pin");
    const downvotes = group.filter(e => e.vote === "down");

    if (upvotes.length > 0 && downvotes.length > 0) {
      // Clear preference signal: same prompt, different reactions
      pairs.push({
        prompt: upvotes[0].prompt || upvotes[0].text || "(unknown prompt)",
        chosen: upvotes[0].response,
        rejected: downvotes[0].response,
        persona: upvotes[0].personaNick,
        timestamp: upvotes[0].timestamp || new Date().toISOString(),
      });
    } else if (upvotes.length > 0) {
      // Positive-only: use as SFT data
      for (const entry of upvotes) {
        if (entry.response) {
          pairs.push({
            prompt: entry.prompt || entry.text || "(unknown prompt)",
            chosen: entry.response,
            rejected: null,
            persona: entry.personaNick,
            timestamp: entry.timestamp || new Date().toISOString(),
          });
        }
      }
    }
  }

  return pairs;
}

function exportTrainingJsonl(persona, pairs) {
  const outputPath = path.join(OUTPUT_DIR, `${persona}.jsonl`);
  const lines = pairs.map(p => JSON.stringify({
    instruction: p.prompt,
    chosen: p.chosen,
    rejected: p.rejected,
    persona: p.persona,
  }));

  if (!dryRun) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(outputPath, lines.join("\n") + "\n");
  }

  return outputPath;
}

// Main
log("Starting DPO pipeline...");

if (!fs.existsSync(FEEDBACK_DIR)) {
  log("No feedback directory found. Run some chat sessions with voting first.");
  process.exit(0);
}

const files = fs.readdirSync(FEEDBACK_DIR).filter(f => f.endsWith(".jsonl"));
if (files.length === 0) {
  log("No feedback files found.");
  process.exit(0);
}

let totalPairs = 0;
const summary = [];

for (const file of files) {
  const persona = file.replace(".jsonl", "");
  if (targetPersona && persona !== targetPersona) continue;

  const filepath = path.join(FEEDBACK_DIR, file);
  const entries = readFeedbackFile(filepath);
  const pairs = extractPairs(entries);

  log(`  ${persona}: ${entries.length} feedback entries → ${pairs.length} training pairs`);
  totalPairs += pairs.length;

  if (pairs.length >= MIN_PAIRS) {
    const outputPath = exportTrainingJsonl(persona, pairs);
    summary.push({ persona, entries: entries.length, pairs: pairs.length, output: outputPath });
    if (!dryRun) {
      log(`  → exported to ${outputPath}`);
    }
  } else {
    log(`  → skipped (need ${MIN_PAIRS}+ pairs, got ${pairs.length})`);
  }
}

log(`\nTotal: ${totalPairs} training pairs from ${files.length} personas`);

if (dryRun) {
  log("(dry-run — no files written)");
} else if (summary.length > 0) {
  log(`Exported ${summary.length} persona training files to ${OUTPUT_DIR}/`);

  if (doTrain) {
    log("\nTriggering training via Node Engine...");
    // POST to the training API to queue a fine-tuning run
    fetch("http://localhost:4180/api/v2/admin/node-engine/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        graphId: "dpo-finetune",
        params: {
          trainingDir: OUTPUT_DIR,
          personas: summary.map(s => s.persona),
          method: "dpo",
          baseModel: "qwen3.5:9b",
        },
      }),
    }).then(r => {
      if (r.ok) log("Training run queued.");
      else log(`Training API error: ${r.status}`);
    }).catch(err => log(`Training API unreachable: ${err.message}`));
  }
}

log("Done.");
