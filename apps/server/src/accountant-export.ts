import { listOutsidePayments, type OutsidePayment } from "./outside-payments-report.js";
import { stampDate, validatedRangeWindow } from "@waitron/reporting";
import { readVenueClock } from "@waitron/db";
import {
  and,
  asc,
  between,
  eq,
  inArray,
  isNotNull,
  isNull,
  notExists,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  billAdvances,
  billPayments,
  invoiceCorrectionRefunds,
  invoiceSeries,
  persons,
  refunds,
  saleLines,
  sales,
  saleSubstitutions,
  saleVoids,
  type Transaction,
} from "@waitron/db";
import { SQL_VARIABLE_LIMIT } from "@waitron/store";
import { advancesTakenOff, type TakenOffBy } from "./advance-taken-off.js";
import { formatInvoiceNumber } from "@waitron/core";
import { listPurchaseInvoices } from "@waitron/purchasing";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { PurchaseInvoice } from "@waitron/purchasing";
import {
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
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
  advance?: AdvanceCell;
  /** On a table's ticket (never a corrective): the part payments it took off. */
  takesOff?: string[];
}

type PaymentMethod = (typeof billPayments.$inferSelect)["method"];

export interface AdvanceCell {
  paidBy: PaymentMethod;
  takenOffBy: string | null;
}

/** A completed Refund a payment on a ticket: no corrective invoice was filed for it. */
export interface RefundWithoutCorrective {
  id: string;
  refundedAt: string;
  amount: Decimal;
  tip: Decimal;
  method: "cash" | "card";
  reason: string;
  requestedBy: string;
  authorizedBy: string;
  saleId: string;
  invoiceNumber: string;
  /** On a part payment's ticket, the table's ticket that took it off. */
  takenOffBy: string | null;
  /** The refund's share of each VAT rate of the ticket, as {@link refundVatShares} divides it. */
  vat: { rate: string; base: Decimal; tax: Decimal }[];
}

export interface AccountantExport {
  invoices: readonly AccountantInvoice[];
  purchases: readonly PurchaseInvoice[];
  outsidePayments: readonly OutsidePayment[];
  refundsWithoutCorrective: readonly RefundWithoutCorrective[];
}

/**
 * `amount` shared over a ticket's VAT rates whose gross is above zero, in proportion to that gross,
 * in whole cents: each rate takes its proportional share rounded down, and the cents left over go
 * one at a time to the rates with the largest remainders, ties to the earlier rate in the
 * breakdown, so no share is negative and the shares sum to `amount`. A rate whose gross is at or
 * below zero is left out. Within a rate the VAT is share × rate / (100 + rate), rounded to the
 * cent, and the base is the share less that VAT. A ticket with no rate above zero gives none.
 */
