import { describe, expect, it } from "vitest";
import { nextOccurrence, occurrenceIn, occursOn, repeatKey } from "./named-day-rules.js";

const xmas = { date: "2026-12-25", repeats: true };
const once = { ...xmas, repeats: false };
const leap = { date: "2024-02-29", repeats: true };

describe("named-day occurrences", () => {
  it.each([
    ["2026-12-25", true],
    ["2031-12-25", true],
    ["2025-12-25", false],
    ["2026-12-26", false],
    ["2026-11-25", false],
  ])("matches a repeating day on %s: %s", (date, want) => {
    expect(occursOn(xmas, date)).toBe(want);
  });

  it.each([
    ["2026-12-25", true],
    ["2025-12-25", false],
    ["2027-12-25", false],
    ["2026-12-26", false],
  ])("matches a one-off day on %s: %s", (date, want) => {
    expect(occursOn(once, date)).toBe(want);
  });

  it.each([
    ["2026-12-25", "12-25"],
    ["2024-02-29", "02-29"],
    ["2031-01-01", "01-01"],
  ])("keeps the month and day of %s", (date, want) => {
    expect(repeatKey(date)).toBe(want);
  });

  it.each([
    [2025, null],
    [2026, "2026-12-25"],
    [2031, "2031-12-25"],
  ])("finds a repeating day in year %i", (year, want) => {
    expect(occurrenceIn(xmas, year)).toBe(want);
  });

  it.each([
    [2025, null],
    [2026, "2026-12-25"],
    [2027, null],
  ])("finds a one-off day in its year only (%i)", (year, want) => {
    expect(occurrenceIn(once, year)).toBe(want);
  });

  it.each([
    [2020, null],
    [2024, "2024-02-29"],
    [2027, null],
    [2028, "2028-02-29"],
    [2100, null],
    [2400, "2400-02-29"],
  ])("repeats 29 February only in a later leap year (%i)", (year, want) => {
    expect(occurrenceIn(leap, year)).toBe(want);
  });

  it.each([
    [xmas, "2025-12-26", "2026-12-25"],
    [xmas, "2026-12-24", "2026-12-25"],
    [xmas, "2026-12-25", "2026-12-25"],
    [xmas, "2026-12-26", "2027-12-25"],
    [once, "2025-12-26", "2026-12-25"],
    [once, "2026-12-25", "2026-12-25"],
    [once, "2026-12-26", null],
    [leap, "2026-03-01", "2028-02-29"],
    [leap, "2028-02-29", "2028-02-29"],
    [leap, "2028-03-01", "2032-02-29"],
    [leap, "2097-03-01", "2104-02-29"],
    [leap, "9997-03-01", null],
    [xmas, "9999-12-26", null],
  ])("finds the next occurrence of %j on or after %s", (day, from, want) => {
    expect(nextOccurrence(day, from)).toBe(want);
  });
});
