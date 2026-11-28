import { eq, inArray } from "drizzle-orm";
import { saleLines, sales, saleSubstitutions, type Transaction } from "@waitron/db";
import type { CorrectionAdmission, FiledFigures, FiscalBackend } from "@waitron/fiscal";
import {
  AppError,
  basisPointsToDecimal,
  centsToDecimal,
  decimal,
  decimalToBasisPoints,
  decimalToCents,
  rawCentsToDecimal,
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
import {
  requireFullInvoiceCorrection,
  requireSupportedCorrection,
  requireTaxpayerDomicile,
} from "./correction-eligibility.js";
import { correctionTargetFor, earlierCorrectionsOf } from "./correction-target.js";
import { deductionsTaken, type TakenCents } from "./deductions-taken.js";
import type { RecordSaleLine } from "./record-sale.js";
import "./errors.js";

type InvoiceLine = typeof saleLines.$inferSelect;

export type CorrectionPreview = CorrectionAmountPreview &
  Omit<Extract<CorrectionAdmission, { eligible: true }>, "eligible"> & { lines: RecordSaleLine[] };

/** Asks for a full invoice's corrective, which only a caller that files one may do; with
 * `"as_admitted"`, for whichever kind the regime's admission says the invoice takes. */
export interface FullInvoiceCorrection {
  fullInvoice?: true | "as_admitted";
  /** Told whether it is a full invoice's correction once the admission is read, before any refusal
   * of it: a refusal Correct invoice waits out carries no kind. */
  kindSeen?: (fullInvoice: boolean) => void;
  /** The regime's admission of this invoice's correction, as {@link readCorrectionAdmission} read
   * it earlier in the same transaction; read again when absent. */
  admission?: CorrectionAdmission;
}

/**
 * What a correction of `selection.gross` from the invoice `saleId`, issued by `issuingNodeId`, would
 * file, as the lines and split `recordCorrection` takes; a replaced invoice is read through its
 * replacement (`correctionTargetFor`), as `recordCorrection` files it. Refused with
 * `sale.correction_not_admitted` when the invoice was exchanged for a full invoice (an F3; reason
 * `replaced`), its regime does not admit a correction of it, or the
 * regime's newest filed figures of it or of an earlier correction cannot be read or differ from the
 * stored ones; refused with
 * `sale.correction_unsupported`, as `recordCorrection` is, when the invoice names a customer.
 * With `fullInvoice: true`, or `"as_admitted"` where the admission marks a full invoice, it is a
 * full invoice's correction instead: refused with
 * `sale.correction_unsupported` unless the invoice names a customer and the regime's admission
 * says it is a full invoice, and with `fiscal.taxpayer_domicile_missing` when the business has no
 * registered address. The answer carries `fullInvoice` when it is a full invoice's correction.
 */
export async function previewCorrectionAmounts(
  tx: Transaction,
  backend: FiscalBackend,
  saleId: SaleId,
  issuingNodeId: NodeId,
  selection: { gross: Decimal; lineIds?: readonly string[] },
  kind: FullInvoiceCorrection = {},
): Promise<CorrectionPreview> {
  const { admission, full, history, invoiceLines, partsTaken } = await admittedHistory(
    tx,
    backend,
    saleId,
    issuingNodeId,
    kind,
  );
  const preview = allocateCorrectionAmounts(history, selection);
  return {
    ...preview,
    original: admission.original,
    lines: correctionLinesFor(invoiceLines, preview.allocations, partsTaken),
    ...(full && { fullInvoice: true as const }),
  };
}

export interface CorrectableLine {
  id: string;
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
  kind: FullInvoiceCorrection = {},
): Promise<CorrectableLine[]> {
  const { history, invoiceLines } = await admittedHistory(tx, backend, saleId, issuingNodeId, kind);
  const left = new Map(remainingLines(history).map((line) => [line.id, line.gross]));
  const byId = new Map(invoiceLines.map((line) => [line.id, line]));
  return history.lines.map((line) => ({
    id: line.id,
    descriptions: byId.get(line.id)!.descriptions,
    rate: line.rate,
    gross: line.gross,
    left: left.get(line.id)!,
  }));
}

async function admissionOf(
  tx: Transaction,
  backend: FiscalBackend,
  saleId: SaleId,
  issuingNodeId: NodeId,
): Promise<CorrectionAdmission> {
  return backend.correctionAdmissionFor
    ? backend.correctionAdmissionFor(tx, saleId, issuingNodeId)
    : { eligible: false, reason: "unsupported" };
}

const isFullInvoiceCorrection = (kind: FullInvoiceCorrection, admission: CorrectionAdmission) =>
  kind.fullInvoice === true ||
  (kind.fullInvoice === "as_admitted" && admission.fullInvoice === true);

/** The regime's admission of a correction of the invoice `saleId`, read through its replacement. */
export async function readCorrectionAdmission(
  tx: Transaction,
  backend: FiscalBackend,
  saleId: SaleId,
  issuingNodeId: NodeId,
): Promise<CorrectionAdmission> {
  return admissionOf(tx, backend, await correctionTargetFor(tx, saleId), issuingNodeId);
}

/** Whether a correction of the invoice `saleId` asked for as `kind` is a full invoice's, as
 * {@link previewCorrectionAmounts} decides it, reading the regime's admission alone: none of the
 * preview's refusals is checked. */
export async function admittedAsFullInvoice(
  tx: Transaction,
  backend: FiscalBackend,
  saleId: SaleId,
  issuingNodeId: NodeId,
  kind: FullInvoiceCorrection,
): Promise<boolean> {
  return isFullInvoiceCorrection(
    kind,
    kind.admission ?? (await readCorrectionAdmission(tx, backend, saleId, issuingNodeId)),
  );
}

/** Whether the invoice a correction of `saleId` is filed against (`correctionTargetFor`) names a
 * customer. A cheap pre-check of {@link admittedAsFullInvoice}: an invoice that names no customer
 * cannot be a full invoice's correction (`requireFullInvoiceCorrection`). */
export async function correctionTargetNamesACustomer(
  tx: Transaction,
  saleId: SaleId,
): Promise<boolean> {
  const [target] = await tx
    .select({ taxId: sales.counterpartyTaxId })
    .from(sales)
    .where(eq(sales.id, await correctionTargetFor(tx, saleId)));
  return target?.taxId != null;
}

async function admittedHistory(
  tx: Transaction,
  backend: FiscalBackend,
  invoiceId: SaleId,
  issuingNodeId: NodeId,
  kind: FullInvoiceCorrection,
) {
  const saleId = await correctionTargetFor(tx, invoiceId);
  // The requested invoice as well as its replacement: an exchange names the invoice it took.
  const [substituted] = await tx
    .select({ id: saleSubstitutions.id })
    .from(saleSubstitutions)
    .where(inArray(saleSubstitutions.substitutedSaleId, [invoiceId, saleId]));
  if (substituted !== undefined) {
    throw new AppError("sale.correction_not_admitted", { reason: "replaced" });
  }
  const admission = kind.admission ?? (await admissionOf(tx, backend, saleId, issuingNodeId));
  const full = isFullInvoiceCorrection(kind, admission);
  kind.kindSeen?.(full);
  if (admission.fullInvoice && !full) {
    throw new AppError("sale.correction_not_admitted", { reason: "not_simplified" });
  }
  if (!admission.eligible) {
    throw new AppError("sale.correction_not_admitted", { reason: admission.reason });
  }
  const stored = await readStored(tx, saleId);
  if (full) {
    requireFullInvoiceCorrection(
      admission.fullInvoice === true ? stored.sale.counterpartyTaxId : null,
      saleId,
    );
    await requireTaxpayerDomicile(tx);
  } else {
    requireSupportedCorrection(stored.sale.counterpartyTaxId, saleId);
  }
  await refuseMovedFigures(tx, backend, [stored.sale, ...stored.corrections]);
  return { admission, full, ...(await readHistory(tx, saleId, stored)) };
}

/**
 * What a paid invoice holds and what every earlier correction of it took, whatever that
 * correction's filing state, for `allocateCorrectionAmounts`. Refused with
 * `sale.correction_history_unusable` when what is stored cannot be read as amounts: the sale is
 * itself a correction other than a replacement, a line has no stored gross, an earlier correction's line names no invoice
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

/** The invoice's and its earlier corrections' stored figures and lines (`earlierCorrectionsOf`);
 * refused when the sale is unknown or is itself a correction other than a replacement. */
async function readStored(
  tx: Transaction,
  saleId: SaleId,
): Promise<{
  sale: StoredFigures & Pick<typeof sales.$inferSelect, "counterpartyTaxId">;
  corrections: StoredFigures[];
  earlierLines: Awaited<ReturnType<typeof earlierCorrectionsOf>>["lines"];
}> {
  const figures = { id: sales.id, total: sales.total, vatBreakdown: sales.vatBreakdown };
  const [sale] = await tx
    .select({
      ...figures,
      correctsSaleId: sales.correctsSaleId,
      replacesOriginal: sales.replacesOriginal,
      counterpartyTaxId: sales.counterpartyTaxId,
    })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale === undefined) throw new AppError("sale.not_found", { saleId });
  if (sale.correctsSaleId !== null && !sale.replacesOriginal) unusable();
  const { corrections, lines } = await earlierCorrectionsOf(tx, saleId);
  return { sale, corrections, earlierLines: lines };
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
): Promise<{
  history: CorrectionAmountHistory;
  invoiceLines: InvoiceLine[];
  partsTaken: Map<string, number>;
}> {
  const { sale, corrections, earlierLines } = stored ?? (await readStored(tx, saleId));

  const lines = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
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

  const meal = lines.filter((line) => line.advanceRole !== "deduction");
  const { vatBreakdown, taken } = mealView(sale.vatBreakdown, meal, lines);
  const history: CorrectionAmountHistory = {
    lines: meal.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      rate: basisPointsToDecimal(line.vatRate),
      gross: centsToDecimal(line.lineGross!),
      base: centsToDecimal(line.lineTotal),
      menu: centsToDecimal(line.listGross ?? line.lineGross!),
    })),
    vatBreakdown,
    consumed: [
      ...taken.map((piece) => ({
        saleLineId: piece.saleLineId,
        rate: basisPointsToDecimal(piece.rate),
        gross: centsToDecimal(piece.gross),
        base: centsToDecimal(piece.base),
        tax: centsToDecimal(piece.gross - piece.base),
      })),
      ...earlierLines.map((line) => ({
        saleLineId: line.correctsLineId!,
        rate: basisPointsToDecimal(line.vatRate),
        gross: centsToDecimal(-line.lineGross!),
        base: centsToDecimal(-line.lineTotal),
        tax: centsToDecimal(line.lineTotal - line.lineGross!),
      })),
    ],
  };
  const partsTaken = new Map<string, number>();
  for (const line of earlierLines) {
    if (line.setMenuPart === null) continue;
    const id = line.correctsLineId!;
    partsTaken.set(id, (partsTaken.get(id) ?? 0) - line.setMenuPart);
  }
  return { history, invoiceLines: lines, partsTaken };
}

