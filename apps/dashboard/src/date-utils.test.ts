import { expect, it } from "vitest";
import { formatIsoMinute } from "./date-utils.js";

// This file runs in the Node project (see vitest.config.ts), whose worker has TZ=America/New_York.
// `formatIsoMinute` must render the operator's LOCAL wall clock, not the UTC one the ISO string
// carries. All three cases below turn on that difference, so they fail against a UTC string-slice.

// A canary. If TZ did not actually pin — the failure mode the whole Node project exists to prevent —
// the worker falls back to the machine's zone, which on a UTC CI runner is UTC (offset 0). Asserting
// the exact America/New_York winter offset (5 hours behind → +300 minutes) makes an unpinned run
// fail HERE, loudly, rather than letting the timestamp assertions below pass vacuously because local
// happened to equal UTC.
it("runs with the timezone pinned to America/New_York (guards against a vacuous pass)", () => {
  expect(new Date("2026-01-15T05:30:00.000Z").getTimezoneOffset()).toBe(300);
});

it("renders the local wall-clock minute, not the UTC one the ISO carries", () => {
  // 05:30 UTC is 00:30 the same morning in New York (EST, UTC-5).
  expect(formatIsoMinute("2026-01-15T05:30:00.000Z")).toBe("2026-01-15 00:30");
});

it("rolls the date back when the local zone is behind midnight UTC", () => {
  // 02:00 UTC on the 15th is still 21:00 on the 14th in New York — the DATE part is localized too,
  // which a slice of the ISO string can never do.
  expect(formatIsoMinute("2026-01-15T02:00:00.000Z")).toBe("2026-01-14 21:00");
});

it("does not merely echo the UTC slice of the ISO string", () => {
  const iso = "2026-01-15T05:30:00.000Z";
  const utcSlice = `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  expect(formatIsoMinute(iso)).not.toBe(utcSlice);
});
