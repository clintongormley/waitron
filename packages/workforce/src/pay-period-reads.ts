import { and, gt, lt, lte } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import type { Period } from "./projection.js";
import type { PayPeriodClosure } from "./record-types.js";
import { payPeriodClosures } from "./schema/pay-period-closures.js";

export async function readClosures(
  tx: Database | Transaction,
  input: { period: Period },
): Promise<PayPeriodClosure[]> {
  const rows = await tx
    .select()
    .from(payPeriodClosures)
    .where(
      and(
        lt(payPeriodClosures.periodStart, input.period.end),
        gt(payPeriodClosures.periodEnd, input.period.start),
      ),
    );
  return rows.map(({ periodStart, periodEnd, ...row }) => ({
    ...row,
    period: { start: periodStart, end: periodEnd },
  }));
}

export async function readClosedPeriodContaining(
  tx: Transaction,
  date: string,
): Promise<Period | null> {
  const [period] = await tx
    .select({ start: payPeriodClosures.periodStart, end: payPeriodClosures.periodEnd })
    .from(payPeriodClosures)
    .where(and(lte(payPeriodClosures.periodStart, date), gt(payPeriodClosures.periodEnd, date)))
    .limit(1);
  return period ?? null;
}
