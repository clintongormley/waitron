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
  "mailController",
  "attendanceController",
  "certificateReminderController",
  "tenderRefundController",
  "jobRunner",
];

const CLOSERS = [
  "jobRunner",
  "pendingCardLoop",
  "tenderRefundLoop",
  "attendanceLoop",
  "certificateReminderLoop",
  "certificateDiagnosis",
  "invoiceEmailLoop",
  "mailLoop",
  "cloudSnapshots",
  "unsubscribeFromChanges",
  "boxEmails",
  "spareSettings",
  "liveEvents",
  "loop",
  "backupSupervisor",
  "handoverDestinationDuty",
  "chartPost",
  "spareStore",
  "jobRunnerServices",
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
    mailController: aborter("mailController"),
    attendanceController: aborter("attendanceController"),
    certificateReminderController: aborter("certificateReminderController"),
    tenderRefundController: aborter("tenderRefundController"),
    pendingCardLoop: awaited("pendingCardLoop"),
    tenderRefundLoop: awaited("tenderRefundLoop"),
    attendanceLoop: awaited("attendanceLoop"),
    certificateReminderLoop: awaited("certificateReminderLoop"),
    certificateDiagnosis: stopper("certificateDiagnosis"),
    invoiceEmailLoop: awaited("invoiceEmailLoop"),
    mailLoop: awaited("mailLoop"),
    cloudSnapshots: awaited("cloudSnapshots"),
    unsubscribeFromChanges: () => void calls.push("call unsubscribeFromChanges"),
    jobRunner: {
      signalStepdown: () => void calls.push("abort jobRunner"),
      stopServices: async () => {
        calls.push("stop jobRunnerServices");
      },
      stopJobs: async () => {
        calls.push("stop jobRunner");
      },
    },
    boxEmails: stopper("boxEmails"),
    spareSettings: stopper("spareSettings"),
    liveEvents: { close: () => void calls.push("close liveEvents") },
    loop: awaited("loop"),
    backupSupervisor: stopper("backupSupervisor"),
    handoverDestinationDuty: stopper("handoverDestinationDuty"),
    chartPost: stopper("chartPost"),
    spareStore: stopper("spareStore"),
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
      "stop jobRunner",
      "await pendingCardLoop",
      "await tenderRefundLoop",
      "await attendanceLoop",
      "await certificateReminderLoop",
      "stop certificateDiagnosis",
      "await invoiceEmailLoop",
      "await mailLoop",
      "await cloudSnapshots",
      "call unsubscribeFromChanges",
      "stop boxEmails",
      "stop spareSettings",
      "close liveEvents",
      "await loop",
      "stop backupSupervisor",
      "stop handoverDestinationDuty",
      "stop chartPost",
      "stop spareStore",
      "stop jobRunnerServices",
    ]);
  });

  it("skips the duties a box did not start", async () => {
    const calls: string[] = [];
    const handles = recordingHandles(calls, {
      certificateReminderController: undefined,
      attendanceLoop: undefined,
      certificateDiagnosis: undefined,
      handoverDestinationDuty: undefined,
      spareStore: undefined,
    });
    await stopBackgroundDuties(backgroundDuties(handles));
    expect(calls).not.toContain("abort certificateReminderController");
    expect(calls).not.toContain("await attendanceLoop");
    expect(calls).not.toContain("stop certificateDiagnosis");
    expect(calls).not.toContain("stop handoverDestinationDuty");
    expect(calls).not.toContain("stop spareStore");
    expect(calls.at(-1)).toBe("stop jobRunnerServices");
  });

  it("stops a spare's store, which carries a reason, after the chart post and before the runner's services", async () => {
    const calls: string[] = [];
    const duties = backgroundDuties(recordingHandles(calls));
    const closer = duties.closers.find((c) => c.name === "spareStore");
    expect(closer?.atStepdown).toBeUndefined();
    expect(closer?.reason).not.toBe("");
    expect(closer?.reason).toBeDefined();
    await stopBackgroundDuties(duties);
    expect(calls.slice(-3)).toEqual([
      "stop chartPost",
      "stop spareStore",
      "stop jobRunnerServices",
    ]);
  });

  it("carries on past a failing closer and rejects with the first failure", async () => {
    const calls: string[] = [];
    const first = new Error("menu activation failed");
    const handles = recordingHandles(calls, {
      jobRunner: {
        signalStepdown: () => {},
        stopServices: async () => {
          calls.push("stop jobRunnerServices");
        },
        stopJobs: () => {
          throw first;
        },
      },
      boxEmails: { stop: () => Promise.reject(new Error("box email failed")) },
    });
    await expect(stopBackgroundDuties(backgroundDuties(handles))).rejects.toBe(first);
    expect(calls.at(-1)).toBe("stop jobRunnerServices");
    expect(calls).toContain("stop handoverDestinationDuty");
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
      boxEmails: { stop: () => Promise.reject(new Error("box email failed")) },
    });

    let settled = false;
    const stopping = stopBackgroundDuties(backgroundDuties(handles)).finally(
      () => (settled = true),
    );
    stopping.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    expect(calls).toContain("abort tenderRefundController");
    expect(calls).not.toContain("stop jobRunnerServices");

    finish();
    await expect(stopping).rejects.toBe(first);
    expect(calls.at(-1)).toBe("stop jobRunnerServices");
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
    expect(calls).not.toContain("stop handoverDestinationDuty");

    finish();
    await stopping;
    expect(stops).toBe(1);
    expect(calls.at(-1)).toBe("stop jobRunnerServices");
  });

  it("rethrows a closer's first synchronous failure on a later call, without calling it again", () => {
    let stops = 0;
    const failure = new Error("stop failed");
    const duties = backgroundDuties(
      recordingHandles([], {
        boxEmails: {
          stop: () => {
            stops += 1;
            throw failure;
          },
        },
      }),
    );
    const closer = duties.closers.find((c) => c.name === "boxEmails")!;
    expect(() => closer.close()).toThrow(failure);
    expect(() => closer.close()).toThrow(failure);
    expect(stops).toBe(1);
  });
});

