import { describe, expect, it } from "vitest";
import { formatBytes } from "./bytes-format.js";

describe("formatBytes", () => {
  it("writes gigabytes to one decimal place in the reader's language", () => {
    expect(formatBytes(1_800_000_000, "es")).toBe("1,8 GB");
    expect(formatBytes(1_800_000_000, "en")).toBe("1.8 GB");
    expect(formatBytes(1_800_000_000, "es-ES")).toBe("1,8 GB");
  });

  it("writes megabytes as a whole number", () => {
    expect(formatBytes(950_000_000, "en")).toBe("950 MB");
    expect(formatBytes(1_499_999, "en")).toBe("1 MB");
    expect(formatBytes(0, "en")).toBe("0 MB");
  });

  it("switches to gigabytes once the megabytes round to 1000", () => {
    expect(formatBytes(999_499_999, "en")).toBe("999 MB");
    expect(formatBytes(999_500_000, "en")).toBe("1 GB");
  });

  it("writes a language it has no words for as English", () => {
    expect(formatBytes(1_800_000_000, "fr")).toBe("1.8 GB");
  });

  it("writes a dash for anything that is not a byte count", () => {
    for (const value of [null, undefined, -1, NaN, Infinity, "1800000000", {}]) {
      expect(formatBytes(value, "en")).toBe("—");
    }
  });
});
