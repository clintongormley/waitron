import { describe, expect, it } from "vitest";
import {
  calendarDateOfTime,
  clockTimeSkipped,
  minuteOfServiceDay,
  parseServiceDay,
  rangeInForce,
  rangeSpan,
  serviceMomentAt,
  withExtension,
} from "./service-day.js";

const P = "00000000-0000-4000-8000-000000000001";
const Q = "00000000-0000-4000-8000-000000000002";
const lunch = { periodId: P, startsAt: "12:00", endsAt: "14:00" };
const afternoon = { periodId: Q, startsAt: "14:00", endsAt: "03:00" };

describe("service day", () => {
  it.each([
    ["06:00", "06:00", 0],
    ["05:45", "06:00", 1425],
    ["02:30", "06:00", 1230],
    ["00:00", "00:00", 0],
  ])("counts %s from changeover %s", (time, cutover, want) => {
    expect(minuteOfServiceDay(time, cutover)).toBe(want);
  });

  it("reads an end at the changeover as the end of the day", () => {
    expect(rangeSpan({ startsAt: "21:00", endsAt: "03:00" }, "06:00")).toEqual({
      start: 900,
      end: 1260,
    });
    expect(rangeSpan({ startsAt: "06:00", endsAt: "06:00" }, "06:00")).toEqual({
      start: 0,
      end: 1440,
    });
  });

  it.each([
    ["empty", [{ ...lunch, endsAt: "12:00" }]],
    ["order", [{ ...lunch, startsAt: "14:00", endsAt: "12:00" }]],
    ["step", [{ ...lunch, startsAt: "12:10" }]],
    ["step", [{ ...lunch, endsAt: "14:10" }]],
    ["overlap", [lunch, { ...afternoon, startsAt: "13:45" }]],
  ])("refuses a %s range", (reason, slots) => {
    expect(() => parseServiceDay(slots, "slots", "06:00")).toThrowError(
      expect.objectContaining({
        code: "menu_timetable.invalid",
        params: { field: "slots", reason },
      }),
    );
  });

  it.each([
    [null, "slots"],
    [{}, "slots"],
    [[null], "slots.0"],
    [["lunch"], "slots.0"],
    [[{ ...lunch, periodId: null }], "slots.0.periodId"],
    [[{ ...lunch, periodId: "not-a-uuid" }], "slots.0.periodId"],
    [[{ ...lunch, startsAt: null }], "slots.0.startsAt"],
    [[{ ...lunch, startsAt: "24:00" }], "slots.0.startsAt"],
    [[{ ...lunch, endsAt: null }], "slots.0.endsAt"],
    [[{ ...lunch, endsAt: "14:60" }], "slots.0.endsAt"],
  ])("refuses malformed ranges at %s", (value, field) => {
    expect(() => parseServiceDay(value, "slots", "06:00")).toThrowError(
      expect.objectContaining({ code: "menu_timetable.invalid", params: { field } }),
    );
  });

  it("sorts touching ranges on the business day and normalises period ids", () => {
    const id = "ABCDEFAB-0000-4000-8000-000000000001";
    expect(parseServiceDay([afternoon, { ...lunch, periodId: id }], "slots", "06:00")).toEqual([
      { ...lunch, periodId: id.toLowerCase() },
      afternoon,
    ]);
    expect(parseServiceDay([], "slots", "06:00")).toEqual([]);
  });

  it("accepts a full business day", () => {
    expect(
      parseServiceDay([{ periodId: P, startsAt: "06:00", endsAt: "06:00" }], "slots", "06:00"),
    ).toEqual([{ periodId: P, startsAt: "06:00", endsAt: "06:00" }]);
  });

  it.each([
    ["11:59", null],
    ["12:00", P],
    ["13:59", P],
    ["14:00", Q],
    ["02:30", Q],
    ["03:00", null],
  ])("picks the range at %s, end exclusive", (time, want) => {
    expect(
      rangeInForce([lunch, afternoon], minuteOfServiceDay(time, "06:00"), "06:00")?.periodId ??
        null,
    ).toBe(want);
  });

  it("puts Saturday morning in Friday's business day and weekday", () => {
    expect(
      serviceMomentAt(new Date("2026-10-10T00:30:00Z"), {
        timeZone: "Europe/Madrid",
        dayCutover: "06:00",
      }),
    ).toEqual({ businessDay: "2026-10-09", weekday: 5, minute: 1230 });
    expect(
      serviceMomentAt(new Date("2026-10-10T04:00:00Z"), {
        timeZone: "Europe/Madrid",
        dayCutover: "06:00",
      }),
    ).toEqual({ businessDay: "2026-10-10", weekday: 6, minute: 0 });
  });

  it.each([
    { timeZone: "Not/AZone", dayCutover: "06:00" },
    { timeZone: "Europe/Madrid", dayCutover: "24:00" },
  ])("returns null for a clock it cannot read: %j", (clock) => {
    expect(serviceMomentAt(new Date("2026-10-10T00:30:00Z"), clock)).toBeNull();
  });

  it("places a time before the changeover on the next calendar date", () => {
    expect(calendarDateOfTime("2026-03-28", "02:30", "06:00")).toBe("2026-03-29");
    expect(calendarDateOfTime("2026-03-28", "21:00", "06:00")).toBe("2026-03-28");
    expect(calendarDateOfTime("2026-12-31", "05:45", "06:00")).toBe("2027-01-01");
    expect(calendarDateOfTime("2026-03-28", "06:00", "06:00")).toBe("2026-03-28");
  });
});

