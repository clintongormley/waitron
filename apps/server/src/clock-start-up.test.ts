import { describe, expect, it, vi } from "vitest";
import type { ClockWitness } from "@waitron/fiscal";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { clockStartUp, tillClockCheck } from "./clock-start-up.js";
import { startClockState } from "./start-clock-check.js";

const TX = { fake: "tx" } as unknown as Transaction;
const NOW = { instant: new Date("2026-10-31T10:00:00.000Z"), offsetMinutes: 60 };
const IN_2001 = { instant: new Date("2001-01-01T00:00:00.000Z"), offsetMinutes: 60 };
const FIRST_ISSUE_MS = Date.parse("2024-10-28T00:00:00.000Z");

describe("tillClockCheck", () => {
  function check(options: { files?: boolean; recordableThrows?: Error } = {}) {
    const startUp = clockStartUp({ primaryAtStart: true });
    const witnesses: ClockWitness[] = [];
    const backend = {
      assertRecordableAt: vi.fn((reading: { instant: Date }) => {
        if (options.recordableThrows !== undefined) throw options.recordableThrows;
        if (reading.instant.getTime() < FIRST_ISSUE_MS)
          throw new AppError("clock.unusable", {
            clockAt: reading.instant.toISOString(),
            offsetMinutes: 60,
          });
      }),
    };
    const clockCheck = tillClockCheck({
      startUp,
      backend,
      filesRecords: () => options.files ?? true,
    });
    return { startUp, backend, clockCheck, witnesses };
  }

  it("answers false and closes the window when its read sees no stop at a recordable reading", async () => {
    const h = check();
    expect(await h.clockCheck(TX, NOW)).toBe(false);
    expect(h.startUp.open()).toBe(false);
  });

  it("keeps the window open and offers the till at a reading no record could carry", async () => {
    const h = check();
    expect(await h.clockCheck(TX, IN_2001)).toBe(true);
    expect(h.startUp.open()).toBe(true);
  });

  it("passes on an error of the seat's date check that is not clock.unusable, leaving the window open", async () => {
    const failure = new Error("seat broke");
    const h = check({ recordableThrows: failure });
    await expect(h.clockCheck(TX, IN_2001)).rejects.toBe(failure);
    expect(h.startUp.open()).toBe(true);
  });
});

describe("tillClockCheck while the start check waits", () => {
  function waitingCheck(options: { primaryAtStart?: boolean; files?: boolean } = {}) {
    const startUp = clockStartUp({ primaryAtStart: options.primaryAtStart ?? true });
    const start = startClockState();
    const backend = {
      assertRecordableAt: vi.fn(),
    };
    const clockCheck = tillClockCheck({
      startUp,
      backend,
      filesRecords: () => options.files ?? true,
      start,
    });
    return { startUp, start, backend, clockCheck };
  }

  it("offers the check at once, and still once a read that saw no stop shuts the window", async () => {
    const h = waitingCheck();
    expect(await h.clockCheck(TX, NOW)).toBe(true);
    expect(h.startUp.open()).toBe(true);
    h.startUp.noStop();
    expect(await h.clockCheck(TX, NOW)).toBe(true);
  });

  it("offers the check on a box that was not the primary at its start", async () => {
    const h = waitingCheck({ primaryAtStart: false });
    expect(h.startUp.open()).toBe(false);
    expect(await h.clockCheck(TX, NOW)).toBe(true);
  });

  it("offers nothing for waiting on a box that files no records", async () => {
    const h = waitingCheck({ files: false });
    expect(await h.clockCheck(TX, NOW)).toBe(false);
  });
});
