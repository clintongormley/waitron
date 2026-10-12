import { expect, it } from "vitest";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { seasonWeekOn, zoneSeasonWeekOn } from "./real-week.js";

const slot = (startsAt: string) => [{ periodId: "p", startsAt, endsAt: "23:00" }];
const ranges = (startsAt: string) => [{ startsAt, endsAt: "06:00" }];
function model(): Pick<OpeningHoursModel, "seasons" | "departments"> {
  return {
    seasons: [
      { id: "winter", name: "Winter", startsOn: "12-01" },
      { id: "autumn", name: "Autumn", startsOn: "09-01" },
    ],
    departments: [
      {
        id: "d1",
        name: "Restaurant",
        active: true,
        periods: [],
        dates: [],
        seasonWeeks: [
          { seasonId: "winter", week: [{ weekday: 1, slots: slot("12:00") }] },
          { seasonId: "autumn", week: [{ weekday: 1, slots: slot("10:00") }] },
        ],
        zones: [
          {
            id: "z1",
            name: "Terrace",
            dates: [],
            week: [{ weekday: 1, ranges: ranges("20:00") }],
            seasonWeeks: [
              { seasonId: "winter", week: [{ weekday: 1, ranges: ranges("18:00") }] },
              { seasonId: "autumn", week: [{ weekday: 1, ranges: ranges("22:00") }] },
            ],
          },
        ],
      },
    ],
  };
}
it.each([
  ["2030-11-30", "10:00", "22:00"],
  ["2030-12-01", "12:00", "18:00"],
  ["2031-02-28", "12:00", "18:00"],
  ["2031-09-01", "10:00", "22:00"],
])("reads %s's own season's week for a department and its zone", (date, opens, closes) => {
  expect(seasonWeekOn(model(), "d1", date)).toEqual([{ weekday: 1, slots: slot(opens) }]);
  expect(zoneSeasonWeekOn(model(), "d1", "z1", date)).toEqual([
    { weekday: 1, ranges: ranges(closes) },
  ]);
});
it("reads no week for an unknown department or zone, or a venue with no seasons", () => {
  expect(seasonWeekOn(model(), "nope", "2030-12-01")).toEqual([]);
  expect(zoneSeasonWeekOn(model(), "nope", "z1", "2030-12-01")).toEqual([]);
  expect(zoneSeasonWeekOn(model(), "d1", "nope", "2030-12-01")).toEqual([]);
  expect(seasonWeekOn({ ...model(), seasons: [] }, "d1", "2030-12-01")).toEqual([]);
  expect(zoneSeasonWeekOn({ ...model(), seasons: [] }, "d1", "z1", "2030-12-01")).toEqual([]);
});
