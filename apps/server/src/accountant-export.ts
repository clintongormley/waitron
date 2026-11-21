import { listOutsidePayments, type OutsidePayment } from "./outside-payments-report.js";
import { saleVatDay, stampDate, validatedRangeWindow } from "@waitron/reporting";
import { readVenueClock } from "@waitron/db";
import { and, asc, between, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { invoiceSeries, sales, saleSubstitutions, saleVoids, type Transaction } from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import { listPurchaseInvoices } from "@waitron/purchasing";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { PurchaseInvoice } from "@waitron/purchasing";
import {
  centsToDecimal,
  compareDecimal,
  decimal,
  sumDecimals,
  type Decimal,
} from "@waitron/shared";
import { ACCOUNTANT_EXPORT_WORDS } from "./i18n/accountant-export.js";
import { numeric, renderWorkbook, type Cell } from "./xlsx-workbook.js";

export interface AccountantInvoice {
  id: string;
  nodeId: string;
  invoiceNumber: string;
  invoiceType: "F1" | "F2" | "corrective" | "replacement";
  issueDate: string;
  /** The day the sale happened, present only when it is earlier than `issueDate`. */
  saleDate?: string;
  customerName: string | null;
  customerTaxId: string | null;
  customerIdentifierType: string | null;
  customerIdentifierCountry: string | null;
  customerCountry: string | null;
  customerAddress: string | null;
  total: Decimal;
  vatBreakdown: { rate: string; base: string; tax: string }[];
  correctsSaleId: string | null;
  originalInvoiceNumber: string | null;
  voidedAt: string | null;
}

export interface AccountantExport {
  invoices: readonly AccountantInvoice[];
  purchases: readonly PurchaseInvoice[];
  outsidePayments: readonly OutsidePayment[];
}

export async function renderAccountantWorkbook(
  data: AccountantExport,
  language: "en" | "es",
): Promise<Uint8Array<ArrayBuffer>> {
  const words = ACCOUNTANT_EXPORT_WORDS[language];
  const invoiceRows: Cell[][] = [];
  for (const [position, invoice] of data.invoices.entries()) {
    if (position % 250 === 0) await nextTurn();
    const groups = invoice.vatBreakdown.length === 0 ? [null] : invoice.vatBreakdown;
    for (const [index, vat] of groups.entries()) {
      invoiceRows.push([
        invoice.id,
        invoice.nodeId,
        invoice.invoiceNumber,
        invoice.invoiceType === "F1" || invoice.invoiceType === "F2"
          ? invoice.invoiceType
          : words[invoice.invoiceType],
        invoice.issueDate,
        invoice.customerName,
        invoice.customerTaxId,
        invoice.customerIdentifierType === null
          ? null
          : words.identifierTypes[
              invoice.customerIdentifierType as keyof typeof words.identifierTypes
            ],
        invoice.customerIdentifierCountry,
        invoice.customerCountry,
        invoice.customerAddress,
        vat === null ? null : numeric(vat.rate),
        vat === null ? null : numeric(vat.base),
        vat === null ? null : numeric(vat.tax),
        index === 0 ? numeric(invoice.total) : null,
        invoice.correctsSaleId,
        invoice.originalInvoiceNumber,
        invoice.voidedAt,
        null,
        // Left off rather than blank: a missing trailing cell reads as an empty one.
        ...(invoice.saleDate === undefined ? [] : [invoice.saleDate]),
      ]);
    }
  }
  const purchaseRows: Cell[][] = [];
  for (const [position, purchase] of data.purchases.entries()) {
    if (position % 250 === 0) await nextTurn();
    const entered = sumDecimals(purchase.lines.flatMap((line) => [line.base, line.tax]));
    const flags = [
      ...(compareDecimal(purchase.total, decimal("0.00")) < 0 ? [words.negative] : []),
      ...(compareDecimal(purchase.total, entered) !== 0 ? [words.unreconciled] : []),
    ].join("; ");
    for (const [index, line] of purchase.lines.entries()) {
      purchaseRows.push([
        purchase.supplierInvoiceNumber,
        purchase.id,
        purchase.supplierName,
        purchase.supplierTaxId,
        purchase.issuedOn,
        purchase.receivedOn,
        words.regimes[purchase.regime],
        numeric(purchase.deductibleProportion),
        words.vatKinds[line.kind],
        numeric(line.rate),
        numeric(line.base),
        numeric(line.tax),
        index === 0 ? numeric(purchase.total) : null,
        flags,
        purchase.note,
      ]);
    }
  }
  const outsideRows: Cell[][] = data.outsidePayments.map((payment) => [
    payment.id,
    payment.workingOrderId,
    payment.saleId,
    payment.invoiceNumber,
    payment.nodeId,
    payment.settledAt,
    numeric(payment.amount),
    payment.externalProvider === null ? null : words.outsideSources[payment.externalProvider],
    payment.externalMachine,
    payment.externalRef,
    words.paymentStates[payment.state],
    numeric(payment.refunded),
  ]);
  return renderWorkbook([
    {
      name: words.invoiceSheet,
      rows: [[...words.invoiceColumns, words.saleDateColumn], ...invoiceRows],
    },
    { name: words.purchaseSheet, rows: [words.purchaseColumns, ...purchaseRows] },
    { name: words.outsideSheet, rows: [words.outsideColumns, ...outsideRows] },
  ]);
}

export async function listAccountantExport(
  tx: Transaction,
  range: { from: string; to: string },
): Promise<AccountantExport> {
  const original = alias(sales, "original_invoice");
  const originalSeries = alias(invoiceSeries, "original_series");
  const replacement = alias(sales, "replacement_invoice");
  const civilDate = stampDate(sales.issuedAt, sales.issuedOffsetMinutes);
  // The day the workbook lists the sale under: a replacement goes with the original it repeats.
  const periodDay = sql<string>`case when ${sales.replacesOriginal} = 1
    then ${saleVatDay({
      replacementSupplyDay: sales.supplyDay,
      supplyDay: original.supplyDay,
      issuedAt: original.issuedAt,
      issuedOffsetMinutes: original.issuedOffsetMinutes,
    })}
    else ${saleVatDay({
      replacementSupplyDay: replacement.supplyDay,
      supplyDay: sales.supplyDay,
      issuedAt: sales.issuedAt,
      issuedOffsetMinutes: sales.issuedOffsetMinutes,
    })} end`;
  const rows = await tx
    .select({
      id: sales.id,
      nodeId: sales.nodeId,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
      issueDate: civilDate,
      supplyDay: sales.supplyDay,
      customerName: sales.counterpartyLegalName,
      customerTaxId: sales.counterpartyTaxId,
      customerIdentifierType: sales.counterpartyIdentifierType,
      customerIdentifierCountry: sales.counterpartyIdentifierCountryCode,
      customerCountry: sales.counterpartyCountryCode,
      customerAddress: sales.counterpartyAddress,
      total: sales.total,
      vatBreakdown: sales.vatBreakdown,
      correctsSaleId: sales.correctsSaleId,
      replacesOriginal: sales.replacesOriginal,
      originalCode: originalSeries.code,
      originalNumber: original.invoiceNumber,
      voidedAt: saleVoids.voidedAt,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .leftJoin(original, eq(original.id, sales.correctsSaleId))
    .leftJoin(originalSeries, eq(originalSeries.id, original.seriesId))
    .leftJoin(saleVoids, eq(saleVoids.saleId, sales.id))
    .leftJoin(
      replacement,
      and(eq(replacement.correctsSaleId, sales.id), eq(replacement.replacesOriginal, true)),
    )
    .leftJoin(saleSubstitutions, eq(saleSubstitutions.substitutionSaleId, sales.id))
    .where(and(between(periodDay, range.from, range.to), isNull(saleSubstitutions.id)))
    .orderBy(asc(periodDay), asc(sales.issuedAt), asc(sales.id));
  const invoices: AccountantInvoice[] = rows.map(
    ({ code, number, originalCode, originalNumber, replacesOriginal, supplyDay, ...row }) => ({
      ...row,
      ...(supplyDay !== null && supplyDay < row.issueDate ? { saleDate: supplyDay } : {}),
      invoiceNumber: formatInvoiceNumber(code, number),
      invoiceType: replacesOriginal
        ? "replacement"
        : row.correctsSaleId !== null
          ? "corrective"
          : row.customerTaxId === null
            ? "F2"
            : "F1",
      originalInvoiceNumber:
        originalCode === null || originalNumber === null
          ? null
          : formatInvoiceNumber(originalCode, originalNumber),
      total: centsToDecimal(row.total),
    }),
  );
  const nextDay = new Date(`${range.to}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const purchases = await listPurchaseInvoices(tx, {
    from: range.from,
    to: nextDay.toISOString().slice(0, 10),
  });
  const clock = await readVenueClock(tx);
  const outsidePayments = await listOutsidePayments(
    tx,
    validatedRangeWindow({
      fromBusinessDay: range.from,
      toBusinessDay: range.to,
      timeZone: clock.timeZone,
      dayCutover: "00:00",
      cutoverChanges: [],
    }),
  );
  return { invoices, purchases, outsidePayments };
}
