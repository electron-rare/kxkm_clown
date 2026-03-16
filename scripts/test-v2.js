#!/usr/bin/env node
// Runs all V2 package tests using node --test
// First compiles TypeScript, then runs the compiled test files

const path = require("path");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const TSC_BIN = require.resolve("typescript/bin/tsc");

const PACKAGES = [
  "core",
  "auth",
  "chat-domain",
  "persona-domain",
  "node-engine",
  "tui",
];

function main() {
  // Step 1: Compile all V2 packages (including test files)
  console.log("[test:v2] Compiling TypeScript...");
  try {
    execFileSync(process.execPath, [TSC_BIN, "-b", "tsconfig.v2.json", "--pretty", "false"], {
      cwd: ROOT_DIR,
      stdio: "pipe",
    });
  } catch (err) {
    const output = (err.stdout || "").toString() + (err.stderr || "").toString();
    console.error("[test:v2] TypeScript compilation failed:");
    console.error(output);
    process.exit(1);
  }
  console.log("[test:v2] Compilation OK");

  // Step 2: Collect all compiled test files
  const testFiles = [];
  for (const pkg of PACKAGES) {
    const testFile = path.join(ROOT_DIR, "packages", pkg, "dist", "index.test.js");
    try {
      require("fs").accessSync(testFile);
      testFiles.push(testFile);
    } catch {
      console.warn(`[test:v2] Warning: no compiled test file for ${pkg}`);
    }
  }

  if (testFiles.length === 0) {
    console.error("[test:v2] No test files found");
    process.exit(1);
  }

  // Step 3: Run tests with node --test
  console.log(`[test:v2] Running ${testFiles.length} test files...`);
  try {
    execFileSync(process.execPath, ["--test", ...testFiles], {
      cwd: ROOT_DIR,
      stdio: "inherit",
    });
  } catch (err) {
    process.exit(err.status || 1);
  }

  console.log("[test:v2] All tests passed");
}

main();
