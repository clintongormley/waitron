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
  readonly takeawayRateBps: number | null;
}

export type SetMenuGroupingDiscount = { readonly id: string; readonly offerId: string } & (
  | { readonly kind: "comp" }
  | { readonly kind: "amount"; readonly cents: number }
  | { readonly kind: "percent"; readonly basisPoints: number }
);

interface SavedMenu {
  readonly id: string;
  readonly offerId: string;
  readonly takeawayRateBps: number | null;
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

export interface SetMenuGroupingInput {
  readonly offers: readonly SetMenuOffer[];
  readonly dishes: readonly SetMenuGroupingDish[];
  readonly discounts: readonly SetMenuGroupingDiscount[];
  readonly takeaway: boolean;
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
  readonly rate: number | null;
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
const PLACEMENT_LIMIT = 300;
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

function choice(
  offer: SetMenuOffer,
  rate: number | null,
  discount?: SetMenuGroupingDiscount,
): Choice {
  const net = offer.priceCents - (discount?.kind === "amount" ? discount.cents : 0);
  const factor =
    discount?.kind === "comp"
      ? 0
      : SCALE - (discount?.kind === "percent" ? discount.basisPoints : 0);
  const round = factor > 0 && factor < SCALE;
  return {
    offer,
    rate,
    discount,
    factor,
    round,
    baseCost: Math.max(0, net) * factor - (round ? SCALE / 2 : 0),
    allowance: Math.max(0, -net) * SCALE,
  };
}

function supplementBound({ supplement }: Arc, { factor, allowance }: Choice): number {
  return Math.max(0, supplement * factor - allowance);
}

function selectCounts(
  choices: readonly Choice[],
  limits: readonly number[],
  budget: number,
  dishes: number,
) {
  const vectors: number[] = [];
  const bases: number[] = [];
  const counts = choices.map(() => 0);
  const used = new Set<string>();
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
      return bases.push(base) < MAX_SET_MENU_MIXES;
    }
    const id = option.discount?.id;
    const limit = id && used.has(id) ? 0 : Math.min(left, limits[index]!);
    counts[index] = 0;
    if (!visit(index + 1, left, base)) return false;
    if (id && limit > 0) used.add(id);
    for (let count = 1; count <= limit; count++) {
      counts[index] = count;
      if (!visit(index + 1, left - count, base + count * prices[index]!)) return false;
    }
    counts[index] = 0;
    if (id && limit > 0) used.delete(id);
    return true;
  }

  return visit(0, dishes, 0)
    ? { vectors: Int32Array.from(vectors), bases: Float64Array.from(bases) }
    : null;
}

type Menu = { readonly id: string; readonly option: number };
type Assignment = readonly [menu: number, line: number, supplement: number];

export function groupSetMenus(input: SetMenuGroupingInput): SetMenuGrouping {
  if (input.takeaway && input.discounts.length === 0) {
    const parts = new Map<number | null, SetMenuGroupingDish[]>();
    for (const dish of input.dishes) {
      if (!parts.has(dish.takeawayRateBps)) parts.set(dish.takeawayRateBps, []);
      parts.get(dish.takeawayRateBps)!.push(dish);
    }
    // Each rate uses only its own portions and saved IDs.
    if (parts.size > 1) {
      const results = [...parts.values()].map((dishes) => groupRate({ ...input, dishes }));
      return {
        exact: results.every(({ exact }) => exact),
        totalCents: results.reduce((sum, { totalCents }) => sum + totalCents, 0),
        setMenus: results.flatMap(({ setMenus }) => setMenus).sort(byId),
        dishes: results.flatMap(({ dishes }) => dishes).sort(byId),
        unusedDiscountIds: [],
      };
    }
  }
  return groupRate(input);
}

