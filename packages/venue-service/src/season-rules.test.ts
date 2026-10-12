import { describe, expect, it } from "vitest";
import { DEFAULT_SEASONS, seasonLastDay, seasonOn } from "./season-rules.js";

const four = DEFAULT_SEASONS.map((s, i) => ({ ...s, id: String(i) }));

describe("seasonOn", () => {
  it.each([
    ["2030-11-30", "Autumn"],
    ["2030-12-01", "Winter"],
    ["2031-01-15", "Winter"],
    ["2031-02-28", "Winter"],
    ["2032-02-29", "Winter"],
    ["2031-03-01", "Spring"],
    ["2031-08-31", "Summer"],
  ])("puts %s in %s", (day, name) => expect(seasonOn(four, day)?.name).toBe(name));

  it("wraps a lone season over the whole year", () =>
    expect(seasonOn([{ id: "a", name: "All", startsOn: "05-01" }], "2031-01-01")?.id).toBe("a"));

  it("orders seasons given out of order", () =>
    expect(seasonOn([...four].reverse(), "2031-07-01")?.name).toBe("Summer"));

  it("answers null with no seasons", () => expect(seasonOn([], "2031-01-01")).toBeNull());
});

describe("seasonLastDay", () => {
  it("ends Winter on the last day of February", () =>
    expect(seasonLastDay(four, "12-01")).toBe("02-28"));

  it("ends a season the day before the next one starts", () =>
    expect(seasonLastDay([...four].reverse(), "03-01")).toBe("05-31"));

  it("ends the year's last season on 12-31 when the first starts on 01-01", () =>
    expect(seasonLastDay([{ startsOn: "01-01" }, { startsOn: "07-01" }], "07-01")).toBe("12-31"));
});
