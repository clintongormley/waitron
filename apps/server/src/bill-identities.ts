import { eq } from "drizzle-orm";
import { workingOrders, type Transaction } from "@waitron/db";
import { AppError, normalisePartyName } from "@waitron/shared";
import type { BillCommand } from "./bill-actions.js";
import { invalid } from "./bill-allocation.js";
import { requireBillEditor } from "./bill-editing.js";
import { VENUE_SERVICE } from "./modules.js";
import type { BillEditExpected } from "./order-drafts.js";
import { guardParty, partyRevision, refuseMovedParty } from "./parties.js";
import type { ZoneSubject } from "./zone-access.js";
import "./errors.js";

export async function billNameZoneSubject(tx: Transaction, billId: string): Promise<ZoneSubject> {
  const partyId = (await VENUE_SERVICE.readBillIdentities(tx, [billId])).get(billId)?.partyId;
  return partyId === null || partyId === undefined ? { orderId: billId } : { partyId };
}

/** Naming is guarded by the bill's current party revision and its editor. */
export async function setBillName(
  tx: Transaction,
  billId: string,
  name: unknown,
  command: BillCommand & { expectedEdit: BillEditExpected },
): Promise<{ revision: number; billNumber: number | null; billName: string | null }> {
  const billName = normalisePartyName(name);
  const [bill] = await tx
    .select({ partyId: workingOrders.partyId, status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  if (bill === undefined || bill.status === "abandoned")
    throw new AppError("tab.not_open", { tabId: billId });
  const identity = (await VENUE_SERVICE.readBillIdentities(tx, [billId])).get(billId);
  const numberingParty = bill.partyId;
  if (numberingParty === null || identity?.number == null) {
    if (bill.partyId === null) throw invalid("billId");
    // A fault in Waitron: every writer that puts a bill on a party numbers it there.
    throw new Error(`bill ${billId} is on party ${bill.partyId} with no number`);
  }
  if (command.partyId !== undefined && command.partyId !== numberingParty)
    await refuseMovedParty(tx, command.partyId);
  await guardParty(tx, numberingParty, command);
  await requireBillEditor(tx, billId, command.operatorId, command.expectedEdit);
  await VENUE_SERVICE.setBillName(tx, billId, billName);
  return {
    revision: await partyRevision(tx, numberingParty),
    billNumber: identity!.number,
    billName,
  };
}
