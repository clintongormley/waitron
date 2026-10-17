import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { Season } from "../season-rules.js";
const AUTUMN: Season = { id: "autumn", name: "Autumn", startsOn: "09-01", colour: "orange" };
const terraceWeek = () =>
  [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
    weekday,
    ranges: [{ startsAt: weekday === 5 || weekday === 6 ? "01:00" : "23:30", endsAt: "06:00" }],
  }));
export function departmentHoursModel(): OpeningHoursModel {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 0,
    currentBusinessDay: "2026-10-12",
    pending: null,
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [],
    seasons: [AUTUMN],
    currentSeasonId: AUTUMN.id,
    departments: [
      {
        id: "d1",
        name: "Restaurant",
        active: true,
        periods: [],
        seasonWeeks: [{ seasonId: AUTUMN.id, week: [] }],
        zones: [
          {
            id: "z1",
            name: "Terrace",
            seasonWeeks: [{ seasonId: AUTUMN.id, week: terraceWeek() }],
          },
          {
            id: "z2",
            name: "Bar",
            seasonWeeks: [{ seasonId: AUTUMN.id, week: [] }],
          },
        ],
      },
    ],
  };
}
