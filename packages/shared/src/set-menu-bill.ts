import { stringToCents } from "./cents.js";
import { hasCode, isAppError } from "./errors.js";
import type { ServedSetMenuCopy } from "./menu-document/menu-document-types.js";
import {
  fitSetMenus,
  type SetMenuFit,
  type SetMenuOffer,
  type SetMenuOfferDish,
  type SetMenuPlace,
} from "./set-menu-fit.js";

export interface SetMenuCopy extends SetMenuOffer {
  setMenuId: string;
  versionId: string;
  name: string;
  terms: Pick<ServedSetMenuCopy["terms"], "vatClass" | "takeawayVatClass">;
}

export function setMenuOfferOf(copy: ServedSetMenuCopy): SetMenuOffer {
  const dishes: SetMenuOfferDish[] = [];
  for (const offer of copy.offers) {
    if (offer.unit.measure) continue;
    const { productId, countsAsCourseId, variants, variantCountsAs } = offer;
    if (
      variants.length === 0 &&
      Object.keys(variantCountsAs).length === 0 &&
      countsAsCourseId !== null
    ) {
      dishes.push({
        productId,
        variantId: null,
        countsAsCourseId,
        surchargeCents: stringToCents(offer.unitPrice),
      });
    }
    for (const variant of variants) {
      const course = variantCountsAs[variant.id];
      if (course === undefined) continue;
      dishes.push({
        productId,
        variantId: variant.id,
        countsAsCourseId: course,
        surchargeCents: stringToCents(variant.unitPrice),
      });
    }
  }
  return {
    id: copy.key,
    priceCents: stringToCents(copy.terms.price),
    lines: copy.terms.lines,
    dishes,
  };
}

export function setMenuCopyOf(copy: ServedSetMenuCopy, versionId: string): SetMenuCopy {
  const { vatClass, takeawayVatClass } = copy.terms;
  return {
    ...setMenuOfferOf(copy),
    setMenuId: copy.menuId,
    name: copy.name,
    versionId,
    terms: { vatClass, takeawayVatClass },
  };
}

export function copiesListing(
  copies: readonly SetMenuCopy[],
  productId: string,
  variantId: string | null,
): SetMenuCopy[] {
  return copies.filter((copy) =>
    copy.dishes.some((dish) => dish.productId === productId && dish.variantId === variantId),
  );
}

export interface BillSetMenu {
  lineId: string;
  copyId: string;
  lineNo: number;
}

export interface DishPlace {
  setMenuLineId: string;
  place: number;
}

export interface PlacedDish extends DishPlace {
  lineId: string;
  productId: string;
  variantId: string | null;
  priceCents: number;
  countsAsCourseId: string;
  movable: boolean;
}

export interface BillSetMenuState {
  copies: readonly SetMenuCopy[];
  recorded: Readonly<Record<string, string>>;
  setMenus: readonly BillSetMenu[];
  dishes: readonly PlacedDish[];
}

export interface DishToPlace {
  id: string;
  productId: string;
  variantId: string | null;
  reserved: DishPlace | null;
}

export interface PlacementResult extends DishPlace {
  id: string;
  priceCents: number;
  countsAsCourseId: string;
}

type DishChoice = Pick<DishToPlace, "productId" | "variantId">;

interface Candidate extends DishPlace {
  lineNo: number;
  capacity: number;
  courseCount: number;
  priceCents: number;
  countsAsCourseId: string;
}

function placesFor(state: BillSetMenuState, dish: DishChoice): Candidate[] {
  const candidates: Candidate[] = [];
  for (const menu of state.setMenus) {
    const copy = state.copies.find(({ id }) => id === menu.copyId);
    const listing = copy?.dishes.find(
      ({ productId, variantId }) => productId === dish.productId && variantId === dish.variantId,
    );
    if (copy === undefined || listing === undefined) continue;
    for (const [place, line] of copy.lines.entries()) {
      if (!line.courseIds.includes(listing.countsAsCourseId)) continue;
      candidates.push({
        setMenuLineId: menu.lineId,
        place,
        lineNo: menu.lineNo,
        capacity: line.count,
        courseCount: line.courseIds.length,
        priceCents: listing.surchargeCents,
        countsAsCourseId: listing.countsAsCourseId,
      });
    }
  }
  return candidates;
}

function placeKey({ setMenuLineId, place }: DishPlace): string {
  return JSON.stringify([setMenuLineId, place]);
}

function samePlace(left: DishPlace, right: DishPlace): boolean {
  return left.setMenuLineId === right.setMenuLineId && left.place === right.place;
}

function occupy(occupied: Map<string, number>, place: DishPlace): void {
  const key = placeKey(place);
  occupied.set(key, (occupied.get(key) ?? 0) + 1);
}

function isOpen(occupied: ReadonlyMap<string, number>, place: Candidate): boolean {
  return (occupied.get(placeKey(place)) ?? 0) < place.capacity;
}

function pricePlace(id: string, place: Candidate): PlacementResult {
  const { setMenuLineId, place: index, priceCents, countsAsCourseId } = place;
  return { id, setMenuLineId, place: index, priceCents, countsAsCourseId };
}

function comparePlaces(left: Candidate, right: Candidate): number {
  return (
    left.priceCents - right.priceCents ||
    left.courseCount - right.courseCount ||
    left.lineNo - right.lineNo ||
    left.place - right.place
  );
}