function groupRate(input: SetMenuGroupingInput): SetMenuGrouping {
  const dishes = [...input.dishes].sort(byId);
  const offers = [...input.offers].sort(byId);
  const discounts = [...input.discounts].sort(byId);
  const oldMenu = new Map(input.previous?.setMenus.map((menu) => [menu.id, menu]));
  const oldPlace = new Map(input.previous?.dishes.map(({ id, place }) => [id, place]));
  const rates = input.takeaway
    ? [...new Set(dishes.map((dish) => dish.takeawayRateBps))]
        .filter((rate) => rate !== null)
        .sort((a, b) => a - b)
    : [null];
  const choices = rates.flatMap((rate) =>
    offers.flatMap((offer) => [
      choice(offer, rate),
      ...discounts
        .filter(({ offerId }) => offerId === offer.id)
        .map((discount) => choice(offer, rate, discount)),
    ]),
  );
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
      return supplement !== undefined &&
        (!input.takeaway || dish.takeawayRateBps === option.rate) &&
        option.offer.lines[line]!.courseIds.includes(dish.courseId)
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
  function newMenu(option: number): Menu {
    let id: string;
    do id = `new-menu-${choices[option]!.rate ?? "eat-in"}-${++serial}`;
    while (oldMenu.has(id));
    return { id, option };
  }

  function menuType(offerId: string, rate: number | null): string {
    return JSON.stringify([offerId, rate]);
  }
  const byType = new Map<string, number[]>();
  choices.forEach(({ offer, rate }, index) => {
    const type = menuType(offer.id, rate);
    const options = byType.get(type);
    if (options) options.push(index);
    else byType.set(type, [index]);
  });

  const ranked = new Map<string, number>();
  dishes.forEach(({ id }, i) => {
    const place = oldPlace.get(id);
    const menu = place && oldMenu.get(place.setMenuId);
    if (
      menu &&
      arcs[i]!.some(({ pair }) => {
        const { choice, line } = pairs[pair]!;
        return (
          line === place.lineIndex &&
          choices[choice]!.offer.id === menu.offerId &&
          choices[choice]!.rate === menu.takeawayRateBps
        );
      })
    )
      ranked.set(menu.id, (ranked.get(menu.id) ?? 0) + 1);
  });
  const saved = [...oldMenu.values()].sort(
    (a, b) => (ranked.get(b.id) ?? 0) - (ranked.get(a.id) ?? 0) || byId(a, b),
  );
  const optionsFor = (menu: SavedMenu) =>
    byType.get(menuType(menu.offerId, menu.takeawayRateBps)) ?? [];
  const grantOf = (option: number) => choices[option]!.discount?.id ?? null;

  function candidates(counts: readonly number[]): Menu[] {
    const remaining = [...counts];
    const chosen = new Map<string, SavedMenu[]>();
    for (const menu of saved) {
      const type = menuType(menu.offerId, menu.takeawayRateBps);
      const prior = chosen.get(type) ?? [];
      if (prior.length >= optionsFor(menu).reduce((sum, i) => sum + counts[i]!, 0)) continue;
      prior.push(menu);
      chosen.set(type, prior);
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
      for (let i = 0; i < count; i++) selected.push(newMenu(option));
    });
    return selected;
  }

  function materialize(
    menus: readonly Menu[],
    assigned: readonly (Assignment | undefined)[],
    reprice = false,
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
    const granted =
      reprice && discounts.length > 0
        ? solvePlacement({
            capacities: menus.map((_, i) => Number(occupied.has(i))),
            uncoveredCost: 0,
            classes: discounts.map((discount) => ({
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
      granted?.flatMap((flows, i) => flows.map(({ pair }) => [pair, discounts[i]!] as const)),
    );
    const chargedMenus = menus.flatMap(({ id, option }, i) => {
      if (!occupied.has(i)) return [];
      const { offer, rate } = choices[option]!;
      const discount = reprice ? earned.get(i) : choices[option]!.discount;
      return [
        {
          id,
          offerId: offer.id,
          takeawayRateBps: rate,
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
      unusedDiscountIds: discounts.filter(({ id }) => !used.has(id)).map(({ id }) => id),
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
    pins: readonly (Assignment | undefined)[] = [],
    omitted?: readonly (Assignment | undefined)[],
    allow?: (arc: Arc) => boolean,
  ): (Assignment | undefined)[] {
    const capacities = slots.map(({ capacity }) => capacity);
    pins.forEach((pin) => {
      if (pin)
        capacities[slots.findIndex(({ menu, line }) => menu === pin[0] && line === pin[1])]!--;
    });
    const weight = dishes.length + 1;
    const solution = solvePlacement({
      capacities,
      uncoveredCost: 0,
      classes: dishes.map(({ id }, i) => {
        const previous = oldPlace.get(id);
        return {
          count: pins[i] || omitted?.[i] || matches[i]!.length === 0 ? 0 : 1,
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
                cost: supplementBound(arc, choices[choice]!) * weight + Number(moved),
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
    return dishes.map(({ id }, i) => {
      const old = oldPlace.get(id);
      if (!old) return undefined;
      const arc = layout.matches[i]!.find(
        ({ pair }) =>
          room[pair]! > 0 &&
          menus[layout.slots[pair]!.menu]!.id === old.setMenuId &&
          layout.slots[pair]!.line === old.lineIndex,
      );
      if (!arc) return undefined;
      room[arc.pair]!--;
      return [layout.slots[arc.pair]!.menu, old.lineIndex, arc.supplement];
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

  function fallback(): SetMenuGrouping {
    const menus = [...savedFit];
    let assigned = pins;
    let current = materialize(menus, assigned, true);
    const closed = new Set<number>();
    for (const [menu] of menus.entries()) {
      const released = assigned.map((place) => (place?.[0] === menu ? undefined : place));
      const alternative = materialize(menus, released, true);
      if (alternative.totalCents >= current.totalCents) continue;
      closed.add(menu);
      assigned = released;
      current = alternative;
    }
    const layout = menuPlacement(menus);
    const filled = assign(
      menus,
      layout,
      assigned,
      undefined,
      ({ pair }) => !closed.has(layout.slots[pair]!.menu),
    );
    const withNewDishes = materialize(menus, filled, true);
    if (withNewDishes.totalCents < current.totalCents) {
      assigned = filled;
      current = withNewDishes;
    }

    serial = 0;
    const options = choices
      .map((_, i) => i)
      .filter((option) => limits[option]! > 0)
      .sort((a, b) => choices[a]!.baseCost - choices[b]!.baseCost)
      .slice(0, FALLBACK_LIMIT / 2);
    for (const option of options) {
      const { discount } = choices[option]!;
      if (discount && current.setMenus.some(({ discountId }) => discountId === discount.id))
        continue;
      // An offer that cannot save money on the remaining portions cannot after another offer takes some.
      while (current.setMenus.length < FALLBACK_LIMIT - options.length) {
        const menu = newMenu(option);
        const layout = menuPlacement([menu]);
        if (layout.matches.every((options, i) => assigned[i] || options.length === 0)) break;
        const added = assign([menu], layout, [], assigned);
        const placed = dishes.map((_, i): Assignment | undefined => {
          const dish = added[i];
          return assigned[i] ?? (dish && [menus.length, dish[1], dish[2]]);
        });
        const alternative = materialize([...menus, menu], placed, true);
        if (alternative.totalCents >= current.totalCents) break;
        menus.push(menu);
        assigned = placed;
        current = alternative;
        if (discount) break;
      }
    }
    return current;
  }

  if (!Number.isSafeInteger(eligibleCost * SCALE * (dishes.length + 1))) return best;
  const mixes = selectCounts(
    choices,
    limits.map((limit, i) => (choices[i]!.discount ? Math.min(1, limit) : limit)),
    eligibleCost * SCALE,
    eligibleCount,
  );
  if (!mixes) return fallback();

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

  function refine(menus: readonly Menu[], priceFloor: number): boolean {
    const layout = menuPlacement(menus);
    const percentCount = menus.filter(({ option }) => choices[option]!.round).length;
    const special = (arc: Arc): boolean => {
      const option = choices[layout.slots[arc.pair]!.choice]!;
      return arc.supplement > 0 && (option.allowance > 0 || (option.round && percentCount > 1));
    };
    const fresh = (pins: readonly (Assignment | undefined)[]) =>
      assign(menus, layout, pins, undefined, (arc) => !special(arc));
    const first = assign(menus, layout);
    solves++;
    const candidate = materialize(menus, first);
    consider(candidate);
    if (candidate.totalCents <= priceFloor || priceFloor > best.totalCents)
      return solves < PLACEMENT_LIMIT;

    const pending = layout.matches.flatMap((matches, i) => {
      const options = matches.filter(special);
      return options.length ? [{ i, options }] : [];
    });
    const fixed: (Assignment | undefined)[] = [];
    const available = layout.slots.map(({ capacity }) => capacity);
    function visit(at: number): boolean {
      if (solves >= PLACEMENT_LIMIT) return false;
      if (best.totalCents <= priceFloor) return true;
      const item = pending[at];
      if (!item) {
        solves++;
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

  const exact = searchMixVectors({
    offerCount: choices.length,
    pairOffer: pairs.map(({ choice }) => choice),
    pairPlaces: pairs.map(({ capacity }) => capacity),
    ...mixes,
    cutoff: () => (best.totalCents - extras - constant - (oldPlace.size ? 0 : 1)) * SCALE + 1,
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
      return menus.length === 0 || refine(menus, Math.ceil(cost / SCALE) + extras + constant);
    },
  });
  return exact ? { ...best, exact } : fallback();
}
