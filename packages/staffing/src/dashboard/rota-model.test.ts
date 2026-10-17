import { describe, expect, it } from "vitest";
import { rotaWeek } from "../testing/rota-fixture.js";
import { EVERYONE, chosenShow, matchesFor, summary, weekCounts } from "./rota-model.js";
import type { RotaWeek } from "../staffing-types.js";

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

describe("the week's attention counts and their summary", () => {
  const kitchen = (read: RotaWeek) => chosenShow(read, "station:kitchen");
  const everyone = { kind: "everyone" } as const;
  const allFilled = () => {
    const read = rotaWeek();
    for (const day of read.days)
      for (const a of day.areas) {
        a.match.over = [];
        for (const s of a.match.slots)
          s.status = { kind: "filled", shiftId: "filled", outsideRole: false };
      }
    return read;
  };
  const noSlots = () => {
    const read = rotaWeek();
    for (const day of read.days)
      for (const a of day.areas) {
        a.match.over = [];
        a.match.slots = [];
      }
    return read;
  };
  it("counts the shown area's unfilled, partly uncovered and over, and every area's for Everyone", () => {
    const read = rotaWeek();
    read.days[2]!.areas.push({
      area: { kind: "department", id: "restaurant" },
      match: {
        slots: [
          {
            slot: { ...read.days[4]!.areas[0]!.match.slots[0]!.slot, key: "restaurant-empty" },
            status: { kind: "unfilled" },
          },
        ],
        over: [],
      },
    });
    expect(weekCounts(read, kitchen(read))).toEqual({ unfilled: 1, partly: 1, over: 1 });
    expect(weekCounts(read, everyone)).toEqual({ unfilled: 2, partly: 1, over: 1 });
  });
  it("gives the counts while any is above zero", () => {
    const read = rotaWeek();
    expect(summary(read, kitchen(read))).toBe("counts");
    const overOnly = allFilled();
    overOnly.days[3]!.areas[0]!.match.over = ["over"];
    expect(summary(overOnly, kitchen(overOnly))).toBe("counts");
  });
  it("says all slots are filled when the scope has a slot and no count", () => {
    const read = allFilled();
    expect(weekCounts(read, kitchen(read))).toEqual({ unfilled: 0, partly: 0, over: 0 });
    expect(summary(read, kitchen(read))).toBe("all_filled");
    expect(summary(read, everyone)).toBe("all_filled");
  });
  it("says there are no shifts yet for Everyone with no slot and no shift", () => {
    const read = noSlots();
    read.shifts = [];
    expect(summary(read, everyone)).toBe("no_shifts");
    expect(summary(read, kitchen(read))).toBe("nothing_to_fill");
  });
  it("says there is nothing to fill with no slot in scope", () => {
    const read = noSlots();
    expect(summary(read, kitchen(read))).toBe("nothing_to_fill");
    expect(summary(read, everyone)).toBe("nothing_to_fill");
  });
});
