import { describe, expect, it } from "vitest";
import {
  backgroundDuties,
  stopBackgroundDuties,
  type BackgroundDutyHandles,
} from "./background-duties.js";

const ABORTS = [
  "controller",
  "pendingCardController",
  "cloudController",
  "invoiceEmailController",
  "attendanceController",
  "certificateReminderController",
  "tenderRefundController",
];

const CLOSERS = [
  "pendingCardLoop",
  "tenderRefundLoop",
  "attendanceLoop",
  "attendanceEmailLoop",
  "certificateReminderLoop",
  "certificateDiagnosis",
  "invoiceEmailLoop",
  "cloudWorker",
  "cloudSnapshots",
  "suggestionLoop",
  "unsubscribeFromChanges",
  "stopSealingNodeCommits",
  "sealedState",
  "menuActivation",
  "appendOnlyWatch",
  "freeSpaceWatch",
  "boxEmails",
  "liveEvents",
  "tunnelController",
  "loop",
  "tunnelWorker",
  "backupSupervisor",
  "demoPrinterLoop",
  "clockWatch",
  "streamHost",
];

/** Every handle records its own name when the duty table touches it. */
function recordingHandles(
  calls: string[],
  overrides: Partial<BackgroundDutyHandles> = {},
): BackgroundDutyHandles {
  const aborter = (name: string) => ({ abort: () => void calls.push(`abort ${name}`) });
  const awaited = (name: string) =>
    ({
      then: (resolve: () => void) => {
        calls.push(`await ${name}`);
        resolve();
      },
    }) as unknown as Promise<void>;
  const stopper = (name: string) => ({ stop: () => void calls.push(`stop ${name}`) });
  return {
    controller: aborter("controller"),
    pendingCardController: aborter("pendingCardController"),
    cloudController: aborter("cloudController"),
    invoiceEmailController: aborter("invoiceEmailController"),
    attendanceController: aborter("attendanceController"),
    certificateReminderController: aborter("certificateReminderController"),
    tenderRefundController: aborter("tenderRefundController"),
    pendingCardLoop: awaited("pendingCardLoop"),
    tenderRefundLoop: awaited("tenderRefundLoop"),
    attendanceLoop: awaited("attendanceLoop"),
    attendanceEmailLoop: awaited("attendanceEmailLoop"),
    certificateReminderLoop: awaited("certificateReminderLoop"),
    certificateDiagnosis: stopper("certificateDiagnosis"),
    invoiceEmailLoop: awaited("invoiceEmailLoop"),
    cloudWorker: awaited("cloudWorker"),
    cloudSnapshots: awaited("cloudSnapshots"),
    suggestionLoop: awaited("suggestionLoop"),
    unsubscribeFromChanges: () => void calls.push("call unsubscribeFromChanges"),
    stopSealingNodeCommits: () => void calls.push("call stopSealingNodeCommits"),
    sealedState: { settled: () => void calls.push("settled sealedState") },
    menuActivation: stopper("menuActivation"),
    appendOnlyWatch: stopper("appendOnlyWatch"),
    freeSpaceWatch: stopper("freeSpaceWatch"),
    boxEmails: stopper("boxEmails"),
    liveEvents: { close: () => void calls.push("close liveEvents") },
    tunnelController: { abort: () => void calls.push("abort tunnelController") },
    loop: awaited("loop"),
    tunnelWorker: {
      catch: () => {
        calls.push("catch tunnelWorker");
        return Promise.resolve();
      },
    } as unknown as Promise<void>,
    backupSupervisor: stopper("backupSupervisor"),
    demoPrinterLoop: stopper("demoPrinterLoop"),
    clockWatch: stopper("clockWatch"),
    streamHost: stopper("streamHost"),
    ...overrides,
  };
}

