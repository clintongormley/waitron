import type { DrainResult } from "@waitron/fiscal";

/**
 * Wraps one boot's drain so the regime's restart reset (topology design §5.2) runs before the first
 * pass and never again. Before that first pass nothing in this process has claimed a submission, so
 * everything in flight belongs to a run that is gone; after it, a claim may be this boot's own.
 * A failed reset fails the pass without draining, and the next pass tries the reset again.
 */
export function resetBeforeFirstDrain(
  reset: (now: Date) => Promise<void>,
  drain: (now: Date) => Promise<DrainResult>,
): (now: Date) => Promise<DrainResult> {
  let resetDone: Promise<void> | undefined;
  return async (now) => {
    resetDone ??= reset(now).catch((error: unknown) => {
      resetDone = undefined;
      throw error;
    });
    await resetDone;
    return drain(now);
  };
}
