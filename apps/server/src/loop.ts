import { setTimeout as delay } from "node:timers/promises";

/**
 * How long to sleep before the next pass.
 *
 * `null` means no work exists anywhere, which sleeps the ceiling rather than forever: the ledger can
 * gain work from outside this process at any moment (a till writing a sale, an operator provisioning
 * a taxpayer), so "nothing is due" is a fact with a shelf life.
 */
export function sleepMsFor(
  nextDueAt: Date | null,
  now: Date,
  minTickMs: number,
  maxTickMs: number,
): number {
  if (nextDueAt === null) return maxTickMs;
  return clampSleepMs(nextDueAt.getTime() - now.getTime(), minTickMs, maxTickMs);
}

export function clampSleepMs(wait: number, minTickMs: number, maxTickMs: number): number {
  return Math.min(maxTickMs, Math.max(minTickMs, wait));
}

/** Only shutdown aborts are silenced. Other errors reach the caller. */
export async function realSleep(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    /* v8 ignore start */
    // Unreachable through this repo's own call sites; a rethrow, not a silent drop, in case that ever
    // stops being true.
    if (!signal.aborted) throw error;
    /* v8 ignore stop */
  }
}
