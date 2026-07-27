import { setTimeout as delay } from "node:timers/promises";
import type { PassReport } from "./pass.js";
import { codeOf } from "./error-code.js";
import type { Logger } from "./logger.js";

/**
 * How long to sleep before the next pass.
 *
 * `null` means no work exists anywhere, which sleeps the ceiling rather than forever: the ledger can
 * gain work from outside this process at any moment (a till writing a sale, an operator provisioning
 * a tenant), so "nothing is due" is a fact with a shelf life.
 */
export function sleepMsFor(
  nextDueAt: Date | null,
  now: Date,
  minTickMs: number,
  maxTickMs: number,
): number {
  if (nextDueAt === null) return maxTickMs;
  const wait = nextDueAt.getTime() - now.getTime();
  return Math.min(maxTickMs, Math.max(minTickMs, wait));
}

export interface LoopDeps {
  pass: (now: Date) => Promise<PassReport>;
  now: () => Date;
  /** Injected so the suite asserts durations instead of waiting them out. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  minTickMs: number;
  maxTickMs: number;
  log: Logger;
  onPass?: (report: PassReport, at: Date) => void;
}

/**
 * Real sleep, interruptible by the shutdown signal so SIGTERM does not wait out an hour.
 *
 * Narrow on purpose: only the abort is silenced. Anything else rethrows rather than vanishing the
 * way a bare `catch {}` would vanish it — `runLoop`'s own try/catch around calling this is what
 * gives an unforeseen sleep failure the same visibility an unforeseen pass failure gets, so this
 * function does not need a logger of its own to stay honest.
 */
export async function realSleep(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    /* v8 ignore start */
    // Unreachable through this repo's own call sites: `ms` is always the clamped, positive-integer
    // output of `sleepMsFor`, and `signal` is always a genuine AbortSignal per `LoopDeps`'s typing,
    // and node:timers/promises' setTimeout has no other rejection path for legitimate arguments
    // (verified directly against this Node build — a negative or NaN ms clamps to 1ms and resolves
    // rather than rejecting). Kept as a rethrow, not a silent drop, in case that ever stops being
    // true, or a differently-behaved `sleep` is injected in `LoopDeps`'s place.
    if (!signal.aborted) throw error;
    /* v8 ignore stop */
  }
}

export async function runLoop(deps: LoopDeps): Promise<void> {
  while (!deps.signal.aborted) {
    const startedAt = deps.now();
    let nextDueAt: Date | null;
    try {
      const report = await deps.pass(startedAt);
      nextDueAt = report.nextDueAt;
      try {
        // `onPass` is a side observer (health state), not a duty. Its own try/catch keeps a bug in
        // it from being mislabeled as a pass failure, and — since the pass itself already
        // succeeded — from clobbering the real `nextDueAt` the pass computed with a false
        // due-immediately retry.
        deps.onPass?.(report, startedAt);
      } catch (error) {
        deps.log("error", "onPass.threw", { errorCode: codeOf(error) });
      }
    } catch (error) {
      // `runPass` contains each duty's own failure, so reaching here means something unforeseen.
      // Exiting would breach the hourly duty in precisely the case nobody predicted, so the loop
      // logs and retries on its floor.
      deps.log("error", "pass.threw", { errorCode: codeOf(error) });
      nextDueAt = startedAt;
    }
    // Checked AFTER the pass: a signal arriving mid-pass lets the pass finish (the duties are
    // crash-safe, but a clean finish still beats abandoning a partially-submitted batch) and skips
    // the sleep entirely.
    if (deps.signal.aborted) break;
    const sleepMs = sleepMsFor(nextDueAt, deps.now(), deps.minTickMs, deps.maxTickMs);
    deps.log("info", "loop.sleeping", { sleepMs });
    try {
      await deps.sleep(sleepMs, deps.signal);
    } catch (error) {
      // A well-behaved `sleep` resolves — never rejects — for the ordinary abort; see `realSleep`.
      // A rejection reaching here is therefore itself unforeseen, structurally the same case as a
      // pass that throws, and contained the same way: log and go around again rather than let a
      // sleep failure end the loop and, with it, the hourly duty.
      deps.log("error", "sleep.threw", { errorCode: codeOf(error) });
    }
  }
  deps.log("info", "loop.stopped");
}
