import { describe, expect, it } from "vitest";

import * as shared from "./index.js";
import type { BillSetMenuState, PlacedDish, SetMenuCopy } from "./index.js";
import { bill, daily, dish, special } from "./set-menu-bill.fixtures.js";

function specialSirloin(dailyCopy: SetMenuCopy = daily): BillSetMenuState {
  const state = bill(["daily", dailyCopy], ["special", special]);
  const { id, productId, variantId } = dish("sirloin");
  const sirloin: PlacedDish = {
    lineId: id,
    productId,
    variantId,
    setMenuLineId: "special",
    place: 1,
    priceCents: 0,
    countsAsCourseId: "mains",
    movable: true,
  };
  return { ...state, dishes: [sirloin] };
}

const toDaily = { setMenuLineId: "daily", place: 1 };
const toSpecial = { setMenuLineId: "special", place: 1 };

describe("suggesting a set-menu move", () => {
  it("moves Sirloin to the Daily to make room for Sea bass", () => {
    expect(shared.suggestMove(specialSirloin(), [], dish("sea bass"))).toEqual({
      moves: [
        {
          lineId: "sirloin",
          from: toSpecial,
          to: toDaily,
          priceCents: 500,
          countsAsCourseId: "mains",
        },
      ],
      place: {
        id: "sea bass",
        ...toSpecial,
        priceCents: 0,
        countsAsCourseId: "mains",
      },
    });
  });

  it("leaves a dish backed by payment or an adjustment in its place", () => {
    const state = specialSirloin();
    const fixed = { ...state, dishes: [{ ...state.dishes[0]!, movable: false }] };
    expect(shared.suggestMove(fixed, [], dish("sea bass"))).toBeNull();
  });

  it("leaves a drafted variant in its previewed place", () => {
    const specialWithDrinks = {
      ...special,
      lines: [...special.lines, { count: 1, courseIds: ["drinks"] }],
      dishes: [
        ...special.dishes,
        { productId: "wine", variantId: "glass", countsAsCourseId: "drinks", surchargeCents: 300 },
      ],
    };
    const state = bill(["daily", daily], ["special", specialWithDrinks]);
    const wine = { ...dish("wine"), variantId: "glass" };
    const draft = {
      ...wine,
      setMenuLineId: "daily",
      place: 3,
      priceCents: 200,
      countsAsCourseId: "drinks",
    };
    expect(shared.suggestMove(state, [draft], { ...wine, id: "second-glass" })).toEqual({
      moves: [],
      place: {
        id: "second-glass",
        setMenuLineId: "special",
        place: 2,
        priceCents: 300,
        countsAsCourseId: "drinks",
      },
    });
  });

  it("has no suggestion when the bill cannot fit the new dish", () => {
    expect(shared.suggestMove(specialSirloin(), [], dish("lobster"))).toBeNull();
  });

  it("has no suggestion when a menu amount exceeds the calculation limit", () => {
    const expensive = { ...daily, priceCents: 1_000_001 };
    expect(shared.suggestMove(specialSirloin(expensive), [], dish("sea bass"))).toBeNull();
  });
});

describe("checking set-menu moves together", () => {
  it("answers with the price and counting course at an open destination", () => {
    expect(shared.checkMoves(specialSirloin(), [{ lineId: "sirloin", to: toDaily }])).toEqual({
      kind: "ok",
      results: [{ id: "sirloin", ...toDaily, priceCents: 500, countsAsCourseId: "mains" }],
    });
  });

  it("allows two dishes to swap places in one request", () => {
    const state = specialSirloin();
    const second = { ...state.dishes[0]!, lineId: "second-sirloin", ...toDaily, priceCents: 500 };
    const filled = { ...state, dishes: [...state.dishes, second] };
    expect(
      shared.checkMoves(filled, [
        { lineId: "sirloin", to: toDaily },
        { lineId: "second-sirloin", to: toSpecial },
      ]),
    ).toEqual({
      kind: "ok",
      results: [
        { id: "sirloin", ...toDaily, priceCents: 500, countsAsCourseId: "mains" },
        { id: "second-sirloin", ...toSpecial, priceCents: 0, countsAsCourseId: "mains" },
      ],
    });
  });

  it("refuses the second of two moves to the same single place", () => {
    const state = specialSirloin();
    const spare = { ...state.setMenus[1]!, lineId: "another-special", lineNo: 2 };
    const second = { ...state.dishes[0]!, lineId: "second-sirloin", setMenuLineId: spare.lineId };
    const filled = {
      ...state,
      dishes: [...state.dishes, second],
      setMenus: [...state.setMenus, spare],
    };
    expect(
      shared.checkMoves(filled, [
        { lineId: "sirloin", to: toDaily },
        { lineId: "second-sirloin", to: toDaily },
      ]),
    ).toEqual({ kind: "place_taken", lineId: "second-sirloin" });
  });

  it("refuses a dish that is absent from the bill's placed dishes", () => {
    expect(shared.checkMoves(specialSirloin(), [{ lineId: "cancelled", to: toDaily }])).toEqual({
      kind: "not_placed",
      lineId: "cancelled",
    });
  });

  it("refuses a destination whose course does not fit the dish", () => {
    expect(
      shared.checkMoves(specialSirloin(), [{ lineId: "sirloin", to: { ...toDaily, place: 0 } }]),
    ).toEqual({
      kind: "place_taken",
      lineId: "sirloin",
    });
  });
});

