import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, type ResourceChange } from "@waitron/shared";
import {
  createJobRunner,
  LONGEST_TIMER_MS,
  type JobDefinition,
  type JobRunner,
} from "./job-runner.js";
import * as wakers from "./loop-wake.js";

import { fakeTimerDelay as fakeDelay } from "./testing/fake-timer-delay.js";

let runner: JobRunner;
let emit: (change: ResourceChange) => void;
const log = vi.fn();
const unsubscribe = vi.fn();
const times: number[] = [];
const epoch = Date.parse("2026-11-10T12:00:00Z");
const elapsed = () => Date.now() - epoch;
const advance = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
function job(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    name: "menu.activation",
    applies: () => true,
    pass: async () => {
      times.push(elapsed());
      return { nextDueAt: null };
    },
    wakeOn: ["schedule"],
    minSleepMs: 1_000,
    maxSleepMs: 60_000,
    backoff: { firstMs: 5_000, maxMs: 20_000 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(epoch);
  times.length = 0;
  log.mockClear();
  unsubscribe.mockClear();
  runner = createJobRunner({
    now: () => new Date(),
    log,
    delay: fakeDelay,
    monotonicMs: elapsed,
    subscribe: (fn) => {
      emit = fn;
      return unsubscribe;
    },
  });
});
afterEach(async () => {
  await runner.stopJobs();
  await runner.stopServices();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("job runner", () => {
  it("runs at once, then sleeps until due, bounded by floor and ceiling", async () => {
    const waits = [30_000, -1, 90_000];
    runner.add(
      job({
        pass: async () => {
          times.push(elapsed());
          return { nextDueAt: new Date(Date.now() + (waits.shift() ?? 60_000)) };
        },
      }),
    );
    await advance(29_999);
    expect(times).toEqual([0]);
    await advance(1);
    expect(times).toEqual([0, 30_000]);
    await advance(999);
    expect(times).toHaveLength(2);
    await advance(1);
    expect(times).toEqual([0, 30_000, 31_000]);
    await advance(59_999);
    expect(times).toHaveLength(3);
    await advance(1);
    expect(times).toEqual([0, 30_000, 31_000, 91_000]);
  });

  it.each([false, true])("delays the first pass, wakeable=%s", async (wake) => {
    runner.add(job({ firstPassAfterMs: 10_000 }));
    await advance(2_000);
    expect(times).toEqual([]);
    if (wake) {
      emit({ resources: [{ type: "schedule" }] });
      await advance();
    } else {
      await advance(7_999);
      expect(times).toEqual([]);
      await advance(1);
    }
    expect(times).toEqual([wake ? 2_000 : 10_000]);
  });

  it("a null due time sleeps the ceiling", async () => {
    runner.add(job());
    await advance(59_999);
    expect(times).toEqual([0]);
    await advance(1);
    expect(times).toEqual([0, 60_000]);
  });

  it("rechecks applicability every turn and role changes bypass the floor", async () => {
    let applies = false;
    runner.add(job({ applies: () => applies, minSleepMs: 60_000 }));
    await advance(90_000);
    expect(times).toEqual([]);
    expect(runner.views()["menu.activation"]).toMatchObject({
      state: "not_applicable",
      lastTurnAt: "2026-11-10T12:01:00.000Z",
      lastRunAt: null,
    });
    applies = true;
    runner.roleChanged();
    await advance();
    expect(times).toEqual([90_000]);
    await advance(2_000);
    runner.roleChanged();
    await advance();
    expect(times).toEqual([90_000, 92_000]);
  });

  it("named changes wake at the floor; unrelated changes do not wake", async () => {
    runner.add(job({ minSleepMs: 60_000, maxSleepMs: 120_000 }));
    await advance(2_000);
    emit({ resources: [{ type: "other" }] });
    await advance(58_000);
    expect(times).toEqual([0]);
    emit({ resources: [{ type: "schedule" }] });
    await advance();
    expect(times).toEqual([0, 60_000]);
    await advance(2_000);
    emit({ resources: [{ type: "schedule" }] });
    await advance(57_999);
    expect(times).toHaveLength(2);
    await advance(1);
    expect(times).toEqual([0, 60_000, 120_000]);
  });

  it("contains throws and backs off to the ceiling without change-feed interruption", async () => {
    runner.add(
      job({
        pass: async () => {
          times.push(elapsed());
          throw new AppError("shared.invalid_id", { kind: "MenuId", value: "invalid" });
        },
      }),
    );
    await advance(2_000);
    emit({ resources: [{ type: "schedule" }] });
    await advance(52_999);
    expect(times).toEqual([0, 5_000, 15_000, 35_000]);
    expect(runner.views()["menu.activation"]).toMatchObject({
      consecutiveFailures: 4,
      throwsSinceClean: 4,
      failingSince: "2026-11-10T12:00:00.000Z",
      throwingSince: "2026-11-10T12:00:00.000Z",
      lastErrorCode: "shared.invalid_id",
      lastOkAt: null,
    });
    expect(log).toHaveBeenCalledWith("error", "job.failed", {
      job: "menu.activation",
      errorCode: "shared.invalid_id",
      consecutiveFailures: 4,
    });
    await advance(1);
    expect(times).toEqual([0, 5_000, 15_000, 35_000, 55_000]);
  });

  it("a clean pass resets failure counts and backoff, while a degraded pass does not", async () => {
    let turn = 0;
    runner.add(
      job({
        pass: async () => {
          times.push(elapsed());
          turn++;
          if (turn === 1 || turn === 4)
            throw new AppError("shared.invalid_id", { kind: "MenuId", value: "invalid" });
          return { nextDueAt: new Date(Date.now() + 3_000), degraded: turn === 2 };
        },
      }),
    );
    await advance(5_000);
    expect(runner.views()["menu.activation"]).toMatchObject({
      consecutiveFailures: 2,
      throwsSinceClean: 1,
      lastRunAt: "2026-11-10T12:00:05.000Z",
      lastOkAt: null,
    });
    await advance(3_000);
    expect(runner.views()["menu.activation"]).toMatchObject({
      consecutiveFailures: 0,
      throwsSinceClean: 0,
      failingSince: null,
      throwingSince: null,
      lastErrorCode: null,
      lastOkAt: "2026-11-10T12:00:08.000Z",
    });
    await advance(8_000);
    expect(times).toEqual([0, 5_000, 8_000, 11_000, 16_000]);
  });

  it("stopping during backoff settles at once and calls onStop", async () => {
    const onStop = vi.fn(async () => {});
    runner.add(
      job({
        pass: async () => {
          throw Error("failed");
        },
        backoff: { firstMs: 300_000, maxMs: 300_000 },
        onStop,
      }),
    );
    await advance();
    await runner.stopJobs();
    expect(elapsed()).toBe(0);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(runner.views()["menu.activation"].state).toBe("stopped");
  });

  it("keeps a stop-hook rejection handled until close can report it", async () => {
    const failure = Error("stop failed");
    const unhandled: unknown[] = [];
    const remember = (error: unknown) => {
      unhandled.push(error);
    };
    process.on("unhandledRejection", remember);
    try {
      runner.add(
        job({
          onStop: async () => {
            throw failure;
          },
        }),
      );
      await advance();
      runner.signalStepdown();
      await advance();
      const closing = runner.stopJobs();
      runner = createJobRunner({ now: () => new Date(), log, subscribe: () => () => {} });
      await expect(closing).rejects.toBe(failure);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", remember);
    }
  });

  it("awaits every stop hook before reporting one hook's failure", async () => {
    const failure = Error("stop failed");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;
    let stopped = false;
    let caught: unknown;
    runner.add(
      job({
        onStop: async () => {
          throw failure;
        },
      }),
    );
    runner.add(
      job({
        name: "clock.watch",
        onStop: async () => {
          await held;
          stopped = true;
        },
      }),
    );
    await advance();
    const closing = runner.stopJobs().then(
      () => {
        settled = true;
      },
      (error: unknown) => {
        settled = true;
        caught = error;
      },
    );
    try {
      await advance();
      expect(settled).toBe(false);
      expect(stopped).toBe(false);
      release();
      await closing;
      expect(stopped).toBe(true);
      expect(caught).toBe(failure);
    } finally {
      release();
      await closing;
      runner = createJobRunner({ now: () => new Date(), log, subscribe: () => () => {} });
    }
  });

  it("coalesces wakes during a running pass without overlap", async () => {
    let finish!: () => void;
    runner.add(
      job({
        minSleepMs: 0,
        pass: async () => {
          times.push(elapsed());
          if (times.length === 1)
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
          return { nextDueAt: null };
        },
      }),
    );
    await advance();
    runner.wake("menu.activation");
    runner.wake("menu.activation");
    await advance();
    expect(times).toEqual([0]);
    finish();
    await advance(1);
    expect(times).toHaveLength(2);
    await advance(59_998);
    expect(times).toHaveLength(2);
  });

  it("the change listener contains a throwing wake", async () => {
    const original = wakers.createLoopWaker;
    vi.spyOn(wakers, "createLoopWaker").mockImplementation((deps) => ({
      ...original(deps),
      wake: () => {
        throw Error("broken wake");
      },
    }));
    runner.add(job());
    await advance();
    expect(() => emit({ resources: [{ type: "schedule" }] })).not.toThrow();
    await advance();
    expect(log).toHaveBeenCalledWith("error", "job.wake_failed", {
      job: "menu.activation",
      errorCode: "unknown",
    });
  });

  it("stepdown aborts stop-marked jobs synchronously and lets keep-running jobs continue", async () => {
    let finish!: () => void;
    let signal!: AbortSignal;
    const onStop = vi.fn(async () => {});
    runner.add(
      job({
        pass: async (ctx) => {
          signal = ctx.signal;
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return { nextDueAt: null };
        },
        onStop,
      }),
    );
    runner.add(job({ name: "storage.free_space" }));
    await advance();
    try {
      runner.signalStepdown();
      expect(signal.aborted).toBe(true);
    } finally {
      finish();
    }
    await advance();
    expect(onStop).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(times).toEqual([0, 60_000]);
  });

  it("stops all running jobs together, awaits their passes, and stops each once", async () => {
    const stopped: string[] = [];
    for (const name of ["menu.activation", "clock.watch", "storage.free_space"] as const) {
      runner.add(
        job({
          name,
          pass: async () => {
            await fakeDelay(100, new AbortController().signal);
            return { nextDueAt: null };
          },
          onStop: async () => {
            stopped.push(name);
          },
        }),
      );
    }
    await advance();
    const stopping = runner.stopJobs();
    expect(runner.stopJobs()).toBe(stopping);
    await advance(99);
    expect(stopped).toEqual([]);
    await advance(1);
    await stopping;
    expect(stopped.sort()).toEqual(["clock.watch", "menu.activation", "storage.free_space"]);
    expect(elapsed()).toBe(100);
    expect(() => runner.add(job())).toThrow();
  });

  it("a finished pass ends the job", async () => {
    runner.add(
      job({
        pass: async () => {
          times.push(elapsed());
          return { nextDueAt: null, finished: true };
        },
      }),
    );
    await advance(120_000);
    expect(times).toEqual([0]);
    expect(runner.views()["menu.activation"].state).toBe("stopped");
  });

  it("splits long sleeps into timers Node honours", async () => {
    const delay = vi.fn(fakeDelay);
    await runner.stopJobs();
    runner = createJobRunner({
      now: () => new Date(),
      log,
      delay,
      monotonicMs: elapsed,
      subscribe: () => () => {},
    });
    runner.add(job({ maxSleepMs: 5 * LONGEST_TIMER_MS }));
    await advance(5 * LONGEST_TIMER_MS);
    expect(times).toEqual([0, 5 * LONGEST_TIMER_MS]);
    expect(delay.mock.calls.every(([ms]) => ms <= LONGEST_TIMER_MS)).toBe(true);
  });

  it("refuses duplicate jobs and services, and ignores wakes for jobs not added", () => {
    runner.wake("clock.watch");
    runner.add(job());
    expect(() => runner.add(job())).toThrow();
    expect(() => runner.add(job({ name: "stream" }))).toThrow();
  });
});

describe("runner services", () => {
  function service(overrides: Partial<import("./job-runner.js").ServiceDefinition> = {}) {
    return {
      name: "stream" as const,
      applies: () => true,
      start: vi.fn(async () => {}),
      suspend: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      describe: () => ({ running: true, reason: null }),
      ...overrides,
    };
  }

  it("starts an applicable service before registration resolves and reports the host's state", async () => {
    let running = false;
    const host = service({
      describe: () => ({ running, reason: running ? null : "not_configured" }),
    });
    await runner.addService(host);
    expect(host.start).toHaveBeenCalledTimes(1);
    expect(runner.views().stream).toMatchObject({
      kind: "service",
      state: "waiting",
      detail: "not_configured",
    });
    running = true;
    expect(runner.views().stream).toMatchObject({ state: "running", detail: null });
  });

  it("starts and suspends on role changes, then starts again on promotion", async () => {
    let primary = false;
    const host = service({ applies: () => primary });
    await runner.addService(host);
    expect(runner.views().stream.state).toBe("not_applicable");
    primary = true;
    runner.roleChanged();
    await advance();
    expect(host.start).toHaveBeenCalledTimes(1);
    primary = false;
    runner.roleChanged();
    await advance();
    expect(host.suspend).toHaveBeenCalledTimes(1);
    expect(runner.views().stream.state).toBe("not_applicable");
    primary = true;
    runner.roleChanged();
    await advance();
    expect(host.start).toHaveBeenCalledTimes(2);
  });

  it("rechecks missed role changes at sixty seconds without starting twice while a check is pending", async () => {
    let primary = false;
    let release!: () => void;
    const host = service({
      applies: () => primary,
      start: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    });
    await runner.addService(host);
    primary = true;
    await advance(59_999);
    expect(host.start).not.toHaveBeenCalled();
    await advance(1);
    expect(host.start).toHaveBeenCalledTimes(1);
    runner.roleChanged();
    await advance(60_000);
    expect(host.start).toHaveBeenCalledTimes(1);
    release();
    await advance();
  });

  it("keeps an active service through stepdown until close, and never starts an inactive one", async () => {
    let primary = true;
    const host = service({ applies: () => primary });
    await runner.addService(host);
    runner.signalStepdown();
    await advance(60_000);
    expect(host.suspend).not.toHaveBeenCalled();
    expect(host.stop).not.toHaveBeenCalled();
    primary = false;
    runner.roleChanged();
    await advance();
    expect(host.suspend).toHaveBeenCalledTimes(1);
    primary = true;
    runner.roleChanged();
    await advance(60_000);
    expect(host.start).toHaveBeenCalledTimes(1);
  });

  it("close waits for a pending start, stops once, and prevents later checks", async () => {
    let release!: () => void;
    const calls: string[] = [];
    const host = service({
      start: async () => {
        calls.push("start");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      stop: async () => {
        calls.push("stop");
      },
    });
    const registering = runner.addService(host);
    await advance();
    const first = runner.stopServices();
    const second = runner.stopServices();
    expect(calls).toEqual(["start"]);
    release();
    await Promise.all([registering, first, second]);
    runner.roleChanged();
    await advance(120_000);
    expect(calls).toEqual(["start", "stop"]);
    expect(runner.views().stream.state).toBe("stopped");
  });

  it("logs a failed start, reports it, and retries at the next check", async () => {
    const host = service({
      start: vi
        .fn()
        .mockRejectedValueOnce(new AppError("storage.disk_full"))
        .mockResolvedValue(undefined),
    });
    await runner.addService(host);
    expect(log).toHaveBeenCalledWith(
      "error",
      "job.failed",
      expect.objectContaining({ job: "stream", errorCode: "storage.disk_full" }),
    );
    expect(runner.views().stream).toMatchObject({
      state: "not_applicable",
      consecutiveFailures: 1,
      lastErrorCode: "storage.disk_full",
    });
    await advance(60_000);
    expect(host.start).toHaveBeenCalledTimes(2);
    expect(runner.views().stream).toMatchObject({
      state: "running",
      consecutiveFailures: 0,
      throwsSinceClean: 0,
      throwingSince: null,
    });
  });

  it("retries an off active service on wake, but never after stepdown", async () => {
    let running = false;
    const host = service({
      describe: () => ({ running, reason: running ? null : "reseal_required" }),
    });
    await runner.addService(host);
    runner.wake("stream");
    await advance();
    expect(host.start).toHaveBeenCalledTimes(2);
    running = true;
    runner.wake("stream");
    await advance();
    expect(host.start).toHaveBeenCalledTimes(2);
    running = false;
    runner.signalStepdown();
    runner.wake("stream");
    await advance(60_000);
    expect(host.start).toHaveBeenCalledTimes(2);
  });

  it("refuses a service missing from the declared stop order", async () => {
    await expect(runner.addService(service({ name: "menu.activation" }))).rejects.toThrow();
  });
});
