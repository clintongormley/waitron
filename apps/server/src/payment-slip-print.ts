import "./errors.js";
import { and, eq, ne } from "drizzle-orm";
import { readTenant, sales, tenders, withTransaction, type Database } from "@waitron/db";
import { payments, type CardDetails } from "@waitron/payments";
import { AppError, centsToDecimal, subtractDecimal } from "@waitron/shared";
import { enqueuePrintJob } from "@waitron/printing";
import { formatPaymentSlip } from "./payment-slip.js";
import { readReceiptOrder } from "./receipt-order.js";
import { resolveReceiptPrinter } from "./receipt-print.js";
import type { TillConfig } from "./till-config.js";

/** Reconstruct a payment document without reading or invoking the fiscal backend. */
export async function printSalePaymentSlip(
  db: Database,
  cfg: TillConfig,
  workingOrderId: string,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const [sale] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, workingOrderId));
    if (sale === undefined) throw new AppError("working_order.not_found", { workingOrderId });
    const [payment] = await tx
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
      .innerJoin(tenders, and(eq(tenders.saleId, payments.saleId), eq(tenders.method, "card")))
      .where(
        and(
          eq(payments.saleId, sale.id),
          eq(payments.workingOrderId, workingOrderId),
          ne(payments.provider, "manual"),
        ),
      )
      .orderBy(payments.id)
      .limit(1);
    if (payment === undefined) return;
    const printer = await resolveReceiptPrinter(tx, cfg);
    if (printer === undefined) return;
    const taxpayer = await readTenant(tx);
    /* v8 ignore start -- the taxpayer row is the database's one row; presentation still degrades */
    if (taxpayer === null) return;
    /* v8 ignore stop */
    const card: CardDetails | null =
      payment.scheme === null || payment.last4 === null || payment.entryMode === null
        ? null
        : {
            scheme: payment.scheme,
            last4: payment.last4,
            entryMode: payment.entryMode as CardDetails["entryMode"],
            authCode: payment.authCode,
          };
    // An associated capture carries its settlement instant; do not invent a payment date if absent.
    if (payment.paidAt === null) return;
    // `payments.amount` and `tenders.tip_amount` each store a count of whole cents; the slip is
    // printed from amounts, so both become decimals here, at the row that read them.
    const charged = centsToDecimal(payment.charged);
    const tip = centsToDecimal(payment.tip);
    const payload = formatPaymentSlip({
      issuer: { venueName: taxpayer.legalName, nif: taxpayer.taxId },
      ...(await readReceiptOrder(tx, cfg, workingOrderId)),
      paidAt: payment.paidAt,
      amount: subtractDecimal(charged, tip),
      charged,
      tip,
      card,
      invoiceLocale: cfg.locale,
      printer: {
        paperWidth: printer.paperWidth,
        characterSet: printer.characterSet,
        characterTable: printer.characterTable,
      },
    });
    await enqueuePrintJob(tx, { locationId: cfg.locationId }, printer.id, payload);
  });
}
