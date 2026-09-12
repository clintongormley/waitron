import "./errors.js";
import { and, eq, ne } from "drizzle-orm";
import { asAppUser, sales, tenders, tenants, withTenant, type Database } from "@waitron/db";
import { payments, type CardDetails } from "@waitron/payments";
import { AppError, decimal, subtractDecimal } from "@waitron/shared";
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
  await withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const [sale] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(and(eq(sales.tenantId, cfg.tenantId), eq(sales.workingOrderId, workingOrderId)));
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
      .innerJoin(
        tenders,
        and(
          eq(tenders.saleId, payments.saleId),
          eq(tenders.tenantId, payments.tenantId),
          eq(tenders.method, "card"),
        ),
      )
      .where(
        and(
          eq(payments.tenantId, cfg.tenantId),
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
    const [issuer] = await tx
      .select({ venueName: tenants.legalName, nif: tenants.taxId })
      .from(tenants)
      .where(eq(tenants.id, cfg.tenantId));
    /* v8 ignore next -- sale tenant foreign key guarantees issuer; presentation still degrades */
    if (issuer === undefined) return;
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
    const payload = formatPaymentSlip({
      issuer,
      ...(await readReceiptOrder(tx, cfg, workingOrderId)),
      paidAt: payment.paidAt,
      amount: subtractDecimal(decimal(payment.charged), decimal(payment.tip)),
      charged: payment.charged,
      tip: payment.tip,
      card,
      invoiceLocale: cfg.locale,
    });
    await enqueuePrintJob(
      tx,
      { tenantId: cfg.tenantId, locationId: cfg.locationId },
      printer.id,
      payload,
    );
  });
}
