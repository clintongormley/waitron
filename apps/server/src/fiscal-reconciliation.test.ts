import { describe, expect, it, vi } from "vitest";
import { fiscalReconciliationJob } from "./fiscal-reconciliation.js";
import { createJobRunner } from "./job-runner.js";

const START = new Date("2026-07-21T00:00:00Z");
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(options: { enabled?: boolean; hold?: Promise<void>; fail?: boolean } = {}) {
  const enabled = { value: options.enabled ?? true };
  const clock = { now: START };
  const observed: string[] = [];
  const waits: { ms: number; signal: AbortSignal; release: () => void }[] = [];
  const log = vi.fn();
  const runner = createJobRunner({
    now: () => clock.now,
    monotonicMs: () => clock.now.getTime(),
    log,
    delay: (ms, signal) =>
      new Promise<void>((resolve) => {
        waits.push({ ms, signal, release: resolve });
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  });
  runner.add(
    fiscalReconciliationJob({
      enabled: () => enabled.value,
      maxWaitMs: 60_000,
      retryMs: 300_000,
      log,
      pass: async (at) => {
        observed.push(at.toISOString());
        await options.hold;
        if (options.fail) throw new Error("offline");
        return { nextDueAt: new Date(at.getTime() + 86_400_000) };
      },
    }),
  );
  return { runner, enabled, clock, observed, waits, log };
}

describe("the independent fiscal reconciliation duty", () => {
  it("observes immediately and caps the next wait so new months are discovered", async () => {
    const f = fixture();
    try {
      await vi.waitFor(() => expect(f.waits).toHaveLength(1));
      expect(f.observed).toEqual(["2026-07-21T00:00:00.000Z"]);
      expect(f.waits[0]!.ms).toBe(60_000);
      f.clock.now = new Date("2026-07-21T00:01:00Z");
      f.waits[0]!.release();
      await vi.waitFor(() => expect(f.waits).toHaveLength(2));
      expect(f.observed).toEqual(["2026-07-21T00:00:00.000Z", "2026-07-21T00:01:00.000Z"]);
    } finally {
      await f.runner.stopJobs();
    }
    expect(f.waits[1]!.signal.aborted).toBe(true);
  });

  it("rechecks live admission before each pass, including after promotion and demotion", async () => {
    const f = fixture({ enabled: false });
    try {
      await vi.waitFor(() => expect(f.waits).toHaveLength(1));
      expect(f.observed).toEqual([]);
      f.enabled.value = true;
      f.waits[0]!.release();
      await vi.waitFor(() => expect(f.waits).toHaveLength(2));
      expect(f.observed).toHaveLength(1);
      f.enabled.value = false;
      f.waits[1]!.release();
      await vi.waitFor(() => expect(f.waits).toHaveLength(3));
      expect(f.observed).toHaveLength(1);
    } finally {
      await f.runner.stopJobs();
    }
  });

  it("contains a failed lookup and waits rather than ending the duty", async () => {
    const f = fixture({ fail: true });
    try {
      await vi.waitFor(() => expect(f.waits).toHaveLength(1));
      expect(f.log).toHaveBeenCalledWith("warn", "fiscal.reconciliation_failed", {
        errorCode: "unknown",
      });
      expect(f.waits[0]!.ms).toBe(60_000);
      f.waits[0]!.release();
      await vi.waitFor(() => expect(f.waits).toHaveLength(2));
      expect(f.observed).toHaveLength(2);
    } finally {
      await f.runner.stopJobs();
    }
  });

  it("returns before a pending lookup and waits for it on stop without starting another pass", async () => {
    const held = gate();
    const f = fixture({ hold: held.promise });
    await vi.waitFor(() => expect(f.observed).toHaveLength(1));
    let stopped = false;
    const stop = f.runner.stopJobs().then(() => {
      stopped = true;
    });
    try {
      await Promise.resolve();
      expect(stopped).toBe(false);
      expect(f.waits).toEqual([]);
    } finally {
      held.resolve();
      await stop;
    }
    expect(stopped).toBe(true);
    expect(f.observed).toHaveLength(1);
    expect(f.waits).toEqual([]);
  });
});

it("aborts the signal received by the running pass before joining it", async () => {
  const held = gate();
  let signal: AbortSignal | undefined;
  const runner = createJobRunner({ now: () => START, log: () => {} });
  runner.add(
    fiscalReconciliationJob({
      enabled: () => true,
      maxWaitMs: 60_000,
      retryMs: 300_000,
      log: () => {},
      pass: async (_now, received) => {
        signal = received;
        await held.promise;
        return { nextDueAt: START };
      },
    }),
  );
  runner.signalStepdown();
  const stop = runner.stopJobs();
  try {
    expect(signal?.aborted).toBe(true);
  } finally {
    held.resolve();
    await stop;
  }
});
