import { listOutsidePayments, type OutsidePayment } from "./outside-payments-report.js";
import { stampDate, validatedRangeWindow } from "@waitron/reporting";
import { readVenueClock } from "@waitron/db";
import {
  and,
  asc,
  between,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  billAdvances,
  billPayments,
  invoiceSeries,
  saleLines,
  sales,
  saleSubstitutions,
  saleVoids,
  type Transaction,
} from "@waitron/db";
import { SQL_VARIABLE_LIMIT } from "@waitron/store";
import { advancesTakenOff } from "./advance-taken-off.js";
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
  /** On a part payment's ticket: how it was paid, and the table's ticket that took it off. */
  advance?: { paidBy: PaymentMethod; takenOffBy: string | null };
  /** On a table's ticket (never a corrective): the part payments it took off. */
  takesOff?: string[];
}

type PaymentMethod = (typeof billPayments.$inferSelect)["method"];

export interface AccountantExport {
  invoices: readonly AccountantInvoice[];
  purchases: readonly PurchaseInvoice[];
  outsidePayments: readonly OutsidePayment[];
}

function paymentOnAccount(
  invoice: AccountantInvoice,
  words: (typeof ACCOUNTANT_EXPORT_WORDS)["en" | "es"],
): string | null {
  if (invoice.takesOff !== undefined)
    return words.takesOff.replace("{numbers}", () => invoice.takesOff!.join(", "));
  if (invoice.advance === undefined) return null;
  const paid = words.paymentMethods[invoice.advance.paidBy];
  const takenOffBy = invoice.advance.takenOffBy;
  return takenOffBy === null
    ? paid
    : `${paid}; ${words.takenOffBy.replace("{number}", () => takenOffBy)}`;
}

/**
 * The part payments among, or taken off by, the sales `saleIds`: how each was paid and the table's
 * ticket that took it off ({@link advancesTakenOff}), and each such ticket's part payments, in
 * the order they were issued. One read per half {@link SQL_VARIABLE_LIMIT} sales (each id is bound
 * twice), then one per {@link SQL_VARIABLE_LIMIT} part payments.
 */
async function readPaymentsOnAccount(
  tx: Transaction,
  saleIds: readonly string[],
): Promise<{
  advances: Map<string, NonNullable<AccountantInvoice["advance"]>>;
  takesOff: Map<string, string[]>;
}> {
  const found = new Map<string, { number: string; paidBy: PaymentMethod }>();
  const half = Math.floor(SQL_VARIABLE_LIMIT / 2);
  for (let start = 0; start < saleIds.length; start += half) {
    const chunk = saleIds.slice(start, start + half);
    const rows = await tx
      .select({
        saleId: billAdvances.advanceSaleId,
        code: invoiceSeries.code,
        number: sales.invoiceNumber,
        method: billPayments.method,
      })
      .from(billAdvances)
      .innerJoin(sales, eq(sales.id, billAdvances.advanceSaleId))
      .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
      .innerJoin(billPayments, eq(billPayments.id, billAdvances.billPaymentId))
      .where(
        or(
          inArray(billAdvances.advanceSaleId, chunk),
          inArray(
            billAdvances.advanceSaleId,
            tx
              .select({ id: saleLines.deductsSaleId })
              .from(saleLines)
              .where(inArray(saleLines.saleId, chunk)),
          ),
        ),
      )
      .orderBy(asc(sales.issuedAt), asc(sales.invoiceNumber));
    for (const row of rows)
      found.set(row.saleId, {
        number: formatInvoiceNumber(row.code, row.number),
        paidBy: row.method,
      });
  }
  const ids = [...found.keys()];
  const taken = new Map<string, { saleId: string; invoiceNumber: string }>();
  for (let start = 0; start < ids.length; start += SQL_VARIABLE_LIMIT)
    for (const [id, final] of await advancesTakenOff(
      tx,
      ids.slice(start, start + SQL_VARIABLE_LIMIT),
    ))
      taken.set(id, final);
  const advances = new Map<string, NonNullable<AccountantInvoice["advance"]>>();
  const takesOff = new Map<string, string[]>();
  for (const [id, advance] of found) {
    const final = taken.get(id);
    advances.set(id, {
      paidBy: advance.paidBy,
      takenOffBy: final?.invoiceNumber ?? null,
    });
    if (final !== undefined)
      takesOff.set(final.saleId, [...(takesOff.get(final.saleId) ?? []), advance.number]);
  }
  return { advances, takesOff };
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
    const onAccount = paymentOnAccount(invoice, words);
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
        ...(onAccount === null
          ? invoice.saleDate === undefined
            ? []
            : [invoice.saleDate]
          : [invoice.saleDate ?? null, onAccount]),
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
      rows: [
        [...words.invoiceColumns, words.saleDateColumn, words.paymentOnAccountColumn],
        ...invoiceRows,
      ],
    },
    { name: words.purchaseSheet, rows: [words.purchaseColumns, ...purchaseRows] },
    { name: words.outsideSheet, rows: [words.outsideColumns, ...outsideRows] },
  ]);
}

/**
 * The civil date `"YYYY-MM-DD"` the accountant workbook lists a sale under: the `supply_day` of the
 * replacement that repeats it, else its own `supply_day`, else its filed issue date. Where a sale's
 * VAT counts in a return is `vatMovements`'s rule, not this.
 */
function saleVatDay(sale: {
  replacementSupplyDay: SQLWrapper;
  supplyDay: SQLWrapper;
  issuedAt: SQLWrapper;
  issuedOffsetMinutes: SQLWrapper;
}): SQL<string> {
  const filedDate = stampDate(sale.issuedAt, sale.issuedOffsetMinutes);
  return sql<string>`coalesce(${sale.replacementSupplyDay}, ${sale.supplyDay}, ${filedDate})`;
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
  const onAccount = await readPaymentsOnAccount(
    tx,
    invoices.map((invoice) => invoice.id),
  );
  for (const invoice of invoices) {
    const advance = onAccount.advances.get(invoice.id);
    if (advance !== undefined) invoice.advance = advance;
    const takesOff = onAccount.takesOff.get(invoice.id);
    if (takesOff !== undefined) invoice.takesOff = takesOff;
  }
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
