import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import { recordIncidentOnce } from "@waitron/core";
import {
  incidents,
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
const ORIGIN = jobOrigin("payment_check");

/** Open corrections whose earliest completed refund is before `cutoff` and whose ticket has no
 * unhandled unfinished alert yet, each with the money its completed refunds gave back, as raw
 * cents text, and that earliest completion. */
function dueCorrections(db: Transaction, cutoff: string) {
  const completedSince = sql<string>`min(${tenderRefunds.completedAt})`;
  return db
    .select({
      correction: invoiceCorrections,
      back: sql<string>`cast(sum(${tenderRefunds.appliedAmount}) as text)`,
      completedSince,
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
    .where(
      and(
        eq(invoiceCorrections.state, "open"),
        notExists(
          db
            .select({ id: incidents.id })
            .from(incidents)
            .where(
              and(
                eq(incidents.source, ORIGIN.source),
                // `incidents_open_dedup`'s own key, which `recordIncidentOnce` dedupes on.
                sql`case when ${incidents.deviceId} is null then '' else ${incidents.deviceId} end = ''`,
                eq(incidents.code, "invoice_correction.unfinished"),
                eq(incidents.saleId, invoiceCorrections.originalSaleId),
                isNull(incidents.acknowledgedAt),
              ),
            ),
        ),
      ),
    )
    .groupBy(invoiceCorrections.id)
    .having(sql`${completedSince} < ${cutoff}`);
}

/** Raises `invoice_correction.unfinished` for every open correction whose earliest completed
 * refund is over an hour old and whose ticket's alert is not already open. The first read runs
 * outside the write lock, so a pass with nothing due holds up no sale; the write transaction reads
 * again, so a correction filed in between raises nothing. */
export async function sweepInvoiceCorrections(deps: TenderRefundDeps, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - UNFINISHED_MS).toISOString();
  if ((await dueCorrections(deps.db, cutoff)).length === 0) return;
  await withTransaction(deps.db, async (tx) => {
    for (const due of await dueCorrections(tx, cutoff))
      await raiseCorrectionUnfinished(
        tx,
        due.correction,
        rawCentsToDecimal(due.back),
        due.completedSince,
        now,
      );
  });
}

/** Raised once per ticket while unacknowledged, by the payment check alone. */
export function raiseCorrectionUnfinished(
  tx: Transaction,
  row: typeof invoiceCorrections.$inferSelect,
  moneyBack: Decimal,
  completedSince: string,
  now: Date,
): Promise<boolean> {
  return recordIncidentOnce(tx, {
    origin: ORIGIN,
    saleId: saleId(row.originalSaleId),
    error: new AppError("invoice_correction.unfinished", {
      correctionId: row.id,
      saleId: row.originalSaleId,
      moneyBack,
      completedSince,
    }),
    severity: "warning",
    detectedAt: now,
  });
}
