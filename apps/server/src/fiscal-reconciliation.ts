import { codeOf } from "@waitron/server-kit";
import type { JobDefinition } from "./job-runner.js";
import type { Logger } from "./logger.js";

export function fiscalReconciliationJob(deps: {
  enabled(): boolean;
  pass(now: Date, signal: AbortSignal): Promise<{ nextDueAt: Date }>;
  maxWaitMs: number;
  retryMs: number;
  log: Logger;
}): JobDefinition {
  const retryMs = Math.min(deps.retryMs, deps.maxWaitMs);
  return {
    name: "fiscal.reconciliation",
    applies: deps.enabled,
    minSleepMs: 1,
    maxSleepMs: deps.maxWaitMs,
    backoff: { firstMs: retryMs, maxMs: retryMs },
    async pass({ now, signal }) {
      try {
        return await deps.pass(now, signal);
      } catch (error) {
        deps.log("warn", "fiscal.reconciliation_failed", { errorCode: codeOf(error) });
        throw error;
      }
    },
  };
}
