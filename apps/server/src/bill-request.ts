import { eq, sql } from "drizzle-orm";
import {
  isRefusal,
  NOT_NULL_VIOLATION,
  nowIso,
  parties,
  TRIGGER_ABORT,
  UNIQUE_VIOLATION,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { Logger } from "./logger.js";
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
 * keeps the time it was first made. It is accepted whatever the party owes, and stands until it is
 * taken back; {@link clearBillRequestIfPaid} takes it away when a payment leaves nothing of the
 * family to pay, unless that clearing is refused.
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
 * that settles the bill; a bill of no party changes nothing. A refused clearing is logged and leaves
 * the request standing, never undoing the payment.
 */
export async function clearBillRequestIfPaid(
  tx: Transaction,
  billId: string,
  log: Logger | undefined,
): Promise<void> {
  const [bill] = await tx
    .select({ partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  const partyId = bill?.partyId ?? null;
  if (partyId === null) return;
  const survivor = await survivingParty(tx, partyId);
  if (survivor.billRequestedAt === null) return;
  const bills = await readFamilyBills(tx, await partyFamily(tx, survivor.id));
  if (bills.some(billOwes)) return;
  try {
    await tx.update(parties).set({ billRequestedAt: null }).where(eq(parties.id, survivor.id));
  } catch (error) {
    // Under SQLite's default ABORT a refusal backs out the statement alone (CLAUDE.md §3; 1555 is
    // treated like 2067 without a measurement of its own), and no trigger or conflict clause in this
    // schema uses ROLLBACK. A `RAISE(ROLLBACK)` would report the same 1811 and end the transaction.
    if (!isRefusal(error, CLEARING_REFUSALS)) throw error;
    log?.("warn", "bill_request.clear_failed", {
      billId,
      partyId: survivor.id,
      error: String(error),
    });
  }
}

const CLEARING_REFUSALS = [...TRIGGER_ABORT, ...UNIQUE_VIOLATION, ...NOT_NULL_VIOLATION];

/**
 * The party at the end of the party's chain of merges — itself, if it was never merged — and its
 * bill request.
 */
async function survivingParty(
  tx: Transaction,
  partyId: string,
): Promise<{ id: string; billRequestedAt: string | null }> {
  const { rows } = await tx.execute<{ id: string; bill_requested_at: string | null }>(sql`
    with recursive chain(id, merged_into, bill_requested_at) as (
      select id, merged_into_party_id, bill_requested_at from parties where id = ${partyId}
      union
      select p.id, p.merged_into_party_id, p.bill_requested_at
      from parties p join chain c on p.id = c.merged_into
    )
    select id, bill_requested_at from chain where merged_into is null
  `);
  return { id: rows[0]!.id, billRequestedAt: rows[0]!.bill_requested_at };
}
