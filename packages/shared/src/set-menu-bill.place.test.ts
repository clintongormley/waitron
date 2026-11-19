import { describe, expect, it } from "vitest";

import * as shared from "./index.js";
import { bill, daily, dish, special } from "./set-menu-bill.fixtures.js";

describe("placing set-menu dishes", () => {
  it("takes the cheapest open place offered on the bill", () => {
    const state = bill(["daily", daily], ["special", special]);
    expect(shared.placeInOrder(state, [dish("sirloin")])).toEqual({
      placed: [
        {
          id: "sirloin",
          setMenuLineId: "special",
          place: 1,
          priceCents: 0,
          countsAsCourseId: "mains",
        },
      ],
      unplaced: [],
    });
  });

  it("uses narrower lines first, then menu order, for dishes in the order given", () => {
    const state = bill(["z-first", special], ["a-second", special]);
    const result = shared.placeInOrder(state, [
      dish("soup", "z"),
      dish("soup", "b"),
      dish("soup", "a"),
    ]);
    expect(result.placed.map(({ id, setMenuLineId, place }) => [id, setMenuLineId, place])).toEqual(
      [
        ["z", "z-first", 0],
        ["b", "a-second", 0],
        ["a", "z-first", 1],
      ],
    );
  });

  it("uses the earlier line when two lines accept equally many courses", () => {
    const twoStarters = { ...special, lines: [special.lines[0]!, special.lines[0]!] };
    expect(
      shared.placeInOrder(bill(["special", twoStarters]), [dish("soup")]).placed[0]?.place,
    ).toBe(0);
  });

  it("saves a reserved place for its dish in either input order", () => {
    const state = bill(["daily-one", daily], ["daily-two", daily], ["special", special]);
    const existing = [dish("soup"), dish("hake")];
    const occupied = shared.withPlacements(
      state,
      existing,
      shared.placeInOrder(state, existing).placed,
    );
    const sirloin = dish("sirloin");
    const bass = { ...dish("sea bass"), reserved: { setMenuLineId: "special", place: 1 } };
    const onDaily = {
      id: "sirloin",
      setMenuLineId: "daily-two",
      place: 1,
      priceCents: 500,
      countsAsCourseId: "mains",
    };
    const onSpecial = {
      id: "sea bass",
      setMenuLineId: "special",
      place: 1,
      priceCents: 0,
      countsAsCourseId: "mains",
    };

    expect(shared.placeInOrder(occupied, [sirloin, bass])).toEqual({
      placed: [onDaily, onSpecial],
      unplaced: [],
    });
    expect(shared.placeInOrder(occupied, [bass, sirloin])).toEqual({
      placed: [onSpecial, onDaily],
      unplaced: [],
    });
    expect(shared.placeInOrder(occupied, [sirloin, dish("sea bass")])).toEqual({
      placed: [{ ...onSpecial, id: "sirloin" }],
      unplaced: ["sea bass"],
    });
  });

  it("leaves a place held for another draft line free", () => {
    const state = bill(["daily", daily], ["special", special]);
    const result = shared.placeInOrder(
      state,
      [dish("sirloin")],
      [{ setMenuLineId: "special", place: 1 }],
    );
    expect(result).toEqual({
      placed: [
        {
          id: "sirloin",
          setMenuLineId: "daily",
          place: 1,
          priceCents: 500,
          countsAsCourseId: "mains",
        },
      ],
      unplaced: [],
    });
  });

  it("tries other places when a reservation is already occupied", () => {
    const state = bill(["daily", daily], ["special", special]);
    const existing = [dish("sea bass")];
    const occupied = shared.withPlacements(
      state,
      existing,
      shared.placeInOrder(state, existing).placed,
    );
    const sirloin = { ...dish("sirloin"), reserved: { setMenuLineId: "special", place: 1 } };
    expect(shared.placeInOrder(occupied, [sirloin])).toEqual({
      placed: [
        {
          id: "sirloin",
          setMenuLineId: "daily",
          place: 1,
          priceCents: 500,
          countsAsCourseId: "mains",
        },
      ],
      unplaced: [],
    });
  });

  it("uses the counting course of a dish and its variant from the landing copy", () => {
    const dailyOrders = [dish("bravas"), { ...dish("wine"), variantId: "glass" }];
    expect(shared.placeInOrder(bill(["daily", daily]), dailyOrders).placed).toEqual([
      {
        id: "bravas",
        setMenuLineId: "daily",
        place: 2,
        priceCents: 0,
        countsAsCourseId: "sharing",
      },
      { id: "wine", setMenuLineId: "daily", place: 3, priceCents: 200, countsAsCourseId: "drinks" },
    ]);
    expect(shared.placeInOrder(bill(["special", special]), [dish("bravas")]).placed).toEqual([
      {
        id: "bravas",
        setMenuLineId: "special",
        place: 0,
        priceCents: 0,
        countsAsCourseId: "starters",
      },
    ]);
  });

  it("leaves a dish unplaced when no set menu lists it or the bill has no set menus", () => {
    expect(shared.placeInOrder(bill(["daily", daily]), [dish("sea bass")])).toEqual({
      placed: [],
      unplaced: ["sea bass"],
    });
    expect(shared.placeInOrder(bill(), [dish("soup")])).toEqual({ placed: [], unplaced: ["soup"] });
  });

  it("adds successful placements as movable dishes without changing the original state", () => {
    const state = bill(["daily", daily]);
    const dishes = [dish("sea bass"), { ...dish("wine", "wine-line"), variantId: "glass" }];
    const { placed } = shared.placeInOrder(state, dishes);
    const updated = shared.withPlacements(state, dishes, placed);
    expect(updated.dishes).toEqual([
      {
        lineId: "wine-line",
        productId: "wine",
        variantId: "glass",
        setMenuLineId: "daily",
        place: 3,
        priceCents: 200,
        countsAsCourseId: "drinks",
        movable: true,
      },
    ]);
    expect(state.dishes).toEqual([]);
  });
});