/**
 * The invoice as the allocator reads it: an invoice that takes advances off holds its meal, at
 * each rate its stored split plus what its deduction lines take off, and each deduction is
 * something already taken from the meal (`deductionsTaken`). A rate only a deduction line holds
 * drops out, and must then net to nothing. An invoice with no deduction line reads as stored.
 */
function mealView(
  stored: readonly { rate: string; base: string; tax: string }[],
  meal: readonly InvoiceLine[],
  lines: readonly InvoiceLine[],
): { vatBreakdown: CorrectionAmountHistory["vatBreakdown"]; taken: TakenCents[] } {
  const deductions = lines.filter((line) => line.advanceRole === "deduction");
  if (deductions.length === 0) {
    return {
      vatBreakdown: stored.map((group) => ({
        rate: decimal(group.rate),
        base: decimal(group.base),
        tax: decimal(group.tax),
      })),
      taken: [],
    };
  }
  const vatBreakdown: CorrectionAmountHistory["vatBreakdown"] = [];
  for (const group of stored) {
    const rate = decimalToBasisPoints(decimal(group.rate));
    const atRate = deductions.filter((line) => line.vatRate === rate);
    const base =
      decimalToCents(decimal(group.base)) - atRate.reduce((sum, line) => sum + line.lineTotal, 0);
    const tax =
      decimalToCents(decimal(group.tax)) -
      atRate.reduce((sum, line) => sum + line.lineGross! - line.lineTotal, 0);
    if (!meal.some((line) => line.vatRate === rate)) {
      if (base !== 0 || tax !== 0) unusable();
      continue;
    }
    vatBreakdown.push({
      rate: decimal(group.rate),
      base: rawCentsToDecimal(String(base)),
      tax: rawCentsToDecimal(String(tax)),
    });
  }
  const taken = deductionsTaken(
    meal.map((line) => ({
      id: line.id,
      rate: line.vatRate,
      base: line.lineTotal,
      gross: line.lineGross!,
    })),
    deductions.map((line) => ({
      rate: line.vatRate,
      base: line.lineTotal,
      gross: line.lineGross!,
    })),
  );
  return { vatBreakdown, taken };
}

