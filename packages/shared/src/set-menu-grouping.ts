import {
  MAX_SET_MENU_AMOUNT_CENTS,
  type SetMenuDish,
  type SetMenuOffer,
  type SetMenuPlace,
} from "./set-menu-fit.js";
import { solvePlacement, type PlacementProblem } from "./set-menu-placement.js";
import { MAX_SET_MENU_MIXES, searchMixVectors } from "./set-menu-search.js";

export interface SetMenuGroupingDish extends Pick<SetMenuDish, "id" | "productId" | "variantId"> {
  readonly courseId: string;
  readonly aLaCarteCents: number;
  readonly extrasCents: number;
  readonly eligible: boolean;
}

export type SetMenuGroupingDiscount = {
  readonly id: string;
  readonly offerId: string;
  /** Carries the replaced ID for this calculation so the caller can retire it when saving. */
  readonly replacesDiscountId?: string;
} & (
  | { readonly kind: "comp" }
  | { readonly kind: "amount"; readonly cents: number }
  | { readonly kind: "percent"; readonly basisPoints: number }
);

interface SavedMenu {
  readonly id: string;
  readonly offerId: string;
  readonly discountId: string | null;
}

interface SavedDish {
  readonly id: string;
  readonly place: SetMenuPlace | null;
}

export interface SetMenuGroupingPrevious {
  readonly setMenus: readonly SavedMenu[];
  readonly dishes: readonly SavedDish[];
}

/** The caller supplies unique IDs, whole nonnegative cents and percentages from 0 to 10,000 basis points. */
export interface SetMenuGroupingInput {
  readonly offers: readonly SetMenuOffer[];
  readonly dishes: readonly SetMenuGroupingDish[];
  readonly discounts: readonly SetMenuGroupingDiscount[];
  readonly previous: SetMenuGroupingPrevious | null;
}

export interface SetMenuGrouping extends SetMenuGroupingPrevious {
  readonly exact: boolean;
  readonly totalCents: number;
  readonly unusedDiscountIds: readonly string[];
  readonly setMenus: readonly (SavedMenu & {
    readonly baseCents: number;
    readonly discountCents: number;
  })[];
  readonly dishes: readonly (SavedDish & {
    readonly chargeCents: number;
    readonly extrasCents: number;
  })[];
}

interface Choice {
  readonly offer: SetMenuOffer;
  readonly discount: SetMenuGroupingDiscount | undefined;
  readonly baseCost: number;
  readonly factor: number;
  readonly round: boolean;
  readonly allowance: number;
}

interface Pair {
  readonly choice: number;
  readonly line: number;
  readonly capacity: number;
}

interface Arc {
  readonly pair: number;
  readonly supplement: number;
}

const SCALE = 10_000;
const MAX_GROUPING_MIXES = 1_000_000;
const PLACEMENT_LIMIT = 300;
const REFINEMENT_WORK_LIMIT = 16_000;
const REFINEMENTS_PER_MIX = 300;
const FALLBACK_LIMIT = 100;

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function reduction(discount: SetMenuGroupingDiscount | undefined, gross: number): number {
  switch (discount?.kind) {
    case "comp":
      return gross;
    case "amount":
      return Math.min(gross, discount.cents);
    case "percent":
      return Math.floor((gross * discount.basisPoints + SCALE / 2) / SCALE);
    default:
      return 0;
  }
}

function choice(offer: SetMenuOffer, discount?: SetMenuGroupingDiscount): Choice {
  const net = offer.priceCents - (discount?.kind === "amount" ? discount.cents : 0);
  const factor =
    discount?.kind === "comp"
      ? 0
      : SCALE - (discount?.kind === "percent" ? discount.basisPoints : 0);
  const fractional = (cents: number) => (cents * factor) % SCALE !== 0;
  const round =
    fractional(offer.priceCents) ||
    offer.dishes.some(({ surchargeCents }) => fractional(surchargeCents));
  return {
    offer,
    discount,
    factor,
    round,
    baseCost: Math.max(0, net) * factor - (round ? SCALE / 2 : 0),
    allowance: Math.max(0, -net) * SCALE,
  };
}

