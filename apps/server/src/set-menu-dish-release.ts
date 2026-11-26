import { eq, inArray } from "drizzle-orm";
import { workingOrderLines, type Transaction } from "@waitron/db";
import { aLaCarteLineTotal, frozenLinesOf } from "@waitron/orders-sales/set-menu-grouping-plan.js";
import type { Decimal } from "@waitron/shared";
import type { Row } from "./adjustment-rows.js";
import type { AdjustmentAsk } from "./adjustments-apply.js";
import { assertBillInvariant } from "./bill-payments.js";
import { frozenLineIdSources } from "./set-menu-freeze.js";
import { regroupBills } from "./set-menu-regroup.js";
import { refuseOrderOverSimplifiedLimit } from "./stored-order-lines.js";
import type { TradingContext } from "./trading-context.js";

/**
 * A bill's rows as a comp or discount on a dish prices them (A1515-3 D31): each dish it acts on that can
 * leave its set menu at its a la carte price. A till row is read so as a whole or not at all, since
 * {@link standInRow} prices it from its first dish: only when every dish of it in a set menu can
 * leave and all then have one price.
 */
export async function atReleasedPrices(
  tx: Transaction,
  ask: Pick<AdjustmentAsk, "orderId" | "lineId" | "lineIds" | "action">,
  rows: Row[],
): Promise<{ rows: Row[]; released: ReadonlySet<string> }> {
  const unchanged = { rows, released: new Set<string>() };
  if (ask.action === "cancel" || ask.lineId === null) return unchanged;
  const named = new Set(ask.lineIds ?? [ask.lineId]);
  const dishes = rows.filter(({ id }) => named.has(id));
  const placed = dishes.filter(({ setMenuLineId }) => setMenuLineId !== null);
  if (placed.length === 0) return unchanged;
  const frozen = frozenLinesOf(
    rows.map(({ id, parentLineId, setMenuLineId, list, unit }) => ({
      id,
      parentLineId,
      setMenuLineId,
      listUnitPriceGross: list,
      unitPriceGross: unit,
    })),
    await frozenLineIdSources(
      tx,
      rows.map(({ id }) => id),
    ),
  );
  // Out of a frozen set menu a dish would leave its charge behind.
  const released = new Set(
    placed
      .filter(({ setMenuLineId, aLaCarte }) => !frozen.has(setMenuLineId!) && aLaCarte !== null)
      .map(({ id }) => id),
  );
  if (released.size < placed.length) return unchanged;
  const priced = (row: Row): Row =>
    released.has(row.id) ? { ...row, unit: row.aLaCarte!, list: null } : row;
  if (new Set(dishes.map((dish) => priced(dish).unit)).size > 1) return unchanged;
  return { rows: rows.map(priced), released };
}

/** Writes each dish a la carte, out of its set menu. */
export async function releaseDishes(tx: Transaction, dishIds: readonly string[]): Promise<void> {
  if (dishIds.length === 0) return;
  const dishes = await tx
    .select({
      id: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      aLaCarte: workingOrderLines.aLaCarteUnitPrice,
    })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.id, [...dishIds]));
  for (const { id, quantity, aLaCarte } of dishes) {
    await tx
      .update(workingOrderLines)
      .set({
        setMenuRole: null,
        setMenuLineId: null,
        setMenuPlace: null,
        listUnitPriceGross: null,
        unitPriceGross: aLaCarte!,
        lineTotal: aLaCarteLineTotal(aLaCarte!, quantity),
      })
      .where(eq(workingOrderLines.id, id));
  }
}

/**
 * Works the bill's set menus out again after a comp's or discount's last line write, then refuses a
 * total the bill has received more than, or one raised from `before` ({@link totalBeforeEdit}) past
 * the simplified-invoice limit: a dish out of its set menu can make the bill dearer.
 */
export async function regroupAdjusted(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  before: Decimal | null,
): Promise<void> {
  await regroupBills(tx, [orderId]);
  await assertBillInvariant(tx, [orderId]);
  await refuseOrderOverSimplifiedLimit(tx, cfg, orderId, before);
}
