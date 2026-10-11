import { describe, expect, it, vi } from "vitest";
import { AppError } from "./errors.js";
import {
  businessDayAt,
  businessDayBoundaryAt,
  businessDayBounds,
  cutoverForBusinessDay,
  type BusinessDayClock,
} from "./business-day-clock.js";

const madrid = (dayCutover = "05:00"): BusinessDayClock => ({
  timeZone: "Europe/Madrid",
  dayCutover,
  cutoverChanges: [],
});

describe("clock input refusal", () => {
  it("reports an unreadable clock with a domain code and a reason", () => {
    try {
      businessDayBoundaryAt(madrid(), "not-a-day");
      expect.fail("invalid date accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "business_day.clock_invalid",
        params: { reason: "invalid_date" },
      });
    }
  });
  it.each(["2026-02-30", "2026-13-01", "2026-1-01", "not-a-day"])(
    "refuses the invalid business date %s",
    (day) => expect(() => businessDayBoundaryAt(madrid(), day)).toThrow(/clock/),
  );
  it.each(["5:00", "24:00", "05:60", "05:00:00"])("refuses the invalid start %s", (dayCutover) => {
    expect(() => businessDayBounds(madrid(dayCutover), "2026-11-04")).toThrow(/clock/);
  });
  it.each(["Invalid/Zone", "+02:00"])("refuses the invalid named zone %s", (timeZone) => {
    expect(() => businessDayBoundaryAt({ ...madrid(), timeZone }, "2026-11-04")).toThrow(/clock/);
  });
  it.each([
    [{ effectiveBusinessDay: "2026-02-30", dayCutover: "03:00" }],
    [{ effectiveBusinessDay: "2026-11-04", dayCutover: "25:00" }],
    [
      { effectiveBusinessDay: "2026-11-04", dayCutover: "03:00" },
      { effectiveBusinessDay: "2026-11-04", dayCutover: "07:00" },
    ],
    [
      { effectiveBusinessDay: "2026-12-01", dayCutover: "03:00" },
      { effectiveBusinessDay: "2026-11-04", dayCutover: "07:00" },
    ],
  ])("refuses malformed or unordered changes %#", (...cutoverChanges) => {
    expect(() => cutoverForBusinessDay({ ...madrid(), cutoverChanges }, "2026-11-04")).toThrow(
      /clock/,
    );
  });
  it("refuses an invalid instant", () => {
    expect(() => businessDayAt(madrid(), new Date("invalid"))).toThrow(/clock/);
  });
  it("refuses a zero-length day across a skipped civil date", () => {
    expect(() =>
      businessDayBounds({ ...madrid(), timeZone: "Pacific/Apia" }, "2011-12-29"),
    ).toThrow(
      expect.objectContaining({
        code: "business_day.clock_invalid",
        params: { reason: "non_increasing_boundary" },
      }),
    );
  });
  it("accepts a real leap day", () => {
    expect(businessDayBoundaryAt(madrid(), "2024-02-29")).toBe("2024-02-29T04:00:00.000Z");
  });
  it("accepts the bare GMT spelling from a runtime", () => {
    const original = Intl.DateTimeFormat.prototype.formatToParts;
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "formatToParts")
      .mockImplementation(function (this: Intl.DateTimeFormat, at) {
        return original
          .call(this, at)
          .map((part) => (part.type === "timeZoneName" ? { ...part, value: "GMT" } : part));
      });
    try {
      expect(businessDayBoundaryAt({ ...madrid(), timeZone: "UTC" }, "2026-11-04")).toBe(
        "2026-11-04T05:00:00.000Z",
      );
    } finally {
      spy.mockRestore();
    }
  });
  it("refuses an unreadable runtime offset instead of assuming UTC", () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([]);
    try {
      expect(() => businessDayBoundaryAt(madrid(), "2026-11-04")).toThrow(/clock/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("dated business-day boundaries", () => {
  it.each([
    ["03:00", "2026-11-04T02:00:00.000Z"],
    ["07:00", "2026-11-04T06:00:00.000Z"],
  ])("joins the preceding day to the new %s start", (dayCutover, boundary) => {
    const clock = {
      ...madrid(),
      cutoverChanges: [{ effectiveBusinessDay: "2026-11-04", dayCutover }],
    };
    expect(businessDayBounds(clock, "2026-11-02")).toEqual({
      startAt: "2026-11-02T04:00:00.000Z",
      endAt: "2026-11-03T04:00:00.000Z",
    });
    expect(businessDayBounds(clock, "2026-11-03")).toEqual({
      startAt: "2026-11-03T04:00:00.000Z",
      endAt: boundary,
    });
    expect(businessDayBoundaryAt(clock, "2026-11-04")).toBe(boundary);
    expect(businessDayAt(clock, new Date(Date.parse(boundary) - 1))).toBe("2026-11-03");
    expect(businessDayAt(clock, new Date(boundary))).toBe("2026-11-04");
    expect(businessDayAt(clock, new Date(Date.parse(boundary) + 1))).toBe("2026-11-04");
  });

  it("selects the rule for each date across retained and future changes", () => {
    const clock = {
      ...madrid(),
      cutoverChanges: [
        { effectiveBusinessDay: "2026-11-04", dayCutover: "03:00" },
        { effectiveBusinessDay: "2026-12-01", dayCutover: "07:30" },
      ],
    };
    expect(cutoverForBusinessDay(clock, "2026-11-03")).toBe("05:00");
    expect(cutoverForBusinessDay(clock, "2026-11-04")).toBe("03:00");
    expect(cutoverForBusinessDay(clock, "2026-11-30")).toBe("03:00");
    expect(cutoverForBusinessDay(clock, "2026-12-01")).toBe("07:30");
    expect(businessDayBounds(clock, "2026-11-30")).toEqual({
      startAt: "2026-11-30T02:00:00.000Z",
      endAt: "2026-12-01T06:30:00.000Z",
    });
  });

  it("steps the following calendar date across a year boundary", () => {
    expect(businessDayBounds(madrid("00:15"), "2026-12-31")).toEqual({
      startAt: "2026-12-30T23:15:00.000Z",
      endAt: "2026-12-31T23:15:00.000Z",
    });
  });

  it.each([
    ["2026-10-25T00:45:00.000Z", "2026-10-24"],
    ["2026-10-25T01:29:59.999Z", "2026-10-24"],
    ["2026-10-25T01:30:00.000Z", "2026-10-25"],
    ["2026-10-25T01:45:00.000Z", "2026-10-25"],
  ])("keeps chronological day identity through the repeated hour at %s", (at, day) => {
    expect(businessDayAt(madrid("02:30"), new Date(at))).toBe(day);
  });

  it.each([
    ["2026-03-29", "2026-03-29T01:30:00.000Z"],
    ["2026-10-25", "2026-10-25T01:30:00.000Z"],
  ])("retains the reporting conversion at Madrid's clock change on %s", (day, boundary) => {
    expect(businessDayBoundaryAt(madrid("02:30"), day)).toBe(boundary);
  });

  it.each([
    ["UTC", "2026-08-04T04:15:00.000Z"],
    ["America/New_York", "2026-08-04T08:15:00.000Z"],
  ])("uses the explicit %s zone for a non-hour start", (timeZone, boundary) => {
    const clock = { ...madrid("04:15"), timeZone };
    expect(businessDayBoundaryAt(clock, "2026-08-04")).toBe(boundary);
    expect(businessDayAt(clock, new Date(Date.parse(boundary) - 1))).toBe("2026-08-03");
    expect(businessDayAt(clock, new Date(boundary))).toBe("2026-08-04");
  });
});
