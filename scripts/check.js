const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");

function toRelative(file) {
  return path.relative(ROOT_DIR, file).split(path.sep).join("/");
}

function listFiles(relativeDir, matcher, { recursive = false } = {}) {
  const absoluteDir = path.join(ROOT_DIR, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];

  const found = [];

  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const absoluteEntry = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        found.push(...listFiles(path.join(relativeDir, entry.name), matcher, { recursive: true }));
      }
      continue;
    }
    if (matcher(absoluteEntry, entry.name)) {
      found.push(toRelative(absoluteEntry));
    }
  }

  return found;
}

function listRootFiles(matcher) {
  return fs.readdirSync(ROOT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && matcher(entry.name))
    .map((entry) => entry.name);
}

function uniqueSorted(files) {
  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

const NODE_CHECK_FILES = uniqueSorted([
  ...listRootFiles((name) => name.endsWith(".js")),
  ...listFiles("scripts", (_file, name) => name.endsWith(".js")),
  ...listFiles("public", (_file, name) => name.endsWith(".js")),
  "public/admin/personas.js",
]);

const HTML_FILES = uniqueSorted(listFiles("public", (_file, name) => name.endsWith(".html"), { recursive: true }));

const JSON_FILES = uniqueSorted([
  "package.json",
  ...listFiles("apps", (_file, name) => name === "package.json", { recursive: true }),
  ...listFiles("packages", (_file, name) => name === "package.json", { recursive: true }),
  ...listFiles("ops", (_file, name) => name.endsWith(".json"), { recursive: true }),
]);

const MODULE_JS_FILES = uniqueSorted([
  ...listFiles("public/admin", (_file, name) => name.endsWith(".js") && name !== "personas.js"),
  ...listFiles("public/admin/modules", (_file, name) => name.endsWith(".js")),
]);

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

function parseJsonFile(file) {
  const absoluteFile = path.join(ROOT_DIR, file);
  JSON.parse(fs.readFileSync(absoluteFile, "utf8"));
}

async function main() {
  NODE_CHECK_FILES.forEach(runNodeCheck);
  HTML_FILES.forEach(compileInlineScripts);
  JSON_FILES.forEach(parseJsonFile);
  for (const file of MODULE_JS_FILES) {
    await compileModule(file);
  }

  console.log(JSON.stringify({
    ok: true,
    nodeChecked: NODE_CHECK_FILES.length,
    htmlCompiled: HTML_FILES.length,
    jsonParsed: JSON_FILES.length,
    moduleCompiled: MODULE_JS_FILES.length,
  }));
}

main().catch((error) => {
  console.error(`[check] ${error.message}`);
  process.exit(1);
});
