import { codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { realSleep, sleepMsFor } from "./loop.js";

export function startFiscalReconciliation(deps: {
  enabled(): boolean;
  now(): Date;
  pass(now: Date): Promise<{ nextDueAt: Date }>;
  maxWaitMs: number;
  retryMs: number;
  log: Logger;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): { stop(): Promise<void> } {
  const controller = new AbortController();
  const sleep = deps.sleep ?? realSleep;
  const loop = run();
  return {
    stop: async () => {
      controller.abort();
      await loop;
    },
  };

  async function run(): Promise<void> {
    while (!controller.signal.aborted) {
      let nextDueAt: Date | null = null;
      try {
        if (deps.enabled()) nextDueAt = (await deps.pass(deps.now())).nextDueAt;
      } catch (error) {
        deps.log("warn", "fiscal.reconciliation_failed", { errorCode: codeOf(error) });
        nextDueAt = new Date(deps.now().getTime() + deps.retryMs);
      }
      if (controller.signal.aborted) break;
      try {
        await sleep(sleepMsFor(nextDueAt, deps.now(), 1, deps.maxWaitMs), controller.signal);
      } catch (error) {
        deps.log("warn", "fiscal.reconciliation_sleep_failed", { errorCode: codeOf(error) });
      }
    }
  }
}
