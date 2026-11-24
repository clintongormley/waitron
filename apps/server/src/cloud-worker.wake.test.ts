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
let refreshes: number[];

function start(refresh: () => Promise<unknown>) {
  const connection = {
    refresh: () => {
      refreshes.push(elapsed());
      return refresh();
    },
    status: async () => active,
  } as unknown as CloudConnection;
  runner.add(
    cloudConnectionJob({
      connection,
      isPrimary: () => true,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(epoch);
  refreshes = [];
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

it("waits a minute between refreshes", async () => {
  start(async () => active);
  await advance(59_999);
  expect(refreshes).toEqual([0]);
  await advance(1);
  expect(refreshes).toEqual([0, 60_000]);
});

it("waits a minute before retrying a failed refresh", async () => {
  let fail = true;
  start(async () => {
    if (fail) {
      fail = false;
      throw new Error("Cloud did not answer");
    }
    return active;
  });
  await advance(59_999);
  expect(refreshes).toEqual([0]);
  await advance(1);
  expect(refreshes).toEqual([0, 60_000]);
});
