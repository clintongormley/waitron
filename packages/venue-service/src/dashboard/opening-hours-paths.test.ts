import { decodePathSegment } from "@waitron/ui";
import {
  calendarViewPath,
  calendarWindowPath,
  periodsWindowPath,
  seasonPainterPath,
  specialDayPainterPath,
} from "./opening-hours-paths.js";

/** The address's segments after the Calendar's own, as a browser keeps and the screen decodes them. */
const readBack = (path: string) =>
  new URL(path, "http://venue.test").pathname
    .split("/")
    .slice(3)
    .map((part) => decodePathSegment(part));

describe("opening hours paths", () => {
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
    ).toBe("/manage/opening-hours/view/special-day/date/2026-10-20/to/2026-10-23");
    expect(
      specialDayPainterPath({ specialDayId: null, date: "2026-10-20", to: "2026-10-20" }),
    ).toBe("/manage/opening-hours/view/special-day/date/2026-10-20");
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

it("adds replaces and removes only the Calendar window pair", () => {
  const base = "/manage/opening-hours/view/season/season/winter/department/bar/zone/terrace";
  expect(calendarWindowPath(base, "seasons")).toBe(`${base}/window/seasons`);
  expect(calendarWindowPath(`${base}/window/periods`, "seasons")).toBe(`${base}/window/seasons`);
  expect(calendarWindowPath(`${base}/window/seasons`, null)).toBe(base);
  expect(calendarWindowPath(`${base}/window/seasons`, "periods")).toBe(`${base}/window/periods`);
  expect(readBack(calendarWindowPath(base, "a/b"))).toEqual([
    "view",
    "season",
    "season",
    "winter",
    "department",
    "bar",
    "zone",
    "terrace",
    "window",
    "a/b",
  ]);
});

it("names the Periods window over the Year", () => {
  expect(periodsWindowPath).toBe("/manage/opening-hours/view/year/window/periods");
});
