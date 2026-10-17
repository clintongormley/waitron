import { describe, expect, it } from "vitest";
import type { StationServiceTimes } from "../station-service-times.js";
import { monthModel } from "../testing/opening-hours-month-fixture.js";
import {
  activeStationsInOrder,
  monthWeeks,
  stationShowModel,
  type TimesPeriod,
} from "./station-show.js";

const PERIODS: TimesPeriod[] = [
  {
    id: "lunch",
    departmentId: "rest",
    departmentName: "Restaurant",
    name: "Lunch",
    colour: "green",
  },
  {
    id: "dinner",
    departmentId: "rest",
    departmentName: "Restaurant",
    name: "Dinner",
    colour: "red",
  },
  { id: "allday", departmentId: "bar", departmentName: "Bar", name: "All day", colour: "purple" },
];
const STATION = { id: "pass", name: "Pass" };
const LATE = { periodId: "allday", startsAt: "02:00", endsAt: "04:00" };
const DINNER = { periodId: "dinner", startsAt: "19:00", endsAt: "01:00" };
const ALL_DAY = { periodId: "allday", startsAt: "10:00", endsAt: "02:00" };

/** The read lists the Bar first, so only the month read's order puts the Restaurant first. */
function times(
  departments: StationServiceTimes["days"][number]["departments"],
): StationServiceTimes {
  return {
    always: null,
    days: monthModel().days.map((day) => ({ date: day.date, departments })),
  };
}

describe("stationShowModel", () => {
  it("gives two senders a row each, in the month read's department order", () => {
    const meta = monthModel();
    const read = times([
      { departmentId: "bar", ranges: [LATE, ALL_DAY] },
      { departmentId: "rest", ranges: [DINNER] },
    ]);
    const shown = stationShowModel(meta, read, STATION, PERIODS, "station")!;
    expect(shown.departments).toEqual([
      {
        id: "rest",
        name: "Restaurant",
        zones: [],
        periods: [
          { id: "lunch", name: "Lunch", colour: "green" },
          { id: "dinner", name: "Dinner", colour: "red" },
        ],
      },
      {
        id: "bar",
        name: "Bar",
        zones: [],
        periods: [{ id: "allday", name: "All day", colour: "purple" }],
      },
    ]);
    expect(shown.model.days.map((day) => day.date)).toEqual(meta.days.map((day) => day.date));
    expect(shown.model.days[3]!.departments).toEqual([
      { departmentId: "rest", zones: [], ranges: [DINNER] },
      { departmentId: "bar", zones: [], ranges: [ALL_DAY, LATE] },
    ]);
  });

  it("names a lone sender after its department for the Calendar", () => {
    const read = times([{ departmentId: "bar", ranges: [LATE, ALL_DAY] }]);
    const shown = stationShowModel(monthModel(), read, STATION, PERIODS, "department")!;
    expect(shown.departments).toEqual([
      {
        id: "bar",
        name: "Bar",
        zones: [],
        periods: [{ id: "allday", name: "All day", colour: "purple" }],
      },
    ]);
    expect(shown.model.days[3]!.departments).toEqual([
      { departmentId: "bar", zones: [], ranges: [ALL_DAY, LATE] },
    ]);
  });

  it("names a lone sender after the station for the Times tab", () => {
    const read = times([{ departmentId: "bar", ranges: [LATE, ALL_DAY] }]);
    const shown = stationShowModel(monthModel(), read, STATION, PERIODS, "station")!;
    expect(shown.departments).toEqual([
      {
        id: "pass",
        name: "Pass",
        zones: [],
        periods: [
          { id: "lunch", name: "Lunch", colour: "green" },
          { id: "dinner", name: "Dinner", colour: "red" },
          { id: "allday", name: "All day", colour: "purple" },
        ],
      },
    ]);
    expect(shown.model.days[3]!.departments).toEqual([
      { departmentId: "pass", zones: [], ranges: [ALL_DAY, LATE] },
    ]);
  });

  it("gives the Calendar no rows when no department sends to the station", () => {
    const meta = monthModel();
    const shown = stationShowModel(meta, times([]), STATION, PERIODS, "department")!;
    expect(shown.departments).toEqual([]);
    expect(shown.model.days.map((day) => day.date)).toEqual(meta.days.map((day) => day.date));
    expect(shown.model.days.every((day) => day.departments.length === 0)).toBe(true);
  });

  it("gives the Times tab one station row when no department sends to the station", () => {
    const shown = stationShowModel(monthModel(), times([]), STATION, PERIODS, "station")!;
    expect(shown.departments.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "pass", name: "Pass" },
    ]);
    expect(shown.model.days[3]!.departments).toEqual([
      { departmentId: "pass", zones: [], ranges: [] },
    ]);
  });

  it("gives nothing when the two reads cover dates that differ by one", () => {
    const read = times([{ departmentId: "bar", ranges: [ALL_DAY] }]);
    const shifted = { ...read, days: read.days.slice(1) };
    expect(stationShowModel(monthModel(), shifted, STATION, PERIODS, "station")).toBeUndefined();
    const moved = {
      ...read,
      days: read.days.map((day, index) => (index === 4 ? { ...day, date: "2026-12-31" } : day)),
    };
    expect(stationShowModel(monthModel(), moved, STATION, PERIODS, "station")).toBeUndefined();
  });
});

describe("monthWeeks", () => {
  it("covers the month's whole Monday-to-Sunday weeks", () => {
    expect(monthWeeks("2026-12")).toEqual(["2026-11-30", "2027-01-03"]);
  });
});

it("A725 offers active stations alphabetically without changing their identity or default", () => {
  const zulu = { id: "zulu", name: "Zulu", active: true, isDefault: true, displayOrder: 0 };
  const alpha = { id: "alpha", name: "Alpha", active: true, isDefault: false, displayOrder: 2 };
  const bar = { id: "bar", name: "Bar", active: true, isDefault: false, displayOrder: 1 };
  const hidden = {
    id: "hidden",
    name: "A deleted",
    active: false,
    isDefault: false,
    displayOrder: -1,
  };
  const input = [zulu, hidden, bar, alpha];
  const ordered = activeStationsInOrder(input);
  expect(ordered.map(({ id }) => id)).toEqual(["alpha", "bar", "zulu"]);
  expect(ordered[0]).toBe(alpha);
  expect(ordered[1]).toBe(bar);
  expect(ordered[2]).toBe(zulu);
  expect(ordered[2]!.isDefault).toBe(true);
  expect(input).toEqual([zulu, hidden, bar, alpha]);
});

it("A725 uses Spanish alphabetical station names independently of the browser language", () => {
  const stations = ["Ñandú", "barra", "Cocina", "Ásador", "Níspero", "Naranja"].map((name) => ({
    name,
    active: true,
  }));
  expect(activeStationsInOrder(stations).map(({ name }) => name)).toEqual([
    "Ásador",
    "barra",
    "Cocina",
    "Naranja",
    "Níspero",
    "Ñandú",
  ]);
});
