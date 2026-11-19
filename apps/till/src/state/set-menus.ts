import {
  placeInOrder,
  type BillSetMenuState,
  type DishToPlace,
  type ServedSetMenu,
  type ServedSetMenuCopy,
} from "@waitron/shared";
import type { FreshDraftLine, PartyBill, TillMenuOffer } from "../api/client.js";
import type { OrderLine } from "./working-order.js";

type OrderingCopy = { copy: ServedSetMenuCopy; versionId: string };
type BillCopies = Pick<PartyBill, "setMenus" | "setMenuCopies">;

export function orderingCopies(
  bill: BillCopies | undefined,
  zone: readonly ServedSetMenu[],
  sellingVersions?: ReadonlySet<string>,
): OrderingCopy[] {
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

export function draftPlacements(bill: BillSetMenuState, draft: readonly OrderLine[]) {
  const dishes = draft.flatMap((line, index): DishToPlace[] =>
    line.setMenuId === undefined || line.workingOrderLineId !== undefined
      ? []
      : [
          {
            id: line.draftLineId ?? String(index),
            productId: line.product.productId ?? line.product.id,
            variantId: line.product.variantId ?? null,
            reserved: line.setMenuReserved ?? null,
          },
        ],
  );
  return placeInOrder(bill, dishes);
}
