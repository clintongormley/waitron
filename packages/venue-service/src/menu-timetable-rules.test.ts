import { describe, expect, it } from "vitest";
import { menuPeriodName, parseMenuWeek as parseWeek } from "./menu-timetable-rules.js";
import { parseServiceDay } from "./service-day.js";
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
const invalid = (field: string) => ({ code: "menu_timetable.invalid", params: { field } });
const parseMenuWeek = (value: unknown) =>
  parseWeek(value, (slots, field) => parseServiceDay(slots, field, "06:00"));

describe("a whole menu week", () => {
  it("takes one entry per weekday, indexed by weekday", () => {
    const sent = [...week({ 1: [slot("09:00", "12:00")] })].reverse();
    const parsed = parseMenuWeek(sent);
    expect(parsed.slots[1]).toEqual([slot("09:00", "12:00")]);
    expect(parsed.indexOf[1]).toBe(5);
  });

  it("keeps overnight ranges inside their own business weekdays, Sunday into Monday included", () => {
    const friday = slot("22:00", "02:00", MADRUGADA);
    expect(parseMenuWeek(week({ 5: [friday], 6: [slot("01:00", "03:00")] })).slots[6]).toEqual([
      slot("01:00", "03:00"),
    ]);
    expect(parseMenuWeek(week({ 0: [friday], 1: [slot("01:00", "03:00")] })).slots[1]).toEqual([
      slot("01:00", "03:00"),
    ]);
    expect(parseMenuWeek(week({ 5: [friday], 6: [slot("02:00", "03:00")] })).slots[6]).toEqual([
      slot("02:00", "03:00"),
    ]);
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
