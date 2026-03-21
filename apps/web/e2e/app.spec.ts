import { test, expect, type Page } from "@playwright/test";

async function reachLogin(page: Page): Promise<void> {
  await page.goto("/");
  const connectScreen = page.locator(".minitel-connect");
  if (await connectScreen.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await connectScreen.click();
  }
  await expect(page.getByPlaceholder("votre pseudo")).toBeVisible();
}

async function loginAs(page: Page, username = "alice"): Promise<void> {
  await reachLogin(page);
  await page.getByPlaceholder("votre pseudo").fill(username);
  await page.getByRole("button", { name: ">>> Connexion <<<" }).click();
  await expect(page.getByRole("button", { name: "Envoyer" })).toBeVisible();
  await expect(page.locator(".chat-status")).toHaveText("connecte");
}

test("connexion visiteur vers le chat", async ({ page }) => {
  await loginAs(page, "alice");

  await expect(page.locator(".minitel-user")).toHaveText("alice");
  await expect(page.getByRole("log")).toContainText("Backend Playwright");
  await expect(page.locator(".chat-channel")).toHaveText("#general");
});

test("chat websocket deterministe", async ({ page }) => {
  await loginAs(page, "alice");

  await page.locator(".chat-input input[type='text']").fill("bonjour du test");
  await page.getByRole("button", { name: "Envoyer" }).click();

  await expect(page.getByRole("log")).toContainText("bonjour du test");
  await expect(page.getByRole("log")).toContainText("Reponse deterministe: bonjour du test");
});

test("upload de fichier dans le chat", async ({ page }) => {
  await loginAs(page, "alice");

  await page.locator("input[type='file']").setInputFiles({
    name: "note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("bonjour upload"),
  });

  await expect(page.getByRole("log")).toContainText("alice a envoye: note.txt");
  await expect(page.getByRole("log")).toContainText("Fichier recu: note.txt. Analyse prete.");
});

test("connexion admin et tableau de bord", async ({ page }) => {
  await loginAs(page, "alice");

  await page.getByRole("button", { name: "Menu de navigation" }).click();
  await page.getByRole("button", { name: "Administration" }).click();

  await expect(page.getByText(">>> ADMINISTRATION <<<")).toBeVisible();
  await page.getByPlaceholder("admin").fill("ops-admin");
  await page.getByPlaceholder("********").fill("secret");
  await page.getByRole("button", { name: ">>> Connexion admin <<<" }).click();

  await expect(page.locator(".admin-user")).toContainText("ops-admin [admin]");
  await expect(page.getByText("Graphes")).toBeVisible();
  await expect(page.getByText("1/2")).toBeVisible();
  await page.getByRole("button", { name: "Node Engine" }).click();
  await expect(page.getByText("NODE ENGINE")).toBeVisible();
  await expect(page.getByText("Graphe demo")).toBeVisible();
});