describe("fiscal reconciliation shutdown", () => {
  it("stops reconciliation during stepdown and shares the same pending close with shutdown", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let calls = 0;
    const handles = Object.assign(recordingHandles([]), {
      fiscalReconciliation: {
        stop: () => {
          calls += 1;
          return pending;
        },
      },
    });
    const duties = backgroundDuties(handles);
    const closer = duties.closers.find((item) => item.name === "fiscalReconciliation");
    expect(closer?.atStepdown).toBe(true);
    expect(closer?.close()).toBe(pending);
    let closed = false;
    const closing = stopBackgroundDuties(duties).then(() => {
      closed = true;
    });
    try {
      await Promise.resolve();
      expect(closed).toBe(false);
      expect(calls).toBe(1);
    } finally {
      finish();
      await closing;
    }
    expect(closed).toBe(true);
  });
});

describe("spare join shutdown", () => {
  it("stops the spare join at a stepdown, once, after the box emails", async () => {
    const calls: string[] = [];
    const handles = Object.assign(recordingHandles(calls), {
      spareJoin: { stop: () => void calls.push("stop spareJoin") },
    });
    const duties = backgroundDuties(handles);
    expect(duties.closers.find((item) => item.name === "spareJoin")?.atStepdown).toBe(true);
    await stopBackgroundDuties(duties);
    expect(calls.filter((call) => call === "stop spareJoin")).toHaveLength(1);
    expect(calls.indexOf("stop spareJoin")).toBe(calls.indexOf("stop boxEmails") + 1);
  });

  it("has no spare join closer on a box that did not start one", () => {
    const duties = backgroundDuties(recordingHandles([]));
    expect(duties.closers.map((closer) => closer.name)).not.toContain("spareJoin");
  });
});
