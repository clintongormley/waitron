import { and, eq } from "drizzle-orm";
import { findAdjustmentReason } from "@waitron/adjustments";
import {
  previewCorrectionAmounts,
  recordCorrection,
  type CorrectionPreview,
  type RecordCorrectionInput,
} from "@waitron/core";
import {
  invoiceCorrections,
  readLiveSeriesIdTx,
  saleSettlements,
  tenders,
  type Transaction,
} from "@waitron/db";
import { prepareIssueClock, type FiscalBackend, type TrustedReading } from "@waitron/fiscal";
import type { Authorization, AuthzInput } from "@waitron/identity";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  hasCode,
  isUuid,
  negateDecimal,
  seriesId as brandSeriesId,
  sumDecimals,
  type Decimal,
  type ErrorParams,
  type SaleId,
} from "@waitron/shared";
import { invalid, MONEY } from "./bill-allocation.js";
import {
  readCorrectionLegs,
  readCorrectionMoney,
  refuseWhileCorrectionOpen,
} from "./invoice-correction-legs.js";
import { fingerprint } from "./parties.js";
import { readSaleOperationDescription } from "./sale-operation-description.js";
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
   * correction's lineIds, or the code it refused with and whether /close may end the correction
   * keeping its refunds; null while a leg is pending, nothing is back, or the correction has ended. */
  fileNow:
    { gross: string; vatBreakdown: SplitLine[] } | { refusal: string; closable: boolean } | null;
}

export type InvoiceCorrectionDeps = Pick<TenderRefundDeps, "backend" | "clock" | "attendance">;

const ZERO = decimal("0.00");

/**
 * The checks both the preview and Open run, in order, so the preview refuses what Open refuses
 * about the invoice with the same code. Answers what correcting `selection.gross` would file and
 * the money still refundable over every payment on the invoice.
 */
