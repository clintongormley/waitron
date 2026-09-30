import { and, eq, isNotNull, sql } from "drizzle-orm";
import { nowIso, parties, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { PartyCommandArgs } from "./order-groups.js";
import {
  billOwes,
  checkAndBumpParty,
  partyFamily,
  readFamilyBills,
  runServiceCommand,
} from "./parties.js";
import "./errors.js";

/**
 * Record that the party asked for the bill, or take the request back. A request already standing
 * keeps the time it was first made. It is accepted whatever the party owes, and
 * {@link clearBillRequestIfPaid} takes it away once every bill of the family is paid.
 */
export async function requestBill(
  tx: Transaction,
  partyId: string,
  requested: boolean,
  args: PartyCommandArgs,
): Promise<{ revision: number; billRequestedAt: string | null }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "party.bill_request",
    { partyId, requested, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      const [row] = await tx
        .update(parties)
        .set({
          billRequestedAt: requested
            ? sql`coalesce(${parties.billRequestedAt}, ${nowIso()})`
            : null,
        })
        .where(eq(parties.id, partyId))
        .returning({ billRequestedAt: parties.billRequestedAt });
      return { revision, billRequestedAt: row!.billRequestedAt };
    },
  );
}

/**
 * Take away the bill request of the settled bill's party once no bill of its family is left to pay.
 * Called in the transaction that settles the bill; a bill of no party changes nothing.
 */
export async function clearBillRequestIfPaid(tx: Transaction, billId: string): Promise<void> {
  const [bill] = await tx
    .select({ partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  const partyId = bill?.partyId ?? null;
  if (partyId === null) return;
  const bills = await readFamilyBills(tx, await partyFamily(tx, partyId));
  if (bills.some(billOwes)) return;
  await tx
    .update(parties)
    .set({ billRequestedAt: null })
    .where(and(eq(parties.id, partyId), isNotNull(parties.billRequestedAt)));
}
