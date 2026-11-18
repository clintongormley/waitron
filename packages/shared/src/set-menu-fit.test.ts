import { describe, expect, it } from "vitest";

import {
  fitSetMenus,
  MAX_SET_MENU_AMOUNT_CENTS,
  type SetMenuDish,
  type SetMenuFit,
  type SetMenuFitInput,
  type SetMenuOffer,
  type SetMenuOnBill,
} from "./index.js";

function offer(
  id: string,
  priceCents: number,
  items: readonly (string | readonly [string, number])[],
  lines: SetMenuOffer["lines"] = [
    { count: 1, courseIds: ["starter"] },
    { count: 1, courseIds: ["main"] },
  ],
): SetMenuOffer {
  return {
    id,
    priceCents,
    lines,
    dishes: items.map((item) =>
      typeof item === "string"
        ? { productId: item, variantId: null, surchargeCents: 0 }
        : { productId: item[0], variantId: null, surchargeCents: item[1] },
    ),
  };
}

function dish(id: string, productId: string, countsAsCourseId = "starter"): SetMenuDish {
  return { id, productId, countsAsCourseId, variantId: null, pinnedTo: null };
}

function menus(count: number, fixedOfferId: string | null = null): SetMenuOnBill[] {
  return Array.from({ length: count }, (_, i) => ({ id: `s${i + 1}`, fixedOfferId }));
}

const daily = offer("daily", 1400, ["soup", "hake", ["sirloin", 500]]);
const special = offer("special", 2000, ["soup", "hake", "sirloin", "sea bass"]);
const worked: SetMenuFitInput = {
  offers: [daily, special],
  setMenus: menus(4),
  previous: null,
  dishes: [
    ...menus(4).map(({ id }) => dish(`soup-${id}`, "soup")),
    dish("hake", "hake", "main"),
    dish("sirloin-a", "sirloin", "main"),
    dish("sirloin-b", "sirloin", "main"),
    dish("bass", "sea bass", "main"),
  ],
};

function smallBill(input: Partial<SetMenuFitInput> = {}): SetMenuFitInput {
  return { offers: [daily, special], setMenus: menus(2), dishes: [], previous: null, ...input };
}

function checkPlacement(
  input: SetMenuFitInput,
  fit: Extract<SetMenuFit, { kind: "fitted" }>,
): void {
  expect(fit.setMenus.map(({ id }) => id)).toEqual(input.setMenus.map(({ id }) => id).sort());
  expect(fit.dishes.map(({ id }) => id)).toEqual(input.dishes.map(({ id }) => id).sort());
  const occupied = new Map<string, number>();
  for (const menu of fit.setMenus) {
    const original = input.setMenus.find(({ id }) => id === menu.id)!;
    const chosen = input.offers.find(({ id }) => id === menu.offerId)!;
    expect(menu.priceCents).toBe(chosen.priceCents);
    if (original.fixedOfferId !== null) expect(menu.offerId).toBe(original.fixedOfferId);
  }
  for (const placed of fit.dishes) {
    const original = input.dishes.find(({ id }) => id === placed.id)!;
    const menu = fit.setMenus.find(({ id }) => id === placed.place.setMenuId)!;
    const chosen = input.offers.find(({ id }) => id === menu.offerId)!;
    const line = chosen.lines[placed.place.lineIndex]!;
    const listed = chosen.dishes.find(
      ({ productId, variantId }) =>
        productId === original.productId && variantId === original.variantId,
    );
    expect(placed.surchargeCents).toBe(listed?.surchargeCents);
    expect(line.courseIds).toContain(original.countsAsCourseId);
    const key = JSON.stringify(placed.place);
    const count = (occupied.get(key) ?? 0) + 1;
    expect(count).toBeLessThanOrEqual(line.count);
    occupied.set(key, count);
  }
  const sum =
    fit.setMenus.reduce((total, { priceCents }) => total + priceCents, 0) +
    fit.dishes.reduce((total, { surchargeCents }) => total + surchargeCents, 0);
  expect(fit.totalCents).toBe(sum);
}

