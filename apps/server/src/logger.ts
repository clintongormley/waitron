export type LogLevel = "info" | "warn" | "error";

export type Logger = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;

/**
 * One structured JSON line per event, on an injected sink so no test writes to a real stream and no
 * test reads one back. Structured rather than prose for the same reason every error in this repo
 * carries a code: a line is read by a log collector first and a human second.
 *
 * `at`, `level` and `event` are written AFTER the caller's fields so a field named `event` cannot
 * shadow the event — the spread order is the whole guard, and `logger.test.ts` pins it.
 */
export function createLogger(sink: (line: string) => void, now: () => Date): Logger {
  return (level, event, fields) => {
    sink(`${JSON.stringify({ ...fields, at: now().toISOString(), level, event })}\n`);
  };
}
