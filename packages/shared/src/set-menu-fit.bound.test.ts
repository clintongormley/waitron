import { expect, it } from "vitest";

import { fitSetMenus, MAX_SET_MENU_AMOUNT_CENTS, type SetMenuFitInput } from "./set-menu-fit.js";

export function boundTable(seed: number, menus = 40, capped = false): SetMenuFitInput {
  const next = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 2 ** 32) * limit);
  };
  const courses = ["starter", "main", "dessert", "coffee", "bread", "drink"];
  const lines = [[0], [1, 0], [2, 3], [4], [5]].map((choices) => ({
    count: 1,
    courseIds: choices.map((index) => courses[index]!),
  }));
  const products = Array.from({ length: 40 }, (_, index) => ({
    productId: `product-${index}`,
    variantId: null,
    course: courses[index % courses.length]!,
  }));
  const offers = Array.from({ length: 5 }, (_, index) => ({
    id: `offer-${index}`,
    priceCents: capped ? MAX_SET_MENU_AMOUNT_CENTS : 1400 + index * 100,
    dishes: products
      .filter((_, item) => item < 6 || next(10) < 6)
      .map(({ productId, variantId, course }) => ({
        productId,
        variantId,
        countsAsCourseId: course,
        surchargeCents: capped ? MAX_SET_MENU_AMOUNT_CENTS : next(2) * next(801),
      })),
    lines,
  }));
  const setMenus = Array.from({ length: menus }, (_, index) => ({
    id: `menu-${index}`,
    fixedOfferId: null,
  }));
  const dishes = setMenus.flatMap((menu, index) =>
    lines.map((line, position) => {
      const listed = offers[index % offers.length]!.dishes;
      const accepted = products.filter(
        ({ course, productId }) =>
          line.courseIds.includes(course) && listed.some((dish) => dish.productId === productId),
      );
      const item = accepted[next(accepted.length)]!;
      return {
        id: `${menu.id}-${position}`,
        productId: item.productId,
        variantId: null,
        pinnedTo: null,
      };
    }),
  );
  return { offers, setMenus, dishes, previous: null };
}

it.each(Array.from({ length: 10 }, (_, index) => index + 1))(
  "fits and refits the largest agreed table in under 500 ms each (seed %i)",
  (seed) => {
    const input = boundTable(seed);
    const start = performance.now();
    const fit = fitSetMenus(input);
    expect(performance.now() - start, `fit seed ${seed}`).toBeLessThan(500);
    expect(fit.kind).toBe("fitted");
    if (fit.kind !== "fitted") return;
    const previous = {
      offerBySetMenu: new Map(fit.setMenus.map(({ id, offerId }) => [id, offerId])),
      placeByDish: new Map(fit.dishes.map(({ id, place }) => [id, place])),
    };
    const refit = {
      ...input,
      previous,
      dishes: [...input.dishes, { ...input.dishes[0]!, id: "new" }],
    };
    const refitStart = performance.now();
    const result = fitSetMenus(refit);
    expect(performance.now() - refitStart, `refit seed ${seed}`).toBeLessThan(500);
    expect(result).toEqual({ kind: "uncovered", setMenusNeeded: 41 });
  },
);

it("covers a bill that needs several more menus in under 500 ms", () => {
  const input = boundTable(1515);
  const start = performance.now();
  const result = fitSetMenus({ ...input, setMenus: input.setMenus.slice(0, 30) });
  expect(performance.now() - start).toBeLessThan(500);
  expect(result).toEqual({ kind: "uncovered", setMenusNeeded: 40 });
});

it("keeps every cent at the mix and amount caps", () => {
  const input = boundTable(1515, 47, true);
  const start = performance.now();
  const fit = fitSetMenus(input);
  expect(performance.now() - start).toBeLessThan(1000);
  expect(fit).toMatchObject({ kind: "fitted", totalCents: 282_000_000 });
});
