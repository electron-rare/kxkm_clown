const path = require("path");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const TSC_BIN = require.resolve("typescript/bin/tsc");
const VITE_BIN = path.join(ROOT_DIR, "node_modules", "vite", "bin", "vite.js");

function runNodeScript(script, args, cwd = ROOT_DIR) {
  execFileSync(process.execPath, [script, ...args], {
    cwd,
    stdio: "pipe",
  });
}

function main() {
  runNodeScript(TSC_BIN, ["-b", "tsconfig.v2.json", "--pretty", "false"]);
  runNodeScript(VITE_BIN, ["build", "--config", "vite.config.ts"], path.join(ROOT_DIR, "apps", "web"));

  console.log(JSON.stringify({
    ok: true,
    built: ["tsconfig.v2.json", "apps/web/vite.config.ts"],
  }));
}

try {
  main();
} catch (error) {
  console.error(`[build:v2] ${error.message}`);
  process.exit(1);
}
