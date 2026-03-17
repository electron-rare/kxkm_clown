#!/usr/bin/env node
/**
 * Extract training dataset from chat logs for a specific persona.
 * Reads JSONL chat logs and extracts user→persona conversation pairs.
 *
 * Usage:
 *   node scripts/extract-persona-dataset.js --persona Pharmacius --output data/training/pharmacius-dataset.jsonl
 *   node scripts/extract-persona-dataset.js --persona Schaeffer --min-pairs 50 --output data/training/schaeffer-dataset.jsonl
 *   node scripts/extract-persona-dataset.js --all --output-dir data/training/personas/
 */

const fs = require("fs");
const path = require("path");

function readArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : "";
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const CHAT_LOG_DIR = path.resolve(process.cwd(), "data", "chat-logs");

function loadChatLogs() {
  const entries = [];
  try {
    const files = fs.readdirSync(CHAT_LOG_DIR).filter(f => f.endsWith(".jsonl")).sort();
    for (const file of files) {
      const content = fs.readFileSync(path.join(CHAT_LOG_DIR, file), "utf-8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line));
        } catch {}
      }
    }
  } catch {}
  return entries;
}

function extractPairsForPersona(entries, personaNick) {
  const pairs = [];

  for (let i = 0; i < entries.length - 1; i++) {
    const current = entries[i];
    const next = entries[i + 1];

    // Look for user message followed by persona response
    if (
      current.type === "message" &&
      current.nick &&
      current.nick.startsWith("user_") &&
      current.text &&
      current.text.length > 5 &&
      next.type === "message" &&
      next.nick === personaNick &&
      next.text &&
      next.text.length > 10
    ) {
      pairs.push({
        messages: [
          { role: "user", content: current.text },
          { role: "assistant", content: next.text },
        ],
      });
      i++; // skip the next entry since we used it
    }
  }

  return pairs;
}

function extractAllPersonas(entries) {
  const personaNicks = new Set();
  for (const e of entries) {
    if (e.type === "message" && e.nick && !e.nick.startsWith("user_")) {
      personaNicks.add(e.nick);
    }
  }
  return personaNicks;
}

function main() {
  const persona = readArg("--persona");
  const outputPath = readArg("--output");
  const outputDir = readArg("--output-dir");
  const minPairs = Number(readArg("--min-pairs")) || 10;
  const all = hasFlag("--all");

  console.log("[extract] Loading chat logs from", CHAT_LOG_DIR);
  const entries = loadChatLogs();
  console.log(`[extract] Loaded ${entries.length} entries`);

  if (all) {
    const dir = outputDir || "data/training/personas";
    fs.mkdirSync(dir, { recursive: true });

    const personaNicks = extractAllPersonas(entries);
    console.log(`[extract] Found ${personaNicks.size} personas: ${[...personaNicks].join(", ")}`);

    let totalPairs = 0;
    for (const nick of personaNicks) {
      const pairs = extractPairsForPersona(entries, nick);
      if (pairs.length < minPairs) {
        console.log(`  [skip] ${nick}: ${pairs.length} pairs (min ${minPairs})`);
        continue;
      }

      const filePath = path.join(dir, `${nick.toLowerCase()}-dataset.jsonl`);
      const content = pairs.map(p => JSON.stringify(p)).join("\n") + "\n";
      fs.writeFileSync(filePath, content, "utf-8");
      console.log(`  [saved] ${nick}: ${pairs.length} pairs → ${filePath}`);
      totalPairs += pairs.length;
    }

    console.log(`\n[extract] Total: ${totalPairs} pairs for ${personaNicks.size} personas`);
  } else if (persona) {
    if (!outputPath) {
      console.error("Usage: --persona <nick> --output <path.jsonl>");
      process.exit(1);
    }

    const pairs = extractPairsForPersona(entries, persona);
    console.log(`[extract] ${persona}: ${pairs.length} pairs found`);

    if (pairs.length < minPairs) {
      console.warn(`[extract] WARNING: Only ${pairs.length} pairs (min recommended: ${minPairs})`);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const content = pairs.map(p => JSON.stringify(p)).join("\n") + "\n";
    fs.writeFileSync(outputPath, content, "utf-8");
    console.log(`[extract] Saved to ${outputPath}`);
  } else {
    // Just show stats
    const personaNicks = extractAllPersonas(entries);
    console.log(`\n[extract] Persona stats:`);
    for (const nick of [...personaNicks].sort()) {
      const pairs = extractPairsForPersona(entries, nick);
      const status = pairs.length >= minPairs ? "✓" : "✗";
      console.log(`  ${status} ${nick}: ${pairs.length} pairs`);
    }
  }
}

main();
