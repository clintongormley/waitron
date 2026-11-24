import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { readBillEditState } from "../bill-editing.js";
import { seedGivenAwayLine } from "./cancel-line.js";
import { inTx, partyRevisionOf, seatedWith, send, type BillVenue } from "./bill-venue.js";

function lineIdOf(venue: BillVenue, billId: string, lineNo: number): string {
  const [row] = venue.db.all<{ id: string }>(
    sql`select id from working_order_lines where working_order_id = ${billId} and line_no = ${lineNo}`,
  );
  return row!.id;
}

async function sent(answer: Promise<{ status: number; json: Record<string, unknown> }>) {
  const { status, json } = await answer;
  if (status !== 200) throw new Error(`answered ${status}: ${JSON.stringify(json)}`);
}

/**
 * A table's bill of two Croquettes (lines 1 and 2, 10.00 each) and a Small beer given away (line 3)
 * that took a 15.00 cash contribution, after which both Croquettes were paid for in cash on a bill
 * of their own: the bill comes to 0.00 and holds 15.00. Sent through the till's routes as
 * `venue.cookie`'s person.
 */
export async function zeroBillHoldingMoney(
  venue: BillVenue,
): Promise<{ partyId: string; billId: string }> {
  const { partyId, tabId: billId } = await seatedWith(
    venue,
    "Croquettes",
    "Croquettes",
    "Small beer",
  );
  await seedGivenAwayLine(venue, billId, 3);
  await sent(
    send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "15.00",
      method: "cash",
      tendered: "15.00",
      applied: "15.00",
      tip: "0.00",
    }),
  );
  await sent(
    send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/item-payments`, {
      submissionId: randomUUID(),
      picks: [{ lineId: lineIdOf(venue, billId, 1) }, { lineId: lineIdOf(venue, billId, 2) }],
      partyId,
      expectedPartyRevision: await partyRevisionOf(venue, billId),
      expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, billId))],
      method: "cash",
      tendered: "20.00",
      applied: "20.00",
      tip: "0.00",
    }),
  );
  return { partyId, billId };
}
