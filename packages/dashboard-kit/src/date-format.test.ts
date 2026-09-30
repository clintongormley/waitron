import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { formatIsoMinute } from "./date-format.js";

// Node reads a changed TZ at once, so the zone is pinned for this file alone.
beforeAll(() => {
  vi.stubEnv("TZ", "America/New_York");
});
afterAll(() => {
  vi.unstubAllEnvs();
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
