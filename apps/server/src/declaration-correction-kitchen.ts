import { and, eq, sql } from "drizzle-orm";
import {
  parties,
  partyFamilies,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { declarationProductIds, parseMenuPatch, readRecordedDocuments } from "@waitron/menu";
import { inIds } from "./in-ids.js";
import { refreshKitchenAllergyClashes } from "./kitchen-allergy.js";
import type { TradingContext } from "./trading-context.js";

/** Refreshes allergy clashes for every sent line (one with a ticket item) whose product (dish,
 * variant or picked extra) is one of `productIds`, on an order whose party is open: one
 * `refreshKitchenAllergyClashes` per order, with extra lines mapped to their dish line. */
export async function refreshCorrectedKitchenLines(
  tx: Transaction,
  cfg: TradingContext,
  productIds: readonly string[],
): Promise<void> {
  const open = await tx.select({ id: parties.id }).from(parties).where(eq(parties.state, "open"));
  if (open.length === 0) return;
  // A party joined into an open one is closed, and its bills count as the open party's.
  const families = await partyFamilies(
    tx,
    open.map(({ id }) => id),
  );
  const dishId = sql<string>`coalesce(${workingOrderLines.parentLineId}, ${workingOrderLines.id})`;
  const rows = await tx
    .selectDistinct({ orderId: workingOrderLines.workingOrderId, lineId: dishId })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .innerJoin(ticketItems, eq(ticketItems.workingOrderLineId, dishId))
    .where(
      and(
        inIds(workingOrders.partyId, [...families.values()].flat()),
        inIds(workingOrderLines.productId, productIds),
      ),
    );
  const byOrder = new Map<string, string[]>();
  for (const { orderId, lineId } of rows)
    byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), lineId]);
  for (const [orderId, lineIds] of byOrder)
    await refreshKitchenAllergyClashes(tx, cfg, orderId, lineIds);
}

/** {@link refreshCorrectedKitchenLines} for a Patch live menu request's declarations changes,
 * read against the version it patched. */
export async function refreshPatchedKitchenLines(
  tx: Transaction,
  cfg: TradingContext,
  baseVersionId: string,
  changes: unknown,
): Promise<void> {
  const document = (await readRecordedDocuments(tx, [baseVersionId])).get(baseVersionId)!;
  await refreshCorrectedKitchenLines(
    tx,
    cfg,
    declarationProductIds(document, parseMenuPatch(changes)),
  );
}
