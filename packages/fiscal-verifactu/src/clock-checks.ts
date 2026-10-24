import { desc, eq, max } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { clockChecks } from "./schema/clock-checks.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";

export interface OpenCheck {
  id: string;
  reason: (typeof clockChecks.$inferSelect)["reason"];
}

/** The open check: the one with the largest `seq`, while no confirmation names it. At most one
 * check is open, because a check opens only while none is. */
export async function openCheck(tx: Transaction): Promise<OpenCheck | null> {
  const [last] = await tx
    .select({ id: clockChecks.id, reason: clockChecks.reason })
    .from(clockChecks)
    .orderBy(desc(clockChecks.seq))
    .limit(1);
  if (last === undefined) return null;
  const [closing] = await tx
    .select({ id: clockConfirmations.id })
    .from(clockConfirmations)
    .where(eq(clockConfirmations.checkId, last.id))
    .limit(1);
  return closing === undefined ? last : null;
}

/** The `seq` the next check takes, read in the writing transaction (see the column's comment). */
export async function nextCheckSeq(tx: Transaction): Promise<number> {
  const [row] = await tx.select({ seq: max(clockChecks.seq) }).from(clockChecks);
  return (row?.seq ?? 0) + 1;
}

/** The `seq` the next confirmation takes, read in the writing transaction. */
export async function nextConfirmationSeq(tx: Transaction): Promise<number> {
  const [row] = await tx.select({ seq: max(clockConfirmations.seq) }).from(clockConfirmations);
  return (row?.seq ?? 0) + 1;
}
