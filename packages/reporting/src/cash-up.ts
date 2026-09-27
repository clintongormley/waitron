import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, decimal, rawCentsToDecimal, tillId as brandTillId } from "@waitron/shared";
import { businessDayWindow, nodeScopeClause } from "./business-day.js";
import type {
  CashUp,
  DailyCloseInput,
  TenderMethod,
  TenderMethodLine,
  TillCashUp,
} from "./types.js";

/**
 * Operational cash-up for one node — or the whole venue when `input.nodeId` is omitted — over one
 * business day: the money that moved, grouped by (till, method), from three sources (bill payments
 * design §9a):
 *
 * - a tender with no bill payment, at its `settled_at`, on its sale's till;
 * - a `received` bill payment, at its `received_at`, on its own till: `applied + tip`, never the
 *   change;
 * - a `completed` bill payment refund, at its `completed_at`, on its own till, under its payment's
 *   method: minus `applied_amount + tip_amount`.
 *
 * A tender issued from a bill payment is left out: its money was counted when the payment was
 * received, so issuing the invoice changes no day's figures. A bill payment has no node of its own
 * and is scoped through its bill's `working_orders.node_id`.
 *
 * Every source row moves a positive amount (`tenders_amount_ck`, `bill_payments_amounts_ck`,
 * `bill_payment_refunds_amounts_ck`), so a till has a line for a method exactly when money moved
 * through it by that method that day, even when the line nets to zero; `recordDailyClose` reads
 * the cash line that way. `cashTakings` is the till's net cash and can be negative.
 */
export async function computeCashUp(tx: Transaction, input: DailyCloseInput): Promise<CashUp> {
  const window = businessDayWindow(input);
  // Both sums are counts of whole cents, handed over as TEXT for `rawCentsToDecimal`.
  const { rows } = await tx.execute<{
    till_id: string;
    method: TenderMethod;
    amount: string;
    tip: string;
  }>(sql`
    select
      m.till_id as till_id,
      m.method as method,
      cast(sum(m.amount) as text) as amount,
      cast(sum(m.tip) as text) as tip
    from (
      select s.till_id as till_id, t.method as method, t.amount as amount, t.tip_amount as tip
      from tenders t
      join sales s on s.id = t.sale_id
      where t.bill_payment_id is null
        and ${window(sql`t.settled_at`)}
        ${nodeScopeClause(input.nodeId)}
      union all
      select bp.till_id, bp.method, bp.applied + bp.tip, bp.tip
      from bill_payments bp
      join working_orders wo on wo.id = bp.working_order_id
      where bp.state = 'received'
        and ${window(sql`bp.received_at`)}
        ${nodeScopeClause(input.nodeId, sql`wo.node_id`)}
      union all
      select r.till_id, bp.method, -(r.applied_amount + r.tip_amount), -r.tip_amount
      from bill_payment_refunds r
      join bill_payments bp on bp.id = r.bill_payment_id
      join working_orders wo on wo.id = bp.working_order_id
      where r.state = 'completed'
        and ${window(sql`r.completed_at`)}
        ${nodeScopeClause(input.nodeId, sql`wo.node_id`)}
    ) m
    group by m.till_id, m.method
    order by m.till_id, m.method
  `);

  const tills = new Map<string, TenderMethodLine[]>();
  let tenderTotal = decimal("0.00");
  let tipTotal = decimal("0.00");
  for (const r of rows) {
    const line: TenderMethodLine = {
      method: r.method,
      amount: rawCentsToDecimal(r.amount),
      tip: rawCentsToDecimal(r.tip),
    };
    const existing = tills.get(r.till_id);
    if (existing === undefined) tills.set(r.till_id, [line]);
    else existing.push(line);
    tenderTotal = addDecimal(tenderTotal, line.amount);
    tipTotal = addDecimal(tipTotal, line.tip);
  }

  const byTill: TillCashUp[] = [...tills.entries()].map(([tid, byMethod]) => {
    // The query groups by (till, method), so a till has at most one cash line.
    const cashTakings = byMethod.find((m) => m.method === "cash")?.amount ?? decimal("0.00");
    return { tillId: brandTillId(tid), byMethod, cashTakings };
  });

  return { byTill, tenderTotal, tipTotal };
}
