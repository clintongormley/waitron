import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, decimal, rawCentsToDecimal, tillId as brandTillId } from "@waitron/shared";
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
  // Both sums are counts of whole cents read raw, handed over as TEXT and converted by
  // `rawCentsToDecimal` — see its doc comment. `cast(… as text)` is what `::text` was; `till_id`
  // needs no cast at all now, because an id column is `text` on this engine (`columns.ts`).
  const { rows } = await tx.execute<{
    till_id: string;
    method: TenderMethod;
    amount: string;
    tip: string;
  }>(sql`
    select
      s.till_id as till_id,
      t.method as method,
      cast(sum(t.amount) as text) as amount,
      cast(sum(t.tip_amount) as text) as tip
    from tenders t
    join sales s on s.id = t.sale_id
    where ${businessDayClause(sql`t.settled_at`, input)}
      ${nodeScopeClause(input.nodeId)}
    group by s.till_id, t.method
    -- byMethod stays alphabetical (card, cash, other, ...). It needed a ::text cast to get that
    -- when method was a PostgreSQL ENUM, whose bare ordering is its DECLARED order (cash, card,
    -- voucher, ...); the column is a checked TEXT column on this engine, so plain t.method IS
    -- the alphabetical ordering and a cast would say nothing.
    order by s.till_id, t.method
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
