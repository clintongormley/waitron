import {
  centsToDecimal,
  placeInOrder,
  type BillSetMenuState,
  type DishToPlace,
  type DishMove,
  type ServedSetMenu,
  type ServedSetMenuCopy,
} from "@waitron/shared";
import type { FreshDraftLine, PartyBill, TillMenuOffer } from "../api/client.js";
import { lineProductName } from "../widgets/product-name.js";
import type { OrderLine } from "./working-order.js";

export type OrderingCopy = { copy: ServedSetMenuCopy; versionId: string };
export const NO_ORDERING_COPIES: OrderingCopy[] = [];
export type SetMenuChange =
  { menuId: string; count: number } | { remove: string } | { moves: readonly DishMove[] };

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
    const versionId = copy.versionIds.find((id) => sellingVersions?.has(id)) ?? copy.versionIds[0];
    if (versionId !== undefined) copies.push({ copy, versionId });
  }
  return copies;
}

export type SetMenuOfferLookup = (
  line: Pick<FreshDraftLine, "setMenuId" | "menuItemId" | "menuVersionId">,
) => { offer: TillMenuOffer; versionId: string } | undefined;

export function lookupSetMenuLine(line: OrderLine, lookup?: SetMenuOfferLookup) {
  return lookup?.({
    setMenuId: line.setMenuId,
    menuItemId: line.product.menuItemId ?? "",
    menuVersionId: line.product.menuVersionId ?? null,
  });
}

export function draftMenuDishes(draft: readonly OrderLine[]): DishToPlace[] {
  return draft.flatMap((line, index): DishToPlace[] =>
    line.setMenuId === undefined || line.workingOrderLineId !== undefined
      ? []
      : [
          {
            id: draftPlacementId(line, index),
            productId: line.product.productId ?? line.product.id,
            variantId: line.product.variantId ?? null,
            reserved: line.setMenuReserved ?? null,
          },
        ],
  );
}

export function draftPlacements(bill: BillSetMenuState, draft: readonly OrderLine[]) {
  return placeInOrder(bill, draftMenuDishes(draft));
}

export function draftPlacementId(line: OrderLine, index: number): string {
  return line.draftLineId ?? String(index);
}

export function menusWithCopies(bill: BillSetMenuState) {
  const copies = new Map(bill.copies.map((copy) => [copy.id, copy]));
  return bill.setMenus.map((menu) => ({ menu, copy: copies.get(menu.copyId)! }));
}

export function draftNamesLosingPlace(
  bill: BillSetMenuState,
  draft: readonly OrderLine[],
  removed: readonly string[],
): string[] {
  const before = draftPlacements(bill, draft).placed;
  const remaining = bill.setMenus.filter(({ lineId }) => !removed.includes(lineId));
  const unplaced = new Set(draftPlacements({ ...bill, setMenus: remaining }, draft).unplaced);
  const names = new Map(
    draft.map((line, index) => [draftPlacementId(line, index), lineProductName(line.product)]),
  );
  return [...new Set(before.filter(({ id }) => unplaced.has(id)).map(({ id }) => names.get(id)!))];
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
