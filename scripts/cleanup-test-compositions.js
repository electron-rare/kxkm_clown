#!/usr/bin/env node
/**
 * cleanup-test-compositions.js
 *
 * Scans data/compositions/ and deletes directories whose composition.json
 * has a nick matching known test patterns from test suites.
 *
 * Usage:
 *   node scripts/cleanup-test-compositions.js            # dry-run (default)
 *   node scripts/cleanup-test-compositions.js --dry-run  # explicit dry-run
 *   node scripts/cleanup-test-compositions.js --execute  # actually delete
 */

import { readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMP_DIR = path.join(ROOT, "apps", "api", "data", "compositions");

const isDryRun = !process.argv.includes("--execute");

// ---- Test nick patterns ----

// Composer* nicks from ws-commands.test.ts (with optional _<RUN_ID> suffix)
const COMPOSER_PATTERN =
  /^Composer(Delete|Rename|Tracks|Marker|Bpm|Layer|Snapshot|Template|Mix|Dup|Concat|Suggest|Metronome|Gain|Preview|Randomize|Solo|Mute)(_[\w-]+)?$/i;

// Single-word human-name nicks from composition-store.test.ts
const TEST_NAMES = new Set([
  "alice", "bob", "carol", "dave", "eve", "frank", "grace", "hank",
  "ivy", "jules", "kate", "lena", "mike", "nina", "otto", "pam", "quinn",
]);

// Generic "test" in nick or name
const GENERIC_TEST_PATTERN = /\btest\b|clamp/i;

function isTestComposition(comp) {
  const nick = (comp.nick || "").trim();
  const name = (comp.name || "").trim();

  if (COMPOSER_PATTERN.test(nick)) return true;
  if (TEST_NAMES.has(nick.toLowerCase())) return true;
  if (GENERIC_TEST_PATTERN.test(nick)) return true;
  if (GENERIC_TEST_PATTERN.test(name)) return true;

  return false;
}

function main() {
  if (!existsSync(COMP_DIR)) {
    console.error(`Compositions directory not found: ${COMP_DIR}`);
    process.exit(1);
  }

  const entries = readdirSync(COMP_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (dirs.length === 0) {
    console.log("No composition directories found. Nothing to do.");
    process.exit(0);
  }

  const toDelete = [];
  const toKeep = [];
  const errors = [];

  for (const dir of dirs) {
    const compFile = path.join(COMP_DIR, dir, "composition.json");
    if (!existsSync(compFile)) {
      // No composition.json — treat as orphan, mark for deletion
      toDelete.push({ dir, reason: "no composition.json (orphan)" });
      continue;
    }

    let comp;
    try {
      comp = JSON.parse(readFileSync(compFile, "utf8"));
    } catch (err) {
      errors.push({ dir, err: err.message });
      continue;
    }

    if (isTestComposition(comp)) {
      const reason = `nick="${comp.nick}" name="${comp.name}"`;
      toDelete.push({ dir, reason });
    } else {
      toKeep.push({ dir, nick: comp.nick, name: comp.name });
    }
  }

  console.log(`\nCompositions scanned: ${dirs.length}`);
  console.log(`  -> to delete : ${toDelete.length}`);
  console.log(`  -> to keep   : ${toKeep.length}`);
  if (errors.length) {
    console.log(`  -> parse errors: ${errors.length}`);
    for (const { dir, err } of errors) {
      console.log(`     [error] ${dir}: ${err}`);
    }
  }

  if (toDelete.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  console.log(`\n${isDryRun ? "[DRY-RUN] Would delete:" : "Deleting:"}`);
  for (const { dir, reason } of toDelete) {
    console.log(`  ${dir}  (${reason})`);
    if (!isDryRun) {
      rmSync(path.join(COMP_DIR, dir), { recursive: true, force: true });
    }
  }

  if (isDryRun) {
    console.log(
      `\n[DRY-RUN] Pass --execute to actually delete ${toDelete.length} director${toDelete.length === 1 ? "y" : "ies"}.`
    );
  } else {
    console.log(`\nDeleted ${toDelete.length} test composition(s). Kept ${toKeep.length}.`);
  }
}

main();
