import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, decimal, tillId as brandTillId } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { businessDayClause } from "./business-day.js";
import type { CashUp, DailyCloseInput, TenderMethod, TenderMethodLine, TillCashUp } from "./types.js";

/**
 * Operational cash-up for one (tenant, node) over one business day, anchored on settlement. Reads
 * `tenders` joined to `sales` (for node scoping and till_id); groups by (till, method). `cashTakings`
 * per till is Σ cash-method amount (design §5). Post-settlement refunds are out of scope (tenders are
 * always positive). Belt-and-suspenders tenant/node predicates over RLS.
 */
export async function computeCashUp(tx: Transaction, input: DailyCloseInput): Promise<CashUp> {
  const { rows } = await tx.execute<{ till_id: string; method: TenderMethod; amount: string; tip: string }>(sql`
    select
      s.till_id::text as till_id,
      t.method as method,
      sum(t.amount)::numeric(12, 2)::text as amount,
      sum(t.tip_amount)::numeric(12, 2)::text as tip
    from tenders t
    join sales s on s.id = t.sale_id and s.tenant_id = ${input.tenantId}
    where t.tenant_id = ${input.tenantId}
      and s.node_id = ${input.nodeId}
      and ${businessDayClause(sql`t.settled_at`, input)}
    group by s.till_id, t.method
    -- ::text so byMethod is alphabetical (card, cash, other, ...). Ordering the tender_method ENUM
    -- directly sorts by its DECLARED order (cash, card, voucher, ...), which is arbitrary here.
    order by s.till_id, t.method::text
  `);

  const tills = new Map<string, TenderMethodLine[]>();
  let tenderTotal = decimal("0.00");
  let tipTotal = decimal("0.00");
  for (const r of rows) {
    const line: TenderMethodLine = { method: r.method, amount: decimal(r.amount), tip: decimal(r.tip) };
    const existing = tills.get(r.till_id);
    if (existing === undefined) tills.set(r.till_id, [line]);
    else existing.push(line);
    tenderTotal = addDecimal(tenderTotal, line.amount);
    tipTotal = addDecimal(tipTotal, line.tip);
  }

  const byTill: TillCashUp[] = [...tills.entries()].map(([tid, byMethod]) => {
    let cashTakings: Decimal = decimal("0.00");
    for (const m of byMethod) if (m.method === "cash") cashTakings = addDecimal(cashTakings, m.amount);
    return { tillId: brandTillId(tid), byMethod, cashTakings };
  });

  return { byTill, tenderTotal, tipTotal };
}