describe("fitSetMenus", () => {
  it("finds the 72-euro bill from the design's worked example", () => {
    const fit = fitSetMenus(worked);
    expect(fit.kind).toBe("fitted");
    if (fit.kind !== "fitted") return;
    expect(fit.totalCents).toBe(7200);
    expect(fit.setMenus.map(({ offerId }) => offerId).sort()).toEqual([
      "daily",
      "daily",
      "daily",
      "special",
    ]);
    const specialId = fit.setMenus.find(({ offerId }) => offerId === "special")!.id;
    expect(fit.dishes.find(({ id }) => id === "bass")).toEqual({
      id: "bass",
      place: { setMenuId: specialId, lineIndex: 1 },
      surchargeCents: 0,
    });
    expect(
      fit.dishes
        .filter(({ id }) => id.startsWith("sirloin"))
        .map(({ surchargeCents }) => surchargeCents),
    ).toEqual([500, 500]);
    checkPlacement(worked, fit);
  });

  it("pools the two diners' special dishes into one menu", () => {
    const lines = [
      { count: 1, courseIds: ["starter"] },
      { count: 1, courseIds: ["main", "starter"] },
    ];
    const input = smallBill({
      offers: [
        offer("daily", 1400, ["soup", "hake"], lines),
        offer("special", 2000, ["soup", "oysters", "hake", "lobster"], lines),
      ],
      dishes: [
        dish("a", "soup"),
        dish("b", "oysters"),
        dish("c", "soup"),
        dish("d", "lobster", "main"),
      ],
    });
    const fit = fitSetMenus(input);
    expect(fit).toMatchObject({ kind: "fitted", totalCents: 3400 });
    if (fit.kind !== "fitted") return;
    expect(fit.setMenus.map(({ offerId }) => offerId).sort()).toEqual(["daily", "special"]);
    expect(fit.dishes[1]?.place.setMenuId).toBe(fit.dishes[3]?.place.setMenuId);
    checkPlacement(input, fit);
  });

  it("charges empty set menus at the cheapest offer", () => {
    expect(fitSetMenus(smallBill({ setMenus: menus(4) }))).toMatchObject({
      kind: "fitted",
      totalCents: 5600,
    });
  });

  it("keeps a fixed set menu's offer even though a cheaper one covers its dish", () => {
    expect(
      fitSetMenus(
        smallBill({
          setMenus: [
            { id: "s1", fixedOfferId: "special" },
            { id: "s2", fixedOfferId: null },
          ],
          dishes: [dish("a", "soup")],
        }),
      ),
    ).toMatchObject({
      kind: "fitted",
      totalCents: 3400,
      setMenus: [
        { id: "s1", offerId: "special", priceCents: 2000 },
        { id: "s2", offerId: "daily", priceCents: 1400 },
      ],
    });
  });

  it("matches a dish by product and variant", () => {
    const input = smallBill({
      offers: [
        {
          ...daily,
          dishes: [{ productId: "wine", variantId: "glass", surchargeCents: 100 }],
        },
      ],
    });
    for (const variantId of ["bottle", null]) {
      expect(fitSetMenus({ ...input, dishes: [{ ...dish("wine", "wine"), variantId }] })).toEqual({
        kind: "uncovered",
        setMenusNeeded: null,
      });
    }
    expect(
      fitSetMenus({ ...input, dishes: [{ ...dish("wine", "wine"), variantId: "glass" }] }),
    ).toMatchObject({ kind: "fitted", totalCents: 2900 });
  });

  it("cannot cover a course that no line accepts", () => {
    expect(fitSetMenus(smallBill({ dishes: [dish("a", "soup", "drink")] }))).toEqual({
      kind: "uncovered",
      setMenusNeeded: null,
    });
  });

  it("cannot price menus without offers", () => {
    expect(fitSetMenus(smallBill({ offers: [] }))).toEqual({
      kind: "uncovered",
      setMenusNeeded: null,
    });
  });

  it("fits an empty bill without offers", () => {
    expect(fitSetMenus(smallBill({ offers: [], setMenus: [] }))).toEqual({
      kind: "fitted",
      totalCents: 0,
      setMenus: [],
      dishes: [],
    });
  });

  it("stops beyond the permitted number of mixes", () => {
    const offers = Array.from({ length: 6 }, (_, i) => ({ ...daily, id: `offer-${i}` }));
    expect(fitSetMenus(smallBill({ offers, setMenus: menus(30) }))).toEqual({ kind: "too_large" });
    expect(fitSetMenus(smallBill({ offers: offers.slice(1), setMenus: menus(47) }))).toMatchObject({
      kind: "fitted",
      totalCents: 65_800,
    });
  });

  it.each<[string, Partial<SetMenuFitInput>, string, string]>([
    ["offers", { offers: [daily, daily] }, "duplicate_id", "daily"],
    [
      "listed dishes",
      { offers: [{ ...daily, dishes: [daily.dishes[0]!, daily.dishes[0]!] }] },
      "duplicate_id",
      "daily",
    ],
    ["menus", { setMenus: [...menus(1), ...menus(1)] }, "duplicate_id", "s1"],
    ["dishes", { dishes: [dish("a", "soup"), dish("a", "hake")] }, "duplicate_id", "a"],
    ["unknown fixed offers", { setMenus: menus(1, "gone") }, "unknown_offer", "s1"],
    [
      "menu price",
      { offers: [{ ...daily, priceCents: MAX_SET_MENU_AMOUNT_CENTS + 1 }] },
      "invalid_amount",
      "daily",
    ],
    [
      "dish surcharge",
      { offers: [offer("invalid", 0, [["soup", -1]])] },
      "invalid_amount",
      "invalid",
    ],
    ["fractional price", { offers: [{ ...daily, priceCents: 10.5 }] }, "invalid_amount", "daily"],
    [
      "unsafe count",
      {
        offers: [
          { ...daily, lines: [{ count: Number.MAX_SAFE_INTEGER + 1, courseIds: ["main"] }] },
        ],
      },
      "invalid_line",
      "daily",
    ],
    [
      "zero count",
      { offers: [{ ...daily, lines: [{ count: 0, courseIds: ["main"] }] }] },
      "invalid_line",
      "daily",
    ],
    [
      "empty line",
      { offers: [{ ...daily, lines: [{ count: 1, courseIds: [] }] }] },
      "invalid_line",
      "daily",
    ],
  ])("rejects invalid %s", (_label, input, reason, id) => {
    expect(() => fitSetMenus(smallBill(input))).toThrow(
      expect.objectContaining({
        code: "set_menu.fit_invalid_input",
        params: { reason, id },
      }),
    );
  });

  it("matches an exhaustive fit and returns a valid placement", () => {
    for (const [sample, input] of smallTables(300).entries()) {
      const fit = fitSetMenus(input);
      const expected = exhaustiveFit(input);
      expect(fit.kind, `sample ${sample}`).toBe(Number.isFinite(expected) ? "fitted" : "uncovered");
      if (fit.kind !== "fitted") continue;
      expect(fit.totalCents, `sample ${sample}`).toBe(expected);
      checkPlacement(input, fit);
    }
  });
});

