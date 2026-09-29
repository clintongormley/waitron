import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { partyTables, parties, workingOrderLines, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { thousandthsToDecimal } from "@waitron/shared";
import { splitBill } from "../bill-actions.js";
import { partyRevisionOfOrder, setMainBill } from "../parties.js";
import type { TillConfig } from "../till-config.js";
import {
  fireLines,
  fireableLineColumns,
  markServed,
  openTab,
  unmarkServed,
} from "../working-order.js";

const OPERATOR = "cccccccc-0000-4000-8000-0000000000f1";

/**
 * `openTab` with its lines, for a party of its own seated at the table, the rows `seatTable` writes:
 * a table's bill always belongs to a party, and seating takes no lines.
 */
export async function openPartyTab(
  tx: Transaction,
  cfg: TillConfig,
  req: {
    tableId: string;
    lines?: { menuItemId: string; quantity: string }[];
    /** Credited with `lines`. */
    operatorId?: string;
  },
): Promise<{ tabId: string; orderNumber: number; partyId: string }> {
  const [party] = await tx
    .insert(parties)
    .values({ guestCount: null, openedBy: OPERATOR })
    .returning({ id: parties.id });
  const opened = await openTab(tx, cfg, { ...req, partyId: party!.id });
  await tx.insert(partyTables).values({ partyId: party!.id, tableId: req.tableId });
  await setMainBill(tx, party!.id, opened.tabId);
  return { ...opened, partyId: party!.id };
}

/**
 * `splitBill` on a party's bill, sent with the party's revision as it stands: the chosen items go on
 * a new bill of the party.
 */
export async function splitPartyBill(
  tx: Transaction,
  cfg: TillConfig,
  billId: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<{ billId: string }> {
  const party = await partyRevisionOfOrder(tx, billId);
  return splitBill(tx, cfg, billId, transfers, {
    expectedPartyRevision: party!.revision,
    operatorId: OPERATOR,
  });
}

/** Fire every line of the bill, as `tables.test.ts` fires `openTab`'s lines: only released work can be
 * served. */
export async function fireAll(tx: Transaction, cfg: TillConfig, orderId: string): Promise<void> {
  const lines = await tx
    .select(fireableLineColumns)
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
  await fireLines(tx, cfg, orderId, lines);
}

async function partyLine(tx: Transaction, orderId: string, lineNo: number) {
  const [line] = await tx
    .select({
      id: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
      partyId: workingOrders.partyId,
      revision: parties.revision,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
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
    line.partyId!,
    [{ lineId: line.id, quantity: thousandthsToDecimal(line.quantity - line.servedQuantity) }],
    { submissionId: randomUUID(), expectedPartyRevision: line.revision, operatorId: OPERATOR },
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
    line.partyId!,
    [{ lineId: line.id, quantity: thousandthsToDecimal(line.servedQuantity) }],
    { submissionId: randomUUID(), expectedPartyRevision: line.revision, operatorId: OPERATOR },
  );
}
