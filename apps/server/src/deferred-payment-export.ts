import { and, asc, between, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  correctivesOf,
  invoiceSeries,
  sales,
  deferredClosures,
  type Transaction,
} from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import { centsToDecimal, decimal, sumDecimals, toScale, type Decimal } from "@waitron/shared";
import { csvCell } from "./attendance-export-csv.js";
import { DEFERRED_PAYMENT_EXPORT_WORDS } from "./i18n/deferred-payment-export.js";

/** Written without the shared cell's formula guard, so a negative amount stays a number in a
 * spreadsheet; the text is digits, a sign and a decimal mark, so it needs no escaping. */
function amountCell(value: Decimal, language: "en" | "es"): string {
  const text = toScale(value, 2);
  return `"${language === "es" ? text.replace(".", ",") : text}"`;
}

export interface DeferredPaymentInvoice {
  invoiceNumber: string;
  invoiceType: "F1" | "F2";
  issueDate: string;
  closedOn: string;
  recipientName: string | null;
  recipientTaxId: string | null;
  base: Decimal;
  vat: Decimal;
  total: Decimal;
  correctedBy: string[];
  correctionsTotal: Decimal;
  /** The replacement's number; its total repeats the invoice's and is in no column. */
  replacedBy: string | null;
}

function moneySum(values: readonly string[]): Decimal {
  return toScale(sumDecimals(values.map(decimal)), 2);
}

/** Every invoice whose bill was closed as a deferred payment on a business day in the range,
 * venue-wide. */
export async function listDeferredPaymentInvoices(
  tx: Transaction,
  range: { from: string; to: string },
): Promise<DeferredPaymentInvoice[]> {
  const inRange = between(deferredClosures.businessDay, range.from, range.to);
  const rows = await tx
    .select({
      saleId: sales.id,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
      issuedAt: sales.issuedAt,
      offset: sales.issuedOffsetMinutes,
      closedOn: deferredClosures.businessDay,
      recipientName: sales.counterpartyLegalName,
      recipientTaxId: sales.counterpartyTaxId,
      vatBreakdown: sales.vatBreakdown,
      total: sales.total,
    })
    .from(deferredClosures)
    .innerJoin(sales, eq(sales.id, deferredClosures.saleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(inRange)
    .orderBy(
      asc(deferredClosures.businessDay),
      asc(deferredClosures.closedAt),
      asc(deferredClosures.id),
    );

  // No date limit on the corrections: one issued weeks after the close is still named.
  const correction = alias(sales, "correction");
  const correctionSeries = alias(invoiceSeries, "correction_series");
  const correctives = await tx
    .select({
      saleId: deferredClosures.saleId,
      code: correctionSeries.code,
      number: correction.invoiceNumber,
      total: correction.total,
      replacesOriginal: correction.replacesOriginal,
    })
    .from(deferredClosures)
    .innerJoin(
      correction,
      or(
        correctivesOf(sql`${correction}`, sql`${deferredClosures.saleId}`),
        and(
          eq(correction.correctsSaleId, deferredClosures.saleId),
          eq(correction.replacesOriginal, true),
        ),
      ),
    )
    .innerJoin(correctionSeries, eq(correctionSeries.id, correction.seriesId))
    .where(inRange)
    .orderBy(asc(correction.issuedAt), asc(correction.id));
  const replacedBy = new Map(
    correctives
      .filter((row) => row.replacesOriginal)
      .map((row) => [row.saleId, formatInvoiceNumber(row.code, row.number)]),
  );
  const bySale = new Map<string, { numbers: string[]; totals: Decimal[] }>();
  for (const row of correctives.filter((row) => !row.replacesOriginal)) {
    const entry = bySale.get(row.saleId) ?? { numbers: [], totals: [] };
    entry.numbers.push(formatInvoiceNumber(row.code, row.number));
    entry.totals.push(centsToDecimal(row.total));
    bySale.set(row.saleId, entry);
  }

  return rows.map((row) => {
    const corrected = bySale.get(row.saleId);
    return {
      invoiceNumber: formatInvoiceNumber(row.code, row.number),
      invoiceType: row.recipientTaxId === null ? "F2" : "F1",
      issueDate: new Date(Date.parse(row.issuedAt) + row.offset * 60_000)
        .toISOString()
        .slice(0, 10),
      closedOn: row.closedOn,
      recipientName: row.recipientName,
      recipientTaxId: row.recipientTaxId,
      base: moneySum(row.vatBreakdown.map((rate) => rate.base)),
      vat: moneySum(row.vatBreakdown.map((rate) => rate.tax)),
      total: centsToDecimal(row.total),
      correctedBy: corrected?.numbers ?? [],
      correctionsTotal: moneySum(corrected?.totals ?? []),
      replacedBy: replacedBy.get(row.saleId) ?? null,
    };
  });
}

function dayCell(isoDay: string): string {
  const [year, month, day] = isoDay.split("-");
  return csvCell(`${day}/${month}/${year}`);
}

export function renderDeferredPaymentCsv(
  rows: readonly DeferredPaymentInvoice[],
  language: "en" | "es",
): Uint8Array<ArrayBuffer> {
  const w = DEFERRED_PAYMENT_EXPORT_WORDS[language];
  const lines = [
    [
      w.invoiceNumber,
      w.invoiceType,
      w.issueDate,
      w.closedOn,
      w.recipientName,
      w.recipientTaxId,
      w.base,
      w.vat,
      w.total,
      w.correctedBy,
      w.correctionsTotal,
      w.replacedBy,
    ]
      .map(csvCell)
      .join(","),
  ];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.invoiceNumber),
        csvCell(row.invoiceType),
        dayCell(row.issueDate),
        dayCell(row.closedOn),
        csvCell(row.recipientName ?? ""),
        csvCell(row.recipientTaxId ?? ""),
        amountCell(row.base, language),
        amountCell(row.vat, language),
        amountCell(row.total, language),
        csvCell(row.correctedBy.join(" ")),
        amountCell(row.correctionsTotal, language),
        csvCell(row.replacedBy ?? ""),
      ].join(","),
    );
  }
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}
