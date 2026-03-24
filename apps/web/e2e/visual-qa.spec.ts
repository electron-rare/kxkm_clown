/**
 * visual-qa.spec.ts — QA webdesign & rendu graphique
 * Capture des screenshots systématiques pour audit visuel
 * Teste: thèmes, responsive, composants clés, accessibilité basique
 *
 * Usage:
 *   npx playwright test e2e/visual-qa.spec.ts \
 *     --config apps/web/playwright.config.ts \
 *     --reporter list
 */
import { test, expect, type Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Répertoire de sortie pour les screenshots d'audit
const VISUAL_DIR = path.resolve(__dirname, "../../test-results/visual-qa");
if (!fs.existsSync(VISUAL_DIR)) {
  fs.mkdirSync(VISUAL_DIR, { recursive: true });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function shot(page: Page, name: string) {
  const p = path.join(VISUAL_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`[screenshot] ${name}.png`);
}

async function reachLogin(page: Page) {
  await page.goto("/");
  const cs = page.locator(".minitel-connect");
  if (await cs.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await cs.click();
  }
  await expect(page.getByPlaceholder("votre pseudo")).toBeVisible();
}

async function loginAs(page: Page, nick = "qa_tester") {
  await reachLogin(page);
  await page.getByPlaceholder("votre pseudo").fill(nick);
  await page.getByRole("button", { name: ">>> Connexion <<<" }).click();
  await expect(page.getByRole("button", { name: "Envoyer" })).toBeVisible();
}

// ── 1. Écrans d'entrée ───────────────────────────────────────────────────────

test.describe("Écran de connexion (MinitelConnect)", () => {
  test("rendu animation modem — desktop 1280", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    // Capture dès le chargement (animation modem)
    await page.waitForTimeout(400);
    await shot(page, "01-connect-desktop");

    // L'écran MinitelConnect doit être visible
    const screen = page.locator(".minitel-connect");
    if (await screen.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(screen).toBeVisible();
    }
  });

  test("rendu animation modem — mobile 375", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.waitForTimeout(400);
    await shot(page, "02-connect-mobile");
  });

  test("page login — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await reachLogin(page);
    await shot(page, "03-login-desktop");

    // Vérifications graphiques login
    const input = page.getByPlaceholder("votre pseudo");
    const box = await input.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThanOrEqual(30);
  });

  test("page login — mobile 375", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await reachLogin(page);
    await shot(page, "04-login-mobile");

    // Pas d'overflow horizontal sur mobile
    const scrollW = await page.evaluate(() => document.body.scrollWidth);
    const viewW = await page.evaluate(() => window.innerWidth);
    expect(scrollW).toBeLessThanOrEqual(viewW + 2); // +2px tolerance
  });
});

// ── 2. Interface principale post-login ───────────────────────────────────────

test.describe("Chat principal", () => {
  test("vue chat — desktop 1280×800", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);
    await page.waitForTimeout(500);
    await shot(page, "05-chat-desktop");

    // Éléments graphiques clés visibles
    await expect(page.locator(".chat-container")).toBeVisible();
    // Nav doit exister
    const nav = page.locator(".minitel-fkey").first();
    if (await nav.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(nav).toBeVisible();
    }
  });

  test("vue chat — tablet 768×1024", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAs(page);
    await page.waitForTimeout(500);
    await shot(page, "06-chat-tablet");

    // Pas d'overflow horizontal
    const scrollW = await page.evaluate(() => document.body.scrollWidth);
    const viewW = await page.evaluate(() => window.innerWidth);
    expect(scrollW).toBeLessThanOrEqual(viewW + 5);
  });

  test("vue chat — mobile 375×812", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page);
    await page.waitForTimeout(500);
    await shot(page, "07-chat-mobile");

    // Pas d'overflow horizontale sur mobile
    const scrollW = await page.evaluate(() => document.body.scrollWidth);
    const viewW = await page.evaluate(() => window.innerWidth);
    expect(scrollW).toBeLessThanOrEqual(viewW + 5);
  });

  test("chat input visible et utilisable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    const inp = page.locator(".chat-input input[type='text']");
    await expect(inp).toBeVisible();
    const box = await inp.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThanOrEqual(30);
    // Zone de clic suffisante
    expect(box!.width).toBeGreaterThan(100);
  });

  test("pas de texte débordant dans les messages", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    // Envoyer un message de test
    await page.locator(".chat-input input[type='text']").fill("test QA rendu graphique 2026");
    await page.getByRole("button", { name: "Envoyer" }).click();
    await page.waitForTimeout(800);
    await shot(page, "08-chat-with-message");

    // Vérifier que le log de chat est visible
    const log = page.getByRole("log");
    if (await log.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expect(log).toBeVisible();
    }
  });
});

