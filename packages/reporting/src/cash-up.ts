import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, decimal, rawCentsToDecimal, readOrigin } from "@waitron/shared";
import { businessDayWindow, nodeScopeClause } from "./business-day.js";
import type {
  DailyCloseInput,
  DepartmentTakings,
  OriginCashUp,
  TenderMethod,
  TenderMethodLine,
} from "./types.js";

/** Bill-derived tenders and provider refund evidence are excluded: their payment/refund ledgers already count the movement.
 * Zero method lines stay: a drawer that moved cash still needs counting. */
export async function computeCashUp(tx: Transaction, input: DailyCloseInput) {
  const { rows } = await tx.execute<{
    source: string;
    device_id: string | null;
    method: TenderMethod;
    department_id: string | null;
    department_name: string | null;
    active: number | null;
    amount: string;
    tip: string;
  }>(sql`
    select m.source, m.device_id, m.method, h.department_id, d.name as department_name, d.active,
      cast(sum(m.amount) as text) as amount, cast(sum(m.tip) as text) as tip
    from (${cashMovements(input)}) m
    left join sales s on s.working_order_id = m.working_order_id
    left join sale_receipt_headers h on h.sale_id = coalesce(m.sale_id, s.id)
    left join departments d on d.id = h.department_id
    group by m.source, m.device_id, m.method, h.department_id
    order by m.source, m.device_id, m.method, h.department_id
  `);
  const origins = new Map<string, Omit<OriginCashUp, "cashTakings">>();
  const departments = new Map<string | null, DepartmentTakings>();
  let tenderTotal = decimal("0.00");
  let tipTotal = decimal("0.00");
  for (const r of rows) {
    const line: TenderMethodLine = {
      method: r.method,
      amount: rawCentsToDecimal(r.amount),
      tip: rawCentsToDecimal(r.tip),
    };
    const key = JSON.stringify([r.source, r.device_id]);
    let origin = origins.get(key);
    if (origin === undefined) {
      origin = { ...readOrigin(r.source, r.device_id), byMethod: [] };
      origins.set(key, origin);
    }
    addMethod(origin.byMethod, line);
    let department = departments.get(r.department_id);
    if (department === undefined) {
      department = {
        departmentId: r.department_id,
        departmentName: r.department_name,
        active: r.active === null ? null : r.active === 1,
        byMethod: [],
        billsClosed: { count: 0, total: decimal("0.00") },
      };
      departments.set(r.department_id, department);
    }
    addMethod(department.byMethod, line);
    tenderTotal = addDecimal(tenderTotal, line.amount);
    tipTotal = addDecimal(tipTotal, line.tip);
  }
  const byOrigin: OriginCashUp[] = [...origins.values()].map((row) => ({
    ...row,
    cashTakings: row.byMethod.find((m) => m.method === "cash")?.amount ?? decimal("0.00"),
  }));
  const departmentTakings = [...departments.values()];
  for (const row of departmentTakings)
    row.byMethod.sort((a, b) => Number(a.method > b.method) - Number(a.method < b.method));
  return { cash: { byOrigin, tenderTotal, tipTotal }, departmentTakings };
}

function addMethod(lines: TenderMethodLine[], line: TenderMethodLine): void {
  const existing = lines.find((row) => row.method === line.method);
  if (existing === undefined) lines.push({ ...line });
  else {
    existing.amount = addDecimal(existing.amount, line.amount);
    existing.tip = addDecimal(existing.tip, line.tip);
  }
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