describe("period extensions over the service day", () => {
  const day = [lunch, { ...afternoon, endsAt: "19:00" }];
  it("delays the next period while retaining the scheduled and extended runs", () => {
    expect(
      withExtension(day, { periodId: P, startsAt: "14:00", endsAt: "14:30" }, "06:00"),
    ).toEqual([
      lunch,
      { periodId: P, startsAt: "14:00", endsAt: "14:30" },
      { periodId: Q, startsAt: "14:30", endsAt: "19:00" },
    ]);
    expect(day).toEqual([lunch, { ...afternoon, endsAt: "19:00" }]);
  });
  it("drops a period wholly covered by the extension", () => {
    expect(
      withExtension(day, { periodId: P, startsAt: "14:00", endsAt: "20:00" }, "06:00"),
    ).toEqual([lunch, { periodId: P, startsAt: "14:00", endsAt: "20:00" }]);
  });
  it("ends an overnight extension at the next changeover", () => {
    expect(
      withExtension(
        [{ periodId: P, startsAt: "21:00", endsAt: "03:00" }],
        { periodId: P, startsAt: "03:00", endsAt: "06:00" },
        "06:00",
      ),
    ).toEqual([
      { periodId: P, startsAt: "21:00", endsAt: "03:00" },
      { periodId: P, startsAt: "03:00", endsAt: "06:00" },
    ]);
  });
  it("cuts both sides of a range the extension lies inside", () => {
    expect(
      withExtension(
        [{ periodId: Q, startsAt: "12:00", endsAt: "19:00" }],
        { periodId: P, startsAt: "14:00", endsAt: "15:00" },
        "06:00",
      ),
    ).toEqual([
      { periodId: Q, startsAt: "12:00", endsAt: "14:00" },
      { periodId: P, startsAt: "14:00", endsAt: "15:00" },
      { periodId: Q, startsAt: "15:00", endsAt: "19:00" },
    ]);
  });
  it("sorts an unchanged day and retains ranges outside the extension", () => {
    expect(withExtension([...day].reverse(), null, "06:00")).toEqual(day);
    expect(
      withExtension(day, { periodId: P, startsAt: "20:00", endsAt: "21:00" }, "06:00"),
    ).toEqual([...day, { periodId: P, startsAt: "20:00", endsAt: "21:00" }]);
  });
});

it("dates an end at the changeover on the next calendar day when checking skipped times", () => {
  expect(clockTimeSkipped("2027-03-27", "02:30", "02:30", "Europe/Madrid", true)).toBe(true);
  expect(clockTimeSkipped("2027-03-27", "02:30", "02:30", "Europe/Madrid", false)).toBe(false);
});
