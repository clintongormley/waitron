import type { OpeningHoursModel } from "../menu-timetable-types.js";
export function departmentHoursModel(): OpeningHoursModel {
  return {
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [],
    namedDays: [],
    departments: [
      {
        id: "d1",
        name: "Restaurant",
        active: true,
        periods: [],
        week: [],
        dates: [],
        zones: [
          {
            id: "z1",
            name: "Terrace",
            dates: [],
            week: [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
              weekday,
              ranges: [
                { startsAt: weekday === 5 || weekday === 6 ? "01:00" : "23:30", endsAt: "06:00" },
              ],
            })),
          },
          { id: "z2", name: "Bar", week: [], dates: [] },
        ],
      },
    ],
  };
}
