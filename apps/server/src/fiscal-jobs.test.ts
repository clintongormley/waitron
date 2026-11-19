import { expect, it, onTestFinished, vi } from "vitest";
import { emptyDrainResult } from "@waitron/fiscal";
import type { TickResult } from "@waitron/payments";
import { AppError, type ResourceChange } from "@waitron/shared";
import { drainJob, reconcileJob } from "./fiscal-jobs.js";
import { createHealthState } from "./health.js";
import { createJobRunner } from "./job-runner.js";
import { fakeTimerDelay } from "./testing/fake-timer-delay.js";

const START = new Date("2026-07-26T09:00:00Z");
const LATER = new Date("2026-07-26T09:00:05Z");
const signal = new AbortController().signal;
const timings = { minTickMs: 5_000, maxTickMs: 3_600_000 };
const cleanReconcile: TickResult = {
  ran: [],
  deferred: 0,
  beyondHorizon: 0,
  skipped: [],
  nextDueAt: null,
};

function setup() {
  const health = createHealthState(START);
  return {
    health,
    timings,
    awaitingCert: { current: false },
    drain: async () => emptyDrainResult(),
    reconcile: async () => cleanReconcile,
    getRole: () => "primary" as const,
    monotonicMs: () => 0,
    log: vi.fn(),
  };
}

it("runs a woken fiscal pass while an earlier payment check is still in progress", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  const payment = Promise.withResolvers<TickResult>();
  let publish!: (change: ResourceChange) => void;
  const deps = setup();
  const runner = createJobRunner({
    now: () => new Date(),
    log: deps.log,
    delay: fakeTimerDelay,
    monotonicMs: Date.now,
    subscribe: (listener) => {
      publish = listener;
      return () => {};
    },
  });
  onTestFinished(async () => {
    payment.resolve(cleanReconcile);
    await runner.stopJobs();
    vi.useRealTimers();
  });
  runner.add(reconcileJob({ ...deps, reconcile: () => payment.promise }));
  runner.add(drainJob(deps));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(deps.health.lastPassAt).toEqual(START);
  expect(runner.views()["payments.reconcile"]?.state).toBe("running");

  publish({ resources: [{ type: "fiscal_submission_queued" }] });
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.health.lastPassAt).toEqual(LATER);

  payment.resolve(cleanReconcile);
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.health.lastPassAt).toEqual(LATER);
  expect(deps.health.duties["payments.reconcile"]?.lastOkAt).toEqual(START);
});

it("keeps the fiscal heartbeat on a secondary with neither primary duty doing work", async () => {
  const deps = {
    ...setup(),
    getRole: () => "secondary" as const,
    drain: async () => {
      throw new Error("a mirror would file");
    },
  };
  const drain = drainJob(deps);
  expect(drain.applies()).toBe(true);
  await expect(drain.pass({ now: START, signal })).resolves.toEqual({ nextDueAt: null });
  expect(deps.health.lastPassAt).toEqual(START);
  expect(deps.health.duties["fiscal.drain"]?.lastOkAt).toBeNull();
  expect(reconcileJob(deps).applies()).toBe(false);
});

it("records a filing failure for health and rethrows for the runner's retry", async () => {
  const deps = setup();
  const error = new AppError("server.internal", {});
  const drain = drainJob({
    ...deps,
    drain: async () => {
      throw error;
    },
  });
  await expect(drain.pass({ now: START, signal })).rejects.toBe(error);
  expect(deps.health.lastPassAt).toEqual(START);
  expect(deps.health.duties["fiscal.drain"]).toEqual({
    lastOkAt: null,
    consecutiveFailures: 1,
    skipped: 0,
    parked: 0,
  });
  expect(deps.log).toHaveBeenCalledWith("error", "duty.failed", {
    duty: "fiscal.drain",
    errorCode: "server.internal",
  });
});

it("gives the drain the job's stepdown signal", async () => {
  const deps = setup();
  const active = Promise.withResolvers<AbortSignal>();
  const resume = Promise.withResolvers<void>();
  const runner = createJobRunner({ now: () => START, log: deps.log });
  onTestFinished(async () => {
    resume.resolve();
    await runner.stopJobs();
  });
  runner.add(
    drainJob({
      ...deps,
      drain: async (_now, stopSignal) => {
        active.resolve(stopSignal);
        await resume.promise;
        return emptyDrainResult();
      },
    }),
  );
  const stopSignal = await active.promise;
  expect(stopSignal.aborted).toBe(false);
  runner.signalStepdown();
  expect(stopSignal.aborted).toBe(true);
});
