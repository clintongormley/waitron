export type LogLevel = "debug" | "info" | "warn" | "error";

export const LOG_LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type Logger = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;

/**
 * One structured JSON line per event, on an injected sink so no test writes to a real stream and no
 * test reads one back. Structured rather than prose for the same reason every error in this repo
 * carries a code: a line is read by a log collector first and a human second.
 *
 * `at`, `level` and `event` are written AFTER the caller's fields so a field named `event` cannot
 * shadow the event — the spread order is the whole guard, and `logger.test.ts` pins it.
 *
 * `getThreshold` is read at EACH call so a runtime verbosity change takes effect immediately;
 * an event whose level is below the threshold is dropped before the sink is touched. It defaults
 * to a constant `info` so the pre-existing two-arg call sites are unchanged.
 */
export function createLogger(
  sink: (line: string) => void,
  now: () => Date,
  getThreshold: () => LogLevel = () => "info",
): Logger {
  return (level, event, fields) => {
    if (LOG_LEVELS[level] < LOG_LEVELS[getThreshold()]) return;
    sink(`${JSON.stringify({ ...fields, at: now().toISOString(), level, event })}\n`);
  };
}
