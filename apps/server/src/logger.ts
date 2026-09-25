import type { Logger, LogLevel } from "@waitron/server-kit";
export type { Logger, LogLevel };

export const LOG_LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * One structured JSON line per event, on an injected sink.
 *
 * `at`, `level` and `event` are written AFTER the caller's fields so a field named `event` cannot
 * shadow the event.
 *
 * `getThreshold` is read at EACH call so a runtime verbosity change takes effect immediately.
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
