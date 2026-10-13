import { expect, it } from "vitest";
import type { CalendarDay } from "../hours-types.js";
import type { SpecialDayDetail } from "../special-days.js";
import { specialOn } from "./special-date.js";

const goodFriday = (dates: SpecialDayDetail["dates"]): SpecialDayDetail => ({
  id: "easter",
  name: "Easter closing",
  repeatsYearly: true,
  dates,
  paint: [],
  zonePaint: [],
});
const calendarDay = (date: string, holiday?: string): CalendarDay => ({
  date,
  specialDay: { id: "easter", name: "Easter closing" },
  holidays: holiday
    ? [{ id: "h", date, name: holiday, scope: "national", sourceId: "official" }]
    : [],
  tone: "special_day",
  closed: false,
});

it("a repeating date saved on Viernes Santo 2026 applies on 2027's Viernes Santo, not on 3 April 2027", () => {
  const detail = goodFriday([
    { date: "2026-04-03", closedAllDay: true, holidayName: "Viernes Santo" },
  ]);
  expect(specialOn(calendarDay("2027-03-26", "Viernes Santo"), detail, "2027-03-26")).toEqual({
    detail,
    date: "2026-04-03",
    closed: true,
  });
  expect(specialOn(calendarDay("2027-04-03"), detail, "2027-04-03")).toBeUndefined();
});

it("a repeating date saved with no holiday name follows its month and day", () => {
  const detail = goodFriday([{ date: "2026-04-03", closedAllDay: false }]);
  expect(specialOn(calendarDay("2027-04-03"), detail, "2027-04-03")).toEqual({
    detail,
    date: "2026-04-03",
    closed: false,
  });
  expect(
    specialOn(calendarDay("2027-03-26", "Viernes Santo"), detail, "2027-03-26"),
  ).toBeUndefined();
});

it("hands back the stored detail itself rather than a copy, since every render asks again", () => {
  const detail = goodFriday([{ date: "2027-04-03", closedAllDay: false }]);
  expect(specialOn(calendarDay("2027-04-03"), detail, "2027-04-03")?.detail).toBe(detail);
});
