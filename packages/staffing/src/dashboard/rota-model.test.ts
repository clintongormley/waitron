import { describe, expect, it } from "vitest";
import { rotaWeek } from "../testing/rota-fixture.js";
import { EVERYONE, chosenShow, matchesFor } from "./rota-model.js";

describe("the Rota's Show choice", () => {
  it("shows the first area when the address names none or an unknown one", () => {
    const read = rotaWeek();
    for (const asked of [undefined, "", "station:gone"])
      expect(chosenShow(read, asked)).toEqual({
        kind: "area",
        area: { kind: "station", id: "kitchen" },
        key: "station:kitchen",
        name: "Kitchen",
      });
  });
  it("shows the named area, or Everyone", () => {
    const read = rotaWeek();
    expect(chosenShow(read, "department:restaurant")).toEqual({
      kind: "area",
      area: { kind: "department", id: "restaurant" },
      key: "department:restaurant",
      name: "Restaurant",
    });
    expect(chosenShow(read, EVERYONE)).toEqual({ kind: "everyone" });
    expect(EVERYONE).toBe("everyone");
  });
  it("shows Everyone whatever the address says when there is no active area", () => {
    const read = rotaWeek();
    read.areas = [];
    for (const asked of [undefined, "everyone", "station:kitchen"])
      expect(chosenShow(read, asked)).toEqual({ kind: "everyone" });
  });
});

describe("the matches a Show choice covers", () => {
  const withRestaurant = () => {
    const read = rotaWeek();
    const restaurant = { kind: "department" as const, id: "restaurant" };
    for (const day of read.days)
      day.areas.push({ area: restaurant, match: { slots: [], over: [day.businessDay] } });
    return read;
  };
  it("gives one area's matches for an area, and every area's for Everyone", () => {
    const read = withRestaurant();
    const kitchen = chosenShow(read, "station:kitchen");
    expect(matchesFor(read, kitchen)).toEqual(read.days.map((d) => d.areas[0]!.match));
    expect(matchesFor(read, chosenShow(read, "department:restaurant"))).toEqual(
      read.days.map((d) => d.areas[1]!.match),
    );
    expect(matchesFor(read, { kind: "everyone" })).toEqual(
      read.days.flatMap((d) => d.areas.map((a) => a.match)),
    );
  });
  it("gives one day's matches when asked for a day", () => {
    const read = withRestaurant();
    const day = read.days[4]!;
    expect(matchesFor(read, chosenShow(read, "station:kitchen"), day.businessDay)).toEqual([
      day.areas[0]!.match,
    ]);
    expect(matchesFor(read, { kind: "everyone" }, day.businessDay)).toEqual(
      day.areas.map((a) => a.match),
    );
    expect(matchesFor(read, { kind: "everyone" }, "2026-01-01")).toEqual([]);
  });
});
