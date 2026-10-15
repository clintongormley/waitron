import { describe, expect, it } from "vitest";
import type { BusinessDayClock } from "@waitron/shared";
import { resolveFindBillDates } from "./find-bill-dates.js";
import type { FindBillDates } from "./find-bill-types.js";

const clock: BusinessDayClock = {
  timeZone: "Europe/Madrid",
  dayCutover: "05:00",
  cutoverChanges: [],
};
const now = new Date("2026-10-15T01:00:00Z");
describe("Find a bill dates", () => {
  it.each([
    ["today", "2026-10-15", "2026-10-15", "2026-10-14T22:00:00.000Z", "2026-10-15T22:00:00.000Z"],
    [
      "yesterday",
      "2026-10-14",
      "2026-10-14",
      "2026-10-13T22:00:00.000Z",
      "2026-10-14T22:00:00.000Z",
    ],
    [
      "business-day",
      "2026-10-14",
      "2026-10-14",
      "2026-10-14T03:00:00.000Z",
      "2026-10-15T03:00:00.000Z",
    ],
    [
      "last-7-days",
      "2026-10-09",
      "2026-10-15",
      "2026-10-08T22:00:00.000Z",
      "2026-10-15T22:00:00.000Z",
    ],
    [
      "this-month",
      "2026-10-01",
      "2026-10-31",
      "2026-09-30T22:00:00.000Z",
      "2026-10-31T23:00:00.000Z",
    ],
  ] as const)("uses venue dates for %s", (preset, from, to, startAt, endAt) => {
    expect(resolveFindBillDates(clock, { preset }, now)).toEqual({ from, to, startAt, endAt });
  });
  it.each([
    ["2026-10-25", "2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"],
    ["2026-03-29", "2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"],
    ["2028-02-29", "2028-02-28T23:00:00.000Z", "2028-02-29T23:00:00.000Z"],
  ])("uses inclusive civil dates across DST and leap days %s", (day, startAt, endAt) => {
    expect(resolveFindBillDates(clock, { preset: "custom", from: day, to: day }, now)).toEqual({
      from: day,
      to: day,
      startAt,
      endAt,
    });
  });
  it("includes every custom day and ignores business cutovers for civil presets", () => {
    expect(
      resolveFindBillDates(
        {
          ...clock,
          dayCutover: "12:00",
          cutoverChanges: [{ effectiveBusinessDay: "2026-10-14", dayCutover: "15:00" }],
        },
        { preset: "custom", from: "2026-10-14", to: "2026-10-16" },
        now,
      ),
    ).toEqual({
      from: "2026-10-14",
      to: "2026-10-16",
      startAt: "2026-10-13T22:00:00.000Z",
      endAt: "2026-10-16T22:00:00.000Z",
    });
  });
  it.each([
    [
      "2026-10-15T03:59:59.999Z",
      "2026-10-14",
      "2026-10-14T03:00:00.000Z",
      "2026-10-15T04:00:00.000Z",
    ],
    [
      "2026-10-15T04:00:00.000Z",
      "2026-10-15",
      "2026-10-15T04:00:00.000Z",
      "2026-10-16T04:00:00.000Z",
    ],
  ])("uses the scheduled business boundary at %s", (instant, day, startAt, endAt) => {
    const scheduled = {
      ...clock,
      cutoverChanges: [{ effectiveBusinessDay: "2026-10-15", dayCutover: "06:00" }],
    };
    expect(resolveFindBillDates(scheduled, { preset: "business-day" }, new Date(instant))).toEqual({
      from: day,
      to: day,
      startAt,
      endAt,
    });
  });
  it("uses the specified zone rather than the host date", () => {
    expect(
      resolveFindBillDates({ ...clock, timeZone: "Pacific/Honolulu" }, { preset: "today" }, now),
    ).toEqual({
      from: "2026-10-14",
      to: "2026-10-14",
      startAt: "2026-10-14T10:00:00.000Z",
      endAt: "2026-10-15T10:00:00.000Z",
    });
    expect(resolveFindBillDates(clock, { preset: "any" }, now)).toBeNull();
  });
  it.each([
    [{ preset: "custom", from: "2026-02-29", to: "2026-03-01" }, "from"],
    [{ preset: "custom", from: "2026-10-16", to: "2026-10-15" }, "to"],
    [{ preset: "custom", from: "2026-10-15", to: "garbage" }, "to"],
  ] as const)("refuses invalid range %j", (dates, field) => {
    expect(() => resolveFindBillDates(clock, dates as FindBillDates, now)).toThrow(
      expect.objectContaining({ code: "management.request_invalid", params: { field } }),
    );
  });
});
