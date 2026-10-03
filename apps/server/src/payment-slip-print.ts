import "./errors.js";
import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { readTenant, sales, tenders, withTransaction, type Database } from "@waitron/db";
import { payments, type CardDetails } from "@waitron/payments";
import { AppError, centsToDecimal, subtractDecimal } from "@waitron/shared";
import { enqueuePrintJob } from "@waitron/printing";
import { formatPaymentSlip } from "./payment-slip.js";
import { readReceiptOrder } from "./receipt-order.js";
import { resolvePaymentSlipPrinter } from "./receipt-print.js";
import type { OriginConfig } from "./till-config.js";

/**
 * Reconstruct the payment document of each card payment of the sale, one slip per payment in the
 * order the money moved, without reading or invoking the fiscal backend.
 */
export async function printSalePaymentSlip(
  db: Database,
  cfg: OriginConfig,
  workingOrderId: string,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const [sale] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, workingOrderId));
    if (sale === undefined) throw new AppError("working_order.not_found", { workingOrderId });
    const cards = await tx
      .select({
        charged: payments.amount,
        paidAt: payments.settledAt,
        tip: tenders.tipAmount,
        scheme: payments.cardScheme,
        last4: payments.cardLast4,
        entryMode: payments.cardEntryMode,
        authCode: payments.cardAuthCode,
      })
      .from(payments)
      .innerJoin(
        tenders,
        and(
          eq(tenders.saleId, payments.saleId),
          eq(tenders.method, "card"),
          // A bill paid by several cards: each payment's own tender carries its own tip.
          or(
            eq(tenders.billPaymentId, payments.billPaymentId),
            and(isNull(tenders.billPaymentId), isNull(payments.billPaymentId)),
          ),
        ),
      )
      .where(
        and(
          eq(payments.saleId, sale.id),
          eq(payments.workingOrderId, workingOrderId),
          ne(payments.provider, "manual"),
          // An associated capture carries its settlement instant; do not invent a payment date.
          isNotNull(payments.settledAt),
        ),
      )
      // Two cards can settle in the same millisecond; a tie falls back to `rowid`, the order the
      // rows were written in.
      .orderBy(payments.settledAt, sql`${payments}.rowid`);
    if (cards.length === 0) return;
    const printer = await resolvePaymentSlipPrinter(tx, cfg.origin);
    if (printer === undefined) return;
    const taxpayer = await readTenant(tx);
    /* v8 ignore start -- the taxpayer row is the database's one row; presentation still degrades */
    if (taxpayer === null) return;
    /* v8 ignore stop */
    const order = await readReceiptOrder(tx, cfg, workingOrderId);
    for (const payment of cards) {
      const card: CardDetails | null =
        payment.scheme === null || payment.last4 === null || payment.entryMode === null
          ? null
          : {
              scheme: payment.scheme,
              last4: payment.last4,
              entryMode: payment.entryMode as CardDetails["entryMode"],
              authCode: payment.authCode,
            };
      // `payments.amount` and `tenders.tip_amount` each store a count of whole cents; the slip is
      // printed from amounts, so both become decimals here, at the row that read them.
      const charged = centsToDecimal(payment.charged);
      const tip = centsToDecimal(payment.tip);
      const payload = formatPaymentSlip({
        issuer: { venueName: taxpayer.legalName, nif: taxpayer.taxId },
        ...order,
        paidAt: payment.paidAt!,
        amount: subtractDecimal(charged, tip),
        charged,
        tip,
        card,
        invoiceLocale: cfg.locale,
        printer: { paperWidth: printer.paperWidth, resolution: printer.resolution },
      });
      await enqueuePrintJob(tx, { locationId: cfg.locationId }, printer.id, payload);
    }
  });
}
