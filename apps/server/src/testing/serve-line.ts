import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { visitTables, visits, workingOrderLines, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { thousandthsToDecimal } from "@waitron/shared";
import type { TillConfig } from "../till-config.js";
import { markServed, openTab, unmarkServed } from "../working-order.js";

const OPERATOR = "cccccccc-0000-4000-8000-0000000000f1";

/**
 * `openTab` with its lines, for a party of its own seated at the table, the rows `seatTable` writes:
 * a suite whose lines must be marked served needs a party, since serving is a command on one.
 */
export async function openPartyTab(
  tx: Transaction,
  cfg: TillConfig,
  req: { tableId: string; lines?: { menuItemId: string; quantity: string }[] },
): Promise<{ tabId: string; orderNumber: number; visitId: string }> {
  const [visit] = await tx
    .insert(visits)
    .values({ guestCount: null, openedBy: OPERATOR })
    .returning({ id: visits.id });
  const opened = await openTab(tx, cfg, { ...req, visitId: visit!.id });
  await tx.insert(visitTables).values({ visitId: visit!.id, tableId: req.tableId });
  return { ...opened, visitId: visit!.id };
}

async function partyLine(tx: Transaction, orderId: string, lineNo: number) {
  const [line] = await tx
    .select({
      id: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
      visitId: workingOrders.visitId,
      revision: visits.revision,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .innerJoin(visits, eq(visits.id, workingOrders.visitId))
    .where(
      and(eq(workingOrderLines.workingOrderId, orderId), eq(workingOrderLines.lineNo, lineNo)),
    );
  if (line === undefined) throw new Error(`no line ${lineNo} on a party's bill ${orderId}`);
  return line;
}

/** Mark the rest of line `lineNo` of a party's bill served, as a command of its own. */
export async function serveLine(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  lineNo: number,
): Promise<{ revision: number }> {
  const line = await partyLine(tx, orderId, lineNo);
  return markServed(
    tx,
    cfg,
    line.visitId!,
    [{ lineId: line.id, quantity: thousandthsToDecimal(line.quantity - line.servedQuantity) }],
    { submissionId: randomUUID(), expectedVisitRevision: line.revision, operatorId: OPERATOR },
  );
}

/** Take back everything marked served on line `lineNo` of a party's bill. */
export async function unserveLine(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  lineNo: number,
): Promise<{ revision: number }> {
  const line = await partyLine(tx, orderId, lineNo);
  return unmarkServed(
    tx,
    cfg,
    line.visitId!,
    [{ lineId: line.id, quantity: thousandthsToDecimal(line.servedQuantity) }],
    { submissionId: randomUUID(), expectedVisitRevision: line.revision, operatorId: OPERATOR },
  );
}
