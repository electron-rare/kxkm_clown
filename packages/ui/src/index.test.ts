import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SHELL_THEME,
  STATUS_COLORS,
  RUN_STATUS_COLORS,
  PERSONA_PALETTE,
  getPersonaColor,
  createUiCssVariables,
  UI_CSS_VARIABLES,
  RUN_STATUS_CLASSES,
  getRunStatusClass,
  publishUiCssVariables,
  createUiCssText,
  UI_THEME,
} from "./index.js";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

describe("SHELL_THEME", () => {
  it("has all expected keys", () => {
    const keys = [
      "background", "panel", "ink", "muted", "accent",
      "border", "borderLight", "fontMono", "fontDisplay", "gap", "radius",
    ];
    for (const k of keys) {
      assert.ok(k in SHELL_THEME, `missing key: ${k}`);
    }
  });
});

describe("STATUS_COLORS", () => {
  it("has info, warn, danger", () => {
    assert.equal(typeof STATUS_COLORS.info, "string");
    assert.equal(typeof STATUS_COLORS.warn, "string");
    assert.equal(typeof STATUS_COLORS.danger, "string");
  });
});

describe("RUN_STATUS_COLORS", () => {
  it("has 5 statuses", () => {
    const keys = ["running", "queued", "completed", "failed", "cancelled"];
    assert.deepEqual(Object.keys(RUN_STATUS_COLORS).sort(), keys.sort());
  });
});

describe("PERSONA_PALETTE", () => {
  it("has 8 elements", () => {
    assert.equal(PERSONA_PALETTE.length, 8);
  });

  it("all elements are hex color strings", () => {
    for (const c of PERSONA_PALETTE) {
      assert.match(c, /^#[0-9a-f]{6}$/i);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  getPersonaColor                                                   */
/* ------------------------------------------------------------------ */

describe("getPersonaColor", () => {
  it("returns a color from the palette for a nick", () => {
    const color = getPersonaColor("Merzbow");
    assert.ok(PERSONA_PALETTE.includes(color as typeof PERSONA_PALETTE[number]));
  });

  it("is deterministic (same nick -> same color)", () => {
    const a = getPersonaColor("Pharmacius");
    const b = getPersonaColor("Pharmacius");
    assert.equal(a, b);
  });

  it("wraps around the palette (9th persona maps back)", () => {
    // With a custom 3-color palette, hash % 3 always in range
    const palette = ["#aaa", "#bbb", "#ccc"];
    const color = getPersonaColor("anything", palette);
    assert.ok(palette.includes(color));
  });

  it("returns accent if palette is empty", () => {
    assert.equal(getPersonaColor("test", []), SHELL_THEME.accent);
  });

  it("handles short nicks (single char)", () => {
    const color = getPersonaColor("X");
    assert.ok(PERSONA_PALETTE.includes(color as typeof PERSONA_PALETTE[number]));
  });

  it("handles long nicks", () => {
    const long = "A".repeat(500);
    const color = getPersonaColor(long);
    assert.ok(PERSONA_PALETTE.includes(color as typeof PERSONA_PALETTE[number]));
  });
});

/* ------------------------------------------------------------------ */
/*  createUiCssVariables                                              */
/* ------------------------------------------------------------------ */

describe("createUiCssVariables", () => {
  const vars = createUiCssVariables();

  it("returns an object with --kxkm-* keys", () => {
    for (const key of Object.keys(vars)) {
      assert.ok(key.startsWith("--kxkm-"), `key ${key} missing --kxkm- prefix`);
    }
  });

  it("contains shell, status, and persona variables", () => {
    assert.ok("--kxkm-shell-background" in vars);
    assert.ok("--kxkm-status-info" in vars);
    assert.ok("--kxkm-persona-1" in vars);
  });

  it("has 27 variables (19 base + 8 persona)", () => {
    // 11 shell + 3 status + 5 run-status + 8 persona = 27
    assert.equal(Object.keys(vars).length, 27);
  });
});

/* ------------------------------------------------------------------ */
/*  UI_CSS_VARIABLES                                                  */
/* ------------------------------------------------------------------ */

describe("UI_CSS_VARIABLES", () => {
  it("equals a fresh createUiCssVariables() call", () => {
    assert.deepEqual(UI_CSS_VARIABLES, createUiCssVariables());
  });
});

/* ------------------------------------------------------------------ */
/*  getRunStatusClass                                                 */
/* ------------------------------------------------------------------ */

describe("getRunStatusClass", () => {
  for (const [status, cls] of Object.entries(RUN_STATUS_CLASSES)) {
    it(`returns "${cls}" for "${status}"`, () => {
      assert.equal(getRunStatusClass(status), cls);
    });
  }

  it('returns "status-muted" for unknown status', () => {
    assert.equal(getRunStatusClass("unknown"), "status-muted");
  });
});

/* ------------------------------------------------------------------ */
/*  publishUiCssVariables                                             */
/* ------------------------------------------------------------------ */

describe("publishUiCssVariables", () => {
  it("calls setProperty for each variable", () => {
    const calls: [string, string][] = [];
    const target = { setProperty: (n: string, v: string) => calls.push([n, v]) };
    const vars = { "--kxkm-test-a": "red", "--kxkm-test-b": "blue" };
    publishUiCssVariables(target, vars);
    assert.deepEqual(calls, [["--kxkm-test-a", "red"], ["--kxkm-test-b", "blue"]]);
  });

  it("uses default UI_CSS_VARIABLES when none specified", () => {
    const calls: [string, string][] = [];
    const target = { setProperty: (n: string, v: string) => calls.push([n, v]) };
    publishUiCssVariables(target);
    assert.equal(calls.length, Object.keys(UI_CSS_VARIABLES).length);
    assert.deepEqual(calls[0][0], Object.keys(UI_CSS_VARIABLES)[0]);
  });
});

/* ------------------------------------------------------------------ */
/*  createUiCssText                                                   */
/* ------------------------------------------------------------------ */

describe("createUiCssText", () => {
  it("generates a CSS block with :root by default", () => {
    const css = createUiCssText();
    assert.ok(css.startsWith(":root {"));
    assert.ok(css.endsWith("}"));
  });

  it("uses a custom selector if provided", () => {
    const css = createUiCssText(".my-app");
    assert.ok(css.startsWith(".my-app {"));
  });

  it("contains --kxkm-* variables", () => {
    const css = createUiCssText();
    assert.ok(css.includes("--kxkm-shell-background:"));
    assert.ok(css.includes("--kxkm-persona-1:"));
  });
});

/* ------------------------------------------------------------------ */
/*  UI_THEME aggregate                                                */
/* ------------------------------------------------------------------ */

describe("UI_THEME", () => {
  it("aggregates all sub-objects", () => {
    assert.equal(UI_THEME.shell, SHELL_THEME);
    assert.equal(UI_THEME.status, STATUS_COLORS);
    assert.equal(UI_THEME.runStatus, RUN_STATUS_COLORS);
    assert.equal(UI_THEME.personaPalette, PERSONA_PALETTE);
    assert.equal(UI_THEME.runStatusClasses, RUN_STATUS_CLASSES);
  });

  it("has typography from shell fonts", () => {
    assert.equal(UI_THEME.typography.mono, SHELL_THEME.fontMono);
    assert.equal(UI_THEME.typography.display, SHELL_THEME.fontDisplay);
  });

  it("has spacing from shell gap/radius", () => {
    assert.equal(UI_THEME.spacing.gap, SHELL_THEME.gap);
    assert.equal(UI_THEME.spacing.radius, SHELL_THEME.radius);
  });
});
