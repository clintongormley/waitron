import { and, eq, isNull } from "drizzle-orm";
import { invoiceSeries, saleLines, sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { deriveVatBreakdown, recordCorrection, settleSale } from "@waitron/core";
import type { RecordSaleLine } from "@waitron/core";
import type { FiscalBackend, TrustedClock, VatBreakdownLine } from "@waitron/fiscal";
import {
  AppError,
  basisPointsToDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  negateDecimal,
  seriesId as brandSeriesId,
  sumDecimals,
  thousandthsToDecimal,
} from "@waitron/shared";
import type { Decimal, SaleId, SeriesId } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

type StoredBreakdown = { rate: string; base: string; tax: string }[];

/**
 * Credit the whole of an issued invoice with a corrective invoice in the node's live rectificative
 * series, its lines the invoice's with their signs reversed, then settle the invoice owing nothing.
 * `recordCorrection` checks `sale.rectify` against `sessionId`.
 */
export async function creditWholeInvoice(
  tx: Transaction,
  deps: { backend: FiscalBackend; clock: TrustedClock },
  cfg: TillConfig,
  saleId: SaleId,
  sessionId: string,
): Promise<void> {
  const seriesId = await liveRectificativeSeries(tx, cfg);
  const [invoice] = await tx
    .select({ total: sales.total, vatBreakdown: sales.vatBreakdown })
    .from(sales)
    .where(eq(sales.id, saleId));
  const total = centsToDecimal(-invoice!.total);
  const lines = reversedLines(
    await tx.select().from(saleLines).where(eq(saleLines.saleId, saleId)).orderBy(saleLines.lineNo),
  );
  refuseUnmirroredBreakdown(saleId, invoice!.vatBreakdown, deriveVatBreakdown(total, lines), total);
  await recordCorrection(tx, deps.backend, {
    tillId: cfg.tillId,
    nodeId: cfg.nodeId,
    seriesId,
    correctsSaleId: saleId,
    total,
    lines,
    authz: { sessionId },
    clock: deps.clock,
  });
  await settleSale(tx, { saleId, tenders: [] });
}

/** The node's one live rectificative series; two would make the credit's number a guess. */
async function liveRectificativeSeries(tx: Transaction, cfg: TillConfig): Promise<SeriesId> {
  const [row, extra] = await tx
    .select({ id: invoiceSeries.id })
    .from(invoiceSeries)
    .where(
      and(
        eq(invoiceSeries.nodeId, cfg.nodeId),
        eq(invoiceSeries.purpose, "rectificative"),
        isNull(invoiceSeries.retiredAt),
      ),
    )
    .limit(2);
  if (row === undefined) {
    throw new AppError("series.no_rectificative_for_node", { nodeId: cfg.nodeId });
  }
  if (extra !== undefined) {
    throw new Error(`invoice_series: node ${cfg.nodeId} has more than one rectificative series`);
  }
  return brandSeriesId(row.id);
}

function reversedLines(rows: (typeof saleLines.$inferSelect)[]): RecordSaleLine[] {
  const lineNoOf = new Map(rows.map((row) => [row.id, row.lineNo]));
  return rows.map((row) => ({
    lineNo: row.lineNo,
    name: row.name,
    descriptions: row.descriptions,
    unitName: row.unitName,
    unitPrecision: row.unitPrecision,
    quantity: thousandthsToDecimal(-row.quantity),
    unitPrice: centsToDecimal(row.unitPrice),
    vatRate: basisPointsToDecimal(row.vatRate),
    lineTotal: centsToDecimal(-row.lineTotal),
    category: row.category,
    parentLineNo: row.parentLineId === null ? null : lineNoOf.get(row.parentLineId),
    optionSnapshots: row.optionSnapshots,
    variantName: row.variantName,
    variantDescriptions: row.variantDescriptions,
    variantKitchenName: row.variantKitchenName,
    kitchenName: row.kitchenName,
    productId: row.productId,
    parentProductId: row.parentProductId,
    menuId: row.menuId,
    menuVersionId: row.menuVersionId,
    lineGross: row.lineGross === null ? null : centsToDecimal(-row.lineGross),
    classification: row.classification,
  }));
}

/**
 * `recordCorrection` takes no breakdown: it derives one from the lines, taxing each rate's summed
 * base, while an invoice's breakdown is the catalogue's gross minus base. The two differ at some
 * prices: 0.55 at 21% is invoiced 0.45 + 0.10, and its reversed line derives -0.45 - 0.09
 * (measured 2026-10-02 with `rateLines` and `deriveVatBreakdown`; 2.10 at 21% gives -0.37 for 0.36).
 */
function refuseUnmirroredBreakdown(
  saleId: SaleId,
  invoice: StoredBreakdown,
  correction: VatBreakdownLine[],
  total: Decimal,
): void {
  const negated = (amount: string) => negateDecimal(decimal(amount));
  const mirrors =
    correction.length === invoice.length &&
    compareDecimal(sumDecimals(correction.flatMap((g) => [g.base, g.tax])), total) === 0 &&
    invoice.every((group) =>
      correction.some(
        (credit) =>
          compareDecimal(credit.rate, decimal(group.rate)) === 0 &&
          compareDecimal(credit.base, negated(group.base)) === 0 &&
          compareDecimal(credit.tax, negated(group.tax)) === 0,
      ),
    );
  if (!mirrors) {
    throw new AppError("sale.correction_breakdown_mismatch", { saleId, invoice, correction });
  }
}
