import { eq } from "drizzle-orm";
import { recordIncidentOnce } from "@waitron/core";
import { invoiceCorrections, withTransaction, type Transaction } from "@waitron/db";
import { AppError, centsToDecimal, jobOrigin, saleId, type Decimal } from "@waitron/shared";
import { readCorrectionMoney } from "./invoice-correction-legs.js";
import type { TenderRefundDeps } from "./tender-refunds.js";
import "./errors.js";

const UNFINISHED_MS = 3_600_000;

/** Raises `invoice_correction.unfinished` for every open correction whose earliest completed
 * refund is over an hour old. */
export async function sweepInvoiceCorrections(deps: TenderRefundDeps, now: Date): Promise<void> {
  await withTransaction(deps.db, async (tx) => {
    const open = await tx
      .select()
      .from(invoiceCorrections)
      .where(eq(invoiceCorrections.state, "open"));
    for (const row of open) {
      const money = await readCorrectionMoney(tx, row.id);
      const since = money.firstCompletedAt;
      if (since !== null && now.getTime() - Date.parse(since) > UNFINISHED_MS)
        await raiseCorrectionUnfinished(tx, row, centsToDecimal(money.completed), since, now);
    }
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