it("refuses a move into a place still occupied by another dish", () => {
  const state = specialSirloin();
  const second = { ...state.dishes[0]!, lineId: "second-sirloin", ...toDaily, priceCents: 500 };
  const filled = { ...state, dishes: [...state.dishes, second] };
  expect(shared.checkMoves(filled, [{ lineId: "sirloin", to: toDaily }])).toEqual({
    kind: "place_taken",
    lineId: "sirloin",
  });
});

it("refuses an explicit move for a dish backing a payment or adjustment", () => {
  const state = specialSirloin();
  const fixed = { ...state, dishes: [{ ...state.dishes[0]!, movable: false }] };
  expect(shared.checkMoves(fixed, [{ lineId: "sirloin", to: toDaily }])).toEqual({
    kind: "place_taken",
    lineId: "sirloin",
  });
});

it("refuses simultaneous moves that name the same dish twice", () => {
  expect(
    shared.checkMoves(specialSirloin(), [
      { lineId: "sirloin", to: toDaily },
      { lineId: "sirloin", to: toSpecial },
    ]),
  ).toEqual({ kind: "place_taken", lineId: "sirloin" });
});

it("leaves a sent dish in its place when two arrangements cost the same", () => {
  const samePriceDaily = {
    ...daily,
    dishes: daily.dishes.map((listing) =>
      listing.productId === "sirloin" ? { ...listing, surchargeCents: 0 } : listing,
    ),
  };
  const state = bill(["daily", samePriceDaily], ["a-special", special], ["b-special", special]);
  const sirloin = specialSirloin().dishes[0]!;
  const filled = {
    ...state,
    dishes: [
      { ...sirloin, lineId: "a-moving", setMenuLineId: "daily" },
      { ...sirloin, lineId: "z-standing", setMenuLineId: "a-special" },
    ],
  };
  expect(shared.suggestMove(filled, [], dish("hake"))).toEqual({
    moves: [
      {
        lineId: "a-moving",
        from: { setMenuLineId: "daily", place: 1 },
        to: { setMenuLineId: "b-special", place: 1 },
        priceCents: 0,
        countsAsCourseId: "mains",
      },
    ],
    place: {
      id: "hake",
      setMenuLineId: "daily",
      place: 1,
      priceCents: 0,
      countsAsCourseId: "mains",
    },
  });
});

it("surfaces an invalid planned place supplied to the fit", () => {
  const invalid = { ...dish("sea bass"), ...toDaily, priceCents: 0, countsAsCourseId: "mains" };
  expect(() => shared.suggestMove(specialSirloin(), [invalid], dish("hake"))).toThrow(
    expect.objectContaining({
      code: "set_menu.fit_invalid_input",
      params: { reason: "pinned_place_invalid", id: "sea bass" },
    }),
  );
});

it("refuses a move into a place held for a draft dish", () => {
  expect(
    shared.checkMoves(specialSirloin(), [{ lineId: "sirloin", to: toDaily }], [toDaily]),
  ).toEqual({
    kind: "place_taken",
    lineId: "sirloin",
  });
});

it.each([
  { surchargeCents: 500, expectedMoves: 2 },
  { surchargeCents: 0, expectedMoves: 1 },
])(
  "suggests $expectedMoves move(s) when Daily sirloin costs $surchargeCents cents",
  ({ surchargeCents, expectedMoves }) => {
    const pricedDaily = {
      ...daily,
      dishes: daily.dishes.map((listing) =>
        listing.productId === "sirloin" ? { ...listing, surchargeCents } : listing,
      ),
    };
    const state = bill(
      ["daily-one", pricedDaily],
      ["daily-two", pricedDaily],
      ["special-one", special],
      ["special-two", special],
    );
    const sirloin = specialSirloin().dishes[0]!;
    const filled = {
      ...state,
      dishes: [
        {
          ...sirloin,
          lineId: "sirloin-one",
          setMenuLineId: "daily-one",
          priceCents: surchargeCents,
        },
        {
          ...sirloin,
          lineId: "sirloin-two",
          setMenuLineId: "daily-two",
          priceCents: surchargeCents,
        },
      ],
    };
    const suggestion = shared.suggestMove(filled, [], dish("hake"));
    expect(suggestion?.moves).toHaveLength(expectedMoves);
    expect(suggestion?.moves.map(({ priceCents }) => priceCents)).toEqual(
      expectedMoves === 2 ? [0, 0] : [0],
    );
    expect(suggestion?.place).toEqual({
      id: "hake",
      ...suggestion?.moves[0]?.from,
      priceCents: 0,
      countsAsCourseId: "mains",
    });
  },
);
