import { decodePathSegment } from "@waitron/ui";
import {
  calendarViewPath,
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
