import { defineConfig, devices } from "@playwright/test";

/**
 * Config Playwright pour CI/CD — cible 3115.kxkm.net (production)
 * Usage: npx playwright test --config apps/web/playwright.config.ts
 */
const BASE_URL = process.env.TEST_BASE_URL ?? "https://3115.kxkm.net";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 2 : 1,
  workers: 1, // séquentiel pour éviter les conflits sur le WS prod
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../test-results/playwright-html", open: "never" }],
    ["json", { outputFile: "../../test-results/playwright-results.json" }],
  ],
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
