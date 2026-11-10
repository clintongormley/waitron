import { eq } from "drizzle-orm";
import { saleLines, sales, type Transaction } from "@waitron/db";
import {
  AppError,
  basisPointsToDecimal,
  centsToDecimal,
  decimal,
  decimalToBasisPoints,
  decimalToCents,
  thousandthsToDecimal,
  type SaleId,
} from "@waitron/shared";
import type {
  CorrectionAmountAllocation,
  CorrectionAmountHistory,
} from "./correction-allocation.js";
import type { RecordSaleLine } from "./record-sale.js";
import "./errors.js";

/**
 * What a paid invoice holds and what every earlier correction of it took, whatever that
 * correction's filing state, for `allocateCorrectionAmounts`. Refused with
 * `sale.correction_history_unusable` when what is stored cannot be read as amounts: the sale is
 * itself a correction, a line has no stored gross, an earlier correction's line names no invoice
 * line, or an earlier correction's lines disagree with its own stored split, which the writer
 * would later check a new split against.
 */
export async function readCorrectionAmountHistory(
  tx: Transaction,
  saleId: SaleId,
): Promise<CorrectionAmountHistory> {
  const [sale] = await tx
    .select({ correctsSaleId: sales.correctsSaleId, vatBreakdown: sales.vatBreakdown })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale === undefined) throw new AppError("sale.not_found", { saleId });
  if (sale.correctsSaleId !== null) unusable();

  const lines = await tx
    .select({
      id: saleLines.id,
      lineNo: saleLines.lineNo,
      vatRate: saleLines.vatRate,
      lineTotal: saleLines.lineTotal,
      lineGross: saleLines.lineGross,
    })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  const corrections = await tx
    .select({ id: sales.id, vatBreakdown: sales.vatBreakdown })
    .from(sales)
    .where(eq(sales.correctsSaleId, saleId));
  const earlierLines = await tx
    .select({
      saleId: saleLines.saleId,
      correctsLineId: saleLines.correctsLineId,
      vatRate: saleLines.vatRate,
      lineTotal: saleLines.lineTotal,
      lineGross: saleLines.lineGross,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(eq(sales.correctsSaleId, saleId))
    .orderBy(saleLines.saleId, saleLines.lineNo);

  if (lines.some((line) => line.lineGross === null)) unusable();
  if (earlierLines.some((line) => line.lineGross === null || line.correctsLineId === null)) {
    unusable();
  }
  for (const correction of corrections) {
    const groups = new Map<number, { base: number; gross: number }>();
    for (const line of earlierLines.filter((entry) => entry.saleId === correction.id)) {
      const group = groups.get(line.vatRate) ?? { base: 0, gross: 0 };
      groups.set(line.vatRate, {
        base: group.base + line.lineTotal,
        gross: group.gross + line.lineGross!,
      });
    }
    for (const stored of correction.vatBreakdown) {
      const rate = decimalToBasisPoints(decimal(stored.rate));
      const base = decimalToCents(decimal(stored.base));
      const group = groups.get(rate);
      if (
        group === undefined ||
        group.base !== base ||
        group.gross !== base + decimalToCents(decimal(stored.tax))
      ) {
        unusable();
      }
      groups.delete(rate);
    }
    if (groups.size > 0) unusable();
  }

  return {
    lines: lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      rate: basisPointsToDecimal(line.vatRate),
      gross: centsToDecimal(line.lineGross!),
      base: centsToDecimal(line.lineTotal),
    })),
    vatBreakdown: sale.vatBreakdown.map((group) => ({
      rate: decimal(group.rate),
      base: decimal(group.base),
      tax: decimal(group.tax),
    })),
    consumed: earlierLines.map((line) => ({
      saleLineId: line.correctsLineId!,
      rate: basisPointsToDecimal(line.vatRate),
      gross: centsToDecimal(-line.lineGross!),
      base: centsToDecimal(-line.lineTotal),
      tax: centsToDecimal(line.lineTotal - line.lineGross!),
    })),
  };
}

/**
 * The lines of a correction taking `allocations` from the invoice whose stored lines are
 * `invoiceLines`, in allocation order. The quantity is the invoice line's, negated: an amount
 * correction's quantity is the scope shown, never units returned.
 */
export function correctionLinesFor(
  invoiceLines: readonly (typeof saleLines.$inferSelect)[],
  allocations: readonly CorrectionAmountAllocation[],
): RecordSaleLine[] {
  const byId = new Map(invoiceLines.map((line) => [line.id, line]));
  return allocations.map((allocation, index) => {
    const line = byId.get(allocation.saleLineId)!;
    return {
      lineNo: index + 1,
      name: line.name,
      descriptions: line.descriptions,
      unitName: line.unitName,
      unitPrecision: line.unitPrecision,
      quantity: thousandthsToDecimal(-line.quantity),
      priceQuantity: thousandthsToDecimal(line.priceQuantity),
      unitPrice: centsToDecimal(line.unitPrice),
      vatRate: basisPointsToDecimal(line.vatRate),
      lineTotal: centsToDecimal(-decimalToCents(allocation.base)),
      lineGross: centsToDecimal(-decimalToCents(allocation.gross)),
      optionSnapshots: line.optionSnapshots,
      variantName: line.variantName,
      variantDescriptions: line.variantDescriptions,
      variantKitchenName: line.variantKitchenName,
      correctsLineId: line.id,
    };
  });
}

function unusable(): never {
  throw new AppError("sale.correction_history_unusable", {});
}
