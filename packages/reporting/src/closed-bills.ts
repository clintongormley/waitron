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
    select h.department_id, d.name as department_name, d.active,
      count(*) as count, cast(sum(s.total) as text) as total
    from working_orders wo
    join sales s on s.working_order_id = wo.id
    left join sale_receipt_headers h on h.sale_id = s.id
    left join departments d on d.id = h.department_id
    where ${window(sql`wo.settled_at`)}
      ${nodeScopeClause(input.nodeIds, sql`wo.node_id`)}
    group by h.department_id
    order by h.department_id
  `);
  return rows.map((r) => ({
    departmentId: r.department_id,
    departmentName: r.department_name,
    active: r.active === null ? null : r.active === 1,
    billsClosed: { count: Number(r.count), total: rawCentsToDecimal(r.total) },
  }));
}
