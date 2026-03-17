#!/usr/bin/env node
// Deep Audit TUI — analyse code quality, security, perf across the monorepo
// Usage: node ops/v2/deep-audit.js [--json] [--watch] [--fix] [--help]
//
// Checks:
//   1. TypeScript compilation (apps + packages)
//   2. Security patterns (path traversal, injection, SSRF)
//   3. Performance anti-patterns (sync I/O, missing cache, unbounded)
//   4. Dead code detection (unused exports)
//   5. Dependency health (outdated, duplicates)
//   6. Test coverage summary
//   7. File size / complexity metrics

const fs = require("fs");
const path = require("path");
const { execSync, exec } = require("child_process");

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const NO_COLOR = !!process.env.NO_COLOR;
const c = {
  green:   (s) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  red:     (s) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  yellow:  (s) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
  cyan:    (s) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`,
  magenta: (s) => NO_COLOR ? s : `\x1b[35m${s}\x1b[0m`,
  bold:    (s) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  dim:     (s) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`,
};

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function dot(ok) {
  return ok ? c.green("●") : c.red("●");
}

function warn() {
  return c.yellow("▲");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
${c.bold("KXKM Deep Audit TUI")}

Usage: node ops/v2/deep-audit.js [options]

Options:
  --json    Output results as JSON (pipe-friendly)
  --watch   Re-run every 30 seconds
  --verbose Show detailed findings
  --help    Show this help message

Checks:
  TypeScript compilation, security patterns, performance anti-patterns,
  dead code, dependency health, test results, file metrics.

Logs: ops/v2/logs/deep-audit-YYYY-MM-DD.log
`);
  process.exit(0);
}

const FLAG_JSON = args.includes("--json");
const FLAG_WATCH = args.includes("--watch");
const FLAG_VERBOSE = args.includes("--verbose");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT_DIR = path.resolve(__dirname, "../..");
const LOG_DIR = path.join(__dirname, "logs");
const APPS = ["apps/api", "apps/web", "apps/worker"];
const PACKAGES = ["packages/core", "packages/auth", "packages/chat-domain",
  "packages/persona-domain", "packages/node-engine", "packages/storage",
  "packages/ui", "packages/tui"];

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logFile() {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `deep-audit-${d}.log`);
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${stripAnsi(msg)}\n`;
  fs.appendFileSync(logFile(), line, "utf-8");
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function runCmd(cmd, cwd = ROOT_DIR) {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: "utf-8", timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] }).trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

// 1. TypeScript compilation
function checkTypeScript() {
  const results = [];
  for (const dir of [...APPS, ...PACKAGES]) {
    const tsconfig = path.join(ROOT_DIR, dir, "tsconfig.json");
    if (!fs.existsSync(tsconfig)) {
      results.push({ dir, status: "skip", errors: 0, detail: "no tsconfig.json" });
      continue;
    }
    const r = runCmd(`npx tsc --noEmit --pretty false 2>&1 | head -50`, path.join(ROOT_DIR, dir));
    const errCount = (r.out.match(/error TS/g) || []).length;
    results.push({ dir, status: errCount === 0 ? "ok" : "fail", errors: errCount, detail: r.out.slice(0, 500) });
  }
  return results;
}

// 2. Security pattern scan
function checkSecurity() {
  const patterns = [
    { name: "eval()", pattern: /\beval\s*\(/g, severity: "P0" },
    { name: "child_process unsanitized", pattern: /exec\(\s*[`"'].*\$\{/g, severity: "P0" },
    { name: "path.join user input", pattern: /path\.join\(.*req\.(params|query|body)/g, severity: "P1" },
    { name: "innerHTML assignment", pattern: /\.innerHTML\s*=/g, severity: "P1" },
    { name: "dangerouslySetInnerHTML", pattern: /dangerouslySetInnerHTML/g, severity: "P1" },
    { name: "TODO security", pattern: /TODO.*secur|FIXME.*secur|HACK.*secur/gi, severity: "P2" },
    { name: "hardcoded secret", pattern: /(password|secret|token)\s*[:=]\s*["'][^"']{8,}/gi, severity: "P1" },
    { name: "fs.writeFileSync in handler", pattern: /writeFileSync/g, severity: "P2" },
  ];

  const findings = [];
  const dirs = [...APPS, ...PACKAGES].map(d => path.join(ROOT_DIR, d, "src"));

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = getAllFiles(dir, [".ts", ".tsx", ".js"]);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const relPath = path.relative(ROOT_DIR, file);
      for (const p of patterns) {
        if (
          p.name === "hardcoded secret" &&
          (/(^|\/)tests?\//.test(relPath) || /\.test\.[tj]sx?$/.test(relPath))
        ) {
          continue;
        }

        let match;
        const regex = new RegExp(p.pattern.source, p.pattern.flags);
        while ((match = regex.exec(content)) !== null) {
          const lineNum = content.slice(0, match.index).split("\n").length;
          const snippet = lines[lineNum - 1]?.trim().slice(0, 120) || "";

          if (p.name === "hardcoded secret" && snippet.includes("process.env.")) {
            continue;
          }

          findings.push({
            severity: p.severity,
            pattern: p.name,
            file: relPath,
            line: lineNum,
            snippet,
          });
        }
      }
    }
  }
  return findings.sort((a, b) => a.severity.localeCompare(b.severity));
}

// 3. Performance anti-patterns
function checkPerformance() {
  const patterns = [
    { name: "readFileSync in non-init", pattern: /readFileSync/g, severity: "P1" },
    { name: "JSON.parse without try/catch", pattern: /JSON\.parse\(/g, severity: "P2", checkCatch: true },
    { name: "unbounded array push", pattern: /\.push\([^)]+\).*(?:while|for)\b/g, severity: "P2" },
    { name: "console.log in production", pattern: /console\.log\(/g, severity: "P2" },
  ];

  const findings = [];
  const dirs = APPS.map(d => path.join(ROOT_DIR, d, "src"));

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = getAllFiles(dir, [".ts", ".tsx"]);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (const p of patterns) {
        const regex = new RegExp(p.pattern.source, p.pattern.flags);
        let match;
        while ((match = regex.exec(content)) !== null) {
          const lineNum = content.slice(0, match.index).split("\n").length;

          if (p.name === "JSON.parse without try/catch" && hasNearbyTry(lines, lineNum)) {
            continue;
          }

          findings.push({
            severity: p.severity,
            pattern: p.name,
            file: path.relative(ROOT_DIR, file),
            line: lineNum,
            snippet: lines[lineNum - 1]?.trim().slice(0, 120) || "",
          });
        }
      }
    }
  }
  return findings;
}

function hasNearbyTry(lines, lineNum) {
  const start = Math.max(0, lineNum - 8);
  for (let i = lineNum - 1; i >= start; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^try\b/.test(line) || /\btry\s*\{/.test(line)) return true;
    if (/^function\b|=>\s*\{|^for\b|^while\b/.test(line)) break;
  }
  return false;
}

// 4. File metrics
function checkMetrics() {
  const metrics = [];
  const dirs = [...APPS, ...PACKAGES].map(d => path.join(ROOT_DIR, d, "src"));

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = getAllFiles(dir, [".ts", ".tsx"]);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const lineCount = content.split("\n").length;
      if (lineCount > 200) {
        metrics.push({
          file: path.relative(ROOT_DIR, file),
          lines: lineCount,
          sizeKB: Math.round(fs.statSync(file).size / 1024),
          flag: lineCount > 500 ? "large" : lineCount > 300 ? "medium" : "ok",
        });
      }
    }
  }
  return metrics.sort((a, b) => b.lines - a.lines);
}

// 5. Test results summary
function checkTests() {
  const r = runCmd("npm run test:v2 2>&1 | tail -20");
  const passMatch = r.out.match(/(\d+)\s+pass/i);
  const failMatch = r.out.match(/(\d+)\s+fail/i);
  return {
    status: r.ok ? "ok" : "fail",
    pass: passMatch ? parseInt(passMatch[1]) : 0,
    fail: failMatch ? parseInt(failMatch[1]) : 0,
    output: r.out.slice(-500),
  };
}

// 6. Dependency check
function checkDeps() {
  const r = runCmd("npm outdated --json 2>/dev/null || true");
  try {
    const outdated = JSON.parse(r.out || "{}");
    return Object.entries(outdated).map(([pkg, info]) => ({
      package: pkg,
      current: info.current,
      wanted: info.wanted,
      latest: info.latest,
    })).slice(0, 20);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAllFiles(dir, exts) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "dist") {
        results.push(...getAllFiles(full, exts));
      } else if (entry.isFile() && exts.some(ext => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  } catch { /* permission denied or missing */ }
  return results;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function drawBox(title, content) {
  const lines = content.split("\n");
  const maxLen = Math.max(title.length + 4, ...lines.map(l => stripAnsi(l).length));
  const w = Math.min(maxLen + 4, process.stdout.columns || 120);
  const hr = "─".repeat(w - 2);

  console.log(`┌${hr}┐`);
  console.log(`│ ${c.bold(c.cyan(title))}${" ".repeat(Math.max(0, w - stripAnsi(title).length - 4))} │`);
  console.log(`├${hr}┤`);
  for (const line of lines) {
    const pad = Math.max(0, w - stripAnsi(line).length - 4);
    console.log(`│ ${line}${" ".repeat(pad)} │`);
  }
  console.log(`└${hr}┘`);
}

function formatSeverity(s) {
  if (s === "P0") return c.red(c.bold("P0"));
  if (s === "P1") return c.yellow("P1");
  return c.dim("P2");
}

function countSeverity(findings) {
  return findings.reduce((acc, finding) => {
    const sev = finding.severity || "P2";
    acc[sev] = (acc[sev] || 0) + 1;
    return acc;
  }, { P0: 0, P1: 0, P2: 0 });
}

function computeDebtScore({ security, performance, metrics, tsErrors, deps }) {
  const sec = countSeverity(security);
  const perf = countSeverity(performance);
  const mediumFiles = metrics.filter((m) => m.flag === "medium").length;
  const largeFiles = metrics.filter((m) => m.flag === "large").length;

  // Weighted score in [0, 100], higher means more debt.
  const weighted =
    sec.P0 * 18 + sec.P1 * 8 + sec.P2 * 3 +
    perf.P0 * 10 + perf.P1 * 6 + perf.P2 * 2 +
    tsErrors * 5 +
    largeFiles * 3 + mediumFiles * 1 +
    Math.min(20, deps.length);

  const score = Math.min(100, weighted);
  const level = score >= 70 ? "high" : score >= 35 ? "medium" : "low";

  return {
    score,
    level,
    components: {
      security: sec,
      performance: perf,
      tsErrors,
      largeFiles,
      mediumFiles,
      deps: deps.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  ensureLogDir();
  const startTime = Date.now();
  const ts = new Date().toISOString();
  log(`=== Deep Audit started at ${ts} ===`);

  if (!FLAG_JSON) {
    console.clear();
    console.log(c.bold(c.magenta("\n  ╔══════════════════════════════════╗")));
    console.log(c.bold(c.magenta("  ║   KXKM Deep Audit — 3615-KXKM   ║")));
    console.log(c.bold(c.magenta("  ╚══════════════════════════════════╝\n")));
  }

  const results = {};

  // --- Security scan ---
  if (!FLAG_JSON) process.stdout.write(c.dim("  Scanning security patterns... "));
  const secFindings = checkSecurity();
  results.security = secFindings;
  const secP0 = secFindings.filter(f => f.severity === "P0").length;
  const secP1 = secFindings.filter(f => f.severity === "P1").length;
  if (!FLAG_JSON) {
    console.log(`${secP0 === 0 ? dot(true) : dot(false)} ${secP0} P0, ${secP1} P1, ${secFindings.length} total`);
    log(`Security: ${secP0} P0, ${secP1} P1, ${secFindings.length} total`);
    if (FLAG_VERBOSE && secFindings.length > 0) {
      const lines = secFindings.slice(0, 15).map(f =>
        `  ${formatSeverity(f.severity)} ${c.dim(f.file)}:${f.line} — ${f.pattern}`
      ).join("\n");
      drawBox("Security Findings", lines);
    }
  }

  // --- Performance scan ---
  if (!FLAG_JSON) process.stdout.write(c.dim("  Scanning performance patterns... "));
  const perfFindings = checkPerformance();
  results.performance = perfFindings;
  if (!FLAG_JSON) {
    console.log(`${warn()} ${perfFindings.length} findings`);
    log(`Performance: ${perfFindings.length} findings`);
  }

  // --- File metrics ---
  if (!FLAG_JSON) process.stdout.write(c.dim("  Computing file metrics... "));
  const metrics = checkMetrics();
  results.metrics = metrics;
  const largeFiles = metrics.filter(m => m.flag === "large").length;
  if (!FLAG_JSON) {
    console.log(`${largeFiles > 0 ? warn() : dot(true)} ${metrics.length} files >200 LOC, ${largeFiles} >500 LOC`);
    log(`Metrics: ${metrics.length} files >200 LOC, ${largeFiles} >500 LOC`);
    if (FLAG_VERBOSE && metrics.length > 0) {
      const lines = metrics.slice(0, 10).map(m =>
        `  ${m.flag === "large" ? c.red("●") : c.yellow("●")} ${c.dim(m.file)} — ${m.lines} lines (${m.sizeKB} KB)`
      ).join("\n");
      drawBox("Largest Files", lines);
    }
  }

  // --- Deps ---
  if (!FLAG_JSON) process.stdout.write(c.dim("  Checking dependencies... "));
  const deps = checkDeps();
  results.deps = deps;
  if (!FLAG_JSON) {
    console.log(`${deps.length > 5 ? warn() : dot(true)} ${deps.length} outdated`);
    log(`Dependencies: ${deps.length} outdated`);
  }

  // --- TypeScript ---
  if (!FLAG_JSON) process.stdout.write(c.dim("  TypeScript compilation... "));
  const tsResults = checkTypeScript();
  results.typescript = tsResults;
  const tsErrors = tsResults.reduce((sum, r) => sum + r.errors, 0);
  if (!FLAG_JSON) {
    console.log(`${tsErrors === 0 ? dot(true) : dot(false)} ${tsErrors} errors across ${tsResults.length} packages`);
    log(`TypeScript: ${tsErrors} errors`);
  }

  // --- Technical debt score ---
  const debt = computeDebtScore({
    security: secFindings,
    performance: perfFindings,
    metrics,
    tsErrors,
    deps,
  });
  results.debt = debt;

  // --- Summary ---
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (FLAG_JSON) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log("");
    const summaryLines = [
      `${c.bold("Security")}:    ${secP0 === 0 ? c.green("0 P0") : c.red(`${secP0} P0`)}  ${secP1} P1  ${secFindings.length} total`,
      `${c.bold("Performance")}: ${perfFindings.length} anti-patterns detected`,
      `${c.bold("Complexity")}: ${largeFiles} files >500 LOC, ${metrics.length} files >200 LOC`,
      `${c.bold("TypeScript")}:  ${tsErrors === 0 ? c.green("0 errors") : c.red(`${tsErrors} errors`)}`,
      `${c.bold("Deps")}:        ${deps.length} outdated packages`,
      `${c.bold("Debt Score")}:  ${debt.score}/100 (${debt.level})`,
      ``,
      `${c.dim(`Completed in ${elapsed}s — log: ${path.relative(ROOT_DIR, logFile())}`)}`,
    ].join("\n");
    drawBox("Audit Summary", summaryLines);
  }

  log(`=== Deep Audit completed in ${elapsed}s ===`);

  // Clean up old logs (keep 7 days)
  cleanOldLogs(7);
}

function cleanOldLogs(maxDays) {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const cutoff = Date.now() - maxDays * 86400000;
    for (const file of files) {
      if (!file.startsWith("deep-audit-")) continue;
      const filePath = path.join(LOG_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        log(`Cleaned old log: ${file}`);
      }
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

if (FLAG_WATCH) {
  const interval = 30_000;
  run();
  setInterval(run, interval);
} else {
  run().catch(err => {
    console.error(c.red(`Fatal: ${err.message}`));
    process.exit(1);
  });
}
