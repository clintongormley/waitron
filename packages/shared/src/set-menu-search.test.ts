import { describe, expect, it, vi } from "vitest";

import * as placement from "./set-menu-placement.js";
import { mixCount, searchMixes, type MixSearchProblem } from "./set-menu-search.js";

function problem(
  offerCount: number,
  unfixed: number,
  prices: readonly number[],
  classes: MixSearchProblem["placement"]["classes"],
): MixSearchProblem {
  return {
    offerCount,
    unfixed,
    pairOffer: prices.map((_, index) => index),
    pairPlaces: prices.map(() => 1),
    capacities: (counts) => counts,
    mixCost: (counts) => counts.reduce((total, count, offer) => total + count * prices[offer]!, 0),
    placement: { classes, uncoveredCost: 1000 },
  };
}

describe("set-menu mix search", () => {
  it.each([
    [40, 4, 12341],
    [47, 5, 249900],
    [48, 5, Infinity],
    [0, 3, 1],
    [3, 1, 1],
  ])("counts splits of %i menus among %i offers", (menus, offers, expected) => {
    expect(mixCount(menus, offers)).toBe(expected);
  });

  it("finds the cheapest mix that can place every dish", () => {
    const input = problem(2, 2, [10, 15], [{ count: 2, arcs: [{ pair: 1, cost: 0 }] }]);
    expect(searchMixes(input)).toMatchObject({
      counts: [0, 2],
      cost: 30,
      placement: { uncovered: 0 },
    });
  });

  it("keeps the first solved equal-cost mix in enum order when bounds tie", () => {
    expect(searchMixes(problem(3, 2, [10, 10, 10], [])).counts).toEqual([0, 0, 2]);
  });

  it("agrees with solving every mix", () => {
    let seed = 1515;
    const next = (limit: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 2 ** 32) * limit);
    };
    for (let sample = 0; sample < 200; sample++) {
      const prices = Array.from({ length: 1 + next(3) }, () => 10 + next(6));
      const input = problem(
        prices.length,
        next(5),
        prices,
        Array.from({ length: 1 + next(3) }, () => ({
          count: 1 + next(2),
          arcs: prices.flatMap((_, pair) => (next(3) === 0 ? [] : [{ pair, cost: next(7) }])),
        })),
      );
      let best = Infinity;
      function tryCounts(prefix: number[], left: number): void {
        if (prefix.length === input.offerCount - 1) {
          const counts = [...prefix, left];
          const found = placement.solvePlacement({ ...input.placement, capacities: counts });
          best = Math.min(best, input.mixCost(counts) + found.cost);
          return;
        }
        for (let count = 0; count <= left; count++) tryCounts([...prefix, count], left - count);
      }
      tryCounts([], input.unfixed);
      expect(searchMixes(input).cost, `sample ${sample}`).toBe(best);
    }
  });

  it("skips placements when their lower bounds already rule them out", () => {
    const solve = vi.spyOn(placement, "solvePlacement");
    try {
      const input = problem(4, 20, [10, 15, 20, 25], [{ count: 20, arcs: [{ pair: 3, cost: 0 }] }]);
      expect(searchMixes(input)).toMatchObject({ counts: [0, 0, 0, 20], cost: 500 });
      expect(solve.mock.calls.length).toBeLessThan(100);
    } finally {
      solve.mockRestore();
    }
  });
});
