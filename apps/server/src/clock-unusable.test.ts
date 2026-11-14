import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "@waitron/fiscal-verifactu";
import { clockUnusableAt } from "./clock-unusable.js";

const reading = { instant: new Date("2024-10-27T12:00:00.000Z"), offsetMinutes: 0 };

describe("clockUnusableAt", () => {
  it("answers true when the seat refuses the reading as clock.unusable", () => {
    const backend = {
      assertRecordableAt: () => {
        throw new AppError("clock.unusable", {
          clockAt: reading.instant.toISOString(),
          offsetMinutes: 0,
        });
      },
    };
    expect(clockUnusableAt(backend, reading)).toBe(true);
  });

  it("answers false when the seat accepts the reading", () => {
    expect(clockUnusableAt({ assertRecordableAt: () => {} }, reading)).toBe(false);
  });

  it("throws any other refusal", () => {
    const other = new AppError("clock.behind_chain", {
      clockAt: reading.instant.toISOString(),
      offsetMinutes: 0,
      lastRecordAt: "2026-07-20T18:20:30.000Z",
      lastRecordOffsetMinutes: 0,
    });
    const backend = {
      assertRecordableAt: () => {
        throw other;
      },
    };
    expect(() => clockUnusableAt(backend, reading)).toThrow(other);
  });
});