async function checkCorrectionOpenable(
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
  await refuseWhileCorrectionOpen(tx, saleId);
  const preview = await previewCorrectionAmounts(tx, backend, saleId, cfg.nodeId, selection);
  const moneyRefundable = appliedRemainingOf(await readRefundableTenders(tx, saleId));
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
 * Opens a correction of `request.gross` off a paid invoice once `checkCorrectionOpenable` and the
 * reason and split checks pass; nothing is filed and no money moves. A repeat of the same
 * submission answers the first correction and changes nothing.
 */
export async function openInvoiceCorrection(
  tx: Transaction,
  deps: InvoiceCorrectionDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  ask: InvoiceCorrectionAsk,
  actor: { personId: string; authorization: Authorization },
): Promise<{ correction: InvoiceCorrectionView; replayed: boolean }> {
  const print = fingerprint({
    gross: ask.gross,
    lineIds: ask.lineIds === undefined ? null : [...ask.lineIds].sort(),
    reasonId: ask.reasonId,
    note: ask.note,
    expectedSplit: splitKey(ask.expectedSplit),
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
  await refuseChangedSplit(tx, saleId, preview, ask.expectedSplit, preview.moneyRefundable);

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
  const {
    refunds,
    money: { completed: back, pending },
  } = await readCorrectionLegs(tx, correctionId);
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
    legs: refunds.map(toTenderRefundView),
    fileNow:
      row.state !== "open" || pending > 0 || back === 0
        ? null
        : await fileNowFor(tx, backend, cfg, row.originalSaleId, {
            gross: centsToDecimal(back),
            ...(row.lineIds === null ? {} : { lineIds: row.lineIds }),
          }),
  };
}

/**
 * Files the R5 of the open correction `correctionId` for the money its refunds have given back,
 * after the filing checks run again, and marks the correction filed. The one place a correction's
 * R5 is filed.
 */
export async function fileCorrectionIn(
  tx: Transaction,
  deps: InvoiceCorrectionDeps,
  cfg: DeviceRequestConfig,
  correctionId: string,
  authz: RecordCorrectionInput["authz"],
  endedBy: string,
  expectedSplit?: readonly SplitLine[],
): Promise<SaleId> {
  const correction = await openCorrection(tx, correctionId);
  const { completed } = await readCorrectionMoney(tx, correctionId);
  if (completed === 0) throw new AppError("invoice_correction.nothing_back", { correctionId });
  const saleId = correction.originalSaleId as SaleId;
  const preview = await previewCorrectionAmounts(tx, deps.backend, saleId, cfg.nodeId, {
    gross: centsToDecimal(completed),
    ...(correction.lineIds === null ? {} : { lineIds: correction.lineIds }),
  });
  if (expectedSplit !== undefined) await refuseChangedSplit(tx, saleId, preview, expectedSplit);
  if ((await deps.backend.checkIntegrity(tx, cfg.nodeId)).issues.length > 0)
    throw new AppError("invoice_correction.chain_unsound", { saleId });

  const clock = await prepareIssueClock(tx, cfg, deps.clock);
  const seriesId = brandSeriesId(await readLiveSeriesIdTx(tx, cfg.nodeId, "rectificative"));
  const { saleId: correctiveSaleId } = await recordCorrection(tx, deps.backend, {
    operationDescription: await readSaleOperationDescription(tx, cfg, { kind: "sale", saleId }),
    origin: cfg.origin,
    nodeId: cfg.nodeId,
    seriesId,
    correctsSaleId: saleId,
    total: negateDecimal(preview.gross),
    lines: preview.lines,
    partialVatBreakdown: splitOf(preview).map(({ rate, base, tax }) => ({
      rate,
      base: negateDecimal(base),
      tax: negateDecimal(tax),
    })),
    authz,
    clock,
  });

  const filed = await tx
    .update(invoiceCorrections)
    .set({
      state: "filed",
      correctiveSaleId,
      endedAt: clock.now().instant.toISOString(),
      endedBy,
    })
    .where(and(eq(invoiceCorrections.id, correctionId), eq(invoiceCorrections.state, "open")))
    .returning({ id: invoiceCorrections.id });
  if (filed.length !== 1)
    throw new AppError("invoice_correction.not_open", { correctionId, state: correction.state });
  return correctiveSaleId;
}

/**
 * Files the R5 of the open correction `correctionId` for the money its refunds have given back so
 * far. Refuses nothing back (`invoice_correction.nothing_back`) and a split other than the one the
 * till showed (`invoice_correction.split_changed`, with the fresh one).
 */
export async function fileInvoiceCorrectionNow(
  tx: Transaction,
  deps: InvoiceCorrectionDeps,
  cfg: DeviceRequestConfig,
  correctionId: string,
  request: { expectedSplit: readonly SplitLine[] },
  actor: { personId: string; authz: AuthzInput },
): Promise<InvoiceCorrectionView> {
  await fileCorrectionIn(
    tx,
    deps,
    cfg,
    correctionId,
    actor.authz,
    actor.personId,
    request.expectedSplit,
  );
  return readInvoiceCorrection(tx, deps.backend, cfg, correctionId);
}

/** The refusals of a filing that no later attempt on this box can get past. */
type NotAdmitted = ErrorParams["sale.correction_not_admitted"];
const NEVER_FILEABLE = new Set<NotAdmitted["reason"]>([
  "replaced",
  "voided",
  "wrong_node",
  "not_simplified",
]);

/**
 * Ends the open correction `correctionId` without filing: discarded when nothing has gone back;
 * with money back, closed keeping its refunds only when filing it is refused for good
 * (`sale.correction_not_admitted` for a reason in `NEVER_FILEABLE`), and otherwise refused
 * `invoice_correction.still_correctable`.
 */
export async function closeInvoiceCorrection(
  tx: Transaction,
  deps: InvoiceCorrectionDeps,
  cfg: DeviceRequestConfig,
  correctionId: string,
  actor: { personId: string },
): Promise<InvoiceCorrectionView> {
  const correction = await openCorrection(tx, correctionId);
  const { completed } = await readCorrectionMoney(tx, correctionId);
  if (completed > 0) {
    const filing = await previewOrRefusal(tx, deps.backend, cfg, correction.originalSaleId, {
      gross: centsToDecimal(completed),
      ...(correction.lineIds === null ? {} : { lineIds: correction.lineIds }),
    });
    if (!("refusal" in filing) || !filing.closable)
      throw new AppError("invoice_correction.still_correctable", { correctionId });
  }
  const ended = await tx
    .update(invoiceCorrections)
    .set({
      state: completed === 0 ? "discarded" : "closed",
      endedAt: deps.clock.now().instant.toISOString(),
      endedBy: actor.personId,
    })
    .where(and(eq(invoiceCorrections.id, correctionId), eq(invoiceCorrections.state, "open")))
    .returning({ id: invoiceCorrections.id });
  if (ended.length !== 1)
    throw new AppError("invoice_correction.not_open", { correctionId, state: correction.state });
  return readInvoiceCorrection(tx, deps.backend, cfg, correctionId);
}

/** The correction `correctionId`, refused unless it exists and is open. */
async function openCorrection(tx: Transaction, correctionId: string) {
  const [correction] = await tx
    .select()
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.id, correctionId));
  if (correction === undefined)
    throw new AppError("invoice_correction.not_found", { correctionId });
  if (correction.state !== "open")
    throw new AppError("invoice_correction.not_open", { correctionId, state: correction.state });
  return correction;
}

/**
 * What filing `selection` off the sale would file, or the refusal it meets and whether that refusal
 * is one in `NEVER_FILEABLE`, which Close may end the correction over.
 */
