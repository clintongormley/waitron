import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readBillDiscounts } from "./bill-discounts-read.js";

/** What pending discounts take off each bill, in whole cents, for a query to subtract. */
export interface PendingOff {
  /**
   * The cents `bill`'s pending discounts take off, 0 for a bill that has none. `bill` is the
   * bill's id as the query names it; a bare name other than `pending_bill` or `pending_off`
   * resolves to the outer query's column.
   */
  of(bill: SQLWrapper): SQL;
}

/** A {@link PendingOff} over `rows`, each a bill's id and the cents taken off it. */
export function pendingOffOf(rows: readonly (readonly [string, number])[]): PendingOff {
  const table = JSON.stringify(rows);
  return {
    of: (bill) =>
      sql`coalesce((select p.pending_off from (select value ->> 0 as pending_bill, value ->> 1 as pending_off from json_each(${table})) p where p.pending_bill = ${bill}), 0)`,
  };
}

export const NO_PENDING_OFF: PendingOff = pendingOffOf([]);

/**
 * Every open or placed bill with no sale that holds a pending discount, worked out once by
 * `readBillDiscounts`, the working-out the bill's owed figure (`storedOrderFigures`) takes off.
 */
export async function readPendingOff(tx: Transaction): Promise<PendingOff> {
  const { rows } = await tx.execute<{ bill: string }>(sql`
    select distinct wo.id as bill
    from (select working_order_id as bill from bill_discounts where working_order_id is not null
          union
          select l.working_order_id from bill_discounts d
          join working_order_lines l on l.id = d.line_id) held
    join working_orders wo on wo.id = held.bill
    where wo.status in ('open', 'placed')
      and not exists (select 1 from sales s where s.working_order_id = wo.id)
    order by wo.id`);
  if (rows.length === 0) return NO_PENDING_OFF;
  const worked = await readBillDiscounts(
    tx,
    rows.map(({ bill }) => bill),
  );
  return pendingOffOf(
    [...worked].flatMap(([bill, { takes }]) => (takes === 0 ? [] : [[bill, takes] as const])),
  );
}
