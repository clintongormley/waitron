import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PassReport } from "./pass.js";
import { runLoop } from "./loop.js";
import { createLoopWaker, type LoopWaker } from "./loop-wake.js";

const MIN = 5_000;
const HOUR = 3_600_000;

// Built on setTimeout so the fake timers drive it; resolves on abort, as `realSleep` does.
function fakeDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

let origin = 0;
const clock = () => Date.now() - origin;

function waker(): LoopWaker {
  return createLoopWaker({ minTickMs: MIN, delay: fakeDelay, monotonicMs: clock });
}

/** Starts a sleep and reports the clock reading at which it ended, or null while it is under way. */
function track(w: LoopWaker, ms: number, signal = new AbortController().signal) {
  const startedAt = clock();
  const state: { endedAfter: number | null } = { endedAfter: null };
  void w.sleep(ms, signal).then(() => {
    state.endedAfter = clock() - startedAt;
  });
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
  origin = Date.now();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createLoopWaker", () => {
  it("ends an unwoken 60,000 ms sleep at 60,000 ms, not before", async () => {
    const sleep = track(waker(), 60_000);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(sleep.endedAfter).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(sleep.endedAfter).toBe(60_000);
  });

  it("ends a sleep at once when woken 20,000 ms in, the shortest tick having passed", async () => {
    const w = waker();
    const sleep = track(w, 60_000);
    await vi.advanceTimersByTimeAsync(20_000);
    w.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(sleep.endedAfter).toBe(20_000);
  });

  it("ends a sleep woken 1,000 ms in at 5,000 ms, not at 1,000", async () => {
    const w = waker();
    const sleep = track(w, 60_000);
    await vi.advanceTimersByTimeAsync(1_000);
    w.wake();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(sleep.endedAfter).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(sleep.endedAfter).toBe(5_000);
  });

  it("spends a wake given while no sleep is under way on the next sleep only", async () => {
    const w = waker();
    w.wake();
    const first = track(w, 60_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(first.endedAfter).toBe(5_000);

    const second = track(w, 60_000);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(second.endedAfter).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(second.endedAfter).toBe(60_000);
  });

  it("ends a sleep once for two wakes in it, and carries neither to the next sleep", async () => {
    const w = waker();
    const first = track(w, 60_000);
    await vi.advanceTimersByTimeAsync(1_000);
    w.wake();
    await vi.advanceTimersByTimeAsync(2_000);
    // During the hold the first wake started: spent with it, not carried over.
    w.wake();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(first.endedAfter).toBe(5_000);

    const second = track(w, 60_000);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(second.endedAfter).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(second.endedAfter).toBe(60_000);
  });

  it("ends a sleep at once on shutdown, resolving rather than rejecting", async () => {
    const w = waker();
    const unwoken = new AbortController();
    const plain = w.sleep(60_000, unwoken.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    unwoken.abort();
    await expect(plain).resolves.toBeUndefined();
    expect(clock()).toBe(1_000);

    // The same with a wake pending in its hold.
    const held = new AbortController();
    const holding = w.sleep(60_000, held.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    w.wake();
    await vi.advanceTimersByTimeAsync(1_000);
    held.abort();
    await expect(holding).resolves.toBeUndefined();
    expect(clock()).toBe(3_000);

    // And with a wake given before the sleep began.
    w.wake();
    const before = new AbortController();
    const pending = w.sleep(60_000, before.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    before.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(clock()).toBe(4_000);
  });

  it("ends at once when the signal has already aborted", async () => {
    const w = waker();
    w.wake();
    await expect(w.sleep(60_000, AbortSignal.abort())).resolves.toBeUndefined();
    expect(clock()).toBe(0);
  });

  it("works as a detached function", async () => {
    const { wake, sleep } = waker();
    const controller = new AbortController();
    const startedAt = clock();
    let endedAfter: number | null = null;
    void sleep(60_000, controller.signal).then(() => {
      endedAfter = clock() - startedAt;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    wake();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(endedAfter).toBe(5_000);
  });

  it("never holds a woken sleep past its own length", async () => {
    const w = waker();
    const sleep = track(w, 3_000);
    await vi.advanceTimersByTimeAsync(1_000);
    w.wake();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sleep.endedAfter).toBe(3_000);
  });

  it("rethrows a delay failure that no abort explains", async () => {
    const failure = new Error("delay broke");
    const w = createLoopWaker({
      minTickMs: MIN,
      delay: () => Promise.reject(failure),
      monotonicMs: clock,
    });
    await expect(w.sleep(60_000, new AbortController().signal)).rejects.toBe(failure);
  });

  it("treats a delay that rejects when a wake aborts it as a wake", async () => {
    const w = createLoopWaker({
      minTickMs: MIN,
      delay: (ms, signal) =>
        fakeDelay(ms, signal).then(() => {
          if (signal.aborted) throw new Error("aborted");
        }),
      monotonicMs: clock,
    });
    const sleep = track(w, 60_000);
    await vi.advanceTimersByTimeAsync(1_000);
    w.wake();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sleep.endedAfter).toBe(5_000);
  });

  it("defaults to performance.now for the clock", async () => {
    // Twice fake time's rate, which no other clock the fake timers move would read.
    vi.spyOn(performance, "now").mockImplementation(() => clock() * 2);
    const w = createLoopWaker({ minTickMs: MIN, delay: fakeDelay });
    const sleep = track(w, 60_000);
    await vi.advanceTimersByTimeAsync(1_000);
    w.wake();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(sleep.endedAfter).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(sleep.endedAfter).toBe(4_000);
  });

  it("defaults to the real sleep", async () => {
    vi.useRealTimers();
    const w = createLoopWaker({ minTickMs: 0 });
    const controller = new AbortController();
    const sleeping = w.sleep(HOUR, controller.signal);
    w.wake();
    await expect(sleeping).resolves.toBeUndefined();
  });
});

describe("runLoop with a waker's sleep", () => {
  function report(): PassReport {
    return { duties: [], nextDueAt: null };
  }

  async function secondPassAfter(wakeAt: number | null): Promise<number> {
    const w = waker();
    const controller = new AbortController();
    const passes: number[] = [];
    const done = runLoop({
      pass: () => {
        passes.push(clock());
        if (passes.length === 2) controller.abort();
        return Promise.resolve(report());
      },
      now: () => new Date(),
      sleep: w.sleep,
      signal: controller.signal,
      minTickMs: MIN,
      maxTickMs: HOUR,
      log: () => {},
    });
    if (wakeAt !== null) {
      await vi.advanceTimersByTimeAsync(wakeAt);
      w.wake();
    }
    await vi.advanceTimersByTimeAsync(HOUR);
    await done;
    expect(passes).toHaveLength(2);
    return passes[1]! - passes[0]!;
  }

  it("starts the second pass the shortest tick after the first sleep began when woken in it", async () => {
    expect(await secondPassAfter(1_000)).toBe(MIN);
  });

  it("waits the hour for the second pass without a wake (control)", async () => {
    expect(await secondPassAfter(null)).toBe(HOUR);
  });
});
