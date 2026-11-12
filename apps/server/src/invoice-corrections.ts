import { and, eq, sql } from "drizzle-orm";
import { findAdjustmentReason } from "@waitron/adjustments";
import { previewCorrectionAmounts, type CorrectionPreview } from "@waitron/core";
import {
  invoiceCorrectionRefunds,
  invoiceCorrections,
  saleSettlements,
  tenderRefunds,
  tenders,
  type Transaction,
} from "@waitron/db";
import { type FiscalBackend, type TrustedReading } from "@waitron/fiscal";
import type { Authorization } from "@waitron/identity";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  isUuid,
  sumDecimals,
  type Decimal,
  type SaleId,
} from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { fingerprint } from "./parties.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { toTenderRefundView, type TenderRefundDeps } from "./tender-refunds.js";
import type { TenderRefundView } from "./tender-refund-types.js";
import { canonicaliseUuid } from "./till-session.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import "./errors.js";

export interface SplitLine {
  rate: string;
  base: string;
  tax: string;
}

export interface InvoiceCorrectionRequest {
  submissionId: string;
  /** The money back, VAT included. */
  gross: string;
  lineIds?: string[];
  reasonId: string;
  note?: string | null;
  /** The split the till showed, positive, as the preview answered it. */
  expectedSplit: SplitLine[];
}

export interface InvoiceCorrectionView {
  id: string;
  saleId: string;
  state: "open" | "filed" | "discarded" | "closed";
  gross: string;
  moneyBack: string;
  pending: string;
  /** gross − moneyBack − pending. */
  left: string;
  reason: string;
  openedAt: string;
  correctiveSaleId: string | null;
  legs: TenderRefundView[];
  /** What /file would file now: `previewCorrectionAmounts` for the money back over the
   * correction's lineIds, or the code it refused with; null while a leg is pending, nothing is
   * back, or the correction has ended. */
  fileNow: { gross: string; vatBreakdown: SplitLine[] } | { refusal: string } | null;
}

export type InvoiceCorrectionDeps = Pick<TenderRefundDeps, "backend" | "clock" | "attendance">;

const MONEY = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const ZERO = decimal("0.00");

/**
 * The checks both the preview and Open run, in order, so the preview refuses what Open refuses
 * with the same code. Answers what correcting `selection.gross` would file and the money still
 * refundable over every payment on the invoice.
 */
export async function checkCorrectionOpenable(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: Pick<DeviceRequestConfig, "nodeId">,
  reading: TrustedReading,
  saleId: SaleId,
  selection: { gross: Decimal; lineIds?: readonly string[] },
): Promise<CorrectionPreview & { moneyRefundable: Decimal }> {
  const [settled] = await tx
    .select({ id: saleSettlements.id })
    .from(saleSettlements)
    .where(eq(saleSettlements.saleId, saleId));
  if (settled === undefined) throw new AppError("invoice_correction.not_settled", { saleId });
  const paid = await tx
    .select({ method: tenders.method })
    .from(tenders)
    .where(eq(tenders.saleId, saleId));
  if (paid.some((row) => row.method !== "cash"))
    throw new AppError("invoice_correction.not_cash", { saleId });
  const [unfinished] = await tx
    .select({ id: invoiceCorrections.id })
    .from(invoiceCorrections)
    .where(
      and(eq(invoiceCorrections.originalSaleId, saleId), eq(invoiceCorrections.state, "open")),
    );
  if (unfinished !== undefined)
    throw new AppError("invoice_correction.already_open", {
      saleId,
      correctionId: unfinished.id,
    });
  const preview = await previewCorrectionAmounts(tx, backend, saleId, cfg.nodeId, selection);
  const moneyRefundable = sumDecimals([
    ZERO,
    ...(await readRefundableTenders(tx, saleId)).map((row) => decimal(row.appliedRemaining)),
  ]);
  if (compareDecimal(moneyRefundable, preview.gross) < 0)
    throw new AppError("invoice_correction.money_short", {
      saleId,
      moneyLeft: moneyRefundable,
      gross: preview.gross,
    });
  if ((await backend.checkIntegrity(tx, cfg.nodeId)).issues.length > 0)
    throw new AppError("invoice_correction.chain_unsound", { saleId });
  await backend.refuseWhileClockBehind(tx, reading);
  return { ...preview, moneyRefundable };
}

