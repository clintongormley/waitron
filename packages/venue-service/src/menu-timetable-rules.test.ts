import { describe, expect, it } from "vitest";
import {
  firstMenuClash,
  menuPeriodName,
  parseMenuWeek,
  parseSlots,
  slotCell,
  slotInForce,
  slotIntervals,
} from "./menu-timetable-rules.js";
import type { MenuSlot } from "./menu-timetable-types.js";

const MANANAS = "11111111-1111-4111-8111-111111111111";
const MADRUGADA = "22222222-2222-4222-8222-222222222222";
const slot = (startsAt: string, endsAt: string, periodId = MANANAS): MenuSlot => ({
  periodId,
  startsAt,
  endsAt,
});
const week = (byWeekday: Record<number, MenuSlot[]> = {}) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: byWeekday[weekday] ?? [] }));
const invalid = (field: string, extra: Record<string, string> = {}) => ({
  code: "menu_timetable.invalid",
  params: { field, ...extra },
});

describe("a day's slots", () => {
  it("keeps valid slots, lower-casing the period id", () => {
    expect(parseSlots([slot("09:00", "12:00", MANANAS.toUpperCase())], "slots")).toEqual([
      slot("09:00", "12:00"),
    ]);
    expect(parseSlots([], "slots")).toEqual([]);
  });

  it("refuses a slot overlapping an earlier one of the same day, naming the later", () => {
    expect(() =>
      parseSlots(
        [slot("09:00", "12:00"), slot("12:00", "16:00"), slot("15:00", "17:00")],
        "days.1.slots",
      ),
    ).toThrow(expect.objectContaining(invalid("days.1.slots.2")));
    // One running past midnight overlaps a later one that day.
    expect(() => parseSlots([slot("22:00", "02:00"), slot("23:00", "23:30")], "slots")).toThrow(
      expect.objectContaining(invalid("slots.1")),
    );
  });

  it("refuses an end equal to the start, a malformed time and a period id that is no UUID", () => {
    expect(() => parseSlots([slot("09:00", "09:00")], "slots")).toThrow(
      expect.objectContaining(invalid("slots.0.endsAt")),
    );
    expect(() => parseSlots([slot("9:00", "12:00")], "slots")).toThrow(
      expect.objectContaining(invalid("slots.0.startsAt")),
    );
    expect(() => parseSlots([slot("09:00", "24:00")], "slots")).toThrow(
      expect.objectContaining(invalid("slots.0.endsAt")),
    );
    expect(() => parseSlots([slot("09:00", "12:00", "mananas")], "days.3.slots")).toThrow(
      expect.objectContaining(invalid("days.3.slots.0.periodId")),
    );
    expect(() => parseSlots("09:00", "slots")).toThrow(expect.objectContaining(invalid("slots")));
    expect(() => parseSlots([null], "slots")).toThrow(expect.objectContaining(invalid("slots.0")));
  });

  it("measures a slot past midnight on its own day's timeline", () => {
    expect(slotIntervals([slot("09:00", "12:00"), slot("22:00", "02:00")])).toEqual([
      { start: 540, end: 720 },
      { start: 1320, end: 1560 },
    ]);
    expect(slotCell([slot("22:00", "02:00", MADRUGADA)])).toEqual({
      mode: "periods",
      periods: [{ id: MADRUGADA, opensAt: "22:00", closesAt: "02:00" }],
    });
  });
});

describe("a whole menu week", () => {
  it("takes one entry per weekday, indexed by weekday", () => {
    const sent = [...week({ 1: [slot("09:00", "12:00")] })].reverse();
    const parsed = parseMenuWeek(sent);
    expect(parsed.slots[1]).toEqual([slot("09:00", "12:00")]);
    expect(parsed.indexOf[1]).toBe(5);
  });

  it("refuses a Friday slot past midnight overlapping a Saturday slot, Sunday into Monday included", () => {
    const friday = slot("22:00", "02:00", MADRUGADA);
    expect(() => parseMenuWeek(week({ 5: [friday], 6: [slot("01:00", "03:00")] }))).toThrow(
      expect.objectContaining(invalid("days.6.slots")),
    );
    expect(() => parseMenuWeek(week({ 0: [friday], 1: [slot("01:00", "03:00")] }))).toThrow(
      expect.objectContaining(invalid("days.1.slots")),
    );
    // Ending exactly where the next day's first slot starts is no overlap.
    expect(parseMenuWeek(week({ 5: [friday], 6: [slot("02:00", "03:00")] })).slots[6]).toHaveLength(
      1,
    );
  });

  it("refuses a week that is not seven distinct weekdays", () => {
    expect(() => parseMenuWeek(week().slice(1))).toThrow(expect.objectContaining(invalid("days")));
    expect(() => parseMenuWeek({})).toThrow(expect.objectContaining(invalid("days")));
    const twice = week();
    twice[6] = { weekday: 0, slots: [] };
    expect(() => parseMenuWeek(twice)).toThrow(expect.objectContaining(invalid("days.6.weekday")));
    const outside = week();
    outside[3] = { weekday: 7, slots: [] };
    expect(() => parseMenuWeek(outside)).toThrow(
      expect.objectContaining(invalid("days.3.weekday")),
    );
    const broken = week() as unknown[];
    broken[2] = "Tuesday";
    expect(() => parseMenuWeek(broken)).toThrow(expect.objectContaining(invalid("days.2")));
    const slotsMissing = week() as unknown[];
    slotsMissing[4] = { weekday: 4 };
    expect(() => parseMenuWeek(slotsMissing)).toThrow(
      expect.objectContaining(invalid("days.4.slots")),
    );
  });
});

