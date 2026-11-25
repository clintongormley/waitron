import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import {
  menuVersions,
  partyTables,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import type { LiveDeclarationChange } from "@waitron/menu";
import { inIds } from "./in-ids.js";
import { refreshKitchenAllergyClashes } from "./kitchen-allergy.js";
import type { TradingContext } from "./trading-context.js";

const dishId = sql<string>`coalesce(${workingOrderLines.parentLineId}, ${workingOrderLines.id})`;

/** Refreshes allergy clashes for every sent dish on an open party's order holding a kitchen
 * allergy record on its own ticket or an extra's, where the dish's own line or a picked extra's
 * holds one of the products `changes` names for its version's menu, the menu
 * `readPublishedDeclarations` reads the line from (a variant line holds the variant's id): one
 * `refreshKitchenAllergyClashes` per order. Only such a dish can get a correction slip. */
export async function refreshCorrectedKitchenLines(
  tx: Transaction,
  cfg: TradingContext,
  changes: readonly LiveDeclarationChange[],
): Promise<void> {
  if (changes.length === 0) return;
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
    .innerJoin(menuVersions, eq(menuVersions.id, workingOrderLines.menuVersionId))
    .where(
      and(
        or(inIds(workingOrderLines.id, dishes), inIds(workingOrderLines.parentLineId, dishes)),
        or(
          ...changes.map(({ menuId, productIds }) =>
            and(eq(menuVersions.menuId, menuId), inIds(workingOrderLines.productId, productIds)),
          ),
        ),
      ),
    );
  const hit = new Set(corrected.map((row) => row.dishId));
  const byOrder = new Map<string, string[]>();
  for (const { orderId, dishId: id } of recorded)
    if (hit.has(id)) byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), id]);
  for (const [orderId, lineIds] of byOrder)
    await refreshKitchenAllergyClashes(tx, cfg, orderId, lineIds);
}