function smallTables(count: number): SetMenuFitInput[] {
  let seed = 1515;
  const next = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 2 ** 32) * limit);
  };
  const courses = ["starter", "main", "drink"];
  const items = ["soup", "salad", "hake", "sirloin", "water", "coffee"];
  return Array.from({ length: count }, () => {
    const offers = Array.from({ length: 1 + next(3) }, (_, i) =>
      offer(
        `offer-${i}`,
        1000 + 100 * next(9),
        items.flatMap((item): [string, number][] => (next(3) === 0 ? [] : [[item, next(6) * 100]])),
        courses.map((course, j) => ({
          count: 1 + next(2),
          courseIds: next(4) ? [course] : [course, courses[(j + 1) % courses.length]!],
        })),
      ),
    );
    return smallBill({
      offers,
      setMenus: menus(next(4)).map((menu, i) =>
        i === 0 && next(3) === 0
          ? { ...menu, fixedOfferId: offers[next(offers.length)]!.id }
          : menu,
      ),
      dishes: Array.from({ length: next(7) }, (_, i) => {
        const product = next(items.length);
        return dish(`dish-${i}`, items[product]!, courses[Math.floor(product / 2)]!);
      }),
    });
  });
}

function exhaustiveFit(input: SetMenuFitInput): number {
  function tryOffers(chosen: SetMenuOffer[]): number {
    const menu = input.setMenus[chosen.length];
    if (menu) {
      return Math.min(
        ...input.offers
          .filter(({ id }) => menu.fixedOfferId === null || id === menu.fixedOfferId)
          .map((selected) => tryOffers([...chosen, selected])),
      );
    }
    const pairs = chosen.flatMap((selected) =>
      selected.lines.map((line) => ({
        ...line,
        offer: selected,
      })),
    );
    function place(index: number): number {
      const item = input.dishes[index];
      if (!item) return 0;
      let best = Infinity;
      for (const pair of pairs) {
        if (pair.count === 0 || !pair.courseIds.includes(item.countsAsCourseId)) continue;
        const listed = pair.offer.dishes.find(
          (entry) => entry.productId === item.productId && entry.variantId === item.variantId,
        );
        if (!listed) continue;
        pair.count--;
        best = Math.min(best, listed.surchargeCents + place(index + 1));
        pair.count++;
      }
      return best;
    }
    return chosen.reduce((cost, selected) => cost + selected.priceCents, 0) + place(0);
  }
  return tryOffers([]);
}

