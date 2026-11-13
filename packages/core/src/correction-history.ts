import { eq } from "drizzle-orm";
import { saleLines, sales, saleSubstitutions, type Transaction } from "@waitron/db";
import type { CorrectionAdmission, FiledFigures, FiscalBackend } from "@waitron/fiscal";
import {
  AppError,
  basisPointsToDecimal,
  centsToDecimal,
  decimal,
  decimalToBasisPoints,
  decimalToCents,
  thousandthsToDecimal,
  type Decimal,
  type NodeId,
  type SaleId,
} from "@waitron/shared";
import {
  allocateCorrectionAmounts,
  type CorrectionAmountAllocation,
  type CorrectionAmountHistory,
  type CorrectionAmountPreview,
  remainingLines,
} from "./correction-allocation.js";
import { requireSupportedCorrection } from "./correction-eligibility.js";
import type { RecordSaleLine } from "./record-sale.js";
import "./errors.js";

type InvoiceLine = typeof saleLines.$inferSelect;

export type CorrectionPreview = CorrectionAmountPreview &
  Omit<Extract<CorrectionAdmission, { eligible: true }>, "eligible"> & { lines: RecordSaleLine[] };

/**
 * What a correction of `selection.gross` from the invoice `saleId`, issued by `issuingNodeId`, would
 * file, as the lines and split `recordCorrection` takes. Refused with
 * `sale.correction_not_admitted` when the invoice was replaced by a full invoice, its regime does
 * not admit a correction of it, or the regime's newest filed figures of it or of an earlier
 * correction cannot be read or differ from the stored ones; refused with
 * `sale.correction_unsupported`, as `recordCorrection` is, when the invoice names a customer.
 */
export async function previewCorrectionAmounts(
  tx: Transaction,
  backend: FiscalBackend,
  saleId: SaleId,
  issuingNodeId: NodeId,
  selection: { gross: Decimal; lineIds?: readonly string[] },
): Promise<CorrectionPreview> {
  const { admission, history, invoiceLines } = await admittedHistory(
    tx,
    backend,
    saleId,
    issuingNodeId,
  );
  const preview = allocateCorrectionAmounts(history, selection);
  return {
    ...preview,
    filing: admission.filing,
    original: admission.original,
    lines: correctionLinesFor(invoiceLines, preview.allocations),
  };
}

export interface CorrectableLine {
  id: string;
  lineNo: number;
  descriptions: Record<string, string>;
  rate: Decimal;
  gross: Decimal;
  left: Decimal;
}

/** The invoice's lines with what is left to correct of each, refused as
 * `previewCorrectionAmounts` refuses the invoice. */
export async function readCorrectableLines(
  tx: Transaction,
  backend: FiscalBackend,
  saleId: SaleId,
  issuingNodeId: NodeId,
): Promise<CorrectableLine[]> {
  const { history, invoiceLines } = await admittedHistory(tx, backend, saleId, issuingNodeId);
  const left = new Map(remainingLines(history).map((line) => [line.id, line.gross]));
  const byId = new Map(invoiceLines.map((line) => [line.id, line]));
  return history.lines.map((line) => ({
    id: line.id,
    lineNo: line.lineNo,
    descriptions: byId.get(line.id)!.descriptions,
    rate: line.rate,
    gross: line.gross,
    left: left.get(line.id)!,
  }));
}

async function admittedHistory(
  tx: Transaction,
  backend: FiscalBackend,
  saleId: SaleId,
  issuingNodeId: NodeId,
) {
  const [substituted] = await tx
    .select({ id: saleSubstitutions.id })
    .from(saleSubstitutions)
    .where(eq(saleSubstitutions.substitutedSaleId, saleId));
  if (substituted !== undefined) {
    throw new AppError("sale.correction_not_admitted", { reason: "replaced" });
  }
  const admission: CorrectionAdmission = backend.correctionAdmissionFor
    ? await backend.correctionAdmissionFor(tx, saleId, issuingNodeId)
    : { eligible: false, reason: "unsupported" };
  if (!admission.eligible) {
    throw new AppError("sale.correction_not_admitted", { reason: admission.reason });
  }
  const stored = await readStored(tx, saleId);
  requireSupportedCorrection(stored.sale.counterpartyTaxId, saleId);
  await refuseMovedFigures(tx, backend, [stored.sale, ...stored.corrections]);
  return { admission, ...(await readHistory(tx, saleId, stored)) };
}

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
  return (await readHistory(tx, saleId)).history;
}

