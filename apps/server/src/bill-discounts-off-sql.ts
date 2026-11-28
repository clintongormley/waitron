import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { PendingDiscountView } from "@waitron/shared";
import { gatherHeldBills, workOutHeldBill } from "./bill-discounts-read.js";
import { discountViewsOf } from "./bill-discounts-list.js";

/**
 * The pending discounts of open or placed bills with no sale, gathered and worked out once, for a
 * request's totals and lists to share.
 */
export interface PendingOff {
  /** The cents `bill`'s pending discounts take off, 0 for a bill that has none. */
  of(bill: SQLWrapper): SQL;
  /** What the pending discounts of every bill in the JSON array `billIds` take off together. */
  ofEach(billIds: SQLWrapper): SQL;
  /** `billId`'s pending discounts, in the order they are worked out; none for a bill holding none or not read. */
  discountsOf(billId: string): PendingDiscountView[];
}

/** Which bills to read: those named, or those of the parties named. */
type PendingScope = { bills: readonly string[] } | { parties: readonly string[] };

function pendingOffOf(
  takes: ReadonlyMap<string, number>,
  views: ReadonlyMap<string, PendingDiscountView[]>,
): PendingOff {
  const discountsOf = (billId: string) => views.get(billId) ?? [];
  if (takes.size === 0) return { of: () => sql`0`, ofEach: () => sql`0`, discountsOf };
  const figures = JSON.stringify(Object.fromEntries(takes));
  // The id is quoted into an object-label path; escaping `\` and `"` keeps an id holding either
  // naming its own key.
  const of = (bill: SQLWrapper) =>
    sql`coalesce(${figures} ->> ('$."' || replace(replace(${bill}, '\\', '\\\\'), '"', '\\"') || '"'), 0)`;
  return {
    of,
    ofEach: (billIds) =>
      sql`(select coalesce(sum(${of(sql`pending_bill.value`)}), 0) from json_each(${billIds}) pending_bill)`,
    discountsOf,
  };
}

export const NO_PENDING_OFF: PendingOff = pendingOffOf(new Map(), new Map());

function scopeOf(scope: PendingScope | undefined): SQL {
  if (scope === undefined) return sql`1`;
  const [column, ids] =
    "bills" in scope ? [sql`wo.id`, scope.bills] : [sql`wo.party_id`, scope.parties];
  return sql`${column} in (select value from json_each(${JSON.stringify(ids)}))`;
}

/**
 * Every open or placed bill with no sale that holds a pending discount, in `scope` or venue-wide,
 * worked out once by `workOutHeldBill`, the working-out the bill's owed figure
 * (`storedOrderFigures`) takes off.
 */
export async function readPendingOff(tx: Transaction, scope?: PendingScope): Promise<PendingOff> {
  const { rows } = await tx.execute<{ bill: string }>(sql`
    select distinct wo.id as bill
    from (select working_order_id as bill from bill_discounts where working_order_id is not null
          union
          select l.working_order_id from bill_discounts d
          join working_order_lines l on l.id = d.line_id) held
    join working_orders wo on wo.id = held.bill
    where wo.status in ('open', 'placed')
      and not exists (select 1 from sales s where s.working_order_id = wo.id)
      and ${scopeOf(scope)}
    order by wo.id`);
  if (rows.length === 0) return NO_PENDING_OFF;
  const bills = await gatherHeldBills(
    tx,
    rows.map(({ bill }) => bill),
  );
  const takes = new Map<string, number>();
  const views = new Map<string, PendingDiscountView[]>();
  for (const [billId, bill] of bills) {
    const worked = workOutHeldBill(bill);
    if (worked.takes !== 0) takes.set(billId, worked.takes);
    views.set(billId, discountViewsOf(bill, worked));
  }
  return pendingOffOf(takes, views);
}