/** What correcting `selection.gross` off the invoice would file, and the money still refundable on it. */
export async function previewInvoiceCorrection(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: Pick<DeviceRequestConfig, "nodeId">,
  reading: TrustedReading,
  saleId: SaleId,
  selection: { gross: string; lineIds?: readonly string[] },
): Promise<CorrectionPreview & { moneyRefundable: Decimal }> {
  return checkCorrectionOpenable(tx, backend, cfg, reading, saleId, {
    gross: moneyOf(selection.gross, "gross"),
    ...(selection.lineIds === undefined ? {} : { lineIds: selection.lineIds }),
  });
}

/**
 * Opens a correction of `request.gross` off a paid invoice: every check a filing would make runs
 * now, and nothing is filed and no money moves. A repeat of the same submission answers the first
 * correction and changes nothing.
 */
export async function openInvoiceCorrection(
  tx: Transaction,
  deps: InvoiceCorrectionDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  request: InvoiceCorrectionRequest,
  actor: { personId: string; authorization: Authorization },
): Promise<{ correction: InvoiceCorrectionView; replayed: boolean }> {
  const ask = parseInvoiceCorrection(request);
  const print = fingerprint({
    gross: ask.gross,
    lineIds: ask.lineIds === undefined ? null : [...ask.lineIds].sort(),
    reasonId: ask.reasonId,
    note: ask.note,
    expectedSplit: [...ask.expectedSplit].sort((a, b) => compareDecimal(a.rate, b.rate)),
  });
  const [earlier] = await tx
    .select({ id: invoiceCorrections.id, fingerprint: invoiceCorrections.fingerprint })
    .from(invoiceCorrections)
    .where(
      and(
        eq(invoiceCorrections.originalSaleId, saleId),
        eq(invoiceCorrections.submissionId, ask.submissionId),
      ),
    );
  if (earlier !== undefined) {
    if (earlier.fingerprint !== print)
      throw new AppError("submission.id_reused", { submissionId: ask.submissionId });
    return {
      correction: await readInvoiceCorrection(tx, deps.backend, cfg, earlier.id),
      replayed: true,
    };
  }
  const reason = await findAdjustmentReason(tx, ask.reasonId);
  if (reason.kind !== "void") throw new AppError("adjustment.action_not_allowed", {});
  if (reason.noteRequired && ask.note === null) throw new AppError("adjustment.note_required", {});

  const reading = deps.clock.now();
  const preview = await checkCorrectionOpenable(tx, deps.backend, cfg, reading, saleId, {
    gross: ask.gross,
    ...(ask.lineIds === undefined ? {} : { lineIds: ask.lineIds }),
  });
  const split = preview.vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax }));
  if (splitKey(split) !== splitKey(ask.expectedSplit))
    throw new AppError("invoice_correction.split_changed", {
      saleId,
      gross: preview.gross,
      vatBreakdown: split,
      moneyRefundable: preview.moneyRefundable,
    });

  const [row] = await tx
    .insert(invoiceCorrections)
    .values({
      originalSaleId: saleId,
      submissionId: ask.submissionId,
      fingerprint: print,
      gross: decimalToCents(preview.gross),
      lineIds: ask.lineIds ?? null,
      reason: (ask.note === null ? reason.name : `${reason.name}: ${ask.note}`).slice(0, 500),
      requestedBy: actor.personId,
      authorizedBy: actor.authorization.authorizedBy,
      viaOverride: actor.authorization.viaOverride,
      source: cfg.origin.source,
      deviceId: cfg.origin.deviceId,
      nodeId: cfg.nodeId,
      state: "open",
      createdAt: reading.instant.toISOString(),
    })
    .returning({ id: invoiceCorrections.id });
  return {
    correction: await readInvoiceCorrection(tx, deps.backend, cfg, row!.id),
    replayed: false,
  };
}

