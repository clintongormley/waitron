import { stringToCents } from "./cents.js";
import type { PublishedSetMenu, ServedSetMenuCopy } from "./menu-document/menu-document-types.js";
import type { SetMenuOffer, SetMenuOfferDish } from "./set-menu-fit.js";

export interface SetMenuCopy extends SetMenuOffer {
  setMenuId: string;
  versionId: string;
  name: string;
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

/** Every product the published set menu can hold, extras included, each once. */
export function setMenuProductIds(copy: PublishedSetMenu): string[] {
  const accepted = new Set<string | null>(copy.terms.lines.flatMap(({ courseIds }) => courseIds));
  const productIds = new Set<string>();
  for (const offer of Object.values(copy.offers)) {
    if (offer.unit.measure) continue;
    const dishes =
      offer.variants.length === 0
        ? [{ id: offer.productId, countsAsCourseId: offer.countsAsCourseId }]
        : offer.variants;
    const held = dishes.filter(({ countsAsCourseId }) => accepted.has(countsAsCourseId));
    if (held.length === 0) continue;
    for (const { id } of held) productIds.add(id);
    for (const list of offer.offeredModifiers) {
      if (list.kind !== "extras") continue;
      for (const { productId } of list.items) productIds.add(productId);
    }
  }
  return [...productIds];
}

export function setMenuCopyOf(copy: ServedSetMenuCopy, versionId: string): SetMenuCopy {
  return {
    ...setMenuOfferOf(copy),
    setMenuId: copy.menuId,
    name: copy.name,
    versionId,
  };
}

/** The version a bill recording a set menu's newest copy on sale records now: the first of the
 *  copy's versions that a menu selling now holds, else its first. The till and the server agree. */
export function newBillVersionOf(
  versionIds: readonly string[],
  selling: ReadonlySet<string> | undefined,
): string | undefined {
  return versionIds.find((versionId) => selling?.has(versionId)) ?? versionIds[0];
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
  /** Whether the saved grouping was proven cheapest. */
  exact: boolean;
}

export interface DishToPlace {
  id: string;
  productId: string;
  variantId: string | null;
}

interface PlacementResult extends DishPlace {
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
): { placed: PlacementResult[]; unplaced: string[] } {
  const occupied = new Map<string, number>();
  for (const dish of state.dishes) occupy(occupied, dish);
  const placed: PlacementResult[] = [];
  const unplaced: string[] = [];
  for (const dish of dishes) {
    const target = placesFor(state, dish)
      .sort(comparePlaces)
      .find((place) => isOpen(occupied, place));
    if (target === undefined) {
      unplaced.push(dish.id);
      continue;
    }
    occupy(occupied, target);
    placed.push(pricePlace(dish.id, target));
  }
  return { placed, unplaced };
}
