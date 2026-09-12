import "./errors.js";
import { and, eq, or, sql } from "drizzle-orm";
import { diningTables, sales, workingOrders, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";

/** Resolve the commercial grouping shown on receipts and payment slips. */
export async function readReceiptOrder(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  opts: { atIssuance?: boolean } = {},
): Promise<{ orderLabel: string | null; orderNumber: number }> {
  const [order] = await tx
    .select({
      orderNumber: workingOrders.orderNumber,
      label: workingOrders.label,
      deliveryTableId: workingOrders.deliveryTableId,
      saleId: sales.id,
    })
    .from(workingOrders)
    .leftJoin(
      sales,
      and(eq(sales.tenantId, workingOrders.tenantId), eq(sales.workingOrderId, workingOrders.id)),
    )
    .where(and(eq(workingOrders.id, workingOrderId), eq(workingOrders.tenantId, cfg.tenantId)));
  if (order === undefined) {
    throw new AppError("working_order.not_found", { workingOrderId });
  }
  // Issuance freezes the grouping onto the order; later table edits cannot change the document.
  if (!opts.atIssuance && order.saleId !== null) {
    return { orderLabel: order.label, orderNumber: order.orderNumber };
  }
  const [table] = await tx
    .select({ label: diningTables.label })
    .from(diningTables)
    .where(
      and(
        eq(diningTables.tenantId, cfg.tenantId),
        or(
          eq(diningTables.tabId, workingOrderId),
          order.deliveryTableId === null ? undefined : eq(diningTables.id, order.deliveryTableId),
        ),
      ),
    )
    // Match the kitchen display: prefer a seated tab, with the table id breaking joins consistently.
    .orderBy(sql`(${diningTables.tabId} = ${workingOrderId}) desc nulls last`, diningTables.id)
    .limit(1);
  return { orderLabel: table?.label ?? order.label, orderNumber: order.orderNumber };
}
