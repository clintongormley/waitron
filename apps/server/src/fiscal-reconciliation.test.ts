import { describe, expect, it, vi } from "vitest";
import { startFiscalReconciliation } from "./fiscal-reconciliation.js";

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
  const duty = startFiscalReconciliation({
    enabled: () => enabled.value,
    now: () => clock.now,
    maxWaitMs: 60_000,
    retryMs: 300_000,
    log,
    pass: async (at) => {
      observed.push(at.toISOString());
      await options.hold;
      if (options.fail) throw new Error("offline");
      return { nextDueAt: new Date(at.getTime() + 86_400_000) };
    },
    sleep: (ms, signal) =>
      new Promise<void>((resolve) => {
        waits.push({ ms, signal, release: resolve });
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  });
  return { duty, enabled, clock, observed, waits, log };
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
      await f.duty.stop();
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
      await f.duty.stop();
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
      await f.duty.stop();
    }
  });

  it("returns before a pending lookup and waits for it on stop without starting another pass", async () => {
    const held = gate();
    const f = fixture({ hold: held.promise });
    await vi.waitFor(() => expect(f.observed).toHaveLength(1));
    let stopped = false;
    const stop = f.duty.stop().then(() => {
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

it("keeps checking after an interrupted sleep fails for a reason other than shutdown", async () => {
  const log = vi.fn();
  let passes = 0,
    sleeps = 0;
  const duty = startFiscalReconciliation({
    enabled: () => true,
    now: () => START,
    maxWaitMs: 60_000,
    retryMs: 300_000,
    log,
    pass: async () => {
      passes++;
      return { nextDueAt: new Date("2026-07-21T00:00:00.025Z") };
    },
    sleep: async (ms, signal) => {
      expect(ms).toBe(25);
      if (++sleeps === 1) throw new Error("timer failed");
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
  });
  try {
    await vi.waitFor(() => expect(passes).toBe(2));
    expect(log).toHaveBeenCalledWith("warn", "fiscal.reconciliation_sleep_failed", {
      errorCode: "unknown",
    });
  } finally {
    await duty.stop();
  }
  expect(passes).toBe(2);
});