describe("a named period's name", () => {
  it("is trimmed, and a blank one is refused", () => {
    expect(menuPeriodName("  Mañanas ")).toBe("Mañanas");
    expect(() => menuPeriodName("   ")).toThrow(expect.objectContaining(invalid("name")));
    expect(() => menuPeriodName(7)).toThrow(expect.objectContaining(invalid("name")));
  });
});

describe("the slot in force", () => {
  const mananas = slot("09:00", "12:00");
  const madrugada = slot("22:00", "02:00", MADRUGADA);

  it("includes the start and excludes the end", () => {
    expect(slotInForce([mananas], [], "09:00")).toEqual(mananas);
    expect(slotInForce([mananas], [], "11:59")).toEqual(mananas);
    expect(slotInForce([mananas], [], "12:00")).toBeNull();
    expect(slotInForce([mananas], [], "08:59")).toBeNull();
  });

  it("runs a slot past midnight on its own day and into the next, until its end", () => {
    expect(slotInForce([madrugada], [], "23:30")).toEqual(madrugada);
    expect(slotInForce([], [madrugada], "01:59")).toEqual(madrugada);
    expect(slotInForce([], [madrugada], "02:00")).toBeNull();
    // Only the earlier day's slots that run past midnight reach into today.
    expect(slotInForce([], [mananas], "10:00")).toBeNull();
  });

  it("prefers today's slot when yesterday's tail also matches", () => {
    const early = slot("01:00", "03:00");
    expect(slotInForce([early], [madrugada], "01:30")).toEqual(early);
  });
});

describe("a clash beside a special date", () => {
  const tail = [{ start: 1320, end: 1560 }];
  const early = [{ start: 60, end: 180 }];
  const weekOf = (byWeekday: Record<number, typeof tail>) =>
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => byWeekday[weekday] ?? []);

  it("finds a special date's own slot overlapped by the week's tail, or its tail overlapping the week", () => {
    // 2026-12-26 is a Saturday; Friday's week runs past midnight.
    expect(
      firstMenuClash(new Map([["2026-12-26", early]]), weekOf({ 5: tail }), ["2026-12-26"], null),
    ).toEqual({ date: "2026-12-26", other: "2026-12-25" });
    expect(
      firstMenuClash(new Map([["2026-12-25", tail]]), weekOf({ 6: early }), ["2026-12-25"], null),
    ).toEqual({ date: "2026-12-25", other: "2026-12-26" });
    expect(
      firstMenuClash(new Map([["2026-12-26", early]]), weekOf({}), ["2026-12-26"], null),
    ).toBeNull();
  });

  it("leaves out a clash between two special dates when asked about the week alone", () => {
    const dates = new Map([
      ["2026-12-25", tail],
      ["2026-12-26", early],
    ]);
    expect(firstMenuClash(dates, weekOf({}), ["2026-12-25"], null)).toEqual({
      date: "2026-12-25",
      other: "2026-12-26",
    });
    expect(firstMenuClash(dates, weekOf({}), ["2026-12-25"], null, true)).toBeNull();
    // A pair with one day from the week still counts.
    expect(
      firstMenuClash(
        new Map([["2026-12-26", early]]),
        weekOf({ 5: tail }),
        ["2026-12-26"],
        null,
        true,
      ),
    ).toEqual({ date: "2026-12-26", other: "2026-12-25" });
  });

  it("leaves out a pair already past at today", () => {
    expect(
      firstMenuClash(
        new Map([["2026-12-26", early]]),
        weekOf({ 5: tail }),
        ["2026-12-26"],
        "2026-12-27",
      ),
    ).toBeNull();
    expect(
      firstMenuClash(
        new Map([["2026-12-26", early]]),
        weekOf({ 5: tail }),
        ["2026-12-26"],
        "2026-12-26",
      ),
    ).toEqual({ date: "2026-12-26", other: "2026-12-25" });
  });
});
