import { test, expect } from "@playwright/test";

// Point directly to the live DAW server
const DAW_URL = process.env.DAW_URL || "http://kxkm-ai:3333/daw/";

test.describe("openDIAW.be Instruments Debug", () => {
  // Ces tests ciblent le service interne kxkm-ai:3333/daw/ non accessible depuis l'extérieur en CI
  test.skip(true, "service interne openDIAW.be non accessible en CI — tester manuellement");
  test.setTimeout(60_000);

  test("DAW loads and shows openDIAW.be title", async ({ page }) => {
    await page.goto(DAW_URL);
    await expect(page).toHaveTitle(/openDIAW/);
    // Wait for app to initialize
    await page.waitForTimeout(3000);
    // Take screenshot of initial state
    await page.screenshot({ path: "/tmp/daw-01-loaded.png", fullPage: true });
  });

  test("processor bundle contains all 9 instrument visitors", async ({ page }) => {
    // Fetch the HTML to find the processor bundle filename
    const resp = await page.request.get(DAW_URL);
    const html = await resp.text();
    const procMatch = html.match(/processors\.[a-f0-9-]+\.js/);
    expect(procMatch).toBeTruthy();

    const procResp = await page.request.get(`${DAW_URL}${procMatch![0]}`);
    expect(procResp.ok()).toBeTruthy();
    const procJs = await procResp.text();

    const instruments = [
      "visitDroneDeviceBox",
      "visitGrainDeviceBox",
      "visitGlitchDeviceBox",
      "visitCircusDeviceBox",
      "visitHonkDeviceBox",
      "visitMagentaDeviceBox",
      "visitAceStepDeviceBox",
      "visitKokoroTtsDeviceBox",
      "visitPiperDeviceBox",
    ];

    const missing: string[] = [];
    for (const name of instruments) {
      if (!procJs.includes(name)) {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  test("main bundle contains all 9 instrument visitors", async ({ page }) => {
    const resp = await page.request.get(DAW_URL);
    const html = await resp.text();
    const mainMatch = html.match(/main\.[a-f0-9-]+\.js/);
    expect(mainMatch).toBeTruthy();

    const mainResp = await page.request.get(`${DAW_URL}${mainMatch![0]}`);
    const mainJs = await mainResp.text();

    const instruments = [
      "visitDroneDeviceBox",
      "visitGrainDeviceBox",
      "visitGlitchDeviceBox",
      "visitCircusDeviceBox",
      "visitHonkDeviceBox",
      "visitMagentaDeviceBox",
      "visitAceStepDeviceBox",
      "visitKokoroTtsDeviceBox",
      "visitPiperDeviceBox",
    ];

    const missing: string[] = [];
    for (const name of instruments) {
      if (!mainJs.includes(name)) {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  test("main bundle contains BoxAdapters for all 9 instruments", async ({ page }) => {
    const resp = await page.request.get(DAW_URL);
    const html = await resp.text();
    const mainMatch = html.match(/main\.[a-f0-9-]+\.js/);
    expect(mainMatch).toBeTruthy();

    const mainResp = await page.request.get(`${DAW_URL}${mainMatch![0]}`);
    const mainJs = await mainResp.text();

    // Check that BoxAdapters factory code contains each instrument's class name string
    const boxNames = [
      '"DroneDeviceBox"',
      '"GrainDeviceBox"',
      '"GlitchDeviceBox"',
      '"CircusDeviceBox"',
      '"HonkDeviceBox"',
      '"MagentaDeviceBox"',
      '"AceStepDeviceBox"',
      '"KokoroTtsDeviceBox"',
      '"PiperDeviceBox"',
    ];

    const missing: string[] = [];
    for (const name of boxNames) {
      if (!mainJs.includes(name)) {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      console.log(`Missing box class names in main bundle: ${missing.join(", ")}`);
    }
    expect(missing).toEqual([]);
  });

  test("InstrumentFactories.Named contains all 9 custom instruments", async ({ page }) => {
    const resp = await page.request.get(DAW_URL);
    const html = await resp.text();
    const mainMatch = html.match(/main\.[a-f0-9-]+\.js/);
    expect(mainMatch).toBeTruthy();

    const mainResp = await page.request.get(`${DAW_URL}${mainMatch![0]}`);
    const mainJs = await mainResp.text();

    // Check factory descriptions appear in the bundle
    const descriptions = [
      "Pad/drone synthesizer",
      "Granular synthesizer",
      "Glitch texture generator",
      "Barrel organ",
      "Klaxon",
      "AI MIDI generator",
      "AI music generator",
      "Kokoro TTS",
      "Piper TTS",
    ];

    const found: string[] = [];
    const missing: string[] = [];
    for (const desc of descriptions) {
      if (mainJs.includes(desc)) {
        found.push(desc);
      } else {
        missing.push(desc);
      }
    }

    console.log(`Found: ${found.length}/9 instrument descriptions`);
    if (missing.length > 0) {
      console.log(`Missing: ${missing.join(", ")}`);
    }
    expect(missing).toEqual([]);
  });

  test("DAW can open and navigate (smoke)", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`[DAW Console Error] ${msg.text()}`);
      }
    });

    page.on("pageerror", (err) => {
      console.log(`[DAW Page Error] ${err.message}`);
    });

    await page.goto(DAW_URL);
    await page.waitForTimeout(5000);

    // Collect all console errors
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.waitForTimeout(2000);
    await page.screenshot({ path: "/tmp/daw-02-ready.png", fullPage: true });

    // Check no critical errors about factories or instruments
    const factoryErrors = errors.filter(e =>
      e.includes("factory") || e.includes("Factory") ||
      e.includes("Could not find") || e.includes("DeviceBox")
    );

    if (factoryErrors.length > 0) {
      console.log("Factory-related errors found:");
      factoryErrors.forEach(e => console.log(`  - ${e}`));
    }

    // This is informational — we log errors but don't fail on them
    // because the DAW may show errors from other causes (network, audio context, etc.)
    console.log(`Total console errors: ${errors.length}, factory errors: ${factoryErrors.length}`);
  });
});
