import { realSleep } from "./loop.js";

export interface LoopWaker {
  /** Ends the sleep under way, or the next one if none is, no sooner than `minTickMs` after that
   * sleep began. One wake is spent by one sleep. */
  wake(): void;
  /** `LoopDeps["sleep"]`: ends at `ms`, at a wake (as above), or at once when `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export function createLoopWaker(deps: {
  minTickMs: number;
  /** Defaults to `realSleep`. */
  delay?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** A monotonic clock in ms; defaults to `performance.now`. */
  monotonicMs?: () => number;
}): LoopWaker {
  const delay = deps.delay ?? realSleep;
  const clock = deps.monotonicMs ?? (() => performance.now());
  let woken = false;
  let interrupt: AbortController | undefined;

  async function pause(ms: number, signal: AbortSignal, also?: AbortSignal): Promise<void> {
    try {
      await delay(ms, also ? AbortSignal.any([signal, also]) : signal);
    } catch (error) {
      if (!signal.aborted && !also?.aborted) throw error;
    }
  }

  async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const startedAt = clock();
    const controller = new AbortController();
    interrupt = controller;
    if (woken) controller.abort();
    try {
      await pause(ms, signal, controller.signal);
      if (signal.aborted || !controller.signal.aborted) return;
      const hold = Math.min(ms, deps.minTickMs) - (clock() - startedAt);
      if (hold > 0) await pause(hold, signal);
    } finally {
      // Cleared after the hold, so a wake given during the hold is spent with this sleep.
      woken = false;
      interrupt = undefined;
    }
  }

  return {
    wake(): void {
      woken = true;
      interrupt?.abort();
    },
    sleep,
  };
}
