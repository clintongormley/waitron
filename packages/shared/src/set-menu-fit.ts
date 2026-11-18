import { AppError, type ErrorParams } from "./errors.js";
import {
  mixCount,
  searchMixes,
  type MixSearchProblem,
  type MixSearchResult,
} from "./set-menu-search.js";

export { MAX_SET_MENU_MIXES } from "./set-menu-search.js";
export const MAX_SET_MENU_AMOUNT_CENTS = 1_000_000;

export interface SetMenuOfferDish {
  readonly productId: string;
  readonly variantId: string | null;
  readonly surchargeCents: number;
}

export interface SetMenuOfferLine {
  readonly count: number;
  readonly courseIds: readonly string[];
}

export interface SetMenuOffer {
  readonly id: string;
  readonly priceCents: number;
  readonly dishes: readonly SetMenuOfferDish[];
  readonly lines: readonly SetMenuOfferLine[];
}

export interface SetMenuOnBill {
  readonly id: string;
  readonly fixedOfferId: string | null;
}

export interface SetMenuPlace {
  readonly setMenuId: string;
  readonly lineIndex: number;
}

export interface SetMenuDish {
  readonly id: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly countsAsCourseId: string;
  readonly pinnedTo: SetMenuPlace | null;
}

export interface SetMenuFitPrevious {
  readonly offerBySetMenu: ReadonlyMap<string, string>;
  readonly placeByDish: ReadonlyMap<string, SetMenuPlace>;
}

export interface SetMenuFitInput {
  readonly offers: readonly SetMenuOffer[];
  readonly setMenus: readonly SetMenuOnBill[];
  readonly dishes: readonly SetMenuDish[];
  readonly previous: SetMenuFitPrevious | null;
}

export type SetMenuFit =
  | {
      readonly kind: "fitted";
      readonly totalCents: number;
      readonly setMenus: readonly {
        readonly id: string;
        readonly offerId: string;
        readonly priceCents: number;
      }[];
      readonly dishes: readonly {
        readonly id: string;
        readonly place: SetMenuPlace;
        readonly surchargeCents: number;
      }[];
    }
  | { readonly kind: "uncovered"; readonly setMenusNeeded: number | null }
  | { readonly kind: "too_large" };

interface Pair extends SetMenuOfferLine {
  readonly offer: number;
  readonly lineIndex: number;
}

interface DishClass {
  readonly dishes: SetMenuDish[];
  readonly previousPair: number;
  readonly arcs: readonly { readonly pair: number; readonly cost: number }[];
}

type Fitted = Extract<SetMenuFit, { kind: "fitted" }>;

function invalid(reason: ErrorParams["set_menu.fit_invalid_input"]["reason"], id: string): never {
  throw new AppError("set_menu.fit_invalid_input", { reason, id });
}

function compareId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sorted<T extends { readonly id: string }>(items: readonly T[]): T[] {
  const copy = [...items].sort(compareId);
  copy.forEach(({ id }, index) => {
    if (id === copy[index - 1]?.id) invalid("duplicate_id", id);
  });
  return copy;
}

function matchKey({ productId, variantId }: Pick<SetMenuDish, "productId" | "variantId">): string {
  return JSON.stringify([productId, variantId]);
}

function checkAmount(cents: number, id: string): void {
  if (!Number.isInteger(cents) || cents < 0 || cents > MAX_SET_MENU_AMOUNT_CENTS) {
    invalid("invalid_amount", id);
  }
}

