import { and, eq } from "drizzle-orm";
import {
  billPayments,
  invoiceSeries,
  printJobs,
  readTaxpayer,
  sales,
  refunds,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { findPaymentByBillPayment, payments } from "@waitron/payments";
import { readReceiptLanguage } from "@waitron/menu";
import type { FiscalBackend } from "@waitron/fiscal";
import { formatInvoiceNumber } from "@waitron/core";
import { AppError, addDecimal, decimal, saleId as brandSaleId } from "@waitron/shared";
import { esc, labelAmountLines, prepareText, wrapText, type EscSetting } from "@waitron/printing";
import { receiptLabelsFor } from "@waitron/country-packs";
import { receiptDateTime } from "./receipt-dates.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { formatMoney } from "./receipt-money.js";
import { toRefundView } from "./bill-payments.js";
import { toTenderRefundView } from "./tender-refunds.js";
import type { TenderRefundAcknowledgment } from "./tender-refund-types.js";
import type { TillSaleResult } from "./till-sale.js";
import "./errors.js";

export async function readTenderRefundAcknowledgment(
  backend: FiscalBackend,
  tx: Transaction,
  refundId: string,
  checkAccess: (parent: string | { workingOrderId: string }) => Promise<unknown>,
): Promise<{ acknowledgment: TenderRefundAcknowledgment; locale: string }> {
  const [row] = await tx.select().from(refunds).where(eq(refunds.id, refundId));
  if (row === undefined) throw new AppError("tender.refund_not_found", { refundId });
  const hasPrint = async () => {
    const [job] = await tx
      .select({ id: printJobs.id })
      .from(printJobs)
      .where(eq(printJobs.tenderRefundId, refundId))
      .limit(1);
    return job !== undefined;
  };
  if (row.billPaymentId !== null) {
    const [bill] = await tx
      .select({ workingOrderId: billPayments.workingOrderId, locale: workingOrders.receiptLocale })
      .from(billPayments)
      .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
      .where(eq(billPayments.id, row.billPaymentId));
    if (bill === undefined) throw new AppError("tender.refund_not_found", { refundId });
    await checkAccess({ workingOrderId: bill.workingOrderId });
    if (row.state !== "completed")
      throw new AppError("tender.refund_unavailable", { tenderId: row.billPaymentId });
    const taxpayer = await readTaxpayer(tx);
    if (taxpayer === null) throw new AppError("tender.refund_not_found", { refundId });
    const card =
      row.method === "card" ? await findPaymentByBillPayment(tx, row.billPaymentId) : undefined;
    const { id, paymentId, state, appliedAmount, tipAmount, createdAt, completedAt } =
      toRefundView(row);
    return {
      locale: bill.locale ?? (await readReceiptLanguage(tx)).locale,
      acknowledgment: {
        parent: "bill",
        workingOrderId: bill.workingOrderId,
        paymentReference: paymentId,
        refund: { id, paymentId, state, appliedAmount, tipAmount, createdAt, completedAt },
        issuer: { venueName: taxpayer.legalName, nif: taxpayer.taxId },
        method: row.method,
        customerName: null,
        last4: card?.cardLast4 ?? null,
        printQueued: await hasPrint(),
      },
    };
  }
  if (row.saleId === null || row.tenderId === null)
    throw new AppError("tender.refund_not_found", { refundId });
  await checkAccess(row.saleId);
  if (row.state !== "completed")
    throw new AppError("tender.refund_unavailable", { tenderId: row.tenderId });
  const [sale] = await tx
    .select({ sale: sales, code: invoiceSeries.code })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, row.saleId));
  const filed: Pick<Partial<TillSaleResult>, "issuer"> = await readReceiptIssuer(
    backend,
    tx,
    brandSaleId(row.saleId),
  );
  const taxpayer = filed.issuer === undefined ? await readTaxpayer(tx) : null;
  const issuer =
    filed.issuer ??
    (taxpayer === null
      ? undefined
      : {
          venueName: taxpayer.legalName,
          nif: taxpayer.taxId,
          ...(sale!.sale.taxpayerDomicile === null
            ? {}
            : { domicile: sale!.sale.taxpayerDomicile }),
        });
  if (issuer === undefined) throw new AppError("sale.not_found", { saleId: row.saleId });
  const card =
    row.provider === null || row.providerPaymentRef === null
      ? []
      : await tx
          .select({ last4: payments.cardLast4 })
          .from(payments)
          .where(
            and(
              eq(payments.provider, row.provider),
              eq(payments.paymentRef, row.providerPaymentRef),
            ),
          );
  return {
    locale: sale!.sale.locale,
    acknowledgment: {
      parent: "sale",
      refund: toTenderRefundView(row),
      invoiceNumber: formatInvoiceNumber(sale!.code, sale!.sale.invoiceNumber),
      issuer,
      customerName: sale!.sale.counterpartyLegalName,
      method: row.method,
      last4: card[0]?.last4 ?? null,
      printQueued: await hasPrint(),
    },
  };
}

export function formatTenderRefundAcknowledgment(
  acknowledgment: TenderRefundAcknowledgment,
  language: string,
  printer: EscSetting,
): Uint8Array {
  const labels = receiptLabelsFor(language.startsWith("en") ? "en-GB" : language);
  const headingLocales: Readonly<Record<string, string>> = {
    es: "es-ES",
    ca: "ca-ES",
    gl: "gl-ES",
    eu: "eu-ES",
  };
  const heading = receiptLabelsFor(headingLocales[language.split("-")[0]!] ?? "en-GB");
  const b = esc(printer).init();
  const { columns, widthDots } = b.grid;
  b.printArea(widthDots);
  const text = (value: string) => {
    for (const line of wrapText(prepareText(value), columns)) b.line(line);
  };
  const row = (caption: string, value: string) => {
    for (const line of labelAmountLines(prepareText(caption), prepareText(value), columns))
      b.line(line);
  };
  text(heading.refundHeading);
  if (acknowledgment.parent === "sale") text(heading.refundNotice);
  text(`${acknowledgment.issuer.venueName} · ${acknowledgment.issuer.nif}`);
  if (acknowledgment.issuer.domicile !== undefined) text(acknowledgment.issuer.domicile);
  if (acknowledgment.parent === "sale") row(labels.refundReference, acknowledgment.invoiceNumber);
  else text(`${labels.reference} ${acknowledgment.paymentReference}`);
  text(acknowledgment.refund.id);
  if (acknowledgment.customerName !== null) row(labels.customer, acknowledgment.customerName);
  text(`${receiptDateTime(acknowledgment.refund.completedAt!, language, 0)} UTC`);
  text(
    acknowledgment.method === "cash"
      ? labels.cash
      : `${labels.card}${acknowledgment.last4 === null ? "" : ` **** ${acknowledgment.last4}`}`,
  );
  row(labels.refundAmount, formatMoney(acknowledgment.refund.appliedAmount, language));
  row(labels.refundTip, formatMoney(acknowledgment.refund.tipAmount, language));
  row(
    labels.refundTotal,
    formatMoney(
      addDecimal(
        decimal(acknowledgment.refund.appliedAmount),
        decimal(acknowledgment.refund.tipAmount),
      ),
      language,
    ),
  );
  return b.feedAndCut().bytes();
}
