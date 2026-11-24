import { describe, expect, it } from "vitest";

import { solvePlacement, type PlacementProblem } from "./set-menu-placement.js";

describe("set-menu placement", () => {
  const cheap = { pair: 0, cost: 0 };
  const twoPlaces = {
    capacities: [1, 1],
    classes: [{ count: 2, arcs: [cheap, { pair: 1, cost: 5 }] }],
    uncoveredCost: 1000,
  };

  it("places each dish on its cheapest pair with room", () => {
    expect(solvePlacement(twoPlaces)).toMatchObject({
      cost: 5,
      uncovered: 0,
      flows: [
        [
          { pair: 0, count: 1 },
          { pair: 1, count: 1 },
        ],
      ],
    });
  });

  it("trades a cheap place for a dish that has no other", () => {
    expect(
      solvePlacement({
        ...twoPlaces,
        classes: [
          { count: 1, arcs: [cheap, { pair: 1, cost: 3 }] },
          { count: 1, arcs: [cheap] },
        ],
      }),
    ).toMatchObject({
      cost: 3,
      uncovered: 0,
      flows: [[{ pair: 1, count: 1 }], [{ pair: 0, count: 1 }]],
    });
  });

  it("leaves a dish uncovered when no pair has room", () => {
    expect(
      solvePlacement({
        capacities: [0],
        classes: [{ count: 1, arcs: [cheap] }],
        uncoveredCost: 1000,
      }),
    ).toEqual({ cost: 1000, uncovered: 1, flows: [[]], capacityPrices: [1000] });
  });

  it("leaves every dish in a class with no arcs uncovered", () => {
    expect(
      solvePlacement({
        capacities: [2],
        classes: [{ count: 3, arcs: [] }],
        uncoveredCost: 1000,
      }),
    ).toEqual({ cost: 3000, uncovered: 3, flows: [[]], capacityPrices: [0] });
  });

  it("compares menu placement with each dish's individual price", () => {
    expect(
      solvePlacement({
        capacities: [1],
        classes: [
          { count: 1, arcs: [{ pair: 0, cost: 50 }], uncoveredCost: 100 },
          { count: 1, arcs: [{ pair: 0, cost: 80 }], uncoveredCost: 300 },
        ],
        uncoveredCost: 1000,
      }),
    ).toMatchObject({ cost: 180, uncovered: 1, flows: [[], [{ pair: 0, count: 1 }]] });
  });

  it("prices a full pair a dish wanted", () => {
    expect(solvePlacement(twoPlaces).capacityPrices).toEqual([5, 0]);
  });

  it("matches an exhaustive placement and never bounds another placement above its true cost", () => {
    let seed = 1515;
    const next = (limit: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 2 ** 32) * limit);
    };
    for (let sample = 0; sample < 300; sample++) {
      const pairCount = 1 + next(3);
      const capacities = Array.from({ length: pairCount }, () => next(5));
      const problem: PlacementProblem = {
        capacities,
        classes: Array.from({ length: 1 + next(3) }, () => ({
          count: 1 + next(2),
          arcs: capacities.flatMap((_, pair) => (next(4) === 0 ? [] : [{ pair, cost: next(10) }])),
        })),
        uncoveredCost: 1000,
      };
      const solution = solvePlacement(problem);
      expect(solution.cost, `sample ${sample}`).toBe(exhaustiveCost(problem));
      for (let probe = 0; probe < 5; probe++) {
        const changed = capacities.map(() => next(5));
        const bound = solution.capacityPrices.reduce(
          (cost, price, pair) => cost - price * (changed[pair]! - capacities[pair]!),
          solution.cost,
        );
        expect(
          exhaustiveCost({ ...problem, capacities: changed }),
          `sample ${sample} probe ${probe}`,
        ).toBeGreaterThanOrEqual(bound);
      }
    }
  });
});

function exhaustiveCost(problem: PlacementProblem): number {
  const dishes = problem.classes.flatMap(({ count, arcs }) =>
    Array.from({ length: count }, () => arcs),
  );
  const remaining = [...problem.capacities];
  function place(dish: number): number {
    const arcs = dishes[dish];
    if (!arcs) return 0;
    let cost = problem.uncoveredCost + place(dish + 1);
    for (const arc of arcs) {
      const capacity = remaining[arc.pair]!;
      if (capacity === 0) continue;
      remaining[arc.pair] = capacity - 1;
      cost = Math.min(cost, arc.cost + place(dish + 1));
      remaining[arc.pair] = capacity;
    }
    return cost;
  }
  return place(0);
}
