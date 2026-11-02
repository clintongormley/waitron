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

export function backgroundDuties(h: BackgroundDutyHandles): BackgroundDuties {
  const closers: { name: string; close(): unknown }[] = [
    { name: "pendingCardLoop", close: () => h.pendingCardLoop },
    { name: "tenderRefundLoop", close: () => h.tenderRefundLoop },
    { name: "attendanceLoop", close: () => h.attendanceLoop },
    { name: "attendanceEmailLoop", close: () => h.attendanceEmailLoop },
    { name: "certificateReminderLoop", close: () => h.certificateReminderLoop },
    { name: "certificateDiagnosis", close: () => h.certificateDiagnosis?.stop() },
    { name: "invoiceEmailLoop", close: () => h.invoiceEmailLoop },
    { name: "cloudWorker", close: () => h.cloudWorker },
    { name: "cloudSnapshots", close: () => h.cloudSnapshots },
    { name: "suggestionLoop", close: () => h.suggestionLoop },
    { name: "unsubscribeFromChanges", close: h.unsubscribeFromChanges },
    { name: "stopSealingNodeCommits", close: h.stopSealingNodeCommits },
    // A refresh still running would otherwise run against the closed store and log a failure.
    { name: "sealedState", close: () => h.sealedState.settled() },
    { name: "menuActivation", close: () => h.menuActivation.stop() },
    { name: "appendOnlyWatch", close: () => h.appendOnlyWatch.stop() },
    { name: "freeSpaceWatch", close: () => h.freeSpaceWatch.stop() },
    { name: "boxEmails", close: () => h.boxEmails.stop() },
    { name: "liveEvents", close: () => h.liveEvents.close() },
    { name: "tunnelController", close: () => h.tunnelController.abort() },
    { name: "loop", close: () => h.loop },
    { name: "tunnelWorker", close: () => h.tunnelWorker?.catch(() => {}) },
    { name: "backupSupervisor", close: () => h.backupSupervisor.stop() },
    { name: "demoPrinterLoop", close: () => h.demoPrinterLoop?.stop() },
    { name: "clockWatch", close: () => h.clockWatch.stop() },
    // Litestream writes venue.db, so its stop is awaited before the store closes.
    { name: "streamHost", close: () => h.streamHost.stop() },
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

/** Every abort in order, then every closer in order, each after the one before it settles. */
export async function stopBackgroundDuties(duties: BackgroundDuties): Promise<void> {
  for (const duty of duties.aborts) duty.abort();
  await closeAll(duties.closers.map((closer) => closer.close));
}
