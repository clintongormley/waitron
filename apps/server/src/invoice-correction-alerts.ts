import { and, eq, sql } from "drizzle-orm";
import { recordIncidentOnce } from "@waitron/core";
import {
  invoiceCorrectionRefunds,
  invoiceCorrections,
  tenderRefunds,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { AppError, jobOrigin, rawCentsToDecimal, saleId, type Decimal } from "@waitron/shared";
import type { TenderRefundDeps } from "./tender-refunds.js";
import "./errors.js";

const UNFINISHED_MS = 3_600_000;

/** Open corrections whose earliest completed refund is before `cutoff`, each with the money its
 * completed refunds gave back, as raw cents text, and that earliest completion. */
function dueCorrections(db: Transaction, cutoff: string) {
  const since = sql<string>`min(${tenderRefunds.completedAt})`;
  return db
    .select({
      correction: invoiceCorrections,
      back: sql<string>`cast(sum(${tenderRefunds.appliedAmount}) as text)`,
      since,
    })
    .from(invoiceCorrections)
    .innerJoin(
      invoiceCorrectionRefunds,
      eq(invoiceCorrectionRefunds.invoiceCorrectionId, invoiceCorrections.id),
    )
    .innerJoin(
      tenderRefunds,
      and(
        eq(tenderRefunds.id, invoiceCorrectionRefunds.tenderRefundId),
        eq(tenderRefunds.state, "completed"),
      ),
    )
    .where(eq(invoiceCorrections.state, "open"))
    .groupBy(invoiceCorrections.id)
    .having(sql`${since} < ${cutoff}`);
}

/** Raises `invoice_correction.unfinished` for every open correction whose earliest completed
 * refund is over an hour old. The first read runs outside the write lock, so a pass with nothing
 * due holds up no sale; the write transaction reads again, so a correction filed in between raises
 * nothing. */
export async function sweepInvoiceCorrections(deps: TenderRefundDeps, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - UNFINISHED_MS).toISOString();
  if ((await dueCorrections(deps.db, cutoff)).length === 0) return;
  await withTransaction(deps.db, async (tx) => {
    for (const due of await dueCorrections(tx, cutoff))
      await raiseCorrectionUnfinished(
        tx,
        due.correction,
        rawCentsToDecimal(due.back),
        due.since,
        now,
      );
  });
}

/** Raised once per ticket while unacknowledged, by the payment check alone. */
export function raiseCorrectionUnfinished(
  tx: Transaction,
  row: typeof invoiceCorrections.$inferSelect,
  moneyBack: Decimal,
  since: string,
  now: Date,
): Promise<boolean> {
  return recordIncidentOnce(tx, {
    origin: jobOrigin("payment_check"),
    saleId: saleId(row.originalSaleId),
    error: new AppError("invoice_correction.unfinished", {
      correctionId: row.id,
      saleId: row.originalSaleId,
      moneyBack,
      since,
    }),
    severity: "warning",
    detectedAt: now,
  });
}
