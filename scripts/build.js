const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");

const COPY_DIRS = [
  "apps",
  "packages",
  "ops",
  "public",
  "docs",
  "scripts",
];

const DATA_FILES = [
  "data/manifeste.md",
  "data/personas.overrides.json",
  "data/channels.json",
  "data/runtime-admin.json",
];

const DATA_DIRS = [
  "data",
  "data/v2-local",
  "data/v2-local/personas",
  "data/v2-local/persona-sources",
  "data/v2-local/persona-feedback",
  "data/v2-local/persona-proposals",
  "data/logs",
  "data/sessions",
  "data/training",
  "data/memory",
  "data/dpo",
  "data/persona-sources",
  "data/persona-feedback",
  "data/persona-proposals",
  "data/uploads",
  "data/uploads-meta",
  "data/node-engine",
  "data/node-engine/graphs",
  "data/node-engine/runs",
  "data/node-engine/artifacts",
  "data/node-engine/cache",
  "models",
  "models/base_models",
  "models/finetuned",
  "models/lora",
];

function listRootFiles() {
  return fs.readdirSync(ROOT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".js") || name === "package.json" || name === "package-lock.json" || name === "README.md")
    .sort((a, b) => a.localeCompare(b));
}

function listExistingDirs(relativeDir, { recursive = false } = {}) {
  const absoluteDir = path.join(ROOT_DIR, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];

  const found = [];

  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nestedRelative = path.join(relativeDir, entry.name);
    found.push(nestedRelative);
    if (recursive) {
      found.push(...listExistingDirs(nestedRelative, { recursive: true }));
    }
  }

  return found;
}

function listDataDirs() {
  return [...new Set([
    ...DATA_DIRS,
    ...listExistingDirs("data/node-engine", { recursive: true }),
  ])].sort((a, b) => a.localeCompare(b));
}

function copyFile(relativePath) {
  const source = path.join(ROOT_DIR, relativePath);
  if (!fs.existsSync(source)) return false;
  const target = path.join(DIST_DIR, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function copyDir(relativePath) {
  const source = path.join(ROOT_DIR, relativePath);
  if (!fs.existsSync(source)) return false;
  const target = path.join(DIST_DIR, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  return true;
}

function ensureDirs() {
  for (const relativePath of listDataDirs()) {
    fs.mkdirSync(path.join(DIST_DIR, relativePath), { recursive: true });
  }
}

function main() {
  execFileSync(process.execPath, ["scripts/check.js"], {
    cwd: ROOT_DIR,
    stdio: "pipe",
  });

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  let copiedFiles = 0;
  let copiedDirs = 0;

  for (const file of listRootFiles()) {
    if (copyFile(file)) copiedFiles++;
  }

  for (const dir of COPY_DIRS) {
    if (copyDir(dir)) copiedDirs++;
  }

  ensureDirs();

  for (const file of DATA_FILES) {
    if (copyFile(file)) copiedFiles++;
  }

  const packageFile = path.join(DIST_DIR, "package.json");
  if (fs.existsSync(packageFile)) {
    const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
    pkg.scripts = {
      start: "node server.js",
      check: "node scripts/check.js",
      smoke: "node scripts/smoke.js",
      build: "node scripts/build.js",
      "v2:init": "python3 scripts/orchestrate_batches.py init --root ops/v2",
      "v2:status": "python3 scripts/orchestrate_batches.py status --root ops/v2",
    };
    fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + "\n");
  }

  fs.writeFileSync(
    path.join(DIST_DIR, "BUILD_INFO.json"),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        node: process.version,
        copiedFiles,
        copiedDirs,
        dist: path.relative(ROOT_DIR, DIST_DIR),
      },
      null,
      2
    ) + "\n"
  );

  console.log(JSON.stringify({
    ok: true,
    dist: DIST_DIR,
    copiedFiles,
    copiedDirs,
  }));
}

try {
  main();
} catch (error) {
  console.error(`[build] ${error.message}`);
  process.exit(1);
}
