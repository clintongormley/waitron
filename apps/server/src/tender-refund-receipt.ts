import { and, eq } from "drizzle-orm";
import { invoiceSeries, readTenant, sales, tenderRefunds, type Transaction } from "@waitron/db";
import { payments } from "@waitron/payments";
import type { FiscalBackend } from "@waitron/fiscal";
import { formatInvoiceNumber } from "@waitron/core";
import { AppError, addDecimal, decimal, saleId as brandSaleId } from "@waitron/shared";
import { esc, labelAmountLines, prepareText, wrapText, type EscSetting } from "@waitron/printing";
import { receiptLabelsFor } from "@waitron/country-packs";
import { resolveTransactionScope } from "./find-bill-transactions.js";
import { receiptDateTime } from "./receipt-dates.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { formatMoney } from "./receipt-money.js";
import { toTenderRefundView } from "./tender-refunds.js";
import type { TenderRefundAcknowledgment } from "./tender-refund-types.js";
import type { TillSaleResult } from "./till-sale.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

export async function readTenderRefundAcknowledgment(
  backend: FiscalBackend,
  tx: Transaction,
  cfg: TillConfig,
  refundId: string,
): Promise<TenderRefundAcknowledgment> {
  const [row] = await tx.select().from(tenderRefunds).where(eq(tenderRefunds.id, refundId));
  if (row === undefined) throw new AppError("tender.refund_not_found", { refundId });
  await resolveTransactionScope(tx, cfg, row.saleId);
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
  const tenant = filed.issuer === undefined ? await readTenant(tx) : null;
  const issuer =
    filed.issuer ??
    (tenant === null
      ? undefined
      : {
          venueName: tenant.legalName,
          nif: tenant.taxId,
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
    refund: toTenderRefundView(row),
    invoiceNumber: formatInvoiceNumber(sale!.code, sale!.sale.invoiceNumber),
    issuer,
    customerName: sale!.sale.counterpartyLegalName,
    method: row.method,
    last4: card[0]?.last4 ?? null,
  };
}

export function formatTenderRefundAcknowledgment(
  acknowledgment: TenderRefundAcknowledgment,
  language: string,
  printer: EscSetting,
): Uint8Array {
  const base = receiptLabelsFor(language);
  const english = language.startsWith("en");
  const labels = english
    ? {
        ...base,
        reference: "Original invoice",
        customer: "Customer",
        cash: "Cash",
        card: "Card",
        amountColumn: "Payment returned",
        tip: "Tip returned",
        refund: "Money returned",
      }
    : base;
  const headings: Record<string, readonly [string, string]> = {
    es: ["JUSTIFICANTE DE DEVOLUCIÓN", "La factura original no cambia"],
    ca: ["JUSTIFICANT DE DEVOLUCIÓ", "La factura original no canvia"],
    gl: ["XUSTIFICANTE DE DEVOLUCIÓN", "A factura orixinal non cambia"],
    eu: ["ITZULKETAREN FROGAGIRIA", "Jatorrizko faktura ez da aldatzen"],
  };
  const heading = headings[language.split("-")[0]!] ?? [
    "REFUND ACKNOWLEDGMENT",
    "The original invoice is unchanged",
  ];
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
  text(heading[0]!);
  text(heading[1]!);
  text(`${acknowledgment.issuer.venueName} · ${acknowledgment.issuer.nif}`);
  if (acknowledgment.issuer.domicile !== undefined) text(acknowledgment.issuer.domicile);
  row(labels.reference, acknowledgment.invoiceNumber);
  text(acknowledgment.refund.id);
  if (acknowledgment.customerName !== null) row(labels.customer, acknowledgment.customerName);
  text(`${receiptDateTime(acknowledgment.refund.completedAt!, language, 0)} UTC`);
  text(
    acknowledgment.method === "cash"
      ? labels.cash
      : `${labels.card}${acknowledgment.last4 === null ? "" : ` **** ${acknowledgment.last4}`}`,
  );
  row(labels.amountColumn, formatMoney(acknowledgment.refund.appliedAmount, language));
  row(labels.tip, formatMoney(acknowledgment.refund.tipAmount, language));
  row(
    labels.refund,
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