type StoredFigures = Pick<typeof sales.$inferSelect, "id" | "total" | "vatBreakdown">;

/** The invoice's and its earlier corrections' stored figures; refused when the sale is unknown or
 * is itself a correction. */
async function readStored(
  tx: Transaction,
  saleId: SaleId,
): Promise<{
  sale: StoredFigures & Pick<typeof sales.$inferSelect, "counterpartyTaxId">;
  corrections: StoredFigures[];
}> {
  const figures = { id: sales.id, total: sales.total, vatBreakdown: sales.vatBreakdown };
  const [sale] = await tx
    .select({
      ...figures,
      correctsSaleId: sales.correctsSaleId,
      counterpartyTaxId: sales.counterpartyTaxId,
    })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale === undefined) throw new AppError("sale.not_found", { saleId });
  if (sale.correctsSaleId !== null) unusable();
  const corrections = await tx.select(figures).from(sales).where(eq(sales.correctsSaleId, saleId));
  return { sale, corrections };
}

/**
 * Refuses unless the regime reads each sale's newest filed figures and they equal the stored
 * ones: the same total, and at each rate, the same base and VAT.
 */
async function refuseMovedFigures(
  tx: Transaction,
  backend: FiscalBackend,
  stored: readonly StoredFigures[],
): Promise<void> {
  const ids = stored.map((sale) => sale.id as SaleId);
  const filed = backend.filedFiguresFor ? await backend.filedFiguresFor(tx, ids) : new Map();
  for (const sale of stored) {
    const figures: FiledFigures | undefined = filed.get(sale.id as SaleId);
    if (figures === undefined || !figures.readable) {
      throw new AppError("sale.correction_not_admitted", { reason: "filed_figures_unreadable" });
    }
    const { newest } = figures;
    const splitOf = (split: readonly { rate: string; base: string; tax: string }[]) =>
      new Map(
        split.map((line) => [
          decimalToBasisPoints(decimal(line.rate)),
          [decimalToCents(decimal(line.base)), decimalToCents(decimal(line.tax))].join(),
        ]),
      );
    const storedSplit = splitOf(sale.vatBreakdown);
    const filedSplit = splitOf(newest.vatBreakdown);
    if (
      decimalToCents(newest.total) !== sale.total ||
      storedSplit.size !== filedSplit.size ||
      [...storedSplit].some(([rate, amounts]) => filedSplit.get(rate) !== amounts)
    ) {
      throw new AppError("sale.correction_not_admitted", { reason: "filed_figures_changed" });
    }
  }
}

async function readHistory(
  tx: Transaction,
  saleId: SaleId,
  stored?: Awaited<ReturnType<typeof readStored>>,
): Promise<{ history: CorrectionAmountHistory; invoiceLines: InvoiceLine[] }> {
  const { sale, corrections } = stored ?? (await readStored(tx, saleId));

  const lines = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
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

  const history: CorrectionAmountHistory = {
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
  return { history, invoiceLines: lines };
}

/**
 * The lines of a correction taking `allocations` from the invoice whose stored lines are
 * `invoiceLines`, in allocation order. The quantity is the invoice line's, negated: an amount
 * correction's quantity is the scope shown, never units returned. The list gross is a line amount,
 * not a frozen fact, so it is left out; an extra points at its dish only when the dish is corrected
 * too.
 */
export function correctionLinesFor(
  invoiceLines: readonly InvoiceLine[],
  allocations: readonly CorrectionAmountAllocation[],
): RecordSaleLine[] {
  const byId = new Map(invoiceLines.map((line) => [line.id, line]));
  const lineNoOf = new Map(
    allocations.map((allocation, index) => [allocation.saleLineId, index + 1]),
  );
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
      category: line.category,
      kitchenName: line.kitchenName,
      productId: line.productId,
      parentProductId: line.parentProductId,
      menuId: line.menuId,
      menuVersionId: line.menuVersionId,
      listGross: null,
      listUnitPriceGross:
        line.listUnitPriceGross === null ? null : centsToDecimal(line.listUnitPriceGross),
      classification: line.classification,
      parentLineNo: line.parentLineId === null ? null : (lineNoOf.get(line.parentLineId) ?? null),
      correctsLineId: line.id,
    } satisfies Required<RecordSaleLine>;
  });
}

function unusable(): never {
  throw new AppError("sale.correction_history_unusable", {});
}
