import { sql, type SQL } from "drizzle-orm";
import { workingOrders, type Transaction } from "@waitron/db";

/** `billId` and the bills reopened from it in turn, as the common table `chain(id)`. */
function chainFrom(billId: string): SQL {
  // `union`, not `union all`: a bill already reached is not queued again, so a cycle ends.
  return sql`with recursive chain(id) as (
      select ${billId}
      union
      select w.id from chain c join ${workingOrders} w on w.reopened_from = c.id
    )`;
}

/**
 * The ids of `billId` and of every bill reopened from it in turn, as a parenthesised subquery: a
 * printed bill's received payments move to the bill reopened from it, so a payment a resend to the
 * printed bill names is on one of these.
 */
export function reopenedChainIds(billId: string): SQL {
  return sql`(${chainFrom(billId)} select id from chain)`;
}

/** The bill `billId` was last reopened as, which the table owes on now; `billId` itself when it was
 * never reopened. */
export async function lastReopenedBill(tx: Transaction, billId: string): Promise<string> {
  const { rows } = await tx.execute<{ id: string }>(
    sql`${chainFrom(billId)} select c.id from chain c
      where not exists (select 1 from ${workingOrders} w where w.reopened_from = c.id)`,
  );
  return rows[0]!.id;
}
