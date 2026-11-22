import { describe, expect, it } from "vitest";
import { realSleep, sleepMsFor } from "./loop.js";

const NOW = new Date("2026-07-26T09:00:00Z");
const MIN = 5_000;
const MAX = 3_600_000;

describe("sleepMsFor", () => {
  it("sleeps until the due time when it lies inside the clamps", () => {
    expect(sleepMsFor(new Date("2026-07-26T09:10:00Z"), NOW, MIN, MAX)).toBe(600_000);
  });

  it("never sleeps longer than the max, however distant the due time", () => {
    // A liveness floor, not a tuning knob: drain's hourly duty must not be lengthened by a quiet
    // ledger, nor by a nextDueAt computed before a till wrote a sale.
    expect(sleepMsFor(new Date("2026-08-01T00:00:00Z"), NOW, MIN, MAX)).toBe(MAX);
  });

  it("never sleeps less than the min, even for work due now or overdue", () => {
    expect(sleepMsFor(NOW, NOW, MIN, MAX)).toBe(MIN);
    expect(sleepMsFor(new Date("2026-07-26T08:00:00Z"), NOW, MIN, MAX)).toBe(MIN);
  });

  it("sleeps the max when there is no work anywhere", () => {
    expect(sleepMsFor(null, NOW, MIN, MAX)).toBe(MAX);
  });
});

describe("realSleep", () => {
  it("resolves after the real delay elapses", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    await realSleep(20, controller.signal);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10);
  });

  it("resolves promptly when the signal is already aborted, rather than waiting out the duration", async () => {
    const controller = new AbortController();
    controller.abort();
    const startedAt = Date.now();
    await realSleep(5_000, controller.signal);
    // Waiting out the full duration instead of honouring the abort would take ~5000ms here.
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
