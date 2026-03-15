const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");

const NODE_CHECK_FILES = [
  "server.js",
  "persona-registry.js",
  "persona-store.js",
  "pharmacius.js",
  "attachment-store.js",
  "attachment-pipeline.js",
  "attachment-service.js",
  "node-engine-registry.js",
  "node-engine-store.js",
  "personas.js",
  "runtime-state.js",
  "client-registry.js",
  "sessions.js",
  "chat-routing.js",
  "http-api.js",
  "websocket.js",
  "commands.js",
  "config.js",
  "network-policy.js",
  "ollama.js",
  "storage.js",
  "attachment-store.js",
  "attachment-pipeline.js",
  "attachment-service.js",
  "scripts/check.js",
  "scripts/smoke.js",
  "public/app.js",
  "public/admin/personas.js",
];

const HTML_FILES = [
  "public/index.html",
  "public/admin/index.html",
  "public/admin/personas.html",
];

const MODULE_JS_FILES = [
  "public/admin/admin.js",
  "public/admin/admin-api.js",
  "public/admin/admin-store.js",
  "public/admin/modules/dashboard.js",
  "public/admin/modules/personas.js",
  "public/admin/modules/runtime.js",
  "public/admin/modules/channels.js",
  "public/admin/modules/data.js",
  "public/admin/modules/node-engine.js",
];

function runNodeCheck(file) {
  const absoluteFile = path.join(ROOT_DIR, file);
  execFileSync(process.execPath, ["--check", absoluteFile], {
    cwd: ROOT_DIR,
    stdio: "pipe",
  });
}

function compileInlineScripts(file) {
  const absoluteFile = path.join(ROOT_DIR, file);
  const html = fs.readFileSync(absoluteFile, "utf8");
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const externalScripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/g)];

  if (!matches.length) {
    if (externalScripts.length) return;
    throw new Error(`Aucun script inline ou externe trouvé dans ${file}`);
  }

  matches.forEach((match, index) => {
    new vm.Script(match[1], {
      filename: `${file}#script${index + 1}`,
    });
  });
}

async function compileModule(file) {
  const absoluteFile = path.join(ROOT_DIR, file);
  const source = fs.readFileSync(absoluteFile, "utf8");
  execFileSync(process.execPath, ["--input-type=module", "--check"], {
    cwd: ROOT_DIR,
    input: source,
    stdio: "pipe",
  });
}

async function main() {
  NODE_CHECK_FILES.forEach(runNodeCheck);
  HTML_FILES.forEach(compileInlineScripts);
  for (const file of MODULE_JS_FILES) {
    await compileModule(file);
  }

  console.log(JSON.stringify({
    ok: true,
    nodeChecked: NODE_CHECK_FILES.length,
    htmlCompiled: HTML_FILES.length,
    moduleCompiled: MODULE_JS_FILES.length,
  }));
}

main().catch((error) => {
  console.error(`[check] ${error.message}`);
  process.exit(1);
});
