import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { rawCentsToDecimal } from "@waitron/shared";
import { businessDayWindow, nodeScopeClause } from "./business-day.js";
import type { DailyCloseInput } from "./types.js";

export async function computeDepartmentClosedBills(tx: Transaction, input: DailyCloseInput) {
  const window = businessDayWindow(input);
  const { rows } = await tx.execute<{
    department_id: string | null;
    department_name: string | null;
    active: number | null;
    count: number;
    total: string;
  }>(sql`
    select s.receipt_department_id as department_id, d.name as department_name, d.active,
      count(*) as count, cast(sum(s.total) as text) as total
    from working_orders wo
    join sales s on s.working_order_id = wo.id
    left join departments d on d.id = s.receipt_department_id
    where ${window(sql`case
        when s.source = 'business_day_close' and s.total = 0 then wo.trusted_opened_at
        else wo.settled_at
      end`)}
      ${nodeScopeClause(input.nodeIds, sql`wo.node_id`)}
    group by s.receipt_department_id
    order by s.receipt_department_id
  `);
  return rows.map((r) => ({
    departmentId: r.department_id,
    departmentName: r.department_name,
    active: r.active === null ? null : r.active === 1,
    billsClosed: { count: Number(r.count), total: rawCentsToDecimal(r.total) },
  }));
}
