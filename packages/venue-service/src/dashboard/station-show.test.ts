import { describe, expect, it } from "vitest";
import type { StationServiceTimes } from "../station-service-times.js";
import { monthModel } from "../testing/opening-hours-month-fixture.js";
import { activeStationsInOrder, monthWeeks, stationShowModel } from "./station-show.js";

const STATION = { id: "pass", name: "Pass", colour: "blue" } as const;
const LATE = { periodId: "allday", startsAt: "02:00", endsAt: "04:00" };
const DINNER = { periodId: "dinner", startsAt: "19:00", endsAt: "01:00" };
const ALL_DAY = { periodId: "allday", startsAt: "10:00", endsAt: "02:00" };

function times(
  departments: StationServiceTimes["days"][number]["departments"],
): StationServiceTimes {
  return {
    days: monthModel().days.map((day) => ({ date: day.date, departments })),
  };
}

describe("stationShowModel", () => {
  it("groups all sending ranges in one named row with the station's colour", () => {
    const meta = monthModel();
    const read = times([
      { departmentId: "bar", ranges: [ALL_DAY, LATE] },
      { departmentId: "rest", ranges: [DINNER] },
    ]);
    const shown = stationShowModel(meta, read, STATION)!;
    expect(shown.departments).toEqual([
      {
        id: "pass",
        name: "Pass",
        station: true,
        zones: [],
        periods: [{ id: "pass", name: "", colour: "blue" }],
      },
    ]);
    expect(shown.model.days.map((day) => day.date)).toEqual(meta.days.map((day) => day.date));
    expect(shown.model.days[3]!.departments).toEqual([
      { departmentId: "pass", zones: [], ranges: [ALL_DAY, LATE, DINNER] },
    ]);
  });

  it("keeps the station row when no department sends to it", () => {
    const shown = stationShowModel(monthModel(), times([]), STATION)!;
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
    expect(stationShowModel(monthModel(), shifted, STATION)).toBeUndefined();
    const moved = {
      ...read,
      days: read.days.map((day, index) => (index === 4 ? { ...day, date: "2026-12-31" } : day)),
    };
    expect(stationShowModel(monthModel(), moved, STATION)).toBeUndefined();
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
