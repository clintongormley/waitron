import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, centsToDecimal, decimal, tillId as brandTillId } from "@waitron/shared";
import { businessDayClause, nodeScopeClause } from "./business-day.js";
import type {
  CashUp,
  DailyCloseInput,
  TenderMethod,
  TenderMethodLine,
  TillCashUp,
} from "./types.js";

/**
 * Operational cash-up for one node — or the whole venue when `input.nodeId` is omitted —
 * over one business day, anchored on settlement. Reads `tenders` joined to `sales` (for node scoping
 * and till_id); groups by (till, method). `cashTakings` per till is Σ cash-method amount (design §5).
 * The node predicate is applied via `nodeScopeClause` only when a node is fixed (a venue-wide overview
 * omits it and reads the whole database, which holds one tenant). Post-settlement refunds are out of
 * scope (tenders are always positive).
 */
export async function computeCashUp(tx: Transaction, input: DailyCloseInput): Promise<CashUp> {
  // `tenders.amount` and `tenders.tip_amount` count whole cents, so these sums are exact counts of
  // cents and `centsToDecimal` below is the one conversion to an amount. `::int` keeps each sum in
  // the width the column itself has and hands it back as a number, as `counts.ts` does for its
  // record counts; a day whose tenders overflow that width raises 22003 rather than reporting a
  // wrong figure. Casting to `numeric(12, 2)` instead would render 12000 cents as "12000.00" — a
  // plausible string a hundred times the amount, which nothing in this package's types would catch.
  const { rows } = await tx.execute<{
    till_id: string;
    method: TenderMethod;
    amount: number;
    tip: number;
  }>(sql`
    select
      s.till_id::text as till_id,
      t.method as method,
      sum(t.amount)::int as amount,
      sum(t.tip_amount)::int as tip
    from tenders t
    join sales s on s.id = t.sale_id
    where ${businessDayClause(sql`t.settled_at`, input)}
      ${nodeScopeClause(input.nodeId)}
    group by s.till_id, t.method
    -- ::text so byMethod is alphabetical (card, cash, other, ...). Ordering the tender_method ENUM
    -- directly sorts by its DECLARED order (cash, card, voucher, ...), which is arbitrary here.
    order by s.till_id, t.method::text
  `);

  const tills = new Map<string, TenderMethodLine[]>();
  let tenderTotal = decimal("0.00");
  let tipTotal = decimal("0.00");
  for (const r of rows) {
    const line: TenderMethodLine = {
      method: r.method,
      amount: centsToDecimal(r.amount),
      tip: centsToDecimal(r.tip),
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
