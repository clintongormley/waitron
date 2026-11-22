import { nodeId } from "@waitron/shared";
import { cardFollowUpJob, type CardFollowUpSteps } from "../card-follow-up.js";
import { createJobRunner } from "../job-runner.js";
import type { Logger } from "../logger.js";
import { recoverTenderRefunds } from "../tender-refund-recovery.js";
import { startTenderRefundResolvers, stopTenderRefundResolvers } from "../tender-refund-sends.js";
import type { TenderRefundDeps } from "../tender-refunds.js";

export function testCardFollowUp(
  steps: Partial<CardFollowUpSteps>,
  deps: Partial<Parameters<typeof cardFollowUpJob>[1]> = {},
) {
  return cardFollowUpJob(
    {
      sweepProviders: async () => [],
      owners: () => ({
        nodeId: nodeId("11111111-1111-4111-8111-111111111111"),
        takenOverFrom: [],
        unowned: true,
      }),
      settle: async () => ({ received: 0, failed: 0, pending: 0, errors: [] }),
      recoverRefunds: async () => ({ pending: 0, nextDueAt: null }),
      startRefundResolvers: () => {},
      stopRefundResolvers: async () => [],
      ...steps,
    },
    {
      getRole: () => "primary",
      recoversRefunds: true,
      admissionReady: () => true,
      log: () => {},
      ...deps,
    },
  );
}

export async function runRefundFollowUp(
  deps: TenderRefundDeps & {
    signal: AbortSignal;
    isPrimary: () => boolean;
    log: Logger;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
) {
  const runner = createJobRunner({
    now: () => deps.clock.now().instant,
    log: deps.log,
    delay: deps.sleep,
    subscribe: () => () => {},
  });
  const stop = () => runner.signalStepdown();
  deps.signal.addEventListener("abort", stop, { once: true });
  if (deps.signal.aborted) stop();
  try {
    runner.add(
      testCardFollowUp(
        {
          recoverRefunds: (stopSignal) => recoverTenderRefunds({ ...deps, stopSignal }),
          startRefundResolvers: () => startTenderRefundResolvers(deps.db),
          stopRefundResolvers: () => stopTenderRefundResolvers(deps.db),
        },
        {
          getRole: () => (deps.isPrimary() ? "primary" : "secondary"),
          admissionReady: () => deps.admission.snapshot().state === "ready",
          log: deps.log,
        },
      ),
    );
    if (!deps.signal.aborted)
      await new Promise<void>((resolve) =>
        deps.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    await runner.stopJobs();
  } finally {
    deps.signal.removeEventListener("abort", stop);
  }
}
