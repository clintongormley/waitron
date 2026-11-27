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
    const ordered = bill(["z-first", special], ["a-second", special]);
    const state = { ...ordered, setMenus: [...ordered.setMenus].reverse() };
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
});

it("uses every free place on a line that holds more than one dish", () => {
  const threeStarters = {
    ...daily,
    lines: [{ count: 3, courseIds: ["starters"] }, ...daily.lines.slice(1)],
  };
  const state = {
    ...bill(["daily", threeStarters]),
    dishes: [
      {
        lineId: "sent-soup",
        setMenuLineId: "daily",
        place: 0,
        productId: "soup",
        variantId: null,
        priceCents: 0,
        countsAsCourseId: "starters",
        movable: true,
      },
    ],
  };
  const soups = ["first", "second", "third"].map((id) => dish("soup", id));
  const result = shared.placeInOrder(state, soups);
  expect(result.placed.map(({ id, place }) => [id, place])).toEqual([
    ["first", 0],
    ["second", 0],
  ]);
  expect(result.unplaced).toEqual(["third"]);
});
