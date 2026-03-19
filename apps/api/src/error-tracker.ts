import logger from "./logger.js";

interface ErrorRecord {
  timestamp: string;
  label: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

const MAX_ERRORS = 200;
const errors: ErrorRecord[] = [];
const errorCounts = new Map<string, number>();

export function trackError(label: string, err: unknown, context?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack?.split("\n").slice(0, 3).join("\n") : undefined;

  const record: ErrorRecord = {
    timestamp: new Date().toISOString(),
    label,
    message,
    stack,
    context,
  };

  errors.push(record);
  if (errors.length > MAX_ERRORS) errors.shift();

  errorCounts.set(label, (errorCounts.get(label) || 0) + 1);

  logger.error({ label, ...context, err: message }, `[error] ${label}`);
}

export function getRecentErrors(limit = 50): ErrorRecord[] {
  return errors.slice(-limit).reverse();
}

export function getErrorCounts(): Record<string, number> {
  return Object.fromEntries(errorCounts);
}

export function resetErrors(): void {
  errors.length = 0;
  errorCounts.clear();
}
