import {
  centsToDecimal,
  newBillVersionOf,
  placeInOrder,
  type BillSetMenuState,
  type DishToPlace,
  type ServedSetMenu,
  type ServedSetMenuCopy,
} from "@waitron/shared";
import type { PartyBill } from "../api/floor-api.js";
import type { FreshDraftLine } from "../api/drafts-api.js";
import type { TillMenuOffer } from "../api/menu-api.js";
import type { OrderLine } from "./working-order.js";

export type OrderingCopy = { copy: ServedSetMenuCopy; versionId: string };
export const NO_ORDERING_COPIES: OrderingCopy[] = [];
type BillCopies = Pick<PartyBill, "setMenus" | "setMenuCopies">;

export function orderingCopies(
  bill: BillCopies | undefined,
  zone: readonly ServedSetMenu[],
  sellingVersions?: ReadonlySet<string>,
): OrderingCopy[] {
  if (zone.length === 0 && !bill?.setMenuCopies?.length) return NO_ORDERING_COPIES;
  const recorded = bill?.setMenus?.recorded ?? {};
  const served = new Map(bill?.setMenuCopies?.map((copy) => [copy.key, copy]));
  const copies: OrderingCopy[] = [];
  for (const entry of bill?.setMenus?.copies ?? []) {
    if (recorded[entry.setMenuId] !== entry.versionId) continue;
    const copy = served.get(entry.id);
    if (copy !== undefined) copies.push({ copy, versionId: entry.versionId });
  }
  for (const copy of zone) {
    if (!copy.newestOnSale || Object.hasOwn(recorded, copy.menuId)) continue;
    const versionId = newBillVersionOf(copy.versionIds, sellingVersions);
    if (versionId !== undefined) copies.push({ copy, versionId });
  }
  return copies;
}

/** `menuId` is the full menu of a line read back from the server; on a line the till built it is the
 * set menu. */
export type SetMenuLine = Pick<FreshDraftLine, "setMenuId" | "menuItemId" | "menuVersionId"> & {
  menuId?: string;
};

/** What the line is sold from now, which can be another full menu's copy; `own` is
 * {@link ownSetMenuOffer}'s answer. */
export type SetMenuOfferLookup = (
  line: SetMenuLine,
) => { offer: TillMenuOffer; versionId: string; own?: TillMenuOffer } | undefined;

/** The dish as `bill` records it at the line's own version, which need not be the one the bill
 * orders from: a bill can record two versions of a set menu (D26). */
function recordedSetMenuOffer(
  line: SetMenuLine,
  bill: BillCopies | undefined,
): TillMenuOffer | undefined {
  const named = bill?.setMenus?.copies.find(
    ({ setMenuId, versionId }) => setMenuId === line.setMenuId && versionId === line.menuVersionId,
  );
  return bill?.setMenuCopies
    ?.find(({ key }) => key === named?.id)
    ?.offers.find(({ id }) => id === line.menuItemId);
}

/**
 * The offer whose declarations are the line's: the copy its own version names, sold or recorded on
 * its bill, else the one the live version of its own full menu holds, as the kitchen reads them.
 * Undefined when none holds the dish, or that menu is not known: another full menu's copy can
 * declare it differently.
 */
export function ownSetMenuOffer(
  line: SetMenuLine,
  sold: { offer: TillMenuOffer; versionId: string } | undefined,
  bill: BillCopies | undefined,
  zone: {
    setMenus: readonly ServedSetMenu[];
    versions: ReadonlyMap<string, string>;
    /** Every version seen, to its full menu: a line can name one no longer live. */
    menuOfVersion: ReadonlyMap<string, string>;
  },
): TillMenuOffer | undefined {
  if (sold !== undefined && sold.versionId === line.menuVersionId) return sold.offer;
  const recorded = recordedSetMenuOffer(line, bill);
  if (recorded !== undefined) return recorded;
  const menuId = zone.menuOfVersion.get(line.menuVersionId ?? "") ?? line.menuId;
  const live = zone.versions.get(menuId ?? "");
  if (live === undefined) return undefined;
  return zone.setMenus
    .find((copy) => copy.menuId === line.setMenuId && copy.versionIds.includes(live))
    ?.offers.find((dish) => dish.id === line.menuItemId);
}

/** {@link ownSetMenuOffer} against a till's offers, as a set-menu line's declarations follow it. */
export type OwnSetMenuOffers = (line: SetMenuLine) => TillMenuOffer | undefined;

export function setMenuLineOf(line: Pick<OrderLine, "product" | "setMenuId">): SetMenuLine {
  return {
    setMenuId: line.setMenuId,
    menuItemId: line.product.menuItemId ?? "",
    menuVersionId: line.product.menuVersionId ?? null,
    ...(line.product.menuId === undefined ? {} : { menuId: line.product.menuId }),
  };
}

export function lookupSetMenuLine(line: OrderLine, lookup?: SetMenuOfferLookup) {
  return lookup?.(setMenuLineOf(line));
}

/** The bill with each recorded copy `read` holds at the version the bill names it at: two full
 * menus' copies can share a key. */
export function withCopiesRead<B extends BillCopies>(bill: B, read: BillCopies): B {
  const versions = new Map(bill.setMenus?.copies.map((copy) => [copy.id, copy.versionId]));
  const same = new Set(
    read.setMenus?.copies.flatMap(({ id, versionId }) =>
      versions.get(id) === versionId ? [id] : [],
    ),
  );
  const fresh = new Map(read.setMenuCopies?.map((copy) => [copy.key, copy]));
  return {
    ...bill,
    setMenuCopies: bill.setMenuCopies?.map((copy) =>
      same.has(copy.key) ? (fresh.get(copy.key) ?? copy) : copy,
    ),
  };
}

function draftMenuDishes(draft: readonly OrderLine[]): DishToPlace[] {
  return draft.flatMap((line, index): DishToPlace[] =>
    line.setMenuId === undefined || line.workingOrderLineId !== undefined
      ? []
      : [
          {
            id: draftPlacementId(line, index),
            productId: line.product.productId ?? line.product.id,
            variantId: line.product.variantId ?? null,
          },
        ],
  );
}

export function draftPlacements(
  bill: BillSetMenuState,
  draft: readonly OrderLine[],
): ReturnType<typeof placeInOrder> {
  return placeInOrder(bill, draftMenuDishes(draft));
}

export function draftPlacementId(line: OrderLine, index: number): string {
  return line.draftLineId ?? String(index);
}

export function menusWithCopies(bill: BillSetMenuState) {
  const copies = new Map(bill.copies.map((copy) => [copy.id, copy]));
  return bill.setMenus.map((menu) => ({ menu, copy: copies.get(menu.copyId)! }));
}

export function sentMenuDishes(bill: BillSetMenuState | null | undefined) {
  const result = new Map<string, { setMenuId: string; price: string }>();
  if (bill === null || bill === undefined) return result;
  const ids = new Map(menusWithCopies(bill).map(({ menu, copy }) => [menu.lineId, copy.setMenuId]));
  for (const dish of bill.dishes)
    result.set(dish.lineId, {
      setMenuId: ids.get(dish.setMenuLineId)!,
      price: centsToDecimal(dish.priceCents),
    });
  return result;
}
