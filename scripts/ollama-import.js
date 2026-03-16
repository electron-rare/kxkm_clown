#!/usr/bin/env node
// -------------------------------------------------------------------------
// ollama-import.js — Node.js CLI wrapper for ollama-import-adapter.sh
//
// Usage:
//   node scripts/ollama-import.js --base llama3.2:1b --adapter /tmp/kxkm-test-training --name kxkm-test
// -------------------------------------------------------------------------
"use strict";

const { execFile } = require("node:child_process");
const path = require("node:path");

function parseArgs(argv) {
  const args = { base: "", adapter: "", name: "" };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--base":    args.base    = argv[++i] || ""; break;
      case "--adapter": args.adapter = argv[++i] || ""; break;
      case "--name":    args.name    = argv[++i] || ""; break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.base || !args.adapter || !args.name) {
  console.error("Usage: node ollama-import.js --base <model> --adapter <path> --name <name>");
  process.exit(1);
}

const scriptPath = path.join(__dirname, "ollama-import-adapter.sh");
const shellArgs = [
  scriptPath,
  "--base-model", args.base,
  "--adapter-path", args.adapter,
  "--name", args.name,
];

console.log(`[ollama-import] Importing adapter into Ollama...`);
console.log(`  base:    ${args.base}`);
console.log(`  adapter: ${args.adapter}`);
console.log(`  name:    ${args.name}`);

execFile("/bin/bash", shellArgs, { timeout: 300000 }, (err, stdout, stderr) => {
  if (stderr) console.error(stderr.trimEnd());

  if (err) {
    console.error(`[ollama-import] Failed: ${err.message}`);
    process.exit(1);
  }

  const lastLine = stdout.trim().split("\n").pop() || "{}";
  try {
    const result = JSON.parse(lastLine);
    console.log(`[ollama-import] Result:`, result);
    process.exit(result.status === "ok" ? 0 : 1);
  } catch {
    console.error(`[ollama-import] Could not parse output: ${lastLine}`);
    process.exit(1);
  }
});