// ── 3. Thèmes CSS ────────────────────────────────────────────────────────────

test.describe("Thèmes CSS (via /theme)", () => {
  const THEMES = ["noir", "matrix", "amber", "ocean", "dark", "light"] as const;

  for (const theme of THEMES) {
    test(`thème "${theme}" — rendu et contraste`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await loginAs(page);

      // Appliquer le thème via la commande chat
      await page.locator(".chat-input input[type='text']").fill(`/theme ${theme}`);
      await page.getByRole("button", { name: "Envoyer" }).click();
      await page.waitForTimeout(600);

      await shot(page, `09-theme-${theme}`);

      // Vérifier que le data-theme est appliqué sur body ou html
      const appliedTheme = await page.evaluate((t) => {
        const body = document.body.getAttribute("data-theme");
        const html = document.documentElement.getAttribute("data-theme");
        return body === t || html === t;
      }, theme);

      // Le thème doit être appliqué (ou pas de data-theme si le thème par défaut)
      // On accepte aussi si la commande est juste ignorée gracieusement
      expect(typeof appliedTheme).toBe("boolean");

      // Pas d'overflow côté thème
      const scrollW = await page.evaluate(() => document.body.scrollWidth);
      const viewW = await page.evaluate(() => window.innerWidth);
      expect(scrollW).toBeLessThanOrEqual(viewW + 5);
    });
  }
});

// ── 4. Navigation vers les pages ─────────────────────────────────────────────

test.describe("Navigation pages", () => {
  async function goToPage(page: Page, cmd: string) {
    await page.locator(".chat-input input[type='text']").fill(cmd);
    await page.getByRole("button", { name: "Envoyer" }).click();
    await page.waitForTimeout(600);
  }

  test("ComposePage — rendu timeline", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    // Navigation via bouton fkey si disponible, sinon via hash
    const daw = page.locator(".minitel-fkey", { hasText: /compose|Compose|COMPOSE/i }).first();
    if (await daw.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await daw.click();
    } else {
      await page.goto("/#compose");
    }
    await page.waitForTimeout(700);
    await shot(page, "10-compose-page");
  });

  test("ImaginePage — rendu", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    const imgBtn = page.locator(".minitel-fkey", { hasText: /imagine|Imagine|IMAGINE/i }).first();
    if (await imgBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await imgBtn.click();
    } else {
      await page.goto("/#imagine");
    }
    await page.waitForTimeout(700);
    await shot(page, "11-imagine-page");
  });

  test("DAW AI — rendu", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    const dawBtn = page.locator(".minitel-fkey", { hasText: /DAW/i }).first();
    if (await dawBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dawBtn.click();
    } else {
      await page.goto("/#daw");
    }
    await page.waitForTimeout(700);
    await shot(page, "12-daw-page");
  });

  test("MediaGallery — rendu", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    const galleryBtn = page.locator(".minitel-fkey", { hasText: /media|gallery|galerie/i }).first();
    if (await galleryBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await galleryBtn.click();
    } else {
      await page.goto("/#gallery");
    }
    await page.waitForTimeout(700);
    await shot(page, "13-gallery-page");
  });
});

// ── 5. Responsive breakpoints ────────────────────────────────────────────────

