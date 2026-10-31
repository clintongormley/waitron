import { describe, expect, it } from "vitest";
import { formatDuration } from "./duration-format.js";

const S = 1_000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe("formatDuration", () => {
  it("writes the two largest non-zero whole units, whichever way the number points", () => {
    expect(formatDuration(2 * D + 3 * H + 4 * M, "en")).toBe("2 days and 3 hours");
    expect(formatDuration(-(2 * D + 3 * H), "en")).toBe("2 days and 3 hours");
    expect(formatDuration(D + 5 * M, "en")).toBe("1 day and 5 minutes");
    expect(formatDuration(D + 59 * S, "en")).toBe("1 day and 59 seconds");
    expect(formatDuration(H, "en")).toBe("1 hour");
    expect(formatDuration(2 * M + 30 * S + 400, "en")).toBe("2 minutes and 30 seconds");
    expect(formatDuration(400 * D, "en")).toBe("400 days");
  });

  it("writes one second and over in whole seconds, and less as tenths", () => {
    expect(formatDuration(1_000, "en")).toBe("1 second");
    expect(formatDuration(1_999, "en")).toBe("1 second");
    expect(formatDuration(999, "en")).toBe("0.9 seconds");
    expect(formatDuration(-400, "en")).toBe("0.4 seconds");
    expect(formatDuration(0, "en")).toBe("0 seconds");
  });

  it("writes the units in the reader's language, from the runtime's own locale data", () => {
    const spanish = formatDuration(2 * D + 3 * H, "es");
    expect(spanish).toMatch(/^2 \S+ \S+ 3 \S+$/);
    expect(spanish).not.toMatch(/day|hour|and/);
    expect(formatDuration(400, "es")).toMatch(/^0,4 \S+$/);
  });

  it("writes a dash for anything that is not a number of milliseconds", () => {
    for (const value of ["1000", null, undefined, NaN, Infinity, -Infinity, {}]) {
      expect(formatDuration(value, "en")).toBe("—");
    }
  });
});
