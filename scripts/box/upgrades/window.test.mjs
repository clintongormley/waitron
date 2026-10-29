import { describe, expect, it } from "vitest";
import { resolveUpdateWindow } from "./window.mjs";

const settings = (values = {}) => ({
  version: 1,
  revision: 7,
  automatic: true,
  start: "03:00",
  end: "05:00",
  timeZone: "Europe/Madrid",
  clockDigest: "a".repeat(64),
  clockReviewRequired: false,
  ...values,
});

describe("dated update windows", () => {
  it.each([
    ["2026-10-29", {}, "2026-10-29T02:00:00Z", "2026-10-29T04:00:00Z"],
    ["2026-07-15", {}, "2026-07-15T01:00:00Z", "2026-07-15T03:00:00Z"],
    [
      "2026-10-29",
      { start: "23:30", end: "01:30" },
      "2026-10-29T22:30:00Z",
      "2026-10-30T00:30:00Z",
    ],
    [
      "2026-12-31",
      { start: "23:30", end: "01:30" },
      "2026-12-31T22:30:00Z",
      "2027-01-01T00:30:00Z",
    ],
    [
      "2028-02-28",
      { start: "23:30", end: "01:30" },
      "2028-02-28T22:30:00Z",
      "2028-02-29T00:30:00Z",
    ],
    [
      "2026-03-29",
      { start: "01:30", end: "04:00" },
      "2026-03-29T00:30:00Z",
      "2026-03-29T02:00:00Z",
    ],
    [
      "2026-10-25",
      { start: "01:30", end: "04:00" },
      "2026-10-24T23:30:00Z",
      "2026-10-25T03:00:00Z",
    ],
    ["2026-10-29", { timeZone: "Asia/Kathmandu" }, "2026-10-28T21:15:00Z", "2026-10-28T23:15:00Z"],
    ["2026-10-29", { timeZone: "UTC" }, "2026-10-29T03:00:00Z", "2026-10-29T05:00:00Z"],
  ])("resolves exact UTC bounds for %s %#", (date, values, start, end) => {
    const result = resolveUpdateWindow(settings(values), date);
    expect(result).toEqual({
      kind: "resolved",
      occurrence: {
        id: `${date}/${values.timeZone ?? "Europe/Madrid"}/7`,
        startDate: date,
        zone: values.timeZone ?? "Europe/Madrid",
        revision: 7,
        startMs: Date.parse(start),
        endMs: Date.parse(end),
      },
    });
  });

  it.each([
    ["2026-03-29", "02:30", "05:00", "endpoint-gap"],
    ["2026-03-29", "01:00", "02:30", "endpoint-gap"],
    ["2026-10-25", "02:30", "05:00", "endpoint-fold"],
    ["2026-10-25", "01:00", "02:30", "endpoint-fold"],
    ["2026-03-28", "23:00", "02:30", "endpoint-gap"],
    ["2026-10-24", "23:00", "02:30", "endpoint-fold"],
  ])("skips %s %s–%s rather than choosing an offset", (date, start, end, reason) => {
    expect(resolveUpdateWindow(settings({ start, end }), date)).toEqual({ kind: "skip", reason });
  });

  it("does not turn a skipped civil date into a different day", () => {
    expect(resolveUpdateWindow(settings({ timeZone: "Pacific/Apia" }), "2011-12-30")).toEqual({
      kind: "skip",
      reason: "endpoint-gap",
    });
  });

  it("refuses an occurrence with a negative UTC instant", () => {
    expect(() => resolveUpdateWindow(settings(), "1969-12-31")).toThrowError(
      expect.objectContaining({ reason: "window-date" }),
    );
  });

  it.each([true, false])(
    "keeps an explicitly unset window ineligible with automatic=%s",
    (automatic) => {
      expect(
        resolveUpdateWindow(settings({ start: null, end: null, automatic }), "2026-10-29"),
      ).toEqual({ kind: "skip", reason: "window-unset" });
    },
  );

  it("waits for review of the current clock binding", () => {
    expect(resolveUpdateWindow(settings({ clockReviewRequired: true }), "2026-10-29")).toEqual({
      kind: "skip",
      reason: "clock-review",
    });
  });

  it.each(["2026-02-29", "2026-13-01", "2026-10-29T00:00", "2026-1-01", "", null])(
    "refuses malformed date %s",
    (date) => {
      expect(() => resolveUpdateWindow(settings(), date)).toThrowError(
        expect.objectContaining({ reason: "window-date" }),
      );
    },
  );

  it("changes the occurrence identity when the saved generation changes", () => {
    const a = resolveUpdateWindow(settings(), "2026-10-29");
    const b = resolveUpdateWindow(settings({ revision: 8 }), "2026-10-29");
    expect(b.occurrence.id).toBe("2026-10-29/Europe/Madrid/8");
    expect(b.occurrence.id).not.toBe(a.occurrence.id);
  });
});
