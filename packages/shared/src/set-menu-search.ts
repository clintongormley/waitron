import { solvePlacement, type Placement, type PlacementProblem } from "./set-menu-placement.js";

export const MAX_SET_MENU_MIXES = 250_000;

export interface MixSearchProblem {
  readonly offerCount: number;
  readonly unfixed: number;
  readonly mixCost: (counts: readonly number[]) => number;
  readonly capacities: (counts: readonly number[]) => readonly number[];
  readonly pairOffer: readonly number[];
  readonly pairPlaces: readonly number[];
  readonly placement: Omit<PlacementProblem, "capacities">;
}

export interface MixSearchResult {
  readonly counts: readonly number[];
  readonly placement: Placement;
  readonly cost: number;
}

export function mixCount(unfixed: number, offerCount: number): number {
  const smaller = Math.min(unfixed, offerCount - 1);
  const larger = Math.max(unfixed, offerCount - 1);
  let count = 1;
  for (let i = 1; i <= smaller; i++) {
    count = (count * (larger + i)) / i;
    if (count > MAX_SET_MENU_MIXES) return Infinity;
  }
  return count;
}

export function searchMixes(problem: MixSearchProblem): MixSearchResult {
  const { offerCount, unfixed, mixCost, capacities, pairOffer, pairPlaces, placement } = problem;
  function solve(counts: readonly number[], base: number): MixSearchResult {
    const result = solvePlacement({ ...placement, capacities: capacities(counts) });
    return { counts, placement: result, cost: base + result.cost };
  }

  const mixes = mixCount(unfixed, offerCount);
  const counts = Array<number>(offerCount).fill(0);
  if (mixes === 1) {
    counts[0] = unfixed;
    return solve(counts, mixCost(counts));
  }

  const vectors = new Int32Array(mixes * offerCount);
  const bases = new Float64Array(mixes);
  let row = 0;
  function enumerate(offer: number, left: number): void {
    if (offer === offerCount - 1) {
      counts[offer] = left;
      vectors.set(counts, row * offerCount);
      bases[row++] = mixCost(counts);
      return;
    }
    for (let count = 0; count <= left; count++) {
      counts[offer] = count;
      enumerate(offer + 1, left - count);
    }
  }
  enumerate(0, unfixed);

  let best: MixSearchResult | undefined;
  searchMixVectors({
    offerCount,
    pairOffer,
    pairPlaces,
    vectors,
    bases,
    solve,
    cutoff: () => best?.cost ?? Infinity,
    accept: (candidate) => {
      if (!best || candidate.cost < best.cost) best = candidate;
      return true;
    },
  });
  return best!;
}

interface MixVectors {
  readonly offerCount: number;
  readonly pairOffer: readonly number[];
  readonly pairPlaces: readonly number[];
  readonly vectors: Int32Array;
  readonly bases: Float64Array;
  readonly solve: (counts: number[], base: number) => MixSearchResult;
  readonly cutoff: () => number;
  readonly accept: (candidate: MixSearchResult) => boolean;
}

export function searchMixVectors({
  offerCount,
  pairOffer,
  pairPlaces,
  vectors,
  bases,
  solve,
  cutoff,
  accept,
}: MixVectors): boolean {
  const bounds = bases.slice();
  const slopes = new Float64Array(offerCount);
  for (;;) {
    let next = -1;
    let lowest = cutoff();
    for (let mix = 0; mix < bases.length; mix++) {
      if (bounds[mix]! < lowest) {
        lowest = bounds[mix]!;
        next = mix;
      }
    }
    if (next === -1) return true;

    const start = next * offerCount;
    const candidate = solve(Array.from(vectors.subarray(start, start + offerCount)), bases[next]!);
    if (!accept(candidate)) return false;
    bounds[next] = Infinity;

    slopes.fill(0);
    candidate.placement.capacityPrices.forEach((price, pair) => {
      const offer = pairOffer[pair]!;
      slopes[offer] = slopes[offer]! + price * pairPlaces[pair]!;
    });

    const limit = cutoff();
    for (let mix = 0; mix < bases.length; mix++) {
      if (bounds[mix]! >= limit) continue;
      let bound = bases[mix]! + candidate.placement.cost;
      for (let offer = 0; offer < offerCount; offer++) {
        const count = vectors[mix * offerCount + offer]!;
        bound -= slopes[offer]! * (count - candidate.counts[offer]!);
      }
      bounds[mix] = Math.max(bounds[mix]!, bound);
    }
  }
}
