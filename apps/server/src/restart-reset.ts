import { emptyDrainResult, type DrainResult } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";

/**
 * Wraps one boot's drain so the regime's restart reset (topology design §5.2) runs before the first
 * pass and never again. Before that first pass nothing in this process has claimed a submission, so
 * everything in flight belongs to a run that is gone; after it, a claim may be this boot's own.
 *
 * A failed reset does not drain. It logs `drain.restart_reset_failed` once, and every pass waiting
 * on that reset reports it in `skipped` with `nextDueAt` `skipRetryMs` later, the way the drain
 * reports its own failures; `tenantsWithWork` stays 0 because no certificate was read. The next
 * pass tries the reset again.
 */
export function resetBeforeFirstDrain({
  reset,
  drain,
  skipRetryMs,
  log,
}: {
  reset: (now: Date) => Promise<void>;
  drain: (now: Date) => Promise<DrainResult>;
  skipRetryMs: number;
  log: Logger;
}): (now: Date) => Promise<DrainResult> {
  // Resolves to `null` once the reset succeeded, or to the failed attempt's error code.
  let resetDone: Promise<string | null> | undefined;
  return async (now) => {
    resetDone ??= reset(now).then(
      () => null,
      (error: unknown) => {
        resetDone = undefined;
        const errorCode = codeOf(error);
        log("error", "drain.restart_reset_failed", { errorCode });
        return errorCode;
      },
    );
    const failedCode = await resetDone;
    if (failedCode === null) return drain(now);
    const result = emptyDrainResult();
    result.skipped.push({ errorCode: failedCode });
    result.nextDueAt = new Date(now.getTime() + skipRetryMs);
    return result;
  };
}
