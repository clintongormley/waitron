import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import {
  partyTables,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { declarationProductIds, parseMenuPatch, readRecordedDocuments } from "@waitron/menu";
import { inIds } from "./in-ids.js";
import { refreshKitchenAllergyClashes } from "./kitchen-allergy.js";
import type { TradingContext } from "./trading-context.js";

const dishId = sql<string>`coalesce(${workingOrderLines.parentLineId}, ${workingOrderLines.id})`;

/** Refreshes allergy clashes for every sent dish on an open party's order whose own product, or
 * whose picked extra's, is one of `productIds` (a variant line holds the variant's id), and which
 * holds a kitchen allergy record on its own ticket or an extra's: one
 * `refreshKitchenAllergyClashes` per order. Only such a dish can get a correction slip. */
export async function refreshCorrectedKitchenLines(
  tx: Transaction,
  cfg: TradingContext,
  productIds: readonly string[],
): Promise<void> {
  // A party holds `party_tables` rows from its seating until it closes (`closePartyTables`), so
  // these are the open parties, read through the table's own small index.
  const openParties = tx.selectDistinct({ id: partyTables.partyId }).from(partyTables);
  const recorded = await tx
    .selectDistinct({ orderId: workingOrderLines.workingOrderId, dishId })
    .from(workingOrders)
    .innerJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .innerJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(sql`${workingOrders.partyId} in ${openParties}`, isNotNull(ticketItems.allergyCurrent)),
    );
  if (recorded.length === 0) return;
  const dishes = recorded.map((row) => row.dishId);
  const corrected = await tx
    .selectDistinct({ dishId })
    .from(workingOrderLines)
    .where(
      and(
        or(inIds(workingOrderLines.id, dishes), inIds(workingOrderLines.parentLineId, dishes)),
        inIds(workingOrderLines.productId, productIds),
      ),
    );
  const hit = new Set(corrected.map((row) => row.dishId));
  const byOrder = new Map<string, string[]>();
  for (const { orderId, dishId: id } of recorded)
    if (hit.has(id)) byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), id]);
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