/** The correction `correctionId`, its refunds and what filing it would file now. */
export async function readInvoiceCorrection(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: Pick<DeviceRequestConfig, "nodeId">,
  correctionId: string,
): Promise<InvoiceCorrectionView> {
  const [row] = await tx
    .select()
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.id, correctionId));
  if (row === undefined) throw new AppError("invoice_correction.not_found", { correctionId });
  const money = await tx
    .select({ state: tenderRefunds.state, cents: sql<number>`sum(${tenderRefunds.appliedAmount})` })
    .from(invoiceCorrectionRefunds)
    .innerJoin(tenderRefunds, eq(tenderRefunds.id, invoiceCorrectionRefunds.tenderRefundId))
    .where(eq(invoiceCorrectionRefunds.invoiceCorrectionId, correctionId))
    .groupBy(tenderRefunds.state);
  const centsIn = (state: string) => money.find((group) => group.state === state)?.cents ?? 0;
  const back = centsIn("completed"),
    pending = centsIn("pending");
  const legs = await tx
    .select({ refund: tenderRefunds })
    .from(invoiceCorrectionRefunds)
    .innerJoin(tenderRefunds, eq(tenderRefunds.id, invoiceCorrectionRefunds.tenderRefundId))
    .where(eq(invoiceCorrectionRefunds.invoiceCorrectionId, correctionId))
    .orderBy(invoiceCorrectionRefunds.createdAt, invoiceCorrectionRefunds.id);
  return {
    id: row.id,
    saleId: row.originalSaleId,
    state: row.state,
    gross: centsToDecimal(row.gross),
    moneyBack: centsToDecimal(back),
    pending: centsToDecimal(pending),
    left: centsToDecimal(row.gross - back - pending),
    reason: row.reason,
    openedAt: row.createdAt,
    correctiveSaleId: row.correctiveSaleId,
    legs: legs.map(({ refund }) => toTenderRefundView(refund)),
    fileNow:
      row.state !== "open" || pending > 0 || back === 0
        ? null
        : await fileNowFor(tx, backend, cfg, row.originalSaleId, {
            gross: centsToDecimal(back),
            ...(row.lineIds === null ? {} : { lineIds: row.lineIds }),
          }),
  };
}

async function fileNowFor(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: Pick<DeviceRequestConfig, "nodeId">,
  saleId: string,
  selection: { gross: Decimal; lineIds?: readonly string[] },
): Promise<InvoiceCorrectionView["fileNow"]> {
  try {
    const preview = await previewCorrectionAmounts(
      tx,
      backend,
      saleId as SaleId,
      cfg.nodeId,
      selection,
    );
    return {
      gross: preview.gross,
      vatBreakdown: preview.vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax })),
    };
  } catch (error) {
    if (error instanceof AppError) return { refusal: error.code };
    throw error;
  }
}

/** The line ids a request names, canonical; refused `lineIds` unless absent or a list of ids. */
export function lineIdsOf(lineIds: unknown): string[] | undefined {
  if (lineIds === undefined) return undefined;
  if (!Array.isArray(lineIds) || lineIds.some((id) => typeof id !== "string" || !isUuid(id)))
    throw invalid("lineIds");
  return lineIds.map((id: string) => canonicaliseUuid(id)!);
}

export function parseInvoiceCorrection(request: InvoiceCorrectionRequest) {
  if (typeof request.submissionId !== "string" || !isUuid(request.submissionId))
    throw invalid("submissionId");
  if (typeof request.reasonId !== "string" || !isUuid(request.reasonId)) throw invalid("reasonId");
  const lineIds = lineIdsOf(request.lineIds);
  const note = request.note ?? null;
  if (note !== null && typeof note !== "string") throw invalid("note");
  const split = request.expectedSplit;
  if (
    !Array.isArray(split) ||
    split.some((line) =>
      [line?.rate, line?.base, line?.tax].some(
        (value) => typeof value !== "string" || !MONEY.test(value),
      ),
    )
  )
    throw invalid("expectedSplit");
  return {
    submissionId: canonicaliseUuid(request.submissionId)!,
    gross: moneyOf(request.gross, "gross"),
    ...(lineIds === undefined ? {} : { lineIds }),
    reasonId: canonicaliseUuid(request.reasonId)!,
    note: note === null || note.trim() === "" ? null : note.trim(),
    expectedSplit: split.map(({ rate, base, tax }) => ({
      rate: centsToDecimal(decimalToCents(decimal(rate))),
      base: centsToDecimal(decimalToCents(decimal(base))),
      tax: centsToDecimal(decimalToCents(decimal(tax))),
    })),
  };
}

/** The split compared by value, in rate order, whatever order or spelling the till sent. */
function splitKey(split: readonly SplitLine[]): string {
  return split
    .map((line) => [line.rate, line.base, line.tax].map((v) => decimalToCents(decimal(v))))
    .sort((a, b) => a[0]! - b[0]!)
    .join(";");
}

function moneyOf(value: unknown, field: string): Decimal {
  if (typeof value !== "string" || !MONEY.test(value)) throw invalid(field);
  return centsToDecimal(decimalToCents(decimal(value)));
}
