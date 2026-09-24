import { expect, it } from "vitest";
import { formatIsoMinute } from "./date-utils.js";

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
