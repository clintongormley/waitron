import type { LogLevel } from "./logger.js";

export interface VerbosityController {
  current(): LogLevel;
  raise(level: LogLevel, ttlMs: number): void;
  revertsAt(): Date | null;
}

/**
 * In-memory only, by design: a restart reverts to `defaultLevel`, because we never want debug
 * verbosity stuck on across a reboot. A pending auto-revert timer is replaced (cleared) by a
 * later `raise`, so the most recent window wins rather than the earliest expiring first.
 */
export function createVerbosityController(opts: {
  defaultLevel: LogLevel;
  now: () => Date;
}): VerbosityController {
  let level = opts.defaultLevel;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let revertsAt: Date | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    revertsAt = null;
  };
  return {
    current: () => level,
    revertsAt: () => revertsAt,
    raise(next, ttlMs) {
      clear();
      level = next;
      revertsAt = new Date(opts.now().getTime() + ttlMs);
      timer = setTimeout(() => {
        level = opts.defaultLevel;
        timer = null;
        revertsAt = null;
      }, ttlMs);
      if (typeof timer === "object" && "unref" in timer) timer.unref(); // never keep the process alive
    },
  };
}
