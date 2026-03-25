#!/usr/bin/env node
// Persona store audit TUI — inspects v2-local per-file store, legacy leftovers,
// and can archive safe v2 aggregate files after migration.
// Usage: node ops/v2/persona-store-audit.js [--json] [--archive] [--target-dir DIR] [--legacy-data-dir DIR]

const fs = require("fs");
const path = require("path");

const NO_COLOR = !!process.env.NO_COLOR;
const c = {
  green: (s) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  red: (s) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`,
  bold: (s) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  dim: (s) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`,
};

function stripAnsi(s) {
  return String(s || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function parseArgs(argv) {
  const args = {
    json: false,
    archive: false,
    noLog: false,
    targetDir: null,
    legacyDataDir: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--archive") {
      args.archive = true;
      continue;
    }
    if (token === "--no-log") {
      args.noLog = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token.startsWith("--target-dir=")) {
      args.targetDir = token.slice("--target-dir=".length);
      continue;
    }
    if (token === "--target-dir" && argv[i + 1]) {
      args.targetDir = argv[++i];
      continue;
    }
    if (token.startsWith("--legacy-data-dir=")) {
      args.legacyDataDir = token.slice("--legacy-data-dir=".length);
      continue;
    }
    if (token === "--legacy-data-dir" && argv[i + 1]) {
      args.legacyDataDir = argv[++i];
      continue;
    }
  }

  return args;
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeReadJsonl(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function listFiles(directory, extension) {
  try {
    return fs.readdirSync(directory)
      .filter((entry) => entry.endsWith(extension))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function countPerPersonaJson(directory, valueToRowCount) {
  const files = listFiles(directory, ".json");
  let rows = 0;

  for (const entry of files) {
    const payload = safeReadJson(path.join(directory, entry), null);
    rows += valueToRowCount(payload);
  }

  return {
    directory,
    files: files.length,
    rows,
    ids: files.map((entry) => entry.replace(/\.json$/, "")),
  };
}

function countV1Jsonl(directory) {
  const files = listFiles(directory, ".jsonl");
  let rows = 0;

  for (const entry of files) {
    rows += safeReadJsonl(path.join(directory, entry)).length;
  }

  return {
    directory,
    files: files.length,
    rows,
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function analyzeV2GlobalFile(filePath, kind, perFileIds) {
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      exists: false,
      kind,
      invalid: false,
      ids: [],
      count: 0,
      missingIds: [],
      safeToArchive: false,
      archivedTo: null,
    };
  }

  const payload = safeReadJson(filePath, null);
  const invalid = payload === null;
  let ids = [];

  if (kind === "personas") {
    ids = Array.isArray(payload) ? payload.map((row) => String(row?.id || "").trim()) : [];
  } else if (kind === "sources") {
    const rows = Array.isArray(payload) ? payload : Object.values(payload || {});
    ids = rows.map((row) => String(row?.personaId || row?.id || "").trim());
  } else {
    ids = Array.isArray(payload) ? payload.map((row) => String(row?.personaId || "").trim()) : [];
  }

  ids = uniqueSorted(ids);
  const perFileIdSet = new Set(perFileIds);
  const missingIds = ids.filter((id) => !perFileIdSet.has(id));

  return {
    path: filePath,
    exists: true,
    kind,
    invalid,
    ids,
    count: ids.length,
    missingIds,
    safeToArchive: !invalid && missingIds.length === 0,
    archivedTo: null,
  };
}

function formatTable(headers, rows) {
  const widths = headers.map((header, index) => {
    return Math.max(header.length, ...rows.map((row) => stripAnsi(row[index] || "").length));
  });

  function pad(text, width) {
    const visible = stripAnsi(text).length;
    return text + " ".repeat(Math.max(0, width - visible));
  }

  const head = headers.map((header, index) => pad(header, widths[index])).join("  ");
  const sep = widths.map((width) => "─".repeat(width)).join("──");
  const body = rows.map((row) => row.map((cell, index) => pad(cell || "", widths[index])).join("  ")).join("\n");
  return [c.bold(head), sep, body].join("\n");
}

function drawBox(title, lines, width) {
  const innerWidth = width - 2;

  function padLine(line) {
    const visible = stripAnsi(line).length;
    return `║ ${line}${" ".repeat(Math.max(0, innerWidth - visible - 1))}║`;
  }

  const titleVisible = stripAnsi(title).length;
  const left = Math.floor((innerWidth - titleVisible) / 2);
  const right = innerWidth - titleVisible - left;

  return [
    `╔${"═".repeat(innerWidth)}╗`,
    `║${" ".repeat(left)}${title}${" ".repeat(right)}║`,
    `╠${"═".repeat(innerWidth)}╣`,
    ...lines.map(padLine),
    `╚${"═".repeat(innerWidth)}╝`,
  ].join("\n");
}

function timestampForFile() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function archiveSafeV2GlobalFiles(items) {
  const archived = [];
  const skipped = [];
  const stamp = timestampForFile();

  for (const item of items) {
    if (!item.exists) continue;
    if (!item.safeToArchive) {
      skipped.push({ path: item.path, reason: "missing-per-file-ids", missingIds: item.missingIds });
      continue;
    }
    const archivedTo = `${item.path}.migrated-${stamp}.bak`;
    fs.renameSync(item.path, archivedTo);
    item.archivedTo = archivedTo;
    archived.push({ from: item.path, to: archivedTo });
  }

  return { archived, skipped };
}

function writeMachineLog(logPath, payload) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`, "utf8");
}

function renderTui(result) {
  const perFileRows = [
    ["personas", String(result.perFile.personas.files), String(result.perFile.personas.rows)],
    ["sources", String(result.perFile.sources.files), String(result.perFile.sources.rows)],
    ["feedback", String(result.perFile.feedback.files), String(result.perFile.feedback.rows)],
    ["proposals", String(result.perFile.proposals.files), String(result.perFile.proposals.rows)],
  ];

  const legacyRows = Object.entries(result.v2GlobalLegacy).map(([name, item]) => {
    let status = c.dim("absent");
    if (item.exists && item.safeToArchive) status = c.green("safe");
    else if (item.exists) status = c.yellow(`missing:${item.missingIds.length}`);

    let archive = c.dim("--");
    if (item.archivedTo) archive = c.green("archived");
    else if (item.exists && item.safeToArchive) archive = c.cyan("ready");

    return [name, item.exists ? String(item.count) : "0", status, archive];
  });

  const v1Rows = [
    ["personas.overrides.json", result.v1Legacy.personasOverrides.exists ? "present" : "absent", c.dim("--")],
    ["persona-sources/*.json", String(result.v1Legacy.sources.files), String(result.v1Legacy.sources.rows)],
    ["persona-feedback/*.jsonl", String(result.v1Legacy.feedback.files), String(result.v1Legacy.feedback.rows)],
    ["persona-proposals/*.jsonl", String(result.v1Legacy.proposals.files), String(result.v1Legacy.proposals.rows)],
  ];

  const blocks = [
    `Target: ${c.cyan(result.targetDir)}`,
    `Legacy: ${c.cyan(result.legacyDataDir)}`,
    "",
    formatTable(["Per-file", "Files", "Rows"], perFileRows),
    "",
    formatTable(["V2 Global", "IDs", "Status", "Archive"], legacyRows),
    "",
    formatTable(["V1 Legacy", "Files", "Rows"], v1Rows),
    "",
    `Summary: ${result.summary.globalFilesPresent} global files present, ${result.summary.globalFilesSafeToArchive} safe to archive, ${result.summary.globalFilesNeedMerge} still need merge`,
  ];

  const lines = [];
  for (const block of blocks) {
    for (const line of String(block).split("\n")) {
      lines.push(line);
    }
  }

  return drawBox(c.bold("Persona Store Audit"), lines, 88);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`
${c.bold("KXKM Persona Store Audit")}

Usage: node ops/v2/persona-store-audit.js [options]

Options:
  --json               Output raw JSON
  --archive            Archive v2 legacy aggregate files only when safe
  --target-dir DIR     Target per-file store (default: env KXKM_LOCAL_DATA_DIR or data/v2-local)
  --legacy-data-dir    Legacy V1 data dir (default: data)
  --no-log             Do not append a JSONL audit log
  --help               Show this help
`);
    process.exit(0);
  }

  const rootDir = path.resolve(__dirname, "../..");
  const targetDir = path.resolve(rootDir, args.targetDir || process.env.KXKM_LOCAL_DATA_DIR || "data/v2-local");
  const legacyDataDir = path.resolve(rootDir, args.legacyDataDir || "data");
  const logPath = path.join(rootDir, "ops/v2/logs/persona-store-audit.jsonl");

  const perFile = {
    personas: countPerPersonaJson(path.join(targetDir, "personas"), (value) => (value && !Array.isArray(value) ? 1 : 0)),
    sources: countPerPersonaJson(path.join(targetDir, "persona-sources"), (value) => (value && !Array.isArray(value) ? 1 : 0)),
    feedback: countPerPersonaJson(path.join(targetDir, "persona-feedback"), (value) => Array.isArray(value) ? value.length : (value ? 1 : 0)),
    proposals: countPerPersonaJson(path.join(targetDir, "persona-proposals"), (value) => Array.isArray(value) ? value.length : (value ? 1 : 0)),
  };

  const v2GlobalLegacy = {
    personas: analyzeV2GlobalFile(path.join(targetDir, "personas.json"), "personas", perFile.personas.ids),
    sources: analyzeV2GlobalFile(path.join(targetDir, "persona-sources.json"), "sources", perFile.sources.ids),
    feedback: analyzeV2GlobalFile(path.join(targetDir, "persona-feedback.json"), "feedback", perFile.feedback.ids),
    proposals: analyzeV2GlobalFile(path.join(targetDir, "persona-proposals.json"), "proposals", perFile.proposals.ids),
  };

  let archiveResult = { archived: [], skipped: [] };
  if (args.archive) {
    archiveResult = archiveSafeV2GlobalFiles(Object.values(v2GlobalLegacy));
  }

  const v1Legacy = {
    personasOverrides: {
      path: path.join(legacyDataDir, "personas.overrides.json"),
      exists: fs.existsSync(path.join(legacyDataDir, "personas.overrides.json")),
    },
    sources: countPerPersonaJson(path.join(legacyDataDir, "persona-sources"), (value) => (value && !Array.isArray(value) ? 1 : 0)),
    feedback: countV1Jsonl(path.join(legacyDataDir, "persona-feedback")),
    proposals: countV1Jsonl(path.join(legacyDataDir, "persona-proposals")),
  };

  const globalItems = Object.values(v2GlobalLegacy);
  const summary = {
    globalFilesPresent: globalItems.filter((item) => item.exists).length,
    globalFilesSafeToArchive: globalItems.filter((item) => item.safeToArchive).length,
    globalFilesNeedMerge: globalItems.filter((item) => item.exists && item.missingIds.length > 0).length,
    v1LegacyFilesPresent:
      (v1Legacy.personasOverrides.exists ? 1 : 0) +
      v1Legacy.sources.files +
      v1Legacy.feedback.files +
      v1Legacy.proposals.files,
    archivedFiles: archiveResult.archived.length,
  };

  const result = {
    ok: true,
    timestamp: new Date().toISOString(),
    targetDir,
    legacyDataDir,
    perFile,
    v2GlobalLegacy,
    v1Legacy,
    archive: archiveResult,
    summary,
  };

  if (!args.noLog) {
    writeMachineLog(logPath, {
      ts: result.timestamp,
      targetDir: result.targetDir,
      legacyDataDir: result.legacyDataDir,
      archiveRequested: args.archive,
      archivedFiles: result.archive.archived.length,
      globalFilesPresent: result.summary.globalFilesPresent,
      globalFilesNeedMerge: result.summary.globalFilesNeedMerge,
      v1LegacyFilesPresent: result.summary.v1LegacyFilesPresent,
    });
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(renderTui(result));
}

try {
  main();
} catch (error) {
  console.error(`[persona-store-audit] ${error.message}`);
  process.exit(1);
}
