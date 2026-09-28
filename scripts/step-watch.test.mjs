import { setTimeout } from "node:timers";
import { describe, expect, it } from "vitest";
import { createStepWatch, withDeadline } from "./step-watch.mjs";

function clock(...readings) {
  return () => readings.shift();
}

describe("createStepWatch", () => {
  it("returns each step's value and lists every step with its duration", async () => {
    const watch = createStepWatch({ now: clock(0, 40, 100, 350) });

    expect(await watch.step("first", async () => "one")).toBe("one");
    expect(await watch.step("second", () => "two")).toBe("two");

    expect(watch.summary()).toBe("first: 40 ms\nsecond: 250 ms");
  });

  it("lists only the slowest steps, slowest first, under their total, when given a limit", async () => {
    const watch = createStepWatch({ now: clock(0, 30, 30, 40, 40, 90) });
    await watch.step("middling", () => undefined);
    await watch.step("quick", () => undefined);
    await watch.step("slow", () => undefined);

    expect(watch.summary(2)).toBe(
      "3 steps, 90 ms in all; the slowest:\nslow: 50 ms\nmiddling: 30 ms",
    );
  });

  it("records a step that throws, and lets the error through", async () => {
    const watch = createStepWatch({ now: clock(0, 7) });

    await expect(
      watch.step("refused", async () => {
        throw new Error("no such table");
      }),
    ).rejects.toThrow("no such table");

    expect(watch.summary()).toBe("refused: 7 ms");
  });

  it("names the step still running, how long it has run and what the process waits on", async () => {
    const watch = createStepWatch({
      now: clock(0, 5, 10, 1510),
      resources: () => ["Timeout", "FSReqCallback"],
    });
    await watch.step("done", () => undefined);
    const pending = watch.step("stuck", () => new Promise(() => {}));

    expect(watch.stalled()).toBe(
      "Stalled in step stuck after 1500 ms. Waiting on: Timeout, FSReqCallback.\nSteps finished before it:\ndone: 5 ms",
    );
    void pending;
  });

  it("says when no step was running", () => {
    const watch = createStepWatch({ now: clock(), resources: () => [] });

    expect(watch.stalled()).toBe(
      "Stalled between steps. Waiting on: nothing.\nSteps finished before it:\n(none)",
    );
  });

  it("does not blame the last finished step for a stall after it", async () => {
    const watch = createStepWatch({ now: clock(0, 4), resources: () => [] });
    await watch.step("finished", () => undefined);

    expect(watch.stalled()).toBe(
      "Stalled between steps. Waiting on: nothing.\nSteps finished before it:\nfinished: 4 ms",
    );
  });

  it("reads the real clock and the process's active resources by default", async () => {
    const watch = createStepWatch();
    const pending = watch.step(
      "waiting on a timer",
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    );

    expect(watch.stalled()).toMatch(
      /^Stalled in step waiting on a timer after \d+ ms\. Waiting on: .*Timeout/,
    );
    await pending;
    expect(watch.summary()).toMatch(/^waiting on a timer: \d+ ms$/);
  });
});

describe("withDeadline", () => {
  it("fails with the watch's report when the body outlives the deadline", async () => {
    const watch = createStepWatch({ resources: () => ["Timeout"] });

    await expect(
      withDeadline(watch, 20, () => watch.step("hangs", () => new Promise(() => {}))),
    ).rejects.toThrow(
      /^Still running after 20 ms\. Stalled in step hangs after \d+ ms\. Waiting on: Timeout\./,
    );
  });

  it("returns the body's value and clears its timer when the body finishes first", async () => {
    const cleared = [];
    const timers = {
      setTimer: () => "the timer",
      clearTimer: (timer) => cleared.push(timer),
    };

    expect(await withDeadline(createStepWatch(), 1000, async () => "migrated", timers)).toBe(
      "migrated",
    );
    expect(cleared).toEqual(["the timer"]);
  });
});