async function previewOrRefusal(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: Pick<DeviceRequestConfig, "nodeId">,
  saleId: string,
  selection: { gross: Decimal; lineIds?: readonly string[] },
): Promise<CorrectionPreview | { refusal: AppError; closable: boolean }> {
  try {
    return await previewCorrectionAmounts(tx, backend, saleId as SaleId, cfg.nodeId, selection);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return {
      refusal: error,
      closable:
        hasCode(error, "sale.correction_not_admitted") && NEVER_FILEABLE.has(error.params.reason),
    };
  }
}

async function fileNowFor(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: Pick<DeviceRequestConfig, "nodeId">,
  saleId: string,
  selection: { gross: Decimal; lineIds?: readonly string[] },
): Promise<InvoiceCorrectionView["fileNow"]> {
  const filing = await previewOrRefusal(tx, backend, cfg, saleId, selection);
  if ("refusal" in filing) return { refusal: filing.refusal.code, closable: filing.closable };
  return { gross: filing.gross, vatBreakdown: splitOf(filing) };
}

/** The money a sale's payments still hold, tips aside. */
export function appliedRemainingOf(rows: readonly { appliedRemaining: string }[]): Decimal {
  return sumDecimals([ZERO, ...rows.map((row) => decimal(row.appliedRemaining))]);
}

function splitOf(preview: Pick<CorrectionPreview, "vatBreakdown">) {
  return preview.vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax }));
}

/**
 * Refuses `invoice_correction.split_changed`, with the fresh split and the money still refundable
 * (read here unless handed in), when `preview` splits other than the till showed.
 */
async function refuseChangedSplit(
  tx: Transaction,
  saleId: SaleId,
  preview: CorrectionPreview,
  expectedSplit: readonly SplitLine[],
  moneyRefundable?: Decimal,
): Promise<void> {
  const split = splitOf(preview);
  if (splitKey(split) === splitKey(expectedSplit)) return;
  throw new AppError("invoice_correction.split_changed", {
    saleId,
    gross: preview.gross,
    vatBreakdown: split,
    moneyRefundable: moneyRefundable ?? appliedRemainingOf(await readRefundableTenders(tx, saleId)),
  });
}

/** The line ids a request names, canonical; refused `lineIds` unless absent or a list of ids. */
export function lineIdsOf(lineIds: unknown): string[] | undefined {
  if (lineIds === undefined) return undefined;
  if (!Array.isArray(lineIds) || lineIds.some((id) => typeof id !== "string" || !isUuid(id)))
    throw invalid("lineIds");
  return lineIds.map((id: string) => canonicaliseUuid(id)!);
}

export type InvoiceCorrectionAsk = ReturnType<typeof parseInvoiceCorrection>;

export function parseInvoiceCorrection(request: InvoiceCorrectionRequest) {
  const submissionId = uuidOf(request.submissionId, "submissionId");
  const reasonId = uuidOf(request.reasonId, "reasonId");
  const lineIds = lineIdsOf(request.lineIds);
  const note = request.note ?? null;
  if (note !== null && typeof note !== "string") throw invalid("note");
  return {
    submissionId,
    gross: moneyOf(request.gross, "gross"),
    ...(lineIds === undefined ? {} : { lineIds }),
    reasonId,
    note: note === null || note.trim() === "" ? null : note.trim(),
    expectedSplit: expectedSplitOf(request.expectedSplit),
  };
}

/** A request's id, canonical; refused by `field` unless it is one. */
export function uuidOf(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) throw invalid(field);
  return canonicaliseUuid(value)!;
}

/** The split a request says the till showed; refused `expectedSplit` when malformed. */
export function expectedSplitOf(split: unknown): SplitLine[] {
  if (
    !Array.isArray(split) ||
    split.some((line: Partial<SplitLine> | null) =>
      [line?.rate, line?.base, line?.tax].some(
        (value) => typeof value !== "string" || !MONEY.test(value),
      ),
    )
  )
    throw invalid("expectedSplit");
  return (split as SplitLine[]).map(({ rate, base, tax }) => ({ rate, base, tax }));
}

/** The split compared by value, in rate order, whatever order or spelling the till sent. */
function splitKey(split: readonly SplitLine[]): string {
  return split
    .map((line) => [line.rate, line.base, line.tax].map((v) => decimalToCents(decimal(v))))
    .sort((a, b) => a[0]! - b[0]!)
    .join(";");
}

/** A request's amount at money scale; refused by `field` when malformed. */
export function moneyOf(value: unknown, field: string): Decimal {
  if (typeof value !== "string" || !MONEY.test(value)) throw invalid(field);
  return centsToDecimal(decimalToCents(decimal(value)));
}
