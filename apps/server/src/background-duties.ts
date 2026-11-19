import type { JobRunner } from "./job-runner.js";
import { closeAll } from "./close-all.js";

export interface BackgroundAbort {
  name: string;
  abort(): void;
}

export interface BackgroundCloser {
  name: string;
  close(): unknown;
  atStepdown?: true;
  reason?: string;
}

export interface BackgroundDuties {
  aborts: readonly BackgroundAbort[];
  closers: readonly BackgroundCloser[];
}

interface Aborter {
  abort(): void;
}

interface Stopper {
  stop(): unknown;
}

/** What `bootServer` has started by the time it returns; a duty a box did not start is undefined. */
export interface BackgroundDutyHandles {
  pendingCardController: Aborter;
  tenderRefundController: Aborter;
  pendingCardLoop: unknown;
  tenderRefundLoop: unknown;
  certificateDiagnosis: Stopper | undefined;
  unsubscribeFromChanges: () => unknown;
  jobRunner: Pick<JobRunner, "signalStepdown" | "stopJobs" | "stopServices">;
  liveEvents: { close(): unknown };
  handoverDestinationDuty: Stopper | undefined;
  chartPost: Stopper;
  spareStore: Stopper | undefined;
  spareJoin?: Stopper;
  spareSettings: Stopper | undefined;
  spareFollow?: Stopper;
  mainSilence?: Stopper;
}

/** The first call's result, or its synchronous failure, is what every later call gets. */
function once(close: () => unknown): () => unknown {
  let outcome: { result: unknown } | { failure: unknown } | undefined;
  return () => {
    if (outcome === undefined) {
      try {
        outcome = { result: close() };
      } catch (failure) {
        outcome = { failure };
      }
    }
    if ("failure" in outcome) throw outcome.failure;
    return outcome.result;
  };
}

const SIGNALLED_LOOP_WAIT =
  "waits for a loop the aborts already signalled; its running pass stops at its next check of the signal";

export function backgroundDuties(h: BackgroundDutyHandles): BackgroundDuties {
  const closers: BackgroundCloser[] = [
    {
      name: "jobRunner",
      close: () => h.jobRunner.stopJobs(),
      reason:
        "stops every job on the runner together; each job's own stepdown mark is in job-catalogue.ts",
    },

    {
      name: "pendingCardLoop",
      close: () => h.pendingCardLoop,
      reason: SIGNALLED_LOOP_WAIT,
    },
    {
      name: "tenderRefundLoop",
      close: () => h.tenderRefundLoop,
      reason: SIGNALLED_LOOP_WAIT,
    },
    { name: "certificateDiagnosis", close: () => h.certificateDiagnosis?.stop(), atStepdown: true },
    {
      name: "unsubscribeFromChanges",
      close: h.unsubscribeFromChanges,
      reason: "only stops hearing local changes",
    },
    ...(h.spareJoin === undefined
      ? []
      : [{ name: "spareJoin", close: () => h.spareJoin!.stop(), atStepdown: true as const }]),
    ...(h.spareFollow === undefined
      ? []
      : [{ name: "spareFollow", close: () => h.spareFollow!.stop(), atStepdown: true as const }]),
    { name: "spareSettings", close: () => h.spareSettings?.stop(), atStepdown: true },
    ...(h.mainSilence === undefined
      ? []
      : [
          {
            name: "mainSilence",
            close: () => h.mainSilence!.stop(),
            reason: "only asks the main box whether it answers; it writes nothing in venue.db",
          },
        ]),
    {
      name: "liveEvents",
      close: () => h.liveEvents.close(),
      reason: "only tells open screens of changes",
    },
    {
      name: "handoverDestinationDuty",
      close: () => h.handoverDestinationDuty?.stop(),
      atStepdown: true,
    },
    {
      name: "chartPost",
      close: () => h.chartPost.stop(),
      reason:
        "hands the old box a chart it may keep, once, within its own limit; it reaches no box but that one and writes nothing here",
    },
    {
      name: "spareStore",
      close: () => h.spareStore?.stop(),
      reason:
        "stops the spare's store and its listener, which admits only the main box; they serve that box's copy under pair-store/ and write nothing in venue.db",
    },
    {
      name: "jobRunnerServices",
      close: () => h.jobRunner.stopServices(),
      reason: "stops after venue.db writers",
    },
  ];
  return {
    aborts: [
      { name: "pendingCardController", abort: () => h.pendingCardController.abort() },
      { name: "tenderRefundController", abort: () => h.tenderRefundController.abort() },
      { name: "jobRunner", abort: () => h.jobRunner.signalStepdown() },
    ],
    closers: closers.map((closer) => ({ ...closer, close: once(closer.close) })),
  };
}

/**
 * Every abort in order, then every closer in order, each after the one before it settles, even when
 * one fails; then rejects with the first failure.
 */
export async function stopBackgroundDuties(
  duties: BackgroundDuties,
  onClosing?: (name: string) => void,
): Promise<void> {
  const failures: unknown[] = [];
  for (const duty of duties.aborts) {
    try {
      duty.abort();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await closeAll(
      duties.closers.map((closer) => () => {
        onClosing?.(closer.name);
        return closer.close();
      }),
    );
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw failures[0];
}

export function restrictedBackgroundDuties(returnRecords?: Stopper): BackgroundDuties {
  return {
    aborts: [],
    closers: returnRecords
      ? [{ name: "returnRecords", atStepdown: true, close: once(() => returnRecords.stop()) }]
      : [],
  };
}
