#!/usr/bin/env node
// Log rotation script — scans and removes old files from data directories
// Usage: node ops/v2/log-rotate.js [--dry-run] [--max-age-days 30] [--json] [--help]

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const NO_COLOR = !!process.env.NO_COLOR;
const c = {
  green:   (s) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  red:     (s) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  yellow:  (s) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
  cyan:    (s) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`,
  bold:    (s) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  dim:     (s) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
${c.bold("KXKM Log Rotation")}

Usage: node ops/v2/log-rotate.js [options]

Options:
  --dry-run          Show what would be deleted without deleting
  --max-age-days N   Maximum age in days (default 30)
  --json             Output results as JSON
  --help             Show this help message

Scans:
  data/logs/         Log files
  data/sessions/     Session files
  data/node-engine/runs/  Old run artifacts
`);
  process.exit(0);
}

const FLAG_DRY_RUN = args.includes("--dry-run");
const FLAG_JSON = args.includes("--json");
const MAX_AGE_DAYS = (() => {
  const idx = args.indexOf("--max-age-days");
  if (idx >= 0 && args[idx + 1]) {
    const n = Number(args[idx + 1]);
    return Number.isFinite(n) && n > 0 ? n : 30;
  }
  return 30;
})();

const ROOT_DIR = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT_DIR, "data");

const SCAN_DIRS = [
  { label: "data/logs", path: path.join(DATA_DIR, "logs") },
  { label: "data/sessions", path: path.join(DATA_DIR, "sessions") },
  { label: "data/node-engine/runs", path: path.join(DATA_DIR, "node-engine", "runs") },
];

// ---------------------------------------------------------------------------
// Scan and collect old files
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function collectOldFiles(dir, maxAgeMs) {
  const now = Date.now();
  const results = [];

  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(full);
        const age = now - stat.mtimeMs;
        if (age > maxAgeMs) {
          results.push({
            path: full,
            relative: path.relative(ROOT_DIR, full),
            size: stat.size,
            mtime: new Date(stat.mtimeMs).toISOString(),
            ageDays: Math.floor(age / (24 * 60 * 60 * 1000)),
          });
        }
      } catch {
        // skip
      }
    }
  }

  walk(dir);
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const report = {
    dryRun: FLAG_DRY_RUN,
    maxAgeDays: MAX_AGE_DAYS,
    timestamp: new Date().toISOString(),
    directories: [],
    totals: { files: 0, bytes: 0 },
  };

  if (!FLAG_JSON) {
    console.log(c.bold("=== KXKM Log Rotation ==="));
    console.log("");
    console.log(`  Max age: ${c.cyan(String(MAX_AGE_DAYS))} days`);
    console.log(`  Mode:    ${FLAG_DRY_RUN ? c.yellow("DRY RUN") : c.red("LIVE DELETE")}`);
    console.log("");
  }

  for (const scanDir of SCAN_DIRS) {
    const oldFiles = collectOldFiles(scanDir.path, maxAgeMs);
    const dirBytes = oldFiles.reduce((sum, f) => sum + f.size, 0);

    const dirReport = {
      label: scanDir.label,
      filesFound: oldFiles.length,
      bytes: dirBytes,
      files: oldFiles.map((f) => ({
        relative: f.relative,
        size: f.size,
        ageDays: f.ageDays,
      })),
    };
    report.directories.push(dirReport);
    report.totals.files += oldFiles.length;
    report.totals.bytes += dirBytes;

    if (!FLAG_JSON) {
      console.log(c.bold(`  ${scanDir.label}/`));
      if (oldFiles.length === 0) {
        console.log(c.dim("    No files older than threshold."));
      } else {
        for (const f of oldFiles) {
          const sizeStr = formatBytes(f.size).padStart(8);
          const ageStr = `${f.ageDays}d`.padStart(5);
          console.log(`    ${c.dim(ageStr)}  ${sizeStr}  ${f.relative}`);
        }
        console.log(`    ${c.cyan(`${oldFiles.length} files, ${formatBytes(dirBytes)}`)}`);
      }
      console.log("");
    }

    // Actually delete if not dry-run
    if (!FLAG_DRY_RUN) {
      for (const f of oldFiles) {
        try {
          fs.unlinkSync(f.path);
        } catch (err) {
          if (!FLAG_JSON) {
            console.log(c.red(`    Failed to delete: ${f.relative} — ${err.message}`));
          }
        }
      }

      // Remove empty directories after deleting files
      cleanEmptyDirs(scanDir.path);
    }
  }

  if (FLAG_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const action = FLAG_DRY_RUN ? "Would delete" : "Deleted";
    console.log(c.bold("  Summary:"));
    console.log(`    ${action}: ${report.totals.files} files (${formatBytes(report.totals.bytes)})`);
    if (FLAG_DRY_RUN) {
      console.log(c.yellow("    Run without --dry-run to actually delete."));
    }
  }
}

function cleanEmptyDirs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const full = path.join(dir, entry.name);
      cleanEmptyDirs(full);
      try {
        // rmdir only removes empty dirs
        fs.rmdirSync(full);
      } catch {
        // not empty — fine
      }
    }
  }
}

try {
  main();
} catch (err) {
  console.error(`[log-rotate] ${err.message}`);
  process.exit(1);
}