function deal(
  offers: readonly SetMenuOffer[],
  menus: readonly SetMenuOnBill[],
  pairs: readonly Pair[],
  classes: readonly DishClass[],
  result: MixSearchResult,
  placement: {
    assigned: Map<string, number>;
    preferences: readonly string[][];
    previous: SetMenuFitPrevious | null;
    occupied: readonly Map<string, number>[];
    placed: Map<string, Fitted["dishes"][number]>;
    moneyWeight: number;
  },
): Fitted {
  const { assigned, preferences, previous, occupied, placed, moneyWeight } = placement;
  const score = new Map<string, number>();
  result.placement.flows.forEach((flows, group) => {
    const { previousPair, dishes } = classes[group]!;
    if (!flows.some(({ pair }) => pair === previousPair)) return;
    for (const dish of dishes) {
      const { setMenuId } = previous!.placeByDish.get(dish.id)!;
      score.set(setMenuId, (score.get(setMenuId) ?? 0) + 1);
    }
  });

  const remaining = [...result.counts];
  preferences.forEach((ids, offer) => {
    const ranked = [...ids].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
    for (const id of ranked.slice(0, remaining[offer])) {
      assigned.set(id, offer);
      remaining[offer]!--;
    }
  });
  let nextOffer = 0;
  const menusByOffer = offers.map((): string[] => []);
  const setMenus = menus.map(({ id }) => {
    if (!assigned.has(id)) {
      while (remaining[nextOffer] === 0) nextOffer++;
      remaining[nextOffer]!--;
      assigned.set(id, nextOffer);
    }
    const offer = assigned.get(id)!;
    menusByOffer[offer]!.push(id);
    return { id, offerId: offers[offer]!.id, priceCents: offers[offer]!.priceCents };
  });

  function put(id: string, setMenuId: string, pair: number, surchargeCents: number): void {
    const filled = occupied[pair]!;
    filled.set(setMenuId, (filled.get(setMenuId) ?? 0) + 1);
    placed.set(id, { id, place: { setMenuId, lineIndex: pairs[pair]!.lineIndex }, surchargeCents });
  }
  const waiting = pairs.map((): { id: string; surchargeCents: number }[] => []);
  result.placement.flows.forEach((flows, index) => {
    const group = classes[index]!;
    const retained = flows.find(({ pair }) => pair === group.previousPair)?.count ?? 0;
    let kept = 0;
    if (retained > 0) {
      const pair = group.previousPair;
      const line = pairs[pair]!;
      const surcharge = Math.floor(group.arcs.find((arc) => arc.pair === pair)!.cost / moneyWeight);
      for (const dish of group.dishes) {
        if (kept === retained) break;
        const { setMenuId } = previous!.placeByDish.get(dish.id)!;
        if (
          assigned.get(setMenuId) !== line.offer ||
          (occupied[pair]!.get(setMenuId) ?? 0) >= line.count
        )
          continue;
        put(dish.id, setMenuId, pair, surcharge);
        kept++;
      }
    }

    let next = 0;
    for (const { pair, count } of flows) {
      const surchargeCents = Math.floor(
        group.arcs.find((arc) => arc.pair === pair)!.cost / moneyWeight,
      );
      const left = pair === group.previousPair ? count - kept : count;
      for (let i = 0; i < left; i++) {
        while (placed.has(group.dishes[next]!.id)) next++;
        waiting[pair]!.push({ id: group.dishes[next++]!.id, surchargeCents });
      }
    }
  });

  waiting.forEach((dishes, pair) => {
    const line = pairs[pair]!;
    const ids = menusByOffer[line.offer]!;
    let next = 0;
    for (const { id, surchargeCents } of dishes.sort(compareId)) {
      while ((occupied[pair]!.get(ids[next]!) ?? 0) >= line.count) next++;
      put(id, ids[next]!, pair, surchargeCents);
    }
  });

  const dishes = [...placed.values()].sort(compareId);
  const totalCents =
    setMenus.reduce((sum, { priceCents }) => sum + priceCents, 0) +
    dishes.reduce((sum, { surchargeCents }) => sum + surchargeCents, 0);
  return { kind: "fitted", totalCents, setMenus, dishes };
}

