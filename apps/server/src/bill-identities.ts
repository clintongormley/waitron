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

/**
 * Where naming a bill is authorised: its numbering party (see {@link setBillName}), or the bill's
 * own order when it has none, which {@link setBillName} then refuses.
 */
export async function billNameZoneSubject(tx: Transaction, billId: string): Promise<ZoneSubject> {
  const partyId = (await VENUE_SERVICE.readBillIdentities(tx, [billId])).get(billId)?.partyId;
  return partyId === null || partyId === undefined ? { orderId: billId } : { partyId };
}

/**
 * Name a bill, or clear its name. Guarded by the revision of its numbering party — the party
 * whose bill list shows it, which for a paid bill left on a party merged into another is not the
 * bill's own party — and by the bill's editor, as a split is: someone else's unsent dishes on the
 * bill need a take-over first.
 */
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
  const numberingParty = identity?.partyId ?? null;
  if (numberingParty === null) {
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
