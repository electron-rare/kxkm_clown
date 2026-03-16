const path = require("path");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const TSC_BIN = require.resolve("typescript/bin/tsc");

function run(args) {
  execFileSync(process.execPath, [TSC_BIN, ...args], {
    cwd: ROOT_DIR,
    stdio: "pipe",
  });
}

function main() {
  run(["-b", "tsconfig.v2.json", "--pretty", "false"]);
  run(["-p", "apps/web/tsconfig.json", "--noEmit", "--pretty", "false"]);

  console.log(JSON.stringify({
    ok: true,
    checked: ["tsconfig.v2.json", "apps/web/tsconfig.json"],
  }));
}

try {
  main();
} catch (error) {
  console.error(`[check:v2] ${error.message}`);
  process.exit(1);
}
