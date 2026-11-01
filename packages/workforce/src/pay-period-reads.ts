import { and, gt, lt } from "drizzle-orm";
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
