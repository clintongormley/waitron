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
 * Take away the bill request of the party the settled bill belongs to — the one its party was merged
 * into, if it was — once no bill of that party's family is left to pay. Called in the transaction
 * that settles the bill; a bill of no party changes nothing.
 */
export async function clearBillRequestIfPaid(tx: Transaction, billId: string): Promise<void> {
  const [bill] = await tx
    .select({ partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  const partyId = bill?.partyId ?? null;
  if (partyId === null) return;
  const survivor = await survivingParty(tx, partyId);
  const bills = await readFamilyBills(tx, await partyFamily(tx, survivor));
  if (bills.some(billOwes)) return;
  await tx
    .update(parties)
    .set({ billRequestedAt: null })
    .where(and(eq(parties.id, survivor), isNotNull(parties.billRequestedAt)));
}

/** The party at the end of the party's chain of merges: itself, if it was never merged. */
async function survivingParty(tx: Transaction, partyId: string): Promise<string> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    with recursive chain(id, merged_into) as (
      select id, merged_into_party_id from parties where id = ${partyId}
      union
      select p.id, p.merged_into_party_id from parties p join chain c on p.id = c.merged_into
    )
    select id from chain where merged_into is null
  `);
  return rows[0]!.id;
}