/**
 * The lines of a correction taking `allocations` from the invoice whose stored lines are
 * `invoiceLines`, in allocation order. The quantity is the invoice line's, negated: an amount
 * correction's quantity is the scope shown, never units returned. The list gross is a line amount,
 * not a frozen fact, so it is left out; an extra points at its dish only when the dish is corrected
 * too. An amount taken off a divided set menu's dish comes off what earlier corrections left of
 * its part (`partsTaken`, cents by invoice line) first, then off its sold amount.
 */
export function correctionLinesFor(
  invoiceLines: readonly InvoiceLine[],
  allocations: readonly CorrectionAmountAllocation[],
  partsTaken: ReadonlyMap<string, number> = new Map(),
): RecordSaleLine[] {
  const byId = new Map(invoiceLines.map((line) => [line.id, line]));
  const lineNoOf = new Map(
    allocations.map((allocation, index) => [allocation.saleLineId, index + 1]),
  );
  return allocations.map((allocation, index) => {
    const line = byId.get(allocation.saleLineId)!;
    const taken = decimalToCents(allocation.gross);
    const partLeft =
      line.setMenuPart !== null && line.setMenuPart > 0
        ? line.setMenuPart - (partsTaken.get(line.id) ?? 0)
        : 0;
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
      lineGross: centsToDecimal(-taken),
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
      advanceRole: line.advanceRole,
      deductsSaleId: line.deductsSaleId,
      setMenuRole: line.setMenuRole,
      setMenuPart: partLeft > 0 ? centsToDecimal(-Math.min(taken, partLeft)) : null,
    } satisfies Required<RecordSaleLine>;
  });
}

function unusable(): never {
  throw new AppError("sale.correction_history_unusable", {});
}