export function refundVatShares(
  amount: Decimal,
  breakdown: readonly { rate: string; base: string; tax: string }[],
): RefundWithoutCorrective["vat"] {
  const sold = breakdown
    .map((vat) => ({
      vat,
      gross: BigInt(decimalToCents(addDecimal(decimal(vat.base), decimal(vat.tax)))),
    }))
    .filter(({ gross }) => gross > 0n);
  if (sold.length === 0) return [];
  const whole = sold.reduce((sum, { gross }) => sum + gross, 0n);
  const cents = BigInt(decimalToCents(amount));
  const shares = sold.map(({ gross }) => ({
    cents: (cents * gross) / whole,
    remainder: (cents * gross) % whole,
  }));
  const leftover = cents - shares.reduce((sum, share) => sum + share.cents, 0n);
  const byRemainder = shares
    .map((share, index) => ({ remainder: share.remainder, index }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  for (const { index } of byRemainder.slice(0, Number(leftover))) shares[index]!.cents += 1n;
  return sold.map(({ vat }, index) => {
    const share = centsToDecimal(Number(shares[index]!.cents));
    const rate = decimal(vat.rate);
    const tax = divideDecimal(multiplyDecimal(share, rate), addDecimal(decimal("100"), rate), 2);
    return { rate: vat.rate, base: subtractDecimal(share, tax), tax };
  });
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

/** A part payment's own ticket, as {@link partPaymentsAmong} reads it. */
export interface PartPaymentRow {
  saleId: string;
  code: string;
  number: number;
  issuedAt: string;
  method: PaymentMethod;
}

/**
 * The part payments among the sales `saleIds`, or taken off by one of them. A deducting line is
 * found through `sale_lines_deducts_sale_idx`, so the read goes over every deduction line rather
 * than every line of every sale named; the box collects no planner statistics to choose it.
 */
export function partPaymentsAmong(tx: Transaction, saleIds: readonly string[]) {
  return tx
    .select({
      saleId: billAdvances.advanceSaleId,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
      issuedAt: sales.issuedAt,
      method: billPayments.method,
    })
    .from(billAdvances)
    .innerJoin(sales, eq(sales.id, billAdvances.advanceSaleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .innerJoin(billPayments, eq(billPayments.id, billAdvances.billPaymentId))
    .where(
      or(
        inArray(billAdvances.advanceSaleId, [...saleIds]),
        inArray(
          billAdvances.advanceSaleId,
          tx
            .select({ id: sql<string>`${saleLines.deductsSaleId}` })
            // Unnamed, the planner took `sale_lines_line_no_key` (node:26-slim, SQLite 3.54.1),
            // reading every line of every sale named.
            .from(sql`${saleLines} indexed by sale_lines_deducts_sale_idx`)
            .where(
              and(isNotNull(saleLines.deductsSaleId), inArray(saleLines.saleId, [...saleIds])),
            ),
        ),
      ),
    );
}

/**
 * How each part payment in `rows` was paid and the table's ticket that took it off (`takenOff`,
 * from {@link advancesTakenOff}), and each such ticket's part payments in the order they were
 * issued, whatever the order of `rows`.
 */
export function linkPaymentsOnAccount(
  rows: readonly PartPaymentRow[],
  takenOff: ReadonlyMap<string, TakenOffBy>,
): { advances: Map<string, AdvanceCell>; takesOff: Map<string, string[]> } {
  const advances = new Map<string, AdvanceCell>();
  const takesOff = new Map<string, string[]>();
  const issued = [...rows].sort((a, b) =>
    a.issuedAt < b.issuedAt ? -1 : a.issuedAt > b.issuedAt ? 1 : a.number - b.number,
  );
  for (const row of issued) {
    if (advances.has(row.saleId)) continue;
    const final = takenOff.get(row.saleId);
    advances.set(row.saleId, { paidBy: row.method, takenOffBy: final?.invoiceNumber ?? null });
    if (final !== undefined)
      takesOff.set(final.saleId, [
        ...(takesOff.get(final.saleId) ?? []),
        formatInvoiceNumber(row.code, row.number),
      ]);
  }
  return { advances, takesOff };
}

/** {@link linkPaymentsOnAccount} of the part payments among, or taken off by, the sales `saleIds`,
 * read once per half {@link SQL_VARIABLE_LIMIT} sales (each id is bound twice). */
async function readPaymentsOnAccount(
  tx: Transaction,
  saleIds: readonly string[],
): Promise<ReturnType<typeof linkPaymentsOnAccount>> {
  const rows: PartPaymentRow[] = [];
  const half = Math.floor(SQL_VARIABLE_LIMIT / 2);
  for (let start = 0; start < saleIds.length; start += half)
    rows.push(...(await partPaymentsAmong(tx, saleIds.slice(start, start + half))));
  return linkPaymentsOnAccount(
    rows,
    await advancesTakenOff(tx, [...new Set(rows.map((row) => row.saleId))]),
  );
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
    const trailing: Cell[] = [invoice.saleDate ?? null, paymentOnAccount(invoice, words)];
    // Empty trailing cells are left off rather than written blank: a missing one reads as empty.
    while (trailing.at(-1) === null) trailing.pop();
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
        ...trailing,
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
  const refundRows: Cell[][] = [];
  for (const refund of data.refundsWithoutCorrective) {
    const groups = refund.vat.length === 0 ? [null] : refund.vat;
    for (const [index, vat] of groups.entries())
      refundRows.push([
        refund.id,
        refund.refundedAt,
        index === 0 ? numeric(refund.amount) : null,
        index === 0 ? numeric(refund.tip) : null,
        words.paymentMethods[refund.method],
        refund.reason,
        refund.requestedBy,
        refund.authorizedBy,
        refund.saleId,
        refund.invoiceNumber,
        refund.takenOffBy,
        vat === null ? null : numeric(vat.rate),
        vat === null ? null : numeric(vat.base),
        vat === null ? null : numeric(vat.tax),
      ]);
  }
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
    { name: words.refundSheet, rows: [[words.refundNote], words.refundColumns, ...refundRows] },
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
  const window = validatedRangeWindow({
    fromBusinessDay: range.from,
    toBusinessDay: range.to,
    timeZone: clock.timeZone,
    dayCutover: "00:00",
    cutoverChanges: [],
  });
  const outsidePayments = await listOutsidePayments(tx, window);
  const refundsWithoutCorrective = await listRefundsWithoutCorrective(tx, window);
  return { invoices, purchases, outsidePayments, refundsWithoutCorrective };
}

/**
 * The refunds `listRefundsWithoutCorrective` reads, found by `refunds_completed_at_idx`. Unnamed, the
 * planner took `refunds_recovery_idx` on state (node:26-slim, SQLite 3.54.1), reading every
 * completed refund. Drizzle refuses a selected column of a table named only in `sql`, hence `mapWith`.
 */
export function refundsWithoutCorrectiveQuery(tx: Transaction, window: (column: SQL) => SQL) {
  const requester = alias(persons, "requester");
  const authorizer = alias(persons, "authorizer");
  return tx
    .select({
      id: sql`${refunds.id}`.mapWith(refunds.id),
      refundedAt: sql<string>`${refunds.completedAt}`,
      applied: sql`${refunds.appliedAmount}`.mapWith(refunds.appliedAmount),
      tip: sql`${refunds.tipAmount}`.mapWith(refunds.tipAmount),
      method: sql`${refunds.method}`.mapWith(refunds.method),
      reason: sql`${refunds.reason}`.mapWith(refunds.reason),
      requestedBy: requester.displayName,
      authorizedBy: authorizer.displayName,
      saleId: sql<string>`${refunds.saleId}`,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
      vatBreakdown: sales.vatBreakdown,
    })
    .from(sql`${refunds} indexed by refunds_completed_at_idx`)
    .innerJoin(sales, eq(sales.id, refunds.saleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .innerJoin(requester, eq(requester.id, refunds.requestedBy))
    .innerJoin(authorizer, eq(authorizer.id, refunds.authorizedBy))
    .where(
      and(
        eq(refunds.state, "completed"),
        window(sql`${refunds.completedAt}`),
        notExists(
          tx
            .select({ id: invoiceCorrectionRefunds.id })
            .from(invoiceCorrectionRefunds)
            .where(eq(invoiceCorrectionRefunds.tenderRefundId, refunds.id)),
        ),
      ),
    )
    .orderBy(asc(refunds.completedAt), asc(refunds.id));
}

/**
 * Refunds of a ticket's payment completed within `window`, by calendar date, that are not part of
 * a Correct invoice. A bill refund is never listed: what it gives back is owed on the bill again.
 */
async function listRefundsWithoutCorrective(
  tx: Transaction,
  window: (column: SQL) => SQL,
): Promise<RefundWithoutCorrective[]> {
  const rows = await refundsWithoutCorrectiveQuery(tx, window);
  const takenOff = await advancesTakenOff(tx, [...new Set(rows.map((row) => row.saleId))]);
  return rows.map(({ applied, tip, code, number, vatBreakdown, ...row }) => {
    const amount = centsToDecimal(applied);
    return {
      ...row,
      amount,
      tip: centsToDecimal(tip),
      invoiceNumber: formatInvoiceNumber(code, number),
      takenOffBy: takenOff.get(row.saleId)?.invoiceNumber ?? null,
      vat: refundVatShares(amount, vatBreakdown),
    };
  });
}
