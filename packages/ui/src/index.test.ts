import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SHELL_THEME, STATUS_COLORS, RUN_STATUS_COLORS, PERSONA_PALETTE,
  getPersonaColor, createUiCssVariables, getRunStatusClass,
  publishUiCssVariables, createUiCssText, UI_THEME, UI_CSS_VARIABLES,
} from "./index.js";

describe("@kxkm/ui", () => {
  describe("SHELL_THEME", () => {
    it("has all required keys", () => {
      assert.ok(SHELL_THEME.background);
      assert.ok(SHELL_THEME.ink);
      assert.ok(SHELL_THEME.accent);
      assert.ok(SHELL_THEME.fontMono);
    });
  });

  describe("getPersonaColor", () => {
    it("returns a string from PERSONA_PALETTE", () => {
      const color = getPersonaColor("Pharmacius");
      assert.ok(PERSONA_PALETTE.includes(color as any));
    });
    it("is deterministic", () => {
      assert.equal(getPersonaColor("Sherlock"), getPersonaColor("Sherlock"));
    });
    it("returns accent for empty palette", () => {
      assert.equal(getPersonaColor("test", []), SHELL_THEME.accent);
    });
    it("distributes across palette", () => {
      const colors = new Set(["A","B","C","D","E","F","G","H"].map(n => getPersonaColor(n)));
      assert.ok(colors.size >= 3, `Expected >=3 distinct colors, got ${colors.size}`);
    });
  });

  describe("createUiCssVariables", () => {
    it("returns object with CSS custom properties", () => {
      const vars = createUiCssVariables();
      assert.ok(vars["--kxkm-shell-background"]);
      assert.ok(vars["--kxkm-shell-accent"]);
      assert.ok(vars["--kxkm-persona-1"]);
    });
    it("includes all persona palette entries", () => {
      const vars = createUiCssVariables();
      for (let i = 1; i <= PERSONA_PALETTE.length; i++) {
        assert.ok(vars[`--kxkm-persona-${i}`]);
      }
    });
  });

  describe("getRunStatusClass", () => {
    it("maps known statuses", () => {
      assert.equal(getRunStatusClass("running"), "status-running");
      assert.equal(getRunStatusClass("failed"), "status-failed");
    });
    it("returns status-muted for unknown", () => {
      assert.equal(getRunStatusClass("unknown"), "status-muted");
    });
  });

  describe("publishUiCssVariables", () => {
    it("calls setProperty for each variable", () => {
      const calls: [string, string][] = [];
      const target = { setProperty: (n: string, v: string) => calls.push([n, v]) };
      publishUiCssVariables(target);
      assert.ok(calls.length > 10);
      assert.ok(calls.some(([n]) => n === "--kxkm-shell-accent"));
    });
  });

  describe("createUiCssText", () => {
    it("generates valid CSS block", () => {
      const css = createUiCssText();
      assert.ok(css.startsWith(":root {"));
      assert.ok(css.includes("--kxkm-shell-background"));
      assert.ok(css.endsWith("}"));
    });
    it("accepts custom selector", () => {
      const css = createUiCssText(".minitel");
      assert.ok(css.startsWith(".minitel {"));
    });
  });

  describe("UI_THEME", () => {
    it("aggregates all theme objects", () => {
      assert.ok(UI_THEME.shell);
      assert.ok(UI_THEME.status);
      assert.ok(UI_THEME.personaPalette);
      assert.ok(UI_THEME.typography);
    });
  });
});
