import { decodePathSegment } from "@waitron/ui";
import {
  calendarViewPath,
  periodPath,
  seasonPainterPath,
  specialDayPainterPath,
} from "./opening-hours-paths.js";

/** The address's segments after the Calendar's own, as a browser keeps and the screen decodes them. */
const readBack = (path: string) =>
  new URL(path, "http://venue.test").pathname
    .split("/")
    .slice(2)
    .map((part) => decodePathSegment(part));

describe("opening hours paths", () => {
  it("round-trips the exact list of separately selected dates", () => {
    const path = specialDayPainterPath({ specialDayId: null, dates: ["2026-10-20", "2026-10-23"] });
    expect(path).toBe("/opening-hours/view/special-day/dates/2026-10-20%2C2026-10-23");
    expect(readBack(path)).toEqual(["view", "special-day", "dates", "2026-10-20,2026-10-23"]);
  });

  it.each(["~", ".", "..", "a/b", "a b"])("writes the id %s so it reads back unchanged", (id) => {
    expect(readBack(seasonPainterPath({ seasonId: id, departmentId: "bar" }))).toEqual([
      "view",
      "season",
      "season",
      id,
      "department",
      "bar",
    ]);
    expect(readBack(specialDayPainterPath({ specialDayId: id }))).toEqual([
      "view",
      "special-day",
      "special-day",
      id,
    ]);
  });

  it("writes a new special day's run as its first and last date, and one date alone", () => {
    expect(
      specialDayPainterPath({ specialDayId: null, date: "2026-10-20", to: "2026-10-23" }),
    ).toBe("/opening-hours/view/special-day/date/2026-10-20/to/2026-10-23");
    expect(
      specialDayPainterPath({ specialDayId: null, date: "2026-10-20", to: "2026-10-20" }),
    ).toBe("/opening-hours/view/special-day/date/2026-10-20");
  });

  it("keeps a module view's empty values and leaves its view pair out", () => {
    expect(readBack(calendarViewPath("staffing", { area: "", view: "rota", week: "~" }))).toEqual([
      "view",
      "staffing",
      "area",
      "",
      "week",
      "~",
    ]);
  });
});

it("opens the exact period, including ids with reserved path characters", () => {
  const path = periodPath("late/lunch");
  expect(path).toBe("/periods/period/late%2Flunch");
  expect(readBack(path)).toEqual(["period", "late/lunch"]);
});