export function fitSetMenus(input: SetMenuFitInput): SetMenuFit {
  const offers = sorted(input.offers);
  const menus = sorted(input.setMenus);
  const dishes = sorted(input.dishes);
  const offerIndex = new Map(offers.map(({ id }, index) => [id, index]));
  let maxPrice = 0;
  let maxSurcharge = 0;
  const surcharges = offers.map((offer) => {
    checkAmount(offer.priceCents, offer.id);
    maxPrice = Math.max(maxPrice, offer.priceCents);
    const prices = new Map<string, number>();
    for (const dish of offer.dishes) {
      const key = matchKey(dish);
      if (prices.has(key)) invalid("duplicate_id", offer.id);
      checkAmount(dish.surchargeCents, offer.id);
      maxSurcharge = Math.max(maxSurcharge, dish.surchargeCents);
      prices.set(key, dish.surchargeCents);
    }
    return prices;
  });

  const pairs = offers.flatMap((offer, index) =>
    offer.lines.map((line, lineIndex): Pair => {
      if (!Number.isSafeInteger(line.count) || line.count < 1 || line.courseIds.length === 0) {
        invalid("invalid_line", offer.id);
      }
      return { ...line, offer: index, lineIndex };
    }),
  );

  const fixed = offers.map(() => 0);
  const preferences = offers.map((): string[] => []);
  const menuIds = new Set(menus.map(({ id }) => id));
  const assigned = new Map<string, number>();
  let unfixed = 0;
  let preferred = 0;
  for (const { id, fixedOfferId } of menus) {
    if (fixedOfferId === null) {
      const oldOffer = input.previous?.offerBySetMenu.get(id);
      const oldIndex = oldOffer === undefined ? undefined : offerIndex.get(oldOffer);
      if (oldIndex !== undefined) {
        preferences[oldIndex]!.push(id);
        preferred++;
      }
      unfixed++;
      continue;
    }
    const index = offerIndex.get(fixedOfferId);
    if (index === undefined) invalid("unknown_offer", id);
    fixed[index]!++;
    assigned.set(id, index);
  }

  function findPair(offer: number, lineIndex: number): number {
    return pairs.findIndex((line) => line.offer === offer && line.lineIndex === lineIndex);
  }
  const placed = new Map<string, Fitted["dishes"][number]>();
  const occupied = pairs.map(() => new Map<string, number>());
  const pinnedCounts = pairs.map(() => 0);
  for (const dish of dishes) {
    const place = dish.pinnedTo;
    if (!place) continue;
    if (!menuIds.has(place.setMenuId)) invalid("unknown_set_menu", dish.id);
    const offer = assigned.get(place.setMenuId);
    if (offer === undefined) invalid("pinned_to_unfixed", dish.id);
    const pair = findPair(offer, place.lineIndex);
    const line = pairs[pair];
    const surchargeCents = surcharges[offer]!.get(matchKey(dish));
    if (!line || surchargeCents === undefined || !line.courseIds.includes(dish.countsAsCourseId)) {
      invalid("pinned_place_invalid", dish.id);
    }
    const filled = occupied[pair]!;
    const count = (filled.get(place.setMenuId) ?? 0) + 1;
    if (count > line.count) invalid("pinned_place_invalid", dish.id);
    filled.set(place.setMenuId, count);
    pinnedCounts[pair]!++;
    placed.set(dish.id, { id: dish.id, place: { ...place }, surchargeCents });
  }

  if (menus.length === 0 && dishes.length === 0) {
    return { kind: "fitted", totalCents: 0, setMenus: [], dishes: [] };
  }
  if (offers.length === 0) return { kind: "uncovered", setMenusNeeded: null };

  const dishWeight = dishes.length + 1;
  const moneyWeight = (menus.length + 1) * dishWeight;
  const classesByKey = new Map<string, DishClass>();
  for (const dish of dishes) {
    if (placed.has(dish.id)) continue;
    const oldPlace = input.previous?.placeByDish.get(dish.id);
    const oldOffer =
      oldPlace && menuIds.has(oldPlace.setMenuId)
        ? input.previous?.offerBySetMenu.get(oldPlace.setMenuId)
        : undefined;
    const oldIndex = oldOffer === undefined ? undefined : offerIndex.get(oldOffer);
    const previousPair = oldIndex === undefined ? -1 : findPair(oldIndex, oldPlace!.lineIndex);
    const item = matchKey(dish);
    const key = JSON.stringify([item, dish.countsAsCourseId, previousPair]);
    const group = classesByKey.get(key);
    if (group) {
      group.dishes.push(dish);
      continue;
    }
    const arcs = pairs.flatMap((line, pair) => {
      const surcharge = surcharges[line.offer]!.get(item);
      if (surcharge === undefined || !line.courseIds.includes(dish.countsAsCourseId)) return [];
      const moved = previousPair >= 0 && previousPair !== pair ? 1 : 0;
      return [{ pair, cost: surcharge * moneyWeight + moved }];
    });
    if (arcs.length === 0) return { kind: "uncovered", setMenusNeeded: null };
    classesByKey.set(key, { dishes: [dish], previousPair, arcs });
  }

  const uncoveredCost = moneyWeight * (maxPrice * menus.length + maxSurcharge * dishes.length + 1);
  const placesPerMenu = pairs.reduce((total, line) => total + line.count, 0);
  if (
    mixCount(unfixed, offers.length) === Infinity ||
    !Number.isSafeInteger(uncoveredCost * (1 + dishes.length + placesPerMenu * menus.length))
  )
    return { kind: "too_large" };

  const classes = [...classesByKey.values()];
  const search: MixSearchProblem = {
    offerCount: offers.length,
    unfixed,
    mixCost: (counts) => {
      let cents = 0;
      let changes = preferred;
      offers.forEach(({ priceCents }, index) => {
        cents += (counts[index]! + fixed[index]!) * priceCents;
        changes -= Math.min(counts[index]!, preferences[index]!.length);
      });
      return cents * moneyWeight + changes * dishWeight;
    },
    capacities: (counts) =>
      pairs.map(
        ({ offer, count }, pair) => (counts[offer]! + fixed[offer]!) * count - pinnedCounts[pair]!,
      ),
    pairOffer: pairs.map(({ offer }) => offer),
    pairPlaces: pairs.map(({ count }) => count),
    placement: {
      uncoveredCost,
      classes: classes.map(({ dishes, arcs }) => ({ count: dishes.length, arcs })),
    },
  };
  const offerPlaces = offers.map(({ lines }) => lines.reduce((sum, { count }) => sum + count, 0));
  const mostPlaces = offerPlaces.reduce((most, count) => Math.max(most, count), 0);
  const billPlaces = fixed.reduce(
    (total, count, offer) => total + count * offerPlaces[offer]!,
    unfixed * mostPlaces,
  );
  function coverageSearch(count: number): MixSearchResult {
    return searchMixes({
      ...search,
      unfixed: count,
      mixCost: () => 0,
      placement: {
        uncoveredCost: 1,
        classes: search.placement.classes.map(({ count, arcs }) => ({
          count,
          arcs: arcs.map(({ pair }) => ({ pair, cost: 0 })),
        })),
      },
    });
  }
  // When the bill has too few places, only the number of unplaced dishes matters.
  const result = dishes.length > billPlaces ? coverageSearch(unfixed) : searchMixes(search);
  const missing = result.placement.uncovered;
  if (missing > 0) {
    // A separate new menu for each unplaced dish is sufficient. Adding menus preserves a fit.
    let sufficient = unfixed + missing;
    let low = unfixed + Math.max(1, Math.ceil((dishes.length - billPlaces) / mostPlaces));
    let high = sufficient;
    for (let count = low; low < high; count = Math.floor((low + high) / 2)) {
      const total = menus.length + count - unfixed;
      if (
        mixCount(count, offers.length) === Infinity ||
        !Number.isSafeInteger(1 + dishes.length + placesPerMenu * total)
      ) {
        high = count;
      } else if (coverageSearch(count).placement.uncovered === 0) {
        sufficient = count;
        high = count;
      } else {
        low = count + 1;
      }
    }
    return { kind: "uncovered", setMenusNeeded: menus.length + sufficient - unfixed };
  }
  return deal(offers, menus, pairs, classes, result, {
    assigned,
    preferences,
    previous: input.previous,
    occupied,
    placed,
    moneyWeight,
  });
}
