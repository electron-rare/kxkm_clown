export const SHELL_THEME = {
  background: "#f6f0df",
  panel: "rgba(255, 249, 237, 0.95)",
  ink: "#20170f",
  muted: "#6f5d4f",
  accent: "#c84c0c",
  border: "#2f2218",
  borderLight: "rgba(47, 34, 24, 0.2)",
  fontMono: '"Courier New", Courier, monospace',
  fontDisplay: '"Courier New", Courier, monospace',
  gap: "16px",
  radius: "0",
} as const;

export const STATUS_COLORS = {
  info: "#2c6e49",
  warn: "#c77d00",
  danger: "#b00020",
} as const;

export const RUN_STATUS_COLORS = {
  running: STATUS_COLORS.info,
  queued: STATUS_COLORS.warn,
  completed: STATUS_COLORS.info,
  failed: STATUS_COLORS.danger,
  cancelled: SHELL_THEME.muted,
} as const;

export const PERSONA_PALETTE = [
  "#c84c0c",
  "#2c6e49",
  "#0f766e",
  "#7c3aed",
  "#b45309",
  "#1d4ed8",
  "#be185d",
  "#0f5b78",
] as const;

export type UiCssVariables = Record<string, string>;

export interface UiCssVariableTarget {
  setProperty(name: string, value: string): void;
}

export function getPersonaColor(nick: string, palette: readonly string[] = PERSONA_PALETTE): string {
  if (palette.length === 0) return SHELL_THEME.accent;

  let hash = 0;
  for (let i = 0; i < nick.length; i += 1) {
    hash = (hash * 31 + nick.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function createUiCssVariables(): UiCssVariables {
  const vars: UiCssVariables = {
    "--kxkm-shell-background": SHELL_THEME.background,
    "--kxkm-shell-panel": SHELL_THEME.panel,
    "--kxkm-shell-ink": SHELL_THEME.ink,
    "--kxkm-shell-muted": SHELL_THEME.muted,
    "--kxkm-shell-accent": SHELL_THEME.accent,
    "--kxkm-shell-border": SHELL_THEME.border,
    "--kxkm-shell-border-light": SHELL_THEME.borderLight,
    "--kxkm-font-mono": SHELL_THEME.fontMono,
    "--kxkm-font-display": SHELL_THEME.fontDisplay,
    "--kxkm-gap": SHELL_THEME.gap,
    "--kxkm-radius": SHELL_THEME.radius,
    "--kxkm-status-info": STATUS_COLORS.info,
    "--kxkm-status-warn": STATUS_COLORS.warn,
    "--kxkm-status-danger": STATUS_COLORS.danger,
    "--kxkm-status-running": RUN_STATUS_COLORS.running,
    "--kxkm-status-queued": RUN_STATUS_COLORS.queued,
    "--kxkm-status-completed": RUN_STATUS_COLORS.completed,
    "--kxkm-status-failed": RUN_STATUS_COLORS.failed,
    "--kxkm-status-cancelled": RUN_STATUS_COLORS.cancelled,
  };

  PERSONA_PALETTE.forEach((color, index) => {
    vars[`--kxkm-persona-${index + 1}`] = color;
  });

  return vars;
}

export const UI_CSS_VARIABLES = createUiCssVariables();

export const RUN_STATUS_CLASSES = {
  running: "status-running",
  queued: "status-queued",
  completed: "status-completed",
  failed: "status-failed",
  cancelled: "status-cancelled",
} as const;

export function getRunStatusClass(status: string): string {
  return RUN_STATUS_CLASSES[status as keyof typeof RUN_STATUS_CLASSES] || "status-muted";
}

export function publishUiCssVariables(
  target: UiCssVariableTarget,
  variables: UiCssVariables = UI_CSS_VARIABLES,
): void {
  for (const [name, value] of Object.entries(variables)) {
    target.setProperty(name, value);
  }
}

export function createUiCssText(
  selector = ":root",
  variables: UiCssVariables = UI_CSS_VARIABLES,
): string {
  const lines = Object.entries(variables)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");

  return `${selector} {\n${lines}\n}`;
}

export const UI_THEME = {
  shell: SHELL_THEME,
  status: STATUS_COLORS,
  runStatus: RUN_STATUS_COLORS,
  personaPalette: PERSONA_PALETTE,
  runStatusClasses: RUN_STATUS_CLASSES,
  typography: {
    mono: SHELL_THEME.fontMono,
    display: SHELL_THEME.fontDisplay,
  },
  spacing: {
    gap: SHELL_THEME.gap,
    radius: SHELL_THEME.radius,
  },
} as const;
