import type { NodeEngineOverview } from "@kxkm/core";

export function formatOverviewLine(overview: NodeEngineOverview): string {
  return [
    `workers=${overview.queue.activeWorkers}/${overview.queue.desiredWorkers}`,
    `queued=${overview.queue.queuedRuns}`,
    `running=${overview.queue.runningRuns}`,
    `graphs=${overview.registry.graphs}`,
    `models=${overview.registry.models}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

export const ansi = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  white: (s: string) => `\x1b[37m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Status indicator — colored dot
// ---------------------------------------------------------------------------

export function statusDot(ok: boolean): string {
  return ok ? ansi.green("●") : ansi.red("●");
}

// ---------------------------------------------------------------------------
// Table formatter — fixed-width columns with header separator
// ---------------------------------------------------------------------------

export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] || "").length))
  );

  function padCell(text: string, width: number): string {
    const visible = stripAnsi(text).length;
    return text + " ".repeat(Math.max(0, width - visible));
  }

  const headerLine = headers.map((h, i) => padCell(h, widths[i])).join("  ");
  const separator = widths.map((w) => "─".repeat(w)).join("──");
  const body = rows
    .map((row) => row.map((cell, i) => padCell(cell || "", widths[i])).join("  "))
    .join("\n");

  return [ansi.bold(headerLine), separator, body].join("\n");
}

// ---------------------------------------------------------------------------
// Box drawing — Unicode box around title + content lines
// ---------------------------------------------------------------------------

export function drawBox(title: string, lines: string[], width?: number): string {
  const contentWidth =
    width ||
    Math.max(
      stripAnsi(title).length + 4,
      ...lines.map((l) => stripAnsi(l).length + 2)
    );
  const inner = contentWidth - 2; // inside the box walls

  function padLine(text: string): string {
    const visible = stripAnsi(text).length;
    return "║ " + text + " ".repeat(Math.max(0, inner - visible - 1)) + "║";
  }

  const titlePadded = (() => {
    const visible = stripAnsi(title).length;
    const totalPad = inner - visible;
    const left = Math.floor(totalPad / 2);
    const right = totalPad - left;
    return "║" + " ".repeat(left) + title + " ".repeat(right) + "║";
  })();

  return [
    "╔" + "═".repeat(inner) + "╗",
    titlePadded,
    "╠" + "═".repeat(inner) + "╣",
    ...lines.map(padLine),
    "╚" + "═".repeat(inner) + "╝",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Strip ANSI escape codes (for width calculations)
// ---------------------------------------------------------------------------

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