export function placeInOrder(
  state: BillSetMenuState,
  dishes: readonly DishToPlace[],
  heldFor: readonly DishPlace[] = [],
): { placed: PlacementResult[]; unplaced: string[] } {
  const occupied = new Map<string, number>();
  for (const dish of state.dishes) occupy(occupied, dish);
  for (const hold of heldFor) occupy(occupied, hold);

  const requests = dishes.map((dish) => ({ dish, candidates: placesFor(state, dish) }));
  const reserved = new Map<string, Candidate>();
  // A valid reservation counts before any unreserved dish can take its place.
  for (const { dish, candidates } of requests) {
    const hold = dish.reserved;
    if (hold === null) continue;
    const target = candidates.find((place) => samePlace(place, hold) && isOpen(occupied, place));
    if (target === undefined) continue;
    occupy(occupied, target);
    reserved.set(dish.id, target);
  }

  const placed: PlacementResult[] = [];
  const unplaced: string[] = [];
  for (const { dish, candidates } of requests) {
    const hold = reserved.get(dish.id);
    if (hold !== undefined) {
      placed.push(pricePlace(dish.id, hold));
      continue;
    }
    const target = candidates.sort(comparePlaces).find((place) => isOpen(occupied, place));
    if (target === undefined) {
      unplaced.push(dish.id);
      continue;
    }
    occupy(occupied, target);
    placed.push(pricePlace(dish.id, target));
  }
  return { placed, unplaced };
}

export function withPlacements(
  state: BillSetMenuState,
  dishes: readonly DishToPlace[],
  placed: readonly PlacementResult[],
): BillSetMenuState {
  const results = new Map(placed.map(({ id, ...place }) => [id, place]));
  const added = dishes.flatMap(({ id, productId, variantId }) => {
    const place = results.get(id);
    return place === undefined
      ? []
      : [{ ...place, lineId: id, productId, variantId, movable: true }];
  });
  return { ...state, dishes: [...state.dishes, ...added] };
}

export interface DishMove {
  lineId: string;
  to: DishPlace;
}

export interface MoveSuggestion {
  moves: (DishMove & { from: DishPlace; priceCents: number; countsAsCourseId: string })[];
  place: PlacementResult;
}

function fitPlace({ setMenuLineId, place }: DishPlace): SetMenuPlace {
  return { setMenuId: setMenuLineId, lineIndex: place };
}

export function suggestMove(
  state: BillSetMenuState,
  drafted: readonly (PlacementResult & DishChoice)[],
  dish: Omit<DishToPlace, "reserved">,
): MoveSuggestion | null {
  const offerBySetMenu = new Map(state.setMenus.map(({ lineId, copyId }) => [lineId, copyId]));
  const copyIds = new Set(offerBySetMenu.values());
  const placeByDish = new Map(state.dishes.map((placed) => [placed.lineId, fitPlace(placed)]));
  let fit: SetMenuFit;
  try {
    fit = fitSetMenus({
      offers: state.copies.filter(({ id }) => copyIds.has(id)),
      setMenus: state.setMenus.map(({ lineId, copyId }) => ({ id: lineId, fixedOfferId: copyId })),
      dishes: [
        ...state.dishes.map((placed) => ({
          id: placed.lineId,
          productId: placed.productId,
          variantId: placed.variantId,
          pinnedTo: placed.movable ? null : fitPlace(placed),
        })),
        ...drafted.map((draft) => ({
          id: draft.id,
          productId: draft.productId,
          variantId: draft.variantId,
          pinnedTo: fitPlace(draft),
        })),
        { ...dish, pinnedTo: null },
      ],
      previous: { offerBySetMenu, placeByDish },
    });
  } catch (error) {
    if (
      isAppError(error) &&
      hasCode(error, "set_menu.fit_invalid_input") &&
      error.params.reason === "invalid_amount"
    )
      return null;
    throw error;
  }
  if (fit.kind !== "fitted") return null;

  const targets = new Map(
    fit.dishes.map(({ id, place: { setMenuId, lineIndex } }) => [
      id,
      { setMenuLineId: setMenuId, place: lineIndex },
    ]),
  );
  const moves: MoveSuggestion["moves"] = [];
  for (const placed of state.dishes) {
    const to = targets.get(placed.lineId)!;
    if (samePlace(placed, to)) continue;
    const { priceCents, countsAsCourseId } = placesFor(state, placed).find((place) =>
      samePlace(place, to),
    )!;
    moves.push({
      lineId: placed.lineId,
      from: { setMenuLineId: placed.setMenuLineId, place: placed.place },
      to,
      priceCents,
      countsAsCourseId,
    });
  }
  const to = targets.get(dish.id)!;
  const destination = placesFor(state, dish).find((place) => samePlace(place, to))!;
  return { moves, place: pricePlace(dish.id, destination) };
}

export function checkMoves(
  state: BillSetMenuState,
  moves: readonly DishMove[],
  heldFor: readonly DishPlace[] = [],
):
  | { kind: "ok"; results: PlacementResult[] }
  | { kind: "place_taken"; lineId: string }
  | { kind: "not_placed"; lineId: string } {
  const moving = new Set(moves.map(({ lineId }) => lineId));
  const dishes = new Map(state.dishes.map((dish) => [dish.lineId, dish]));
  const occupied = new Map<string, number>();
  for (const dish of state.dishes) {
    if (!moving.has(dish.lineId)) occupy(occupied, dish);
  }
  for (const hold of heldFor) occupy(occupied, hold);
  const results: PlacementResult[] = [];
  for (const { lineId, to } of moves) {
    const dish = dishes.get(lineId);
    if (dish === undefined) return { kind: "not_placed", lineId };
    if (!dish.movable || !moving.delete(lineId)) return { kind: "place_taken", lineId };
    const target = placesFor(state, dish).find((place) => samePlace(place, to));
    if (target === undefined || !isOpen(occupied, target)) return { kind: "place_taken", lineId };
    occupy(occupied, target);
    results.push(pricePlace(lineId, target));
  }
  return { kind: "ok", results };
}
