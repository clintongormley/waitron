import { sql } from "drizzle-orm";
import type { Transaction } from "./client.js";

/**
 * Why an order's way of selling can no longer change, or `null` while it still can: `"sent"` once
 * the order has left `open`, a line has been sent or has a kitchen ticket item (a later course's
 * dishes get ticket items before `sent_at`); `"paid"` once a payment attempt has started, a payment
 * is pending or received, or a sale exists. The questions `working_orders_dining_fixed`
 * (`triggers/core.sql`) asks, kept in step with it by `order-dining.test.ts`. When both apply,
 * `"sent"` is answered.
 */
export async function orderDiningLocked(
  tx: Transaction,
  workingOrderId: string,
): Promise<"sent" | "paid" | null> {
  const row = await tx.get<{ sent: number; paid: number } | undefined>(sql`
    select
      (
        o.status <> 'open'
        or exists (
          select 1 from working_order_lines l
          where l.working_order_id = ${workingOrderId} and l.sent_at is not null
        )
        or exists (
          select 1 from ticket_items t
          inner join working_order_lines l on l.id = t.working_order_line_id
          where l.working_order_id = ${workingOrderId}
        )
      ) as sent,
      (
        o.payment_attempt_at is not null
        or exists (
          select 1 from bill_payments p
          where p.working_order_id = ${workingOrderId} and p.state in ('pending', 'received')
        )
        or exists (select 1 from sales s where s.working_order_id = ${workingOrderId})
      ) as paid
    from working_orders o
    where o.id = ${workingOrderId}
  `);
  if (row === undefined) return null;
  if (row.sent) return "sent";
  if (row.paid) return "paid";
  return null;
}
