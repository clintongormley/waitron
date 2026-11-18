import { AppError, type ErrorParams } from "./errors.js";
import { mixCount, searchMixes, type MixSearchResult } from "./set-menu-search.js";

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
  offerIndex: ReadonlyMap<string, number>,
  pairs: readonly Pair[],
  classes: readonly DishClass[],
  result: MixSearchResult,
): Fitted {
  const remaining = [...result.counts];
  let nextOffer = 0;
  const menusByOffer = offers.map((): string[] => []);
  const setMenus = menus.map(({ id, fixedOfferId }) => {
    if (fixedOfferId === null) {
      while (remaining[nextOffer] === 0) nextOffer++;
      remaining[nextOffer]!--;
    }
    const offer = fixedOfferId === null ? nextOffer : offerIndex.get(fixedOfferId)!;
    menusByOffer[offer]!.push(id);
    return { id, offerId: offers[offer]!.id, priceCents: offers[offer]!.priceCents };
  });

  const filled = pairs.map(() => 0);
  const dishes: Fitted["dishes"][number][] = [];
  result.placement.flows.forEach((flows, group) => {
    const items = classes[group]!;
    let next = 0;
    for (const { pair, count } of flows) {
      const line = pairs[pair]!;
      const surchargeCents = items.arcs.find((arc) => arc.pair === pair)!.cost;
      for (let index = 0; index < count; index++) {
        const slot = filled[pair]!++;
        const setMenuId = menusByOffer[line.offer]![Math.floor(slot / line.count)]!;
        dishes.push({
          id: items.dishes[next++]!.id,
          place: { setMenuId, lineIndex: line.lineIndex },
          surchargeCents,
        });
      }
    }
  });
  return { kind: "fitted", totalCents: result.cost, setMenus, dishes: dishes.sort(compareId) };
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
  let unfixed = 0;
  for (const menu of menus) {
    if (menu.fixedOfferId === null) {
      unfixed++;
      continue;
    }
    const index = offerIndex.get(menu.fixedOfferId);
    if (index === undefined) invalid("unknown_offer", menu.id);
    fixed[index]!++;
  }

  if (menus.length === 0 && dishes.length === 0) {
    return { kind: "fitted", totalCents: 0, setMenus: [], dishes: [] };
  }
  if (offers.length === 0) return { kind: "uncovered", setMenusNeeded: null };

  const classesByKey = new Map<string, DishClass>();
  for (const dish of dishes) {
    const key = JSON.stringify([dish.productId, dish.variantId, dish.countsAsCourseId]);
    const group = classesByKey.get(key);
    if (group) {
      group.dishes.push(dish);
      continue;
    }
    const item = matchKey(dish);
    const arcs = pairs.flatMap((line, pair) => {
      const cost = surcharges[line.offer]!.get(item);
      return cost !== undefined && line.courseIds.includes(dish.countsAsCourseId)
        ? [{ pair, cost }]
        : [];
    });
    if (arcs.length === 0) return { kind: "uncovered", setMenusNeeded: null };
    classesByKey.set(key, { dishes: [dish], arcs });
  }

  const uncoveredCost = maxPrice * menus.length + maxSurcharge * dishes.length + 1;
  const placesPerMenu = pairs.reduce((total, line) => total + line.count, 0);
  if (
    mixCount(unfixed, offers.length) === Infinity ||
    !Number.isSafeInteger(uncoveredCost * (1 + dishes.length + placesPerMenu * menus.length))
  )
    return { kind: "too_large" };

  const classes = [...classesByKey.values()];
  const result = searchMixes({
    offerCount: offers.length,
    unfixed,
    mixCost: (counts) =>
      offers.reduce(
        (total, offer, index) => total + (counts[index]! + fixed[index]!) * offer.priceCents,
        0,
      ),
    capacities: (counts) =>
      pairs.map(({ offer, count }) => (counts[offer]! + fixed[offer]!) * count),
    pairOffer: pairs.map(({ offer }) => offer),
    pairPlaces: pairs.map(({ count }) => count),
    placement: {
      uncoveredCost,
      classes: classes.map(({ dishes, arcs }) => ({ count: dishes.length, arcs })),
    },
  });
  if (result.placement.uncovered > 0) return { kind: "uncovered", setMenusNeeded: null };
  return deal(offers, menus, offerIndex, pairs, classes, result);
}