function supplementBound({ supplement }: Arc, { factor, allowance }: Choice, pinned = 0): number {
  return Math.max(0, supplement * factor - Math.max(0, allowance - pinned * SCALE));
}

function selectCounts(
  choices: readonly Choice[],
  limits: readonly number[],
  budget: number,
  dishes: number,
) {
  // Allow more count vectors on twenty three-course orders without widening the largest bills.
  const mixLimit = dishes <= 60 && choices.length <= 5 ? MAX_GROUPING_MIXES : MAX_SET_MENU_MIXES;
  const vectors: number[] = [];
  const bases: number[] = [];
  const counts = choices.map(() => 0);
  const prices = choices.map(({ baseCost }) => baseCost);
  const minimumLeft = [0];
  for (let i = choices.length - 1; i >= 0; i--) {
    minimumLeft.unshift(minimumLeft[0]! + Math.min(0, prices[i]!));
  }

  function visit(index: number, left: number, base: number): boolean {
    if (base + minimumLeft[index]! > budget) return true;
    const option = choices[index];
    if (!option) {
      vectors.push(...counts);
      return bases.push(base) < mixLimit;
    }
    const limit = Math.min(left, limits[index]!);
    counts[index] = 0;
    if (!visit(index + 1, left, base)) return false;
    for (let count = 1; count <= limit; count++) {
      counts[index] = count;
      if (!visit(index + 1, left - count, base + count * prices[index]!)) return false;
    }
    counts[index] = 0;
    return true;
  }

  return visit(0, dishes, 0)
    ? { vectors: Int32Array.from(vectors), bases: Float64Array.from(bases) }
    : null;
}

type Menu = { readonly id: string; readonly option: number };
type Assignment = readonly [menu: number, line: number, supplement: number];

