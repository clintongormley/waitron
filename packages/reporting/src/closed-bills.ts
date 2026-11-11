import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { rawCentsToDecimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { businessDayWindow, nodeScopeClause } from "./business-day.js";
import type { DailyCloseInput } from "./types.js";

/** Bills whose order was settled in the business day, at their invoices' totals as issued. */
export async function computeClosedBills(
  tx: Transaction,
  input: DailyCloseInput,
): Promise<{ count: number; total: Decimal }> {
  const window = businessDayWindow(input);
  const { rows } = await tx.execute<{ count: number; total: string }>(sql`
    select count(*) as count, cast(coalesce(sum(s.total), 0) as text) as total
    from working_orders wo
    join sales s on s.working_order_id = wo.id
    where ${window(sql`wo.settled_at`)}
      ${nodeScopeClause(input.nodeIds, sql`wo.node_id`)}
  `);
  const row = rows[0]!;
  return { count: Number(row.count), total: rawCentsToDecimal(row.total) };
}
