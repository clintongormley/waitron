import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudConnection } from "./cloud-client.js";
import { cloudConnectionJob } from "./cloud-worker.js";
import { createJobRunner, type JobRunner } from "./job-runner.js";
import { fakeTimerDelay } from "./testing/fake-timer-delay.js";

const epoch = Date.parse("2026-11-20T12:00:00Z");
const elapsed = () => Date.now() - epoch;
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const active = { installation: { state: "active" } };
let runner: JobRunner;
let deliveries: number[];

function start(refresh: () => Promise<unknown>) {
  const connection = {
    refresh,
    status: async () => active,
  } as unknown as CloudConnection;
  runner.add(
    cloudConnectionJob({
      connection,
      isPrimary: () => true,
      onGuestMenu: () => {
        deliveries.push(elapsed());
      },
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(epoch);
  deliveries = [];
  runner = createJobRunner({
    now: () => new Date(),
    log: () => {},
    delay: fakeTimerDelay,
    monotonicMs: elapsed,
    subscribe: () => () => {},
  });
});
afterEach(async () => {
  await runner.stopJobs();
  vi.useRealTimers();
});

it("a wake brings the next delivery to two seconds after the pass, not before", async () => {
  start(async () => active);
  await advance(0);
  expect(deliveries).toEqual([0]);
  await advance(1_000);
  runner.wake("cloud.connection");
  await advance(999);
  expect(deliveries).toEqual([0]);
  await advance(1);
  expect(deliveries).toEqual([0, 2_000]);
});

it("without a wake the next delivery waits the full minute", async () => {
  start(async () => active);
  await advance(59_999);
  expect(deliveries).toEqual([0]);
  await advance(1);
  expect(deliveries).toEqual([0, 60_000]);
});

it("a wake after a failed pass does not shorten the minute's wait", async () => {
  let fail = true;
  start(async () => {
    if (fail) {
      fail = false;
      throw new Error("Cloud did not answer");
    }
    return active;
  });
  await advance(1_000);
  runner.wake("cloud.connection");
  await advance(58_999);
  expect(deliveries).toEqual([]);
  await advance(1);
  expect(deliveries).toEqual([60_000]);
});