export function groupSetMenus(input: SetMenuGroupingInput): SetMenuGrouping {
  const dishes = [...input.dishes].sort(byId);
  const offers = [...input.offers].sort(byId);
  const submitted = [...input.discounts].sort(byId);
  const replacements = new Map(
    submitted.flatMap(({ id, replacesDiscountId }) =>
      replacesDiscountId === undefined ? [] : [[replacesDiscountId, id] as const],
    ),
  );
  const discounts = submitted.filter(({ id }) => !replacements.has(id));
  const discountIds = [
    ...new Set([...submitted.map(({ id }) => id), ...replacements.keys()]),
  ].sort();
  const discountsById = new Map(discounts.map((discount) => [discount.id, discount]));
  const oldMenu = new Map(
    input.previous?.setMenus.map((menu) => [
      menu.id,
      {
        ...menu,
        discountId: replacements.get(menu.discountId ?? "") ?? menu.discountId,
      },
    ]),
  );
  const oldPlace = new Map(input.previous?.dishes.map(({ id, place }) => [id, place]));
  const choices = offers.flatMap((offer) => [
    choice(offer),
    ...discounts
      .filter(({ offerId }) => offerId === offer.id)
      .map((discount) => choice(offer, discount)),
  ]);
  const pairs = choices.flatMap(({ offer }, index) =>
    offer.lines.map(({ count }, line): Pair => ({ choice: index, line, capacity: count })),
  );
  const listings = choices.map(
    ({ offer }) =>
      new Map(
        offer.dishes.map((dish) => [
          JSON.stringify([dish.productId, dish.variantId]),
          dish.surchargeCents,
        ]),
      ),
  );
  const arcs = dishes.map((dish): Arc[] => {
    if (!dish.eligible || dish.aLaCarteCents > MAX_SET_MENU_AMOUNT_CENTS) return [];
    const key = JSON.stringify([dish.productId, dish.variantId]);
    return pairs.flatMap(({ choice: index, line }, pair) => {
      const option = choices[index]!;
      const supplement = listings[index]!.get(key);
      return supplement !== undefined && option.offer.lines[line]!.courseIds.includes(dish.courseId)
        ? [{ pair, supplement }]
        : [];
    });
  });

  const aLaCarte = dishes.map(({ aLaCarteCents }) => aLaCarteCents);
  const extras = dishes.reduce((sum, dish) => sum + dish.extrasCents, 0);
  const limits = choices.map(() => 0);
  for (const compatible of arcs) {
    for (const index of new Set(compatible.map(({ pair }) => pairs[pair]!.choice)))
      limits[index]!++;
  }
  const eligibleCost = dishes.reduce(
    (total, dish, i) => total + (arcs[i]!.length > 0 ? dish.aLaCarteCents : 0),
    0,
  );
  const eligibleCount = arcs.filter((options) => options.length > 0).length;
  let serial = 0;
  function newMenuId(): string {
    let id: string;
    do id = `new-menu-${++serial}`;
    while (oldMenu.has(id));
    return id;
  }

  const byType = new Map<string, number[]>();
  choices.forEach(({ offer }, index) => {
    const options = byType.get(offer.id);
    if (options) options.push(index);
    else byType.set(offer.id, [index]);
  });

  const ranked = new Map<string, { count: number; saving: number }>();
  const savedSlots = dishes.map(({ id }, i) => {
    const place = oldPlace.get(id);
    const menu = place && oldMenu.get(place.setMenuId);
    if (!menu) return undefined;
    const arc = arcs[i]!.find(({ pair }) => {
      const { choice, line } = pairs[pair]!;
      return line === place.lineIndex && choices[choice]!.offer.id === menu.offerId;
    });
    if (!arc) return undefined;
    const rank = ranked.get(menu.id) ?? { count: 0, saving: 0 };
    rank.count++;
    rank.saving += aLaCarte[i]! - arc.supplement;
    ranked.set(menu.id, rank);
    return { ...place, supplement: arc.supplement };
  });
  const saved = [...oldMenu.values()].sort(
    (a, b) =>
      (ranked.get(b.id)?.count ?? 0) - (ranked.get(a.id)?.count ?? 0) ||
      (ranked.get(b.id)?.saving ?? 0) - (ranked.get(a.id)?.saving ?? 0) ||
      byId(a, b),
  );
  const optionsFor = (menu: SavedMenu) => byType.get(menu.offerId) ?? [];
  const grantOf = (option: number) => choices[option]!.discount?.id ?? null;

  function candidates(counts: readonly number[]): Menu[] {
    const remaining = [...counts];
    const chosen = new Map<string, SavedMenu[]>();
    for (const menu of saved) {
      const prior = chosen.get(menu.offerId) ?? [];
      if (prior.length >= optionsFor(menu).reduce((sum, i) => sum + counts[i]!, 0)) continue;
      prior.push(menu);
      chosen.set(menu.offerId, prior);
    }
    const selected: Menu[] = [];
    const unassigned = new Set([...chosen.values()].flat());
    for (const matchDiscount of [true, false]) {
      for (const menu of unassigned) {
        const option = optionsFor(menu).find(
          (i) => remaining[i]! > 0 && (!matchDiscount || grantOf(i) === menu.discountId),
        );
        if (option === undefined) continue;
        remaining[option]!--;
        unassigned.delete(menu);
        selected.push({ id: menu.id, option });
      }
    }
    serial = 0;
    remaining.forEach((count, option) => {
      for (let i = 0; i < count; i++) selected.push({ id: newMenuId(), option });
    });
    return selected;
  }

  function materialize(
    menus: readonly Menu[],
    assigned: readonly (Assignment | undefined)[],
    reprice?: { readonly changedOfferId: string; readonly prior: SetMenuGrouping } | "all",
  ): SetMenuGrouping {
    const gross = menus.map(({ option }) => choices[option]!.offer.priceCents);
    const places = dishes.map((_, i) => {
      const match = assigned[i];
      if (!match) return null;
      const [menu, lineIndex, supplement] = match;
      gross[menu]! += supplement;
      return { setMenuId: menus[menu]!.id, lineIndex };
    });
    const occupied = new Set(assigned.flatMap((match) => (match ? [match[0]] : [])));
    const replaceGrant = (offerId: string) =>
      reprice === "all" || offerId === reprice?.changedOfferId;
    const grantsToMatch = discounts.filter(({ offerId }) => replaceGrant(offerId));
    const granted =
      grantsToMatch.length > 0
        ? solvePlacement({
            capacities: menus.map((_, i) => Number(occupied.has(i))),
            uncoveredCost: 0,
            classes: grantsToMatch.map((discount) => ({
              count: 1,
              arcs: menus.flatMap(({ option, id }, pair) =>
                choices[option]!.offer.id === discount.offerId
                  ? [
                      {
                        pair,
                        cost:
                          -reduction(discount, gross[pair]!) * (menus.length + 1) +
                          Number(oldMenu.get(id)?.discountId !== discount.id) -
                          1,
                      },
                    ]
                  : [],
              ),
            })),
          }).flows
        : undefined;
    const earned = new Map(
      granted?.flatMap((flows, i) => flows.map(({ pair }) => [pair, grantsToMatch[i]!] as const)),
    );
    const priorGrants = new Map(
      reprice && reprice !== "all"
        ? reprice.prior.setMenus.map(({ id, discountId }) => [id, discountId])
        : [],
    );
    const chargedMenus = menus.flatMap(({ id, option }, i) => {
      if (!occupied.has(i)) return [];
      const { offer } = choices[option]!;
      const discount = replaceGrant(offer.id)
        ? earned.get(i)
        : reprice
          ? discountsById.get(priorGrants.get(id) ?? "")
          : choices[option]!.discount;
      return [
        {
          id,
          offerId: offer.id,
          discountId: discount?.id ?? null,
          baseCents: offer.priceCents,
          discountCents: reduction(discount, gross[i]!),
        },
      ];
    });
    const used = new Set(chargedMenus.map(({ discountId }) => discountId));
    const pricedDishes = dishes.map(({ id, extrasCents }, i) => ({
      id,
      extrasCents,
      place: places[i]!,
      chargeCents: assigned[i]?.[2] ?? aLaCarte[i]!,
    }));
    return {
      exact: false,
      totalCents:
        chargedMenus.reduce((total, menu) => total + menu.baseCents - menu.discountCents, extras) +
        pricedDishes.reduce((total, dish) => total + dish.chargeCents, 0),
      setMenus: chargedMenus.sort(byId),
      dishes: pricedDishes,
      unusedDiscountIds: discountIds.filter((id) => !used.has(id)),
    };
  }

  let best = materialize([], []);
  function score(candidate: SetMenuGrouping): number[] {
    let retained = 0;
    for (const { id, place } of candidate.dishes) {
      const old = oldPlace.get(id);
      if (
        old !== undefined &&
        old?.setMenuId === place?.setMenuId &&
        old?.lineIndex === place?.lineIndex
      )
        retained++;
    }
    return [
      candidate.totalCents,
      -retained,
      -candidate.setMenus.filter(({ id }) => oldMenu.has(id)).length,
      -candidate.setMenus.filter(
        ({ id, discountId }) => discountId !== null && oldMenu.get(id)?.discountId === discountId,
      ).length,
    ];
  }
  let bestScore = score(best);
  function consider(candidate: SetMenuGrouping): void {
    const candidateScore = score(candidate);
    const firstDifference = candidateScore.findIndex((value, i) => value !== bestScore[i]);
    if (firstDifference >= 0 && candidateScore[firstDifference]! < bestScore[firstDifference]!) {
      best = candidate;
      bestScore = candidateScore;
    }
  }

  function menuPlacement(menus: readonly Menu[]) {
    const slots = menus.flatMap(({ option }, menu) =>
      pairs.flatMap((pair, index) => (pair.choice === option ? [{ ...pair, menu, index }] : [])),
    );
    const matches = arcs.map((options) => {
      const byPair = new Map(options.map((option) => [option.pair, option.supplement]));
      return slots.flatMap(({ index }, slot) => {
        const supplement = byPair.get(index);
        return supplement === undefined ? [] : [{ pair: slot, supplement }];
      });
    });
    return { slots, matches };
  }

  function assign(
    menus: readonly Menu[],
    { slots, matches }: ReturnType<typeof menuPlacement>,
    {
      pins = [],
      omitted,
      allow,
      keepSavedPlaces = true,
    }: {
      pins?: readonly (Assignment | undefined)[];
      omitted?: readonly (Assignment | undefined)[];
      allow?: (arc: Arc) => boolean;
      keepSavedPlaces?: boolean;
    } = {},
  ): (Assignment | undefined)[] {
    const capacities = slots.map(({ capacity }) => capacity);
    const pinnedSupplement = menus.map(() => 0);
    for (const pin of pins) {
      if (!pin) continue;
      const [menu, line, supplement] = pin;
      capacities[slots.findIndex((slot) => slot.menu === menu && slot.line === line)]!--;
      pinnedSupplement[menu]! += supplement;
    }
    const weight = dishes.length + 1;
    const solution = solvePlacement({
      capacities,
      uncoveredCost: 0,
      classes: dishes.map(({ id }, i) => {
        if (pins[i] || omitted?.[i] || matches[i]!.length === 0) return { count: 0, arcs: [] };
        const previous = keepSavedPlaces ? oldPlace.get(id) : undefined;
        return {
          count: 1,
          uncoveredCost: aLaCarte[i]! * SCALE * weight + Number(previous != null),
          arcs: matches[i]!.flatMap((arc) => {
            const { menu, line, choice } = slots[arc.pair]!;
            if (allow && !allow(arc)) return [];
            const moved =
              previous !== undefined &&
              (menus[menu]!.id !== previous?.setMenuId || line !== previous.lineIndex);
            return [
              {
                pair: arc.pair,
                cost:
                  supplementBound(arc, choices[choice]!, pinnedSupplement[menu]!) * weight +
                  Number(moved),
              },
            ];
          }),
        };
      }),
    });
    return solution.flows.map(([flow], i) => {
      if (!flow) return pins[i];
      const { menu, line } = slots[flow.pair]!;
      return [menu, line, matches[i]!.find(({ pair }) => pair === flow.pair)!.supplement];
    });
  }

  function retainedPlaces(
    menus: readonly Menu[],
    layout: ReturnType<typeof menuPlacement>,
  ): (Assignment | undefined)[] {
    const room = layout.slots.map(({ capacity }) => capacity);
    return savedSlots.map((old) => {
      if (!old) return undefined;
      const slot = layout.slots.findIndex(
        ({ menu, line }, pair) =>
          room[pair]! > 0 && menus[menu]!.id === old.setMenuId && line === old.lineIndex,
      );
      if (slot === -1) return undefined;
      room[slot]!--;
      return [layout.slots[slot]!.menu, old.lineIndex, old.supplement];
    });
  }

  const used = new Set<string | null>();
  const savedFit = saved.flatMap((menu) => {
    const options = optionsFor(menu);
    if (options.length === 0) return [];
    const grant = menu.discountId;
    const discounted = !used.has(grant) ? options.find((i) => grantOf(i) === grant) : undefined;
    if (discounted !== undefined) used.add(grant);
    return [{ id: menu.id, option: discounted ?? options[0]! }];
  });
  const savedLayout = menuPlacement(savedFit);
  const pins = retainedPlaces(savedFit, savedLayout);
  consider(materialize(savedFit, pins));

  function fallback(keepSavedPlaces: boolean): SetMenuGrouping {
    const menus = keepSavedPlaces ? [...savedFit] : [];
    let assigned = keepSavedPlaces ? pins : [];
    let current = materialize(menus, assigned, "all");
    const closed = new Set<number>();
    for (const [menu, { option }] of menus.entries()) {
      if (!assigned.some((place) => place?.[0] === menu)) {
        closed.add(menu);
        continue;
      }
      const released = assigned.map((place) => (place?.[0] === menu ? undefined : place));
      const alternative = materialize(menus, released, {
        changedOfferId: choices[option]!.offer.id,
        prior: current,
      });
      if (alternative.totalCents >= current.totalCents) continue;
      closed.add(menu);
      assigned = released;
      current = alternative;
    }
    if (menus.length > 0) {
      const filled = assign(menus, savedLayout, {
        pins: assigned,
        allow: ({ pair }) => !closed.has(savedLayout.slots[pair]!.menu),
      });
      const withNewDishes = materialize(menus, filled, "all");
      if (withNewDishes.totalCents < current.totalCents) {
        assigned = filled;
        current = withNewDishes;
      }
    }

    serial = 0;
    const options = choices
      .map((_, i) => i)
      .filter((option) => limits[option]! > 0)
      .sort((a, b) => choices[a]!.baseCost - choices[b]!.baseCost)
      .slice(0, FALLBACK_LIMIT / 2);
    const layouts = options.map((option) => menuPlacement([{ id: "", option }]));
    while (current.setMenus.length < FALLBACK_LIMIT - options.length) {
      const id = newMenuId();
      let winner:
        { menu: Menu; placed: (Assignment | undefined)[]; bill: SetMenuGrouping } | undefined;
      for (const [index, option] of options.entries()) {
        const menu = { id, option };
        const layout = layouts[index]!;
        if (layout.matches.every((matches, i) => assigned[i] || matches.length === 0)) continue;
        const added = assign([menu], layout, { omitted: assigned, keepSavedPlaces });
        const placed = dishes.map((_, i): Assignment | undefined => {
          const dish = added[i];
          return assigned[i] ?? (dish && [menus.length, dish[1], dish[2]]);
        });
        const alternative = materialize([...menus, menu], placed, {
          changedOfferId: choices[option]!.offer.id,
          prior: current,
        });
        if (alternative.totalCents < (winner?.bill.totalCents ?? current.totalCents))
          winner = { menu, placed, bill: alternative };
      }
      if (!winner) break;
      menus.push(winner.menu);
      assigned = winner.placed;
      current = winner.bill;
    }
    return current;
  }

  function fallbackAtLimit(): SetMenuGrouping {
    const saved = fallback(true);
    if (!input.previous) return saved;
    const fresh = fallback(false);
    return fresh.totalCents < saved.totalCents ? fresh : saved;
  }

  if (!Number.isSafeInteger(eligibleCost * SCALE * (dishes.length + 1))) return best;
  const mixes = selectCounts(
    choices,
    limits.map((limit, i) => (choices[i]!.discount ? Math.min(1, limit) : limit)),
    eligibleCost * SCALE,
    eligibleCount,
  );
  if (!mixes) return fallbackAtLimit();

  const classesByKey = new Map<string, PlacementProblem["classes"][number] & { count: number }>();
  arcs.forEach((matches, i) => {
    if (matches.length === 0) return;
    const uncoveredCost = aLaCarte[i]! * SCALE;
    const key = JSON.stringify([uncoveredCost, matches]);
    const bucket = classesByKey.get(key);
    if (bucket) bucket.count++;
    else
      classesByKey.set(key, {
        count: 1,
        uncoveredCost,
        arcs: matches.map((arc) => ({
          pair: arc.pair,
          cost: supplementBound(arc, choices[pairs[arc.pair]!.choice]!),
        })),
      });
  });
  const constant = aLaCarte.reduce((sum, cents) => sum + cents, 0) - eligibleCost;
  const placement = { uncoveredCost: 0, classes: [...classesByKey.values()] };
  let solves = 0;
  let refinements = 0;
  let unfinishedFloor = Infinity;
  // A placement solve can compare every eligible portion with every occupied menu.
  const refinementLimit = Math.min(1000, Math.floor(REFINEMENT_WORK_LIMIT / eligibleCount ** 2));

  function refine(menus: readonly Menu[], priceFloor: number): boolean {
    const layout = menuPlacement(menus);
    const percentCount = menus.filter(({ option }) => choices[option]!.round).length;
    const special = (arc: Arc): boolean => {
      const option = choices[layout.slots[arc.pair]!.choice]!;
      return arc.supplement > 0 && (option.allowance > 0 || (option.round && percentCount > 1));
    };
    const fresh = (pins: readonly (Assignment | undefined)[]) =>
      assign(menus, layout, { pins, allow: (arc) => !special(arc) });
    const first = assign(menus, layout);
    solves++;
    const candidate = materialize(menus, first);
    consider(candidate);
    if (
      percentCount > 0 &&
      candidate.totalCents === best.totalCents &&
      oldPlace.size > 0 &&
      solves < PLACEMENT_LIMIT
    ) {
      const saved = retainedPlaces(menus, layout);
      if (saved.some((pin, i) => pin && (pin[0] !== first[i]?.[0] || pin[1] !== first[i]?.[1]))) {
        solves++;
        consider(materialize(menus, assign(menus, layout, { pins: saved })));
      }
    }
    if (candidate.totalCents <= priceFloor || priceFloor > best.totalCents) return true;

    const pending = layout.matches.flatMap((matches, i) => {
      const options = matches.filter(special);
      return options.length ? [{ i, options }] : [];
    });
    const fixed: (Assignment | undefined)[] = [];
    const available = layout.slots.map(({ capacity }) => capacity);
    const limit = Math.min(refinements + REFINEMENTS_PER_MIX, refinementLimit);
    function visit(at: number): boolean {
      if (best.totalCents <= priceFloor) return true;
      if (refinements >= limit) return false;
      const item = pending[at];
      if (!item) {
        refinements++;
        consider(materialize(menus, fresh(fixed)));
        return true;
      }
      if (!visit(at + 1)) return false;
      for (const { pair, supplement } of item.options) {
        if (available[pair] === 0) continue;
        const { menu, line } = layout.slots[pair]!;
        fixed[item.i] = [menu, line, supplement];
        available[pair]!--;
        if (!visit(at + 1)) return false;
        available[pair]!++;
      }
      fixed[item.i] = undefined;
      return true;
    }
    return pending.length === 0 || visit(0);
  }

  const finished = searchMixVectors({
    offerCount: choices.length,
    pairOffer: pairs.map(({ choice }) => choice),
    pairPlaces: pairs.map(({ capacity }) => capacity),
    ...mixes,
    cutoff: () => {
      const includeTies = oldPlace.size > 0 && solves + 1 < PLACEMENT_LIMIT;
      return (best.totalCents - extras - constant - Number(!includeTies)) * SCALE + 1;
    },
    canSolve: () => solves + 1 < PLACEMENT_LIMIT,
    solve: (counts, base) => {
      const solved = solvePlacement({
        ...placement,
        capacities: pairs.map(({ choice, capacity }) => counts[choice]! * capacity),
      });
      return { counts, placement: solved, cost: base + solved.cost };
    },
    accept: ({ counts, cost }) => {
      solves++;
      const menus = candidates(counts);
      const floor = Math.ceil(cost / SCALE) + extras + constant;
      if (menus.length > 0 && !refine(menus, floor))
        unfinishedFloor = Math.min(unfinishedFloor, floor);
    },
  });
  const exact = finished && unfinishedFloor >= best.totalCents;
  if (exact) {
    if (pins.some((pin) => pin !== undefined) && discounts.length > 0) {
      // A grant can move to a better holder without moving the saved dishes.
      const occupied = new Set(pins.flatMap((pin) => (pin ? [pin[0]] : [])));
      const savedChoices = savedFit.map((menu) => ({
        id: menu.id,
        option: optionsFor(oldMenu.get(menu.id)!).reduce(
          (best, option) => (choices[option]!.baseCost < choices[best]!.baseCost ? option : best),
          menu.option,
        ),
      }));
      const layout = menuPlacement(savedChoices);
      const savedWithNewDishes = assign(savedChoices, layout, {
        pins,
        allow: ({ pair }) => occupied.has(layout.slots[pair]!.menu),
      });
      consider(materialize(savedChoices, savedWithNewDishes, "all"));
    }
    return { ...best, exact };
  }
  const limited = fallbackAtLimit();
  const bestKeepsSavedPlaces = pins.every((pin, i) => {
    if (!pin) return true;
    const place = best.dishes[i]!.place;
    return place?.setMenuId === savedFit[pin[0]]!.id && place.lineIndex === pin[1];
  });
  return (finished || bestKeepsSavedPlaces) && best.totalCents < limited.totalCents
    ? best
    : limited;
}
