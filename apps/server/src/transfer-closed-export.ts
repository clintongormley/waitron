import { asc, between, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { invoiceSeries, sales, transferClosures, type Transaction } from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import { centsToDecimal, decimal, sumDecimals, toScale, type Decimal } from "@waitron/shared";

export interface TransferClosedInvoice {
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
}

function moneySum(values: readonly string[]): Decimal {
  return toScale(sumDecimals(values.map(decimal)), 2);
}

/** Every invoice whose bill was closed by transfer on a business day in the range, venue-wide. */
export async function listTransferClosedInvoices(
  tx: Transaction,
  range: { from: string; to: string },
): Promise<TransferClosedInvoice[]> {
  const inRange = between(transferClosures.businessDay, range.from, range.to);
  const rows = await tx
    .select({
      saleId: sales.id,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
      issuedAt: sales.issuedAt,
      offset: sales.issuedOffsetMinutes,
      closedOn: transferClosures.businessDay,
      recipientName: sales.counterpartyLegalName,
      recipientTaxId: sales.counterpartyTaxId,
      vatBreakdown: sales.vatBreakdown,
      total: sales.total,
    })
    .from(transferClosures)
    .innerJoin(sales, eq(sales.id, transferClosures.saleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(inRange)
    .orderBy(
      asc(transferClosures.businessDay),
      asc(transferClosures.closedAt),
      asc(transferClosures.id),
    );

  // No date limit on the corrections: one issued weeks after the close is still named.
  const correction = alias(sales, "correction");
  const correctionSeries = alias(invoiceSeries, "correction_series");
  const corrections = await tx
    .select({
      saleId: transferClosures.saleId,
      code: correctionSeries.code,
      number: correction.invoiceNumber,
      total: correction.total,
    })
    .from(transferClosures)
    .innerJoin(correction, eq(correction.correctsSaleId, transferClosures.saleId))
    .innerJoin(correctionSeries, eq(correctionSeries.id, correction.seriesId))
    .where(inRange)
    .orderBy(asc(correction.issuedAt), asc(correction.id));
  const bySale = new Map<string, { numbers: string[]; totals: Decimal[] }>();
  for (const row of corrections) {
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
    };
  });
}
