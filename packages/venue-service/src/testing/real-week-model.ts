import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { NamedDaysModel } from "../holiday-types.js";
const annual = {
  id: "annual/day",
  date: "2025-10-13",
  name: "Anniversary",
  kind: "working_day" as const,
  repeats: true,
  ownHours: true,
  closeWholeVenue: false,
  hasStationHours: false,
};
export function realWeekModel(): OpeningHoursModel {
  return {
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [],
    namedDays: [
      annual,
      { ...annual, id: "second", date: "2026-10-14", repeats: false },
      {
        ...annual,
        id: "closed",
        date: "2026-10-15",
        repeats: false,
        ownHours: false,
        closeWholeVenue: true,
      },
    ],
    departments: [
      {
        id: "d1",
        name: "Restaurant",
        active: true,
        periods: [
          {
            id: "p1",
            name: "Lunch",
            colour: "green",
            menuId: "m1",
            staffMenuIds: [],
            endOffsetMinutes: 0,
            weekdays: [1, 2],
          },
        ],
        week: [
          { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] },
          { weekday: 2, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] },
        ],
        dates: [
          {
            specialDateId: "annual/day",
            slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "16:00" }],
          },
          {
            specialDateId: "second",
            slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "16:00" }],
          },
        ],
        zones: [
          {
            id: "z1",
            name: "Terrace",
            week: [{ weekday: 2, ranges: [{ startsAt: "22:00", endsAt: "06:00" }] }],
            dates: [
              { specialDateId: "annual/day", ranges: [{ startsAt: "23:00", endsAt: "06:00" }] },
            ],
          },
        ],
      },
    ],
  };
}
export const namedWeekModel = (): NamedDaysModel => ({
  timeZone: "Europe/Madrid",
  dayCutover: "06:00",
  civilDate: "2026-10-12",
  clockReadable: true,
  days: [],
  holidayCoverage: [],
  holidaySources: [],
  area: {
    addressKey: "fixture-address",
    readiness: "ready",
    options: [],
    required: false,
    chosen: null,
  },
  localHolidaysPerYear: 2,
});
