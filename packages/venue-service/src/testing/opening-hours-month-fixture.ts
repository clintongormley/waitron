import type { BusinessDayClock } from "@waitron/shared";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { HolidayFact, LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";

type Day = OpeningHoursMonth["days"][number];

const CLOCK: BusinessDayClock = {
  timeZone: "Europe/Madrid",
  dayCutover: "06:00",
  cutoverChanges: [],
};

const period = (id: string, name: string, colour: "amber" | "green" | "red" | "purple") => ({
  id,
  name,
  colour,
  menuId: "m",
  staffMenuIds: [],
  endOffsetMinutes: 0,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  routingUses: [],
});

export const DEPARTMENTS: OpeningHoursModel["departments"] = [
  {
    id: "rest",
    name: "Restaurant",
    active: true,
    zones: [{ id: "terrace", name: "Terrace", seasonWeeks: [] }],
    periods: [
      period("breakfast", "Breakfast", "amber"),
      period("lunch", "Lunch", "green"),
      period("dinner", "Dinner", "red"),
    ],
    seasonWeeks: [],
  },
  {
    id: "bar",
    name: "Bar",
    active: true,
    zones: [],
    periods: [period("allday", "All day", "purple")],
    seasonWeeks: [],
  },
];

export const holiday = (date: LocalDate, name: string): HolidayFact => ({
  id: `h-${date}`,
  date,
  name,
  scope: "national",
  sourceId: "official",
});

/** December 2026 as the server reads it, Monday 30 November to Sunday 3 January: Autumn to 30
 *  November, then Winter. The Restaurant serves breakfast, lunch and dinner and closes on Sundays;
 *  the Bar is open 10:00–02:00. The Terrace is closed 20:00–22:00 on 1 December. 8 December is a
 *  public holiday with no special day, 14 December the special day "Company dinners", and
 *  25 December the special day "Christmas Day", closed, on the public holiday of the same name. */
export function monthModel(overrides: Partial<OpeningHoursMonth> = {}): OpeningHoursMonth {
  const days: Day[] = [];
  for (let date = "2026-11-30"; date <= "2027-01-03"; date = addDays(date, 1)) {
    const sunday = new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
    const closedAllDay = date === "2026-12-25";
    days.push({
      date,
      inMonth: date.startsWith("2026-12"),
      dayCutover: "06:00",
      endMinute: 1440,
      seasonId: date < "2026-12-01" ? "autumn" : "winter",
      specialDay:
        date === "2026-12-14"
          ? { id: "company", name: "Company dinners" }
          : date === "2026-12-25"
            ? { id: "xmas", name: "Christmas Day" }
            : null,
      holidays:
        date === "2026-12-08"
          ? [holiday(date, "Immaculate Conception")]
          : date === "2026-12-25"
            ? [holiday(date, "Christmas Day")]
            : [],
      closedAllDay,
      departments: [
        {
          departmentId: "rest",
          ranges:
            closedAllDay || sunday
              ? []
              : [
                  { periodId: "breakfast", startsAt: "08:00", endsAt: "11:00" },
                  { periodId: "lunch", startsAt: "13:00", endsAt: "16:00" },
                  { periodId: "dinner", startsAt: "20:00", endsAt: "23:00" },
                ],
          zones: [
            {
              zoneId: "terrace",
              closed: date === "2026-12-01" ? [{ startsAt: "20:00", endsAt: "22:00" }] : [],
            },
          ],
        },
        {
          departmentId: "bar",
          ranges: closedAllDay ? [] : [{ periodId: "allday", startsAt: "10:00", endsAt: "02:00" }],
          zones: [],
        },
      ],
    });
  }
  return {
    businessDayClock: CLOCK,
    clockRevision: 7,
    currentBusinessDay: "2026-12-30",
    pending: null,
    month: "2026-12",
    today: "2026-12-30",
    seasons: [
      { id: "autumn", name: "Autumn", startsOn: "09-01", lastDay: "11-30", colour: "orange" },
      { id: "winter", name: "Winter", startsOn: "12-01", lastDay: "02-28", colour: "blue" },
    ],
    days,
    ...overrides,
  };
}
