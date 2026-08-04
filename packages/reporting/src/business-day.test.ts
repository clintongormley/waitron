import { describe, expect, it } from "vitest";
import { validateBusinessDay, validateCutover, validateTimeZone } from "./business-day.js";

describe("validateTimeZone", () => {
  it("accepts a valid IANA zone", () => {
    expect(() => validateTimeZone("Europe/Madrid")).not.toThrow();
  });
  it("rejects a non-existent zone", () => {
    expect(() => validateTimeZone("Mars/Olympus")).toThrow(/time zone/i);
  });
  it("rejects UTC-offset shorthand (must be a named zone)", () => {
    expect(() => validateTimeZone("+02:00")).toThrow(/time zone/i);
  });
});

describe("validateCutover", () => {
  it("accepts a zero-padded HH:MM", () => {
    expect(() => validateCutover("05:00")).not.toThrow();
    expect(() => validateCutover("00:00")).not.toThrow();
    expect(() => validateCutover("23:59")).not.toThrow();
  });
  it.each(["5:00", "24:00", "23:60", "05:0", "0500", "05:00:00"])("rejects %s", (bad) => {
    expect(() => validateCutover(bad)).toThrow(/cutover/i);
  });
});

describe("validateBusinessDay", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(() => validateBusinessDay("2026-08-04")).not.toThrow();
  });
  it.each(["2026-8-4", "04-08-2026", "2026/08/04", "garbage"])("rejects %s", (bad) => {
    expect(() => validateBusinessDay(bad)).toThrow(/business day/i);
  });
});