describe("background duties", () => {
  it("holds the aborts and the closers in exactly today's shutdown order", () => {
    const duties = backgroundDuties(recordingHandles([]));
    expect(duties.aborts.map((a) => a.name)).toEqual(ABORTS);
    expect(duties.closers.map((c) => c.name)).toEqual(CLOSERS);
  });

  it("stops every duty in that order: each abort, then each closer on its own handle", async () => {
    const calls: string[] = [];
    await stopBackgroundDuties(backgroundDuties(recordingHandles(calls)));
    expect(calls).toEqual([
      ...ABORTS.map((name) => `abort ${name}`),
      "await pendingCardLoop",
      "await tenderRefundLoop",
      "await attendanceLoop",
      "await attendanceEmailLoop",
      "await certificateReminderLoop",
      "stop certificateDiagnosis",
      "await invoiceEmailLoop",
      "await cloudWorker",
      "await cloudSnapshots",
      "await suggestionLoop",
      "call unsubscribeFromChanges",
      "call stopSealingNodeCommits",
      "settled sealedState",
      "stop menuActivation",
      "stop appendOnlyWatch",
      "stop freeSpaceWatch",
      "stop boxEmails",
      "close liveEvents",
      "abort tunnelController",
      "await loop",
      "catch tunnelWorker",
      "stop backupSupervisor",
      "stop demoPrinterLoop",
      "stop clockWatch",
      "stop streamHost",
    ]);
  });

  it("skips the duties a box did not start", async () => {
    const calls: string[] = [];
    const handles = recordingHandles(calls, {
      certificateReminderController: undefined,
      attendanceLoop: undefined,
      certificateDiagnosis: undefined,
      suggestionLoop: undefined,
      tunnelWorker: undefined,
      demoPrinterLoop: undefined,
    });
    await stopBackgroundDuties(backgroundDuties(handles));
    expect(calls).not.toContain("abort certificateReminderController");
    expect(calls).not.toContain("await attendanceLoop");
    expect(calls).not.toContain("stop certificateDiagnosis");
    expect(calls).not.toContain("catch tunnelWorker");
    expect(calls).not.toContain("stop demoPrinterLoop");
    expect(calls.at(-1)).toBe("stop streamHost");
  });

  it("carries on past a failing closer and rejects with the first failure", async () => {
    const calls: string[] = [];
    const first = new Error("menu activation failed");
    const handles = recordingHandles(calls, {
      menuActivation: {
        stop: () => {
          throw first;
        },
      },
      clockWatch: { stop: () => Promise.reject(new Error("clock watch failed")) },
    });
    await expect(stopBackgroundDuties(backgroundDuties(handles))).rejects.toBe(first);
    expect(calls.at(-1)).toBe("stop streamHost");
    expect(calls).toContain("stop appendOnlyWatch");
  });

  it("carries on past a failing abort to every other abort and closer, then rejects with the first failure", async () => {
    const calls: string[] = [];
    const first = new Error("cloud abort failed");
    let finish!: () => void;
    const running = new Promise<void>((resolve) => (finish = resolve));
    const handles = recordingHandles(calls, {
      cloudController: {
        abort: () => {
          throw first;
        },
      },
      attendanceController: {
        abort: () => {
          throw new Error("attendance abort failed");
        },
      },
      loop: running,
      clockWatch: { stop: () => Promise.reject(new Error("clock watch failed")) },
    });

    let settled = false;
    const stopping = stopBackgroundDuties(backgroundDuties(handles)).finally(
      () => (settled = true),
    );
    stopping.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    expect(calls).toContain("abort tenderRefundController");
    expect(calls).not.toContain("stop streamHost");

    finish();
    await expect(stopping).rejects.toBe(first);
    expect(calls.at(-1)).toBe("stop streamHost");
  });

  it("awaits a stop called early in its place, without calling it again", async () => {
    let stops = 0;
    let finish!: () => void;
    const stopped = new Promise<void>((resolve) => (finish = resolve));
    const calls: string[] = [];
    const handles = recordingHandles(calls, {
      backupSupervisor: {
        stop: () => {
          stops += 1;
          return stopped;
        },
      },
    });
    const duties = backgroundDuties(handles);
    const early = duties.closers.find((c) => c.name === "backupSupervisor")!;
    expect(early.close()).toBe(stopped);

    let done = false;
    const stopping = stopBackgroundDuties(duties).then(() => (done = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(done).toBe(false);
    expect(calls).not.toContain("stop demoPrinterLoop");

    finish();
    await stopping;
    expect(stops).toBe(1);
    expect(calls.at(-1)).toBe("stop streamHost");
  });

  it("rethrows a closer's first synchronous failure on a later call, without calling it again", () => {
    let stops = 0;
    const failure = new Error("stop failed");
    const duties = backgroundDuties(
      recordingHandles([], {
        clockWatch: {
          stop: () => {
            stops += 1;
            throw failure;
          },
        },
      }),
    );
    const closer = duties.closers.find((c) => c.name === "clockWatch")!;
    expect(() => closer.close()).toThrow(failure);
    expect(() => closer.close()).toThrow(failure);
    expect(stops).toBe(1);
  });
});
