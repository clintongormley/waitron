import { eq } from "drizzle-orm";
import { saleLines, sales, saleSubstitutions, type Transaction } from "@waitron/db";
import type { CorrectionAdmission, FiscalBackend } from "@waitron/fiscal";
import {
  AppError,
  addDecimal,
  basisPointsToDecimal,
  centsToDecimal,
  decimal,
  decimalToBasisPoints,
  decimalToCents,
  negateDecimal,
  subtractDecimal,
  sumDecimals,
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
} from "./correction-allocation.js";
import { requireSupportedCorrection } from "./correction-eligibility.js";
import {
  measuredFigures,
  type Figures,
  type MeasuredSale,
  type StoredSaleFigures,
} from "./filed-figures.js";
import type { RecordSaleLine } from "./record-sale.js";
import "./errors.js";

type InvoiceLine = typeof saleLines.$inferSelect;

export type CorrectionPreview = CorrectionAmountPreview &
  Omit<Extract<CorrectionAdmission, { eligible: true }>, "eligible"> & { lines: RecordSaleLine[] };

/**
 * What a correction of `selection.gross` from the invoice `saleId`, issued by `issuingNodeId`, would
 * file, as the lines and split `recordCorrection` takes. Refused with
 * `sale.correction_not_admitted` when the invoice was replaced by a full invoice, its regime does
 * not admit a correction of it, the regime cannot read the filed figures of it or of an earlier
 * correction (`filed_figures_unreadable`), or a newest version of them whose figures are not the
 * measured ones (the newest answered version's, else the stored ones) still waits for the regime's
 * answer (`filed_figures_unanswered`); refused with
 * `sale.correction_unsupported`, as
 * `recordCorrection` is, when the invoice names a customer. When the answered figures differ from
 * the stored ones, the split is worked out from the answered figures and the lines from the stored
 * ones, and `sale.correction_scope_invalid` refuses a request naming lines (`filed_split_changed`)
 * and, when the answered total left is not what the lines have left, any amount but the whole of
 * it (`filed_total_changed`); the lines then take everything they have left, so their gross is not
 * `gross`.
 */
export async function previewCorrectionAmounts(
  tx: Transaction,
  backend: FiscalBackend,
  saleId: SaleId,
  issuingNodeId: NodeId,
  selection: { gross: Decimal; lineIds?: readonly string[] },
): Promise<CorrectionPreview> {
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
  const figures = await measuredFigures(tx, backend, [stored.sale, ...stored.corrections]);
  if (!figures.readable) {
    throw new AppError("sale.correction_not_admitted", { reason: "filed_figures_unreadable" });
  }
  if (!figures.moved) {
    const { history, invoiceLines } = await readHistory(tx, saleId, stored);
    const preview = allocateCorrectionAmounts(history, selection);
    return {
      ...preview,
      filing: admission.filing,
      original: admission.original,
      lines: correctionLinesFor(invoiceLines, preview.allocations),
    };
  }
  if (selection.lineIds !== undefined) {
    throw new AppError("sale.correction_scope_invalid", { reason: "filed_split_changed" });
  }
  const { history, invoiceLines } = await readHistory(tx, saleId, stored, { moved: true });
  const linesRemaining = decimalToCents(
    subtractDecimal(
      sumDecimals(history.lines.map((line) => line.gross)),
      sumDecimals(history.consumed.map((allocation) => allocation.gross)),
    ),
  );
  const inTotal = figures.measuredRemaining !== linesRemaining;
  if (inTotal && decimalToCents(selection.gross) !== figures.measuredRemaining) {
    throw new AppError("sale.correction_scope_invalid", { reason: "filed_total_changed" });
  }
  const [invoice, ...corrections] = figures.sales;
  const split = splitHistory(invoice!.measured.vatBreakdown, corrections);
  const { gross, vatBreakdown } = allocateCorrectionAmounts(split, {
    gross: selection.gross,
    lineIds: split.lines.map((line) => line.id),
  });
  const { allocations } = allocateCorrectionAmounts(history, {
    gross: inTotal ? centsToDecimal(linesRemaining) : selection.gross,
    lineIds: history.lines.map((line) => line.id),
  });
  return {
    gross,
    vatBreakdown,
    allocations,
    filing: admission.filing,
    original: admission.original,
    lines: correctionLinesFor(invoiceLines, allocations),
  };
}

/** One stand-in line per rate of the invoice's measured split, with what each earlier
 * correction's measured split took from that rate, for working out a moved invoice's split. */
function splitHistory(
  invoiceSplit: Figures["vatBreakdown"],
  corrections: readonly MeasuredSale[],
): CorrectionAmountHistory {
  const standIn = (rate: string) => `rate:${decimalToBasisPoints(decimal(rate))}`;
  return {
    lines: invoiceSplit.map((group, index) => ({
      id: standIn(group.rate),
      lineNo: index + 1,
      rate: decimal(group.rate),
      gross: addDecimal(decimal(group.base), decimal(group.tax)),
      base: decimal(group.base),
    })),
    vatBreakdown: invoiceSplit.map((group) => ({
      rate: decimal(group.rate),
      base: decimal(group.base),
      tax: decimal(group.tax),
    })),
    consumed: corrections.flatMap((correction) =>
      correction.measured.vatBreakdown.map((group) => ({
        saleLineId: standIn(group.rate),
        rate: decimal(group.rate),
        gross: negateDecimal(addDecimal(decimal(group.base), decimal(group.tax))),
        base: negateDecimal(decimal(group.base)),
        tax: negateDecimal(decimal(group.tax)),
      })),
    ),
  };
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

/** The invoice's and its earlier corrections' stored figures; refused when the sale is unknown or
 * is itself a correction. */
async function readStored(
  tx: Transaction,
  saleId: SaleId,
): Promise<{
  sale: StoredSaleFigures & Pick<typeof sales.$inferSelect, "counterpartyTaxId">;
  corrections: StoredSaleFigures[];
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

/** With `moved`, an earlier correction's lines are not checked against its stored split: they
 * stay at the dishes' stored rates while its split may be at the regime's answered ones. */
async function readHistory(
  tx: Transaction,
  saleId: SaleId,
  stored?: Awaited<ReturnType<typeof readStored>>,
  options: { moved?: boolean } = {},
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
  if (!options.moved) {
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
