import { describe, expect, it, vi } from "vitest";
import {
  backgroundDuties,
  stopBackgroundDuties,
  type BackgroundDutyHandles,
} from "./background-duties.js";
import { createJobRunner } from "./job-runner.js";

const ABORTS = [
  "controller",
  "pendingCardController",
  "cloudController",
  "invoiceEmailController",
  "tenderRefundController",
  "jobRunner",
];

const CLOSERS = [
  "jobRunner",
  "pendingCardLoop",
  "tenderRefundLoop",
  "certificateDiagnosis",
  "invoiceEmailLoop",
  "unsubscribeFromChanges",
  "spareSettings",
  "liveEvents",
  "loop",
  "handoverDestinationDuty",
  "chartPost",
  "spareStore",
  "jobRunnerServices",
  "cloudSnapshots",
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
    tenderRefundController: aborter("tenderRefundController"),
    pendingCardLoop: awaited("pendingCardLoop"),
    tenderRefundLoop: awaited("tenderRefundLoop"),
    certificateDiagnosis: stopper("certificateDiagnosis"),
    invoiceEmailLoop: awaited("invoiceEmailLoop"),
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
    spareSettings: stopper("spareSettings"),
    liveEvents: { close: () => void calls.push("close liveEvents") },
    loop: awaited("loop"),
    handoverDestinationDuty: stopper("handoverDestinationDuty"),
    chartPost: stopper("chartPost"),
    spareStore: stopper("spareStore"),
    ...overrides,
  };
}

