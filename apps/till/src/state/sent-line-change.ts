import { compareDecimal, decimal, multiplyDecimal } from "@waitron/shared";
import type { TabLine } from "../api/kitchen-api.js";
import { menuOfferToTillProduct, type TillMenuOffer } from "../api/menu-api.js";
import type { OrderLinePatch } from "../api/orders-api.js";
import { codeMessage } from "../i18n/codes.js";
import { sentDishRefusal, sentDishRefusalText } from "../i18n/sent-item-refusal.js";
import { fill, t } from "../i18n/t.js";
import type { ChangeLineDetail } from "../screens/till-table-order-screen.js";
import type { OrderLine, SelectedExtra } from "./working-order.js";
import type { ZoneOfferIndex } from "./zone-offer-index.js";

/** A change to a line of an order the waiter had started leaving, and how it failed. */
export interface LateChange {
  lineName: string;
  /** Absent when the floor no longer lists the table. */
  tableLabel?: string;
  /** `tableLabel` is a name for today. */
  tableNamed?: true;
  /** The server gave no answer, so the change may have been saved. */
  unanswered: boolean;
  code?: string;
  stationName?: string;
}

export function lateChangeMessage(late: LateChange): string {
  const { tableLabel } = late;
  const named = late.tableNamed === true;
  const key = late.unanswered
    ? tableLabel === undefined
      ? "table.change_unconfirmed_no_table"
      : named
        ? "table.change_unconfirmed_named"
        : "table.change_unconfirmed"
    : tableLabel === undefined
      ? "table.change_not_saved_no_table"
      : named
        ? "table.change_not_saved_named"
        : "table.change_not_saved";
  const sentDish = sentDishRefusal(late.code, late.lineName, late.stationName);
  return fill(t(key), {
    line: late.lineName,
    table: tableLabel ?? "",
    reason:
      sentDish === undefined
        ? codeMessage(late.code ?? "server.internal")
        : sentDishRefusalText(sentDish),
  });
}

/** The sent dish a change adds extras to, for the late-send window; undefined when the change sets
 * no extras, or the dish or its offer is not in the till's lists. */
export function lateExtrasDish(
  change: ChangeLineDetail,
  tabLines: readonly TabLine[],
  offers: Pick<ZoneOfferIndex, "byId" | "versions">,
): OrderLine | undefined {
  if (change.patch.extras === undefined) return undefined;
  const line = tabLines.find((each) => each.lineNo === change.lineNo);
  const offer = offers.byId.get(change.saleLine?.menuItemId ?? line?.menuItemId ?? "");
  if (line === undefined || offer === undefined) return undefined;
  // The line's staff name already names its variant.
  const product = {
    ...menuOfferToTillProduct(offer, offers.versions.get(offer.menuId)),
    name: change.lineName,
  };
  delete product.variantName;
  const extras = addedExtras(tabLines, line, change.patch.extras, offer.offeredModifiers);
  return {
    product,
    quantity: change.saleLine?.quantity ?? line.quantity,
    workingOrderLineId: line.id,
    ...(extras.length === 0 ? {} : { extras }),
  };
}

/** The picks `requested` adds to the stored dish: as the server reads it (`editLineExtras`), every
 * pick no stored extra holds at the same list, product and total quantity. */
function addedExtras(
  tabLines: readonly TabLine[],
  dish: TabLine,
  requested: NonNullable<OrderLinePatch["extras"]>,
  lists: TillMenuOffer["offeredModifiers"],
): SelectedExtra[] {
  const remaining = tabLines.filter((child) => child.parentLineNo === dish.lineNo);
  const added: SelectedExtra[] = [];
  for (const { listId, picks } of requested)
    for (const pick of picks) {
      const index = remaining.findIndex(
        (child) =>
          child.listId === listId &&
          child.productId === pick.productId &&
          compareDecimal(
            multiplyDecimal(
              multiplyDecimal(decimal(dish.quantity), decimal(String(pick.quantity))),
              decimal(child.priceQuantity ?? "1"),
            ),
            decimal(child.quantity),
          ) === 0,
      );
      if (index >= 0) {
        remaining.splice(index, 1);
        continue;
      }
      const list = lists.find((each) => each.kind === "extras" && each.id === listId);
      const item =
        list?.kind === "extras"
          ? list.items.find((each) => each.productId === pick.productId)
          : undefined;
      if (item !== undefined)
        added.push({
          listId,
          productId: pick.productId,
          name: item.name,
          price: item.price,
          quantity: pick.quantity,
        });
    }
  return added;
}
