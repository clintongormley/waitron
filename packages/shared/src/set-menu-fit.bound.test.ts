import { expect, it } from "vitest";

import { fitSetMenus } from "./set-menu-fit.js";

import { boundTable } from "./set-menu-fit.fixtures.js";

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