describe("background duties", () => {
  it("names the closer before entering it, and continues naming after a refusal", async () => {
    const names: string[] = [];
    const failure = new Error("stop refused");
    await expect(
      stopBackgroundDuties(
        {
          aborts: [],
          closers: [
            {
              name: "held",
              close: () => {
                expect(names).toEqual(["held"]);
                throw failure;
              },
            },
            {
              name: "later",
              close: () => {
                expect(names).toEqual(["held", "later"]);
              },
            },
          ],
        },
        (name) => names.push(name),
      ),
    ).rejects.toBe(failure);
  });
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
      "stop certificateDiagnosis",
      "await invoiceEmailLoop",
      "call unsubscribeFromChanges",
      "stop spareSettings",
      "close liveEvents",
      "await loop",
      "stop handoverDestinationDuty",
      "stop chartPost",
      "stop spareStore",
      "stop jobRunnerServices",
      "await cloudSnapshots",
    ]);
  });

  it("gives the stream its final 4500ms before waiting for a slow Cloud snapshot", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const cloud = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const runner = createJobRunner({
      now: () => new Date(),
      log: vi.fn(),
      subscribe: () => () => {},
    });
    let streamStopped = false;
    let closed = false;
    let closing: Promise<void> | undefined;
    try {
      await runner.addService({
        name: "stream",
        applies: () => true,
        start: async () => {},
        suspend: async () => {},
        describe: () => ({ running: true, reason: null }),
        stop: async () => {
          calls.push("stop stream");
          await new Promise((resolve) => setTimeout(resolve, 4500));
          streamStopped = true;
        },
      });
      closing = stopBackgroundDuties(
        backgroundDuties(recordingHandles(calls, { jobRunner: runner, cloudSnapshots: cloud })),
      ).then(() => {
        closed = true;
      });
      await vi.advanceTimersByTimeAsync(7999);
      expect(streamStopped).toBe(true);
      expect(calls.indexOf("await loop")).toBeLessThan(calls.indexOf("stop stream"));
      expect(closed).toBe(false);
      release();
      await closing;
      expect(closed).toBe(true);
    } finally {
      release();
      await vi.runAllTimersAsync();
      await closing;
      await runner.stopJobs();
      await runner.stopServices();
      vi.useRealTimers();
    }
  });

  it("skips the duties a box did not start", async () => {
    const calls: string[] = [];
    const handles = recordingHandles(calls, {
      certificateDiagnosis: undefined,
      handoverDestinationDuty: undefined,
      spareStore: undefined,
    });
    await stopBackgroundDuties(backgroundDuties(handles));
    expect(calls).not.toContain("stop certificateDiagnosis");
    expect(calls).not.toContain("stop handoverDestinationDuty");
    expect(calls).not.toContain("stop spareStore");
    expect(calls.at(-1)).toBe("await cloudSnapshots");
  });

  it("stops a spare's store, which carries a reason, after the chart post and before the runner's services", async () => {
    const calls: string[] = [];
    const duties = backgroundDuties(recordingHandles(calls));
    const closer = duties.closers.find((c) => c.name === "spareStore");
    expect(closer?.atStepdown).toBeUndefined();
    expect(closer?.reason).not.toBe("");
    expect(closer?.reason).toBeDefined();
    await stopBackgroundDuties(duties);
    expect(calls.slice(-4)).toEqual([
      "stop chartPost",
      "stop spareStore",
      "stop jobRunnerServices",
      "await cloudSnapshots",
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
      spareSettings: { stop: () => Promise.reject(new Error("box email failed")) },
    });
    await expect(stopBackgroundDuties(backgroundDuties(handles))).rejects.toBe(first);
    expect(calls.at(-1)).toBe("await cloudSnapshots");
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
      invoiceEmailController: {
        abort: () => {
          throw new Error("attendance abort failed");
        },
      },
      loop: running,
      spareSettings: { stop: () => Promise.reject(new Error("box email failed")) },
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
    expect(calls.at(-1)).toBe("await cloudSnapshots");
  });

  it("awaits a stop called early in its place, without calling it again", async () => {
    let stops = 0;
    let finish!: () => void;
    const stopped = new Promise<void>((resolve) => (finish = resolve));
    const calls: string[] = [];
    const handles = recordingHandles(calls, {
      handoverDestinationDuty: {
        stop: () => {
          stops += 1;
          return stopped;
        },
      },
    });
    const duties = backgroundDuties(handles);
    const early = duties.closers.find((c) => c.name === "handoverDestinationDuty")!;
    expect(early.close()).toBe(stopped);

    let done = false;
    const stopping = stopBackgroundDuties(duties).then(() => (done = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(done).toBe(false);
    expect(calls).not.toContain("stop handoverDestinationDuty");

    finish();
    await stopping;
    expect(stops).toBe(1);
    expect(calls.at(-1)).toBe("await cloudSnapshots");
  });

  it("rethrows a closer's first synchronous failure on a later call, without calling it again", () => {
    let stops = 0;
    const failure = new Error("stop failed");
    const duties = backgroundDuties(
      recordingHandles([], {
        spareSettings: {
          stop: () => {
            stops += 1;
            throw failure;
          },
        },
      }),
    );
    const closer = duties.closers.find((c) => c.name === "spareSettings")!;
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
  it("stops the spare join at a stepdown, once, after unsubscribing from changes", async () => {
    const calls: string[] = [];
    const handles = Object.assign(recordingHandles(calls), {
      spareJoin: { stop: () => void calls.push("stop spareJoin") },
    });
    const duties = backgroundDuties(handles);
    expect(duties.closers.find((item) => item.name === "spareJoin")?.atStepdown).toBe(true);
    await stopBackgroundDuties(duties);
    expect(calls.filter((call) => call === "stop spareJoin")).toHaveLength(1);
    expect(calls.indexOf("stop spareJoin")).toBe(calls.indexOf("call unsubscribeFromChanges") + 1);
  });

  it("has no spare join closer on a box that did not start one", () => {
    const duties = backgroundDuties(recordingHandles([]));
    expect(duties.closers.map((closer) => closer.name)).not.toContain("spareJoin");
  });
});

it("stops an owned follower once through the stepdown and shutdown table", async () => {
  const calls: string[] = [];
  const duties = backgroundDuties(
    recordingHandles(calls, { spareFollow: { stop: () => void calls.push("stop follower") } }),
  );
  const closer = duties.closers.find((item) => item.name === "spareFollow");
  expect(closer?.atStepdown).toBe(true);
  await closer!.close();
  await stopBackgroundDuties(duties);
  expect(calls.filter((call) => call === "stop follower")).toEqual(["stop follower"]);
});
