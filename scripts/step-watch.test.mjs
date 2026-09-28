import { setTimeout } from "node:timers";
import { describe, expect, it } from "vitest";
import { createStepWatch, reportStallAfter } from "./step-watch.mjs";

function clock(...readings) {
  return () => readings.shift();
}

describe("createStepWatch", () => {
  it("returns each phase's value and lists every phase with its duration", async () => {
    const watch = createStepWatch({ now: clock(0, 40, 100, 350) });

    expect(await watch.phase("first", async () => "one")).toBe("one");
    expect(await watch.phase("second", () => "two")).toBe("two");

    expect(watch.summary()).toBe("first: 40 ms\nsecond: 250 ms");
  });

  it("lists only the slowest phases, slowest first, under their total, when given a limit", async () => {
    const watch = createStepWatch({ now: clock(0, 30, 30, 40, 40, 90) });
    await watch.phase("middling", () => undefined);
    await watch.phase("quick", () => undefined);
    await watch.phase("slow", () => undefined);

    expect(watch.summary(2)).toBe(
      "3 phases, 90 ms in all; the slowest:\nslow: 50 ms\nmiddling: 30 ms",
    );
  });

  it("records a phase that throws, and lets the error through", async () => {
    const watch = createStepWatch({ now: clock(0, 7) });

    await expect(
      watch.phase("refused", async () => {
        throw new Error("no such table");
      }),
    ).rejects.toThrow("no such table");

    expect(watch.summary()).toBe("refused: 7 ms");
  });

  it("names the phase still running, how long it has run and the process's active resources", async () => {
    const watch = createStepWatch({
      now: clock(0, 5, 10, 1510),
      resources: () => ["Timeout", "FSReqCallback"],
    });
    await watch.phase("done", () => undefined);
    const pending = watch.phase("stuck", () => new Promise(() => {}));

    expect(watch.stalled()).toBe(
      "Stalled in phase stuck after 1500 ms. Active resources: Timeout, FSReqCallback.\nPhases finished before it:\ndone: 5 ms",
    );
    void pending;
  });

  it("says when no phase was running", () => {
    const watch = createStepWatch({ now: clock(), resources: () => [] });

    expect(watch.stalled()).toBe(
      "Stalled between phases. Active resources: none.\nPhases finished before it:\n(none)",
    );
  });

  it("does not blame the last finished phase for a stall after it", async () => {
    const watch = createStepWatch({ now: clock(0, 4), resources: () => [] });
    await watch.phase("finished", () => undefined);

    expect(watch.stalled()).toBe(
      "Stalled between phases. Active resources: none.\nPhases finished before it:\nfinished: 4 ms",
    );
  });

  it("reads the real clock and the process's active resources by default", async () => {
    const watch = createStepWatch();
    const pending = watch.phase(
      "waiting on a timer",
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    );

    expect(watch.stalled()).toMatch(
      /^Stalled in phase waiting on a timer after \d+ ms\. Active resources: .*Timeout/,
    );
    await pending;
    expect(watch.summary()).toMatch(/^waiting on a timer: \d+ ms$/);
  });
});

describe("reportStallAfter", () => {
  it("fails with the watch's report when the body outlives the deadline", async () => {
    const watch = createStepWatch({ resources: () => ["Timeout"] });

    await expect(
      reportStallAfter(watch, 20, () => watch.phase("hangs", () => new Promise(() => {}))),
    ).rejects.toThrow(
      /^Still running after 20 ms\. Stalled in phase hangs after \d+ ms\. Active resources: Timeout\./,
    );
  });

  it("returns the body's value and clears its timer when the body finishes first", async () => {
    const cleared = [];
    const timers = {
      setTimer: () => "the timer",
      clearTimer: (timer) => cleared.push(timer),
    };

    expect(await reportStallAfter(createStepWatch(), 1000, async () => "migrated", timers)).toBe(
      "migrated",
    );
    expect(cleared).toEqual(["the timer"]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses a deadline of %s before running the body",
    async (ms) => {
      let ran = false;
      await expect(
        reportStallAfter(createStepWatch(), ms, () => {
          ran = true;
        }),
      ).rejects.toThrow("The deadline must be a positive finite number of milliseconds");
      expect(ran).toBe(false);
    },
  );
});
