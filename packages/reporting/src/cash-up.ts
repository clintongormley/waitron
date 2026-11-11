import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, decimal, rawCentsToDecimal, readOrigin } from "@waitron/shared";
import { businessDayWindow, nodeScopeClause } from "./business-day.js";
import type {
  CashUp,
  DailyCloseInput,
  OriginCashUp,
  TenderMethod,
  TenderMethodLine,
} from "./types.js";

/**
 * Bill-derived tenders are excluded because their payments already count the handover. Provider
 * refund evidence is excluded because the completed refund ledger counts the return.
 * Keep method lines that net to zero: the daily close still needs a count for a drawer that moved cash.
 */
export async function computeCashUp(tx: Transaction, input: DailyCloseInput): Promise<CashUp> {
  // Both sums are counts of whole cents, handed over as TEXT for `rawCentsToDecimal`.
  const { rows } = await tx.execute<{
    source: string;
    device_id: string | null;
    method: TenderMethod;
    amount: string;
    tip: string;
  }>(sql`
    select
      m.source as source,
      m.device_id as device_id,
      m.method as method,
      cast(sum(m.amount) as text) as amount,
      cast(sum(m.tip) as text) as tip
    from (${cashMovements(input)}) m
    group by m.source, m.device_id, m.method
    order by m.source, m.device_id, m.method
  `);

  const origins = new Map<string, Omit<OriginCashUp, "cashTakings">>();
  let tenderTotal = decimal("0.00");
  let tipTotal = decimal("0.00");
  for (const r of rows) {
    const line: TenderMethodLine = {
      method: r.method,
      amount: rawCentsToDecimal(r.amount),
      tip: rawCentsToDecimal(r.tip),
    };
    const key = JSON.stringify([r.source, r.device_id]);
    const existing = origins.get(key);
    if (existing === undefined) {
      origins.set(key, { ...readOrigin(r.source, r.device_id), byMethod: [line] });
    } else existing.byMethod.push(line);
    tenderTotal = addDecimal(tenderTotal, line.amount);
    tipTotal = addDecimal(tipTotal, line.tip);
  }

  const byOrigin: OriginCashUp[] = [...origins.values()].map((row) => ({
    ...row,
    // The query groups by (origin, method), so an origin has at most one cash line.
    cashTakings: row.byMethod.find((m) => m.method === "cash")?.amount ?? decimal("0.00"),
  }));

  return { byOrigin, tenderTotal, tipTotal };
}

function cashMovements(input: DailyCloseInput) {
  const window = businessDayWindow(input);
  return sql`
      select s.source as source, s.device_id as device_id, t.method as method,
        t.amount as amount, t.tip_amount as tip, s.id as sale_id, null as working_order_id
      from tenders t
      join sales s on s.id = t.sale_id
      where t.bill_payment_id is null
        and ${window(sql`t.settled_at`)}
        ${nodeScopeClause(input.nodeIds)}
      union all
      select bp.source, bp.device_id, bp.method, bp.applied + bp.tip, bp.tip, null, bp.working_order_id
      from bill_payments bp
      join working_orders wo on wo.id = bp.working_order_id
      where bp.state = 'received'
        and ${window(sql`bp.received_at`)}
        ${nodeScopeClause(input.nodeIds, sql`wo.node_id`)}
      union all
      select r.source, r.device_id, bp.method, -(r.applied_amount + r.tip_amount), -r.tip_amount, null, bp.working_order_id
      from bill_payment_refunds r
      join bill_payments bp on bp.id = r.bill_payment_id
      join working_orders wo on wo.id = bp.working_order_id
      where r.state = 'completed'
        and ${window(sql`r.completed_at`)}
        ${nodeScopeClause(input.nodeIds, sql`wo.node_id`)}
      union all
      select r.source, r.device_id, r.method, -(r.applied_amount + r.tip_amount), -r.tip_amount, r.sale_id, null
      from tender_refunds r
      where r.state = 'completed'
        and ${window(sql`r.completed_at`)}
        ${nodeScopeClause(input.nodeIds, sql`r.node_id`)}
  `;
}

export async function computeDepartmentCashUp(tx: Transaction, input: DailyCloseInput) {
  const { rows } = await tx.execute<{
    department_id: string | null;
    department_name: string | null;
    active: number | null;
    method: TenderMethod;
    amount: string;
    tip: string;
  }>(sql`
    select h.department_id, d.name as department_name, d.active, m.method,
      cast(sum(m.amount) as text) as amount, cast(sum(m.tip) as text) as tip
    from (${cashMovements(input)}) m
    left join sales s on s.working_order_id = m.working_order_id
    left join sale_receipt_headers h on h.sale_id = coalesce(m.sale_id, s.id)
    left join departments d on d.id = h.department_id
    group by h.department_id, m.method
    order by h.department_id, m.method
  `);
  return rows.map((r) => ({
    departmentId: r.department_id,
    departmentName: r.department_name,
    active: r.active === null ? null : r.active === 1,
    line: { method: r.method, amount: rawCentsToDecimal(r.amount), tip: rawCentsToDecimal(r.tip) },
  }));
}
