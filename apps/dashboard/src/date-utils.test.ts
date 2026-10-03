import { expect, it } from "vitest";
import { formatIsoMinute, lastEndedQuarter } from "./date-utils.js";

// Runs in the Node project (vitest.config.ts), whose worker has TZ=America/New_York.
it("runs with the timezone pinned to America/New_York (guards against a vacuous pass)", () => {
  expect(new Date("2026-01-15T05:30:00.000Z").getTimezoneOffset()).toBe(300);
});

it("renders the local wall-clock minute, not the UTC one the ISO carries", () => {
  // 05:30 UTC is 00:30 the same morning in New York (EST, UTC-5).
  expect(formatIsoMinute("2026-01-15T05:30:00.000Z")).toBe("2026-01-15 00:30");
});

it("rolls the date back when the local zone is behind midnight UTC", () => {
  expect(formatIsoMinute("2026-01-15T02:00:00.000Z")).toBe("2026-01-14 21:00");
});

it("does not merely echo the UTC slice of the ISO string", () => {
  const iso = "2026-01-15T05:30:00.000Z";
  const utcSlice = `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  expect(formatIsoMinute(iso)).not.toBe(utcSlice);
});

it("names the quarter that ended most recently on the local calendar", () => {
  expect(lastEndedQuarter(new Date("2026-10-03T10:00:00Z"))).toEqual({ year: 2026, quarter: 3 });
  expect(lastEndedQuarter(new Date("2026-02-10T10:00:00Z"))).toEqual({ year: 2025, quarter: 4 });
});

// Each instant is already the next quarter in UTC and still the previous day in New York.
it.each([
  ["2026-10-01T02:00:00Z", { year: 2026, quarter: 2 }],
  ["2026-01-01T02:00:00Z", { year: 2025, quarter: 3 }],
])("reads the local month and year, not the UTC ones, at %s", (instant, expected) => {
  expect(lastEndedQuarter(new Date(instant))).toEqual(expected);
});
