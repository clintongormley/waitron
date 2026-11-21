import { sql } from "drizzle-orm";
import type { Transaction } from "./client.js";

type DiningLock = "sent" | "paid";

/**
 * Why an order's way of selling can no longer change, or `null` while it still can: `"sent"` once
 * the order has left `open`, a line has been sent or has a kitchen ticket item (a later course's
 * dishes get ticket items before `sent_at`); `"paid"` once a payment is pending or received,
 * or a sale exists. The questions `working_orders_dining_fixed`
 * (`triggers/core.sql`) asks, kept in step with it by `order-dining.test.ts`. When both apply,
 * `"sent"` is answered.
 */
export async function orderDiningLocked(
  tx: Transaction,
  workingOrderId: string,
): Promise<DiningLock | null> {
  return (await ordersDiningLocked(tx, [workingOrderId])).get(workingOrderId) ?? null;
}

/** {@link orderDiningLocked} for several orders in one read; an order still free is absent. */
export async function ordersDiningLocked(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<ReadonlyMap<string, DiningLock>> {
  if (workingOrderIds.length === 0) return new Map();
  const rows = await tx.all<{ id: string; sent: number; paid: number }>(sql`
    select
      o.id,
      (
        o.status <> 'open'
        or exists (
          select 1 from working_order_lines l
          where l.working_order_id = o.id and l.sent_at is not null
        )
        or exists (
          select 1 from ticket_items t
          inner join working_order_lines l on l.id = t.working_order_line_id
          where l.working_order_id = o.id
        )
      ) as sent,
      (
        exists (
          select 1 from bill_payments p
          where p.working_order_id = o.id and p.state in ('pending', 'received')
        )
        or exists (select 1 from sales s where s.working_order_id = o.id)
      ) as paid
    from working_orders o
    where o.id in (${sql.join(
      workingOrderIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  const locks = new Map<string, DiningLock>();
  for (const row of rows) {
    if (row.sent) locks.set(row.id, "sent");
    else if (row.paid) locks.set(row.id, "paid");
  }
  return locks;
}
