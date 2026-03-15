const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");

const ROOT_FILES = [
  "server.js",
  "config.js",
  "network-policy.js",
  "personas.js",
  "persona-registry.js",
  "persona-store.js",
  "pharmacius.js",
  "attachment-store.js",
  "attachment-pipeline.js",
  "attachment-service.js",
  "node-engine-registry.js",
  "node-engine-store.js",
  "ollama.js",
  "storage.js",
  "sessions.js",
  "runtime-state.js",
  "client-registry.js",
  "commands.js",
  "chat-routing.js",
  "http-api.js",
  "websocket.js",
  "web-tools.js",
  "package.json",
  "package-lock.json",
];

const COPY_DIRS = [
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
];

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
  for (const relativePath of DATA_DIRS) {
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

  for (const file of ROOT_FILES) {
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
