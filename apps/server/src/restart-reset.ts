import { emptyDrainResult, type DrainResult } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";

/**
 * Wraps one boot's drain so the regime's restart reset (topology design §5.2) runs before the first
 * pass that drains, and is retried on later passes until it succeeds. Until the reset succeeds this
 * wrapper has run no drain, so no claim in flight is one of its own; after it, a claim may be.
 *
 * A failed reset, whether its promise rejects or `reset` throws before returning one, does not
 * drain. It logs `drain.restart_reset_failed` once, and every pass waiting on that attempt reports
 * it in `skipped` with `nextDueAt` `skipRetryMs` later, the way the drain reports its own failures;
 * `pass.ts` logs `drain.tenant_skipped` for that entry, and leaves the awaiting-certificate flag as
 * it was because `tenantsWithWork` is 0 when the drain did not run. The next pass tries the reset
 * again.
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
    resetDone ??= Promise.resolve()
      .then(() => reset(now))
      .then(
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
