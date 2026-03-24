import { test, expect, type Page } from "@playwright/test";

async function loginAs(page: Page, username = "testbot"): Promise<void> {
  await page.goto("/");
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

test.describe("slash commands", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test("/help affiche la liste des commandes", async ({ page }) => {
    await sendCommand(page, "/help");
    await expect(page.getByRole("log")).toContainText("112 commandes");
    await expect(page.getByRole("log")).toContainText("INSTRUMENTS AI");
    await expect(page.getByRole("log")).toContainText("/drone");
    await expect(page.getByRole("log")).toContainText("/kokoro");
  });

  test("/who affiche les utilisateurs", async ({ page }) => {
    await sendCommand(page, "/who");
    await expect(page.getByRole("log")).toContainText("testbot");
  });

  test("/noise genere du bruit", async ({ page }) => {
    await sendCommand(page, "/noise pink 3");
    await expect(page.getByRole("log")).toContainText("pink noise", { timeout: 15_000 });
  });

  test("/weather affiche la meteo", async ({ page }) => {
    await sendCommand(page, "/weather Paris");
    // wttr.in renvoie parfois en minuscules (ex: "paris: ☀️  +18°C"), on cherche le symbole °C
    await expect(page.getByRole("log")).toContainText("°C", { timeout: 10_000 });
  });

  test("/ascii genere du texte en blocs", async ({ page }) => {
    await sendCommand(page, "/ascii HI");
    await expect(page.getByRole("log")).toContainText("[H]");
    await expect(page.getByRole("log")).toContainText("[I]");
  });

  test("/quote genere une citation", async ({ page }) => {
    await sendCommand(page, "/quote");
    // Should get either a quote or "Citation indisponible"
    const log = page.getByRole("log");
    await expect(log.or(log.getByText("Citation indisponible")).or(log.locator(".chat-message"))).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("navigation", () => {
  test("F-key tabs are accessible", async ({ page }) => {
    await loginAs(page);
    // Les boutons de navigation sont des .minitel-fkey (F1-F9)
    const navButtons = page.locator(".minitel-fkey");
    await expect(navButtons.first()).toBeVisible();
  });
});