function previousFrom(fit: Extract<SetMenuFit, { kind: "fitted" }>) {
  return {
    offerBySetMenu: new Map(fit.setMenus.map(({ id, offerId }) => [id, offerId])),
    placeByDish: new Map(fit.dishes.map(({ id, place }) => [id, place])),
  };
}

describe("refitting set menus", () => {
  const tied = smallBill({ offers: [daily, { ...special, priceCents: daily.priceCents }] });
  const frozen = smallBill({
    setMenus: menus(1, "daily"),
    dishes: [{ ...dish("pinned", "soup"), pinnedTo: { setMenuId: "s1", lineIndex: 0 } }],
  });

  it("keeps equal-price types in preference to starting over", () => {
    const previous = {
      offerBySetMenu: new Map([
        ["s1", "special"],
        ["s2", "daily"],
      ]),
      placeByDish: new Map(),
    };
    expect(fitSetMenus({ ...tied, previous })).toMatchObject({
      setMenus: [
        { id: "s1", offerId: "special" },
        { id: "s2", offerId: "daily" },
      ],
    });
  });

  it("ignores an old menu that has gone and a place no longer on the menu", () => {
    const previous = {
      offerBySetMenu: new Map([
        ["s1", "daily"],
        ["gone", "special"],
      ]),
      placeByDish: new Map([["soup", { setMenuId: "s1", lineIndex: 8 }]]),
    };
    expect(
      fitSetMenus({ ...tied, setMenus: menus(1), dishes: [dish("soup", "soup")], previous }),
    ).toMatchObject({
      setMenus: [{ offerId: "daily" }],
      dishes: [{ place: { setMenuId: "s1", lineIndex: 0 } }],
    });
  });

  it("keeps an existing dish where it was when adding another of the same dish", () => {
    const previous = {
      offerBySetMenu: new Map([
        ["s1", "daily"],
        ["s2", "daily"],
      ]),
      placeByDish: new Map([["a", { setMenuId: "s2", lineIndex: 0 }]]),
    };
    expect(
      fitSetMenus({ ...tied, dishes: [dish("a", "soup"), dish("b", "soup")], previous }),
    ).toMatchObject({
      dishes: [
        { id: "a", place: { setMenuId: "s2" } },
        { id: "b", place: { setMenuId: "s1" } },
      ],
    });
  });

  it("changes the menu that lost its hake rather than a menu with both dishes", () => {
    const offerBySetMenu = new Map(
      menus(4).map(({ id }, i) => [id, i === 3 ? "special" : "daily"]),
    );
    const placeByDish = new Map(
      worked.dishes.slice(0, 4).map(({ id }, i) => [id, { setMenuId: `s${i + 1}`, lineIndex: 0 }]),
    );
    for (const [id, setMenuId] of [
      ["hake", "s1"],
      ["sirloin-a", "s2"],
      ["sirloin-b", "s3"],
      ["bass", "s4"],
    ]) {
      placeByDish.set(id!, { setMenuId: setMenuId!, lineIndex: 1 });
    }
    const dishes = worked.dishes
      .filter(({ id }) => id !== "hake")
      .concat(dish("bass-new", "sea bass", "main"));
    const fit = fitSetMenus({ ...worked, dishes, previous: { offerBySetMenu, placeByDish } });
    expect(fit).toMatchObject({ kind: "fitted", totalCents: 7800 });
    if (fit.kind !== "fitted") return;
    expect(fit.setMenus.map(({ offerId }) => offerId)).toEqual([
      "special",
      "daily",
      "daily",
      "special",
    ]);
    for (const { id, place } of fit.dishes) {
      expect(place).toEqual(
        id === "bass-new" ? { setMenuId: "s1", lineIndex: 1 } : placeByDish.get(id),
      );
    }
  });

  it("charges pinned surcharges and places new dishes around the pins", () => {
    const pinned = {
      ...dish("pinned", "sirloin", "main"),
      pinnedTo: { setMenuId: "s1", lineIndex: 1 },
    };
    expect(fitSetMenus({ ...frozen, dishes: [pinned, dish("new", "soup")] })).toMatchObject({
      totalCents: 1900,
      dishes: [
        { id: "new", place: { setMenuId: "s1", lineIndex: 0 } },
        { id: "pinned", place: pinned.pinnedTo, surchargeCents: 500 },
      ],
    });
    expect(fitSetMenus({ ...frozen, dishes: [...frozen.dishes, dish("new", "soup")] }).kind).toBe(
      "uncovered",
    );
  });

  it("keeps a pinned dish on its own menu even when it sorts after a newcomer", () => {
    const fit = fitSetMenus({
      ...frozen,
      setMenus: menus(2, "daily"),
      dishes: [...frozen.dishes, dish("new", "soup")],
    });
    expect(fit).toMatchObject({
      dishes: [
        { id: "new", place: { setMenuId: "s2" } },
        { id: "pinned", place: { setMenuId: "s1" } },
      ],
    });
  });

  it.each([
    ["gone", 0, "soup", "unknown_set_menu"],
    ["s2", 0, "soup", "pinned_to_unfixed"],
    ["s1", 2, "soup", "pinned_place_invalid"],
    ["s1", 0, "sea bass", "pinned_place_invalid"],
    ["s1", 1, "soup", "pinned_place_invalid"],
    ["s1", 0, "soup", "pinned_place_invalid"],
  ])("rejects a bad pin to %s line %i for %s", (setMenuId, lineIndex, productId, reason) => {
    expect(() =>
      fitSetMenus({
        ...frozen,
        setMenus: [...frozen.setMenus, { id: "s2", fixedOfferId: null }],
        dishes: [
          ...frozen.dishes,
          { ...dish("second", productId), pinnedTo: { setMenuId, lineIndex } },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        code: "set_menu.fit_invalid_input",
        params: { id: "second", reason },
      }),
    );
  });

  it.each([false, true])(
    "stops before weighted arithmetic becomes inexact (wide lines: %s)",
    (wide) => {
      const capped = offer(
        "capped",
        MAX_SET_MENU_AMOUNT_CENTS,
        [["soup", MAX_SET_MENU_AMOUNT_CENTS]],
        [{ count: wide ? 1_000_000 : 1, courseIds: ["starter"] }],
      );
      const setMenus = menus(wide ? 40 : 1000, "capped");
      expect(
        fitSetMenus(
          smallBill({
            offers: [capped],
            setMenus,
            dishes: setMenus.map(({ id }) => dish(id, "soup")),
          }),
        ).kind,
      ).toBe("too_large");
    },
  );

  it("returns the same fit in reverse input order and when refitting its own answer", () => {
    for (const input of smallTables(200)) {
      const fit = fitSetMenus(input);
      const reversed = {
        ...input,
        setMenus: [...input.setMenus].reverse(),
        dishes: [...input.dishes].reverse(),
        offers: [...input.offers].reverse().map((entry) => ({
          ...entry,
          dishes: [...entry.dishes].reverse(),
          lines: entry.lines.map((line) => ({ ...line, courseIds: [...line.courseIds].reverse() })),
        })),
      };
      expect(fitSetMenus(reversed)).toEqual(fit);
      if (fit.kind === "fitted")
        expect(fitSetMenus({ ...reversed, previous: previousFrom(fit) })).toEqual(fit);
    }
  });
});
