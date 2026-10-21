import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { SpecialDaysModel } from "../holiday-types.js";
import type { Season } from "../season-rules.js";
const AUTUMN: Season = { id: "autumn", name: "Autumn", startsOn: "09-01", colour: "orange" };
const lunchWeek = [
  { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] },
  { weekday: 2, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] },
];
const terraceWeek = [{ weekday: 2, ranges: [{ startsAt: "22:00", endsAt: "06:00" }] }];
export function terraceWeekModel(): OpeningHoursModel {
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
        periods: [
          {
            id: "p1",
            name: "Lunch",
            colour: "green",
            menuId: "m1",
            staffMenuIds: [],
            floorPlanSetId: null,
            weekdays: [1, 2],
            routingUses: [],
          },
        ],
        seasonWeeks: [{ seasonId: AUTUMN.id, week: structuredClone(lunchWeek) }],
        zones: [
          {
            id: "z1",
            name: "Terrace",
            seasonWeeks: [{ seasonId: AUTUMN.id, week: structuredClone(terraceWeek) }],
          },
        ],
      },
    ],
  };
}
export const namedWeekModel = (): SpecialDaysModel => ({
  businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
  clockRevision: 0,
  currentBusinessDay: "2026-10-12",
  pending: null,
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