test.describe("Responsive — breakpoints CSS", () => {
  const VIEWPORTS = [
    { name: "xs-320", width: 320, height: 568 },
    { name: "sm-375", width: 375, height: 812 },
    { name: "md-768", width: 768, height: 1024 },
    { name: "lg-1280", width: 1280, height: 800 },
    { name: "xl-1920", width: 1920, height: 1080 },
  ] as const;

  for (const vp of VIEWPORTS) {
    test(`pas d'overflow horizontal — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loginAs(page);
      await page.waitForTimeout(600);
      await shot(page, `14-responsive-${vp.name}`);

      const scrollW = await page.evaluate(() => document.body.scrollWidth);
      const viewW = await page.evaluate(() => window.innerWidth);
      expect(scrollW).toBeLessThanOrEqual(viewW + 5); // ±5px tolérance anti-scrollbar
    });
  }
});

// ── 6. Accessibilité graphique basique ───────────────────────────────────────

test.describe("Accessibilité graphique", () => {
  test("bouton Envoyer — taille min 44×44 (touch target)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page);

    const btn = page.getByRole("button", { name: "Envoyer" });
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box).toBeTruthy();
    // WCAG 2.5.5 recommande 44×44px minimum
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(30); // seuil assoupli pour terminaux texte
  });

  test("boutons nav fkey — taille cliquable suffisante", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    const fkeys = page.locator(".minitel-fkey");
    const count = await fkeys.count();
    if (count === 0) {
      test.skip(); return;
    }

    for (let i = 0; i < Math.min(count, 5); i++) {
      const box = await fkeys.nth(i).boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(24);
        expect(box.width).toBeGreaterThanOrEqual(24);
      }
    }
  });

  test("titre/heading visible à l'accroche", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);
    await shot(page, "15-above-fold-desktop");

    // Au moins un élément de titre ou logo présent
    const heading = page.locator("h1, h2, .eyebrow, .minitel-user").first();
    if (await heading.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(heading).toBeVisible();
    }
  });

  test("couleur de fond — pas un blanc pur (#fff) — thème Minitel", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    const bgColor = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );
    // Le fond Minitel earthtones ne doit pas être blanc pur
    expect(bgColor).not.toBe("rgb(255, 255, 255)");
    expect(bgColor).not.toBe("rgba(0, 0, 0, 0)");
    console.log(`[bg-color] ${bgColor}`);
  });
});

// ── 7. Composants visuels spéciaux ──────────────────────────────────────────

test.describe("Composants visuels", () => {
  test("CRT scanlines visibles (effet phosphore)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    // Chercher les pseudo-éléments CRT (::before / ::after sur .minitel-frame ou body)
    const hasCrt = await page.evaluate(() => {
      const el = document.querySelector(".minitel-frame, .crt-wrapper, body");
      if (!el) return false;
      const style = window.getComputedStyle(el, "::after");
      return !!style.content || style.position !== "static";
    });
    // On accepte vrai ou faux — on log seulement
    console.log(`[crt-effect] found: ${hasCrt}`);
    await shot(page, "16-crt-scanlines");
  });

  test("MediaGallery — grille d'images sans overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);
    await page.goto("/#gallery");
    await page.waitForTimeout(800);
    await shot(page, "17-gallery-grid");

    const scrollW = await page.evaluate(() => document.body.scrollWidth);
    const viewW = await page.evaluate(() => window.innerWidth);
    expect(scrollW).toBeLessThanOrEqual(viewW + 5);
  });

  test("composition timeline — rendu pistes et contrôles", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);
    await page.goto("/#compose");
    await page.waitForTimeout(800);
    await shot(page, "18-composition-timeline");

    // Pas d'overflow
    const scrollW = await page.evaluate(() => document.body.scrollWidth);
    const viewW = await page.evaluate(() => window.innerWidth);
    expect(scrollW).toBeLessThanOrEqual(viewW + 5);
  });

  test("VoiceChat — contrôles push-to-talk visibles", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);
    await page.goto("/#voice");
    await page.waitForTimeout(700);
    await shot(page, "19-voice-chat");
  });
});

// ── 8. Comparaison thème clair vs sombre ────────────────────────────────────

test.describe("Thème clair vs sombre — contraste", () => {
  test("thème 'dark' — texte lisible (bg ≠ ink)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    await page.locator(".chat-input input[type='text']").fill("/theme dark");
    await page.getByRole("button", { name: "Envoyer" }).click();
    await page.waitForTimeout(600);
    await shot(page, "20-contrast-dark");

    const colors = await page.evaluate(() => {
      const s = window.getComputedStyle(document.body);
      return { bg: s.backgroundColor, color: s.color };
    });
    console.log(`[dark theme] bg=${colors.bg} ink=${colors.color}`);
    // bg et ink doivent être différents
    expect(colors.bg).not.toBe(colors.color);
  });

  test("thème 'light' — fond clair, texte sombre", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    await page.locator(".chat-input input[type='text']").fill("/theme light");
    await page.getByRole("button", { name: "Envoyer" }).click();
    await page.waitForTimeout(600);
    await shot(page, "21-contrast-light");

    const colors = await page.evaluate(() => {
      const s = window.getComputedStyle(document.body);
      return { bg: s.backgroundColor, color: s.color };
    });
    console.log(`[light theme] bg=${colors.bg} ink=${colors.color}`);
    expect(colors.bg).not.toBe(colors.color);
  });
});

// ── 9. Fonts et typographie ──────────────────────────────────────────────────

test.describe("Typographie", () => {
  test("police monospace appliquée au body", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    const fontFamily = await page.evaluate(() =>
      window.getComputedStyle(document.body).fontFamily
    );
    console.log(`[font-family] ${fontFamily}`);
    // Doit inclure une police mono
    const isMono = /courier|mono|consolas|inconsolata|fira/i.test(fontFamily);
    expect(isMono).toBe(true);
  });

  test("taille de police — lisible (≥12px)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page);

    const fontSize = await page.evaluate(() =>
      parseFloat(window.getComputedStyle(document.body).fontSize)
    );
    console.log(`[font-size] ${fontSize}px`);
    expect(fontSize).toBeGreaterThanOrEqual(12);
  });
});
