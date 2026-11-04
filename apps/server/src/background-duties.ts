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
  controller: Aborter;
  pendingCardController: Aborter;
  cloudController: Aborter;
  invoiceEmailController: Aborter;
  attendanceController: Aborter;
  certificateReminderController: Aborter | undefined;
  tenderRefundController: Aborter;
  pendingCardLoop: unknown;
  tenderRefundLoop: unknown;
  attendanceLoop: unknown;
  attendanceEmailLoop: unknown;
  certificateReminderLoop: unknown;
  certificateDiagnosis: Stopper | undefined;
  fiscalReconciliation?: Stopper;
  invoiceEmailLoop: unknown;
  cloudWorker: unknown;
  cloudSnapshots: unknown;
  suggestionLoop: unknown;
  unsubscribeFromChanges: () => unknown;
  stopSealingNodeCommits: () => unknown;
  sealedState: { settled(): unknown };
  menuActivation: Stopper;
  appendOnlyWatch: Stopper;
  freeSpaceWatch: Stopper;
  boxEmails: Stopper;
  liveEvents: { close(): unknown };
  tunnelController: Aborter;
  loop: unknown;
  tunnelWorker: Promise<unknown> | undefined;
  backupSupervisor: Stopper;
  demoPrinterLoop: Stopper | undefined;
  clockWatch: Stopper;
  streamHost: Stopper;
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

const LOOP_WAIT =
  "waits for a loop the aborts already signalled; a pass already running continues until it ends";
const SIGNALLED_LOOP_WAIT =
  "waits for a loop the aborts already signalled; its running pass stops at its next check of the signal";

export function backgroundDuties(h: BackgroundDutyHandles): BackgroundDuties {
  const closers: BackgroundCloser[] = [
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
    {
      name: "attendanceLoop",
      close: () => h.attendanceLoop,
      reason: LOOP_WAIT,
    },
    {
      name: "attendanceEmailLoop",
      close: () => h.attendanceEmailLoop,
      reason: LOOP_WAIT,
    },
    {
      name: "certificateReminderLoop",
      close: () => h.certificateReminderLoop,
      reason: LOOP_WAIT,
    },
    { name: "certificateDiagnosis", close: () => h.certificateDiagnosis?.stop(), atStepdown: true },
    {
      name: "invoiceEmailLoop",
      close: () => h.invoiceEmailLoop,
      reason: LOOP_WAIT,
    },
    {
      name: "cloudWorker",
      close: () => h.cloudWorker,
      reason: LOOP_WAIT,
    },
    {
      name: "cloudSnapshots",
      close: () => h.cloudSnapshots,
      reason: LOOP_WAIT,
    },
    {
      name: "suggestionLoop",
      close: () => h.suggestionLoop,
      reason: LOOP_WAIT,
    },
    {
      name: "unsubscribeFromChanges",
      close: h.unsubscribeFromChanges,
      reason: "only stops hearing local changes",
    },
    {
      name: "stopSealingNodeCommits",
      close: h.stopSealingNodeCommits,
      reason:
        "removes the hook that refreshes the sealed-state row in venue.db after a node.db commit; local, sends nothing outside the box",
    },
    // A refresh still running would otherwise run against the closed store and log a failure.
    {
      name: "sealedState",
      close: () => h.sealedState.settled(),
      // Called early, its result would be kept and a later refresh never awaited.
      reason: "waits for a local refresh, which must be awaited at close, not before",
    },
    ...(h.fiscalReconciliation === undefined
      ? []
      : [
          {
            name: "fiscalReconciliation",
            close: () => h.fiscalReconciliation!.stop(),
            atStepdown: true as const,
          },
        ]),
    { name: "menuActivation", close: () => h.menuActivation.stop(), atStepdown: true },
    {
      name: "appendOnlyWatch",
      close: () => h.appendOnlyWatch.stop(),
      reason:
        "checks the append-only triggers and, on a mismatch, records a refusal and restarts the box; local, sends nothing outside the box",
    },
    {
      name: "freeSpaceWatch",
      close: () => h.freeSpaceWatch.stop(),
      reason:
        "on low space puts back the spare file and deletes old local backup archives; local, sends nothing outside the box",
    },
    { name: "boxEmails", close: () => h.boxEmails.stop(), atStepdown: true },
    {
      name: "liveEvents",
      close: () => h.liveEvents.close(),
      reason: "only tells open screens of changes",
    },
    {
      name: "tunnelController",
      close: () => h.tunnelController.abort(),
      reason: "the tunnel only carries requests, which the gate refuses",
    },
    {
      name: "loop",
      close: () => h.loop,
      reason: SIGNALLED_LOOP_WAIT,
    },
    {
      name: "tunnelWorker",
      close: () => h.tunnelWorker?.catch(() => {}),
      reason: "waits for the tunnel, which only carries requests",
    },
    {
      name: "backupSupervisor",
      close: () => h.backupSupervisor.stop(),
      reason: "stops after the sending loop has finished",
    },
    { name: "demoPrinterLoop", close: () => h.demoPrinterLoop?.stop(), atStepdown: true },
    { name: "clockWatch", close: () => h.clockWatch.stop(), atStepdown: true },
    // Litestream writes venue.db, so its stop is awaited before the store closes.
    {
      name: "streamHost",
      close: () => h.streamHost.stop(),
      reason: "stops last, after anything that may still write venue.db",
    },
  ];
  return {
    aborts: [
      { name: "controller", abort: () => h.controller.abort() },
      { name: "pendingCardController", abort: () => h.pendingCardController.abort() },
      { name: "cloudController", abort: () => h.cloudController.abort() },
      { name: "invoiceEmailController", abort: () => h.invoiceEmailController.abort() },
      { name: "attendanceController", abort: () => h.attendanceController.abort() },
      {
        name: "certificateReminderController",
        abort: () => h.certificateReminderController?.abort(),
      },
      { name: "tenderRefundController", abort: () => h.tenderRefundController.abort() },
    ],
    closers: closers.map((closer) => ({ ...closer, close: once(closer.close) })),
  };
}

/**
 * Every abort in order, then every closer in order, each after the one before it settles, even when
 * one fails; then rejects with the first failure.
 */
export async function stopBackgroundDuties(duties: BackgroundDuties): Promise<void> {
  const failures: unknown[] = [];
  for (const duty of duties.aborts) {
    try {
      duty.abort();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await closeAll(duties.closers.map((closer) => closer.close));
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw failures[0];
}
