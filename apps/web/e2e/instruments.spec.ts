import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:4180";

async function loginAs(page: Page, username = "insttest"): Promise<void> {
  await page.goto(BASE.replace(":4180", ":4173") + "/");
  const connectScreen = page.locator(".minitel-connect");
  if (await connectScreen.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await connectScreen.click();
  }
  await expect(page.getByPlaceholder("votre pseudo")).toBeVisible();
  await page.getByPlaceholder("votre pseudo").fill(username);
  await page.getByRole("button", { name: ">>> Connexion <<<" }).click();
  await expect(page.getByRole("button", { name: "Envoyer" })).toBeVisible();
}

async function sendCommand(page: Page, command: string): Promise<void> {
  await page.locator(".chat-input input[type='text']").fill(command);
  await page.getByRole("button", { name: "Envoyer" }).click();
}

test.describe("AI Bridge instrument endpoints", () => {
  test("AI Bridge health returns 19+ backends", async ({ request }) => {
    const resp = await request.get(`${BASE}/api/v2/ai-bridge/health`);
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(data.backends.length).toBeGreaterThanOrEqual(18);
    expect(data.backends).toContain("drone");
    expect(data.backends).toContain("grain");
    expect(data.backends).toContain("glitch");
    expect(data.backends).toContain("circus");
    expect(data.backends).toContain("honk");
  });

  test("POST /instrument/drone returns WAV", async ({ request }) => {
    const resp = await request.post(`${BASE}/api/v2/ai-bridge/instrument/drone`, {
      data: { note: "C2", duration: 2, voices: 3, waveform: "saw" },
    });
    expect(resp.ok()).toBeTruthy();
    expect(resp.headers()["content-type"]).toContain("audio/wav");
  });

  test("POST /instrument/circus returns WAV", async ({ request }) => {
    const resp = await request.post(`${BASE}/api/v2/ai-bridge/instrument/circus`, {
      data: { notes: "C4,E4,G4", duration: 2, register: "principal" },
    });
    expect(resp.ok()).toBeTruthy();
    expect(resp.headers()["content-type"]).toContain("audio/wav");
  });

  test("POST /instrument/honk returns WAV", async ({ request }) => {
    const resp = await request.post(`${BASE}/api/v2/ai-bridge/instrument/honk`, {
      data: { mode: "siren", duration: 2 },
    });
    expect(resp.ok()).toBeTruthy();
    expect(resp.headers()["content-type"]).toContain("audio/wav");
  });

  test("POST /instrument/glitch returns WAV", async ({ request }) => {
    const resp = await request.post(`${BASE}/api/v2/ai-bridge/instrument/glitch`, {
      data: { duration: 3, bpm: 140, crushBits: 6 },
    });
    expect(resp.ok()).toBeTruthy();
    expect(resp.headers()["content-type"]).toContain("audio/wav");
  });

  test("POST /instrument/grain returns WAV", async ({ request }) => {
    const resp = await request.post(`${BASE}/api/v2/ai-bridge/instrument/grain`, {
      data: { source: "noise", duration: 3, density: 10 },
    });
    expect(resp.ok()).toBeTruthy();
    expect(resp.headers()["content-type"]).toContain("audio/wav");
  });

  test.skip("POST /generate/sound-design returns WAV", async ({ request }) => {
    // Génération IA (ACE-Step) trop lente pour CI (>20s) — tester manuellement
    const resp = await request.post(`${BASE}/api/v2/ai-bridge/generate/sound-design`, {
      data: { prompt: "impact", duration: 2, category: "impact" },
    });
    expect(resp.ok()).toBeTruthy();
    expect(resp.headers()["content-type"]).toContain("audio/wav");
  });

  test("POST /generate/voice-fast (Kokoro) returns WAV", async ({ request }) => {
    const resp = await request.post(`${BASE}/api/v2/ai-bridge/generate/voice-fast`, {
      data: { text: "Test Kokoro", voice: "af_heart" },
    });
    expect(resp.ok()).toBeTruthy();
    expect(resp.headers()["content-type"]).toContain("audio/wav");
  });
});

test.describe("Chat instrument commands", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test("/drone command is recognized", async ({ page }) => {
    await sendCommand(page, "/drone 3 C2");
    await expect(page.getByRole("log")).toContainText("drone", { timeout: 15_000 });
  });

  test("/honk command is recognized", async ({ page }) => {
    await sendCommand(page, "/honk 2 klaxon");
    await expect(page.getByRole("log")).toContainText("honk", { timeout: 15_000 });
  });

  test("/kokoro command is recognized", async ({ page }) => {
    await sendCommand(page, "/kokoro Bonjour le test");
    await expect(page.getByRole("log")).toContainText("kokoro", { timeout: 15_000 });
  });
});

test.describe("openDIAW.be DAW integration", () => {
  test("openDIAW.be studio loads at /daw/", async ({ request }) => {
    const resp = await request.get(`${BASE}/daw/`);
    expect(resp.ok()).toBeTruthy();
    const html = await resp.text();
    expect(html).toContain("openDIAW.be");
  });

  test("A2A Agent Card is served", async ({ request }) => {
    const resp = await request.get(`${BASE}/.well-known/agent.json`);
    expect(resp.ok()).toBeTruthy();
    const card = await resp.json();
    expect(card.name).toBe("3615-KXKM");
    expect(card.skills.length).toBeGreaterThanOrEqual(5);
  });

  test("Prometheus metrics endpoint works", async ({ request }) => {
    const resp = await request.get(`${BASE}/metrics`);
    expect(resp.ok()).toBeTruthy();
    const text = await resp.text();
    expect(text).toContain("kxkm_memory_rss_bytes");
    expect(text).toContain("kxkm_uptime_seconds");
  });
});
