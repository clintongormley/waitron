import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  formatBusinessDate,
  formatChangeoverMoment,
  formatDayLength,
  formatIsoMinute,
} from "./date-format.js";
import { setLocale } from "./i18n.js";

// Node reads a changed TZ at once, so the zone is pinned for this file alone.
beforeAll(() => {
  vi.stubEnv("TZ", "America/New_York");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  setLocale("es-ES");
});

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

it("pads a single-digit month, day, hour and minute", () => {
  expect(formatIsoMinute("2026-03-04T11:07:00.000Z")).toBe("2026-03-04 06:07");
});

it("formats a changeover moment in the venue's zone, not the browser's", () => {
  expect(formatChangeoverMoment("2026-10-21T01:00:00.000Z", "Europe/Madrid", "en-GB")).toBe(
    "Wed 21 Oct, 03:00",
  );
  expect(formatChangeoverMoment("2026-10-21T01:00:00.000Z", "Europe/Madrid", "es-ES")).toBe(
    "mié 21 oct, 03:00",
  );
});

it("formats in the active locale when none is passed", () => {
  setLocale("en-GB");
  expect(formatChangeoverMoment("2026-10-21T01:00:00.000Z", "Europe/Madrid")).toBe(
    "Wed 21 Oct, 03:00",
  );
  expect(formatBusinessDate("2026-10-20")).toBe("Tue 20 Oct");
});

it("formats a business date as the calendar day it names, whatever the browser's zone", () => {
  expect(formatBusinessDate("2026-10-20", "en-GB")).toBe("Tue 20 Oct");
  expect(formatBusinessDate("2026-10-20", "es-ES")).toBe("mar 20 oct");
});

it("formats a day's length in whole hours and minutes, leaving out a zero part", () => {
  expect(formatDayLength(1320)).toBe("22 h");
  expect(formatDayLength(1170)).toBe("19 h 30 min");
  expect(formatDayLength(2879)).toBe("47 h 59 min");
  expect(formatDayLength(1)).toBe("1 min");
  expect(formatDayLength(1380)).toBe("23 h");
  expect(formatDayLength(780)).toBe("13 h");
});
