import { and, asc, eq, sql } from "drizzle-orm";
import { findAdjustmentReason } from "@waitron/adjustments";
import {
  formatInvoiceNumber,
  previewCorrectionAmounts,
  readCorrectableLines,
  recordCorrection,
  type CorrectableLine,
  type CorrectionPreview,
  type RecordCorrectionInput,
} from "@waitron/core";
import {
  billAdvances,
  billPayments,
  invoiceCorrections,
  invoiceSeries,
  readLiveSeriesIdTx,
  sales,
  saleSettlements,
  type Transaction,
} from "@waitron/db";
import {
  prepareIssueClock,
  type CorrectionAdmission,
  type FiscalBackend,
  type TrustedReading,
} from "@waitron/fiscal";
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
  type SaleId,
} from "@waitron/shared";
import { invalid, MONEY } from "./bill-allocation.js";
import {
  AS_ADMITTED,
  closableRefusal,
  readCorrectionLegs,
  readCorrectionLegsOf,
  readCorrectionRow,
  type CorrectionLegs,
  refuseWhileCorrectionOpen,
  type InvoiceCorrectionRow,
  waitsForRecordsCheck,
} from "./invoice-correction-legs.js";
import { linkCorrectionToCancels } from "./cancelled-lines.js";
import { sendFiledCorrective } from "./corrective-delivery.js";
import { optionalDocument } from "./optional-document.js";
import { fingerprint } from "./parties.js";
import { deviceMayPrintReceipts, enqueueOriginalReceipt } from "./receipt-print.js";
import { readSaleOperationDescription } from "./sale-operation-description.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import type { RefundableTender } from "./tender-refund-types.js";
import { toTenderRefundView, type TenderRefundDeps } from "./tender-refunds.js";
import type { TenderRefundView } from "./tender-refund-types.js";
import { canonicaliseUuid } from "./till-session.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import type { OrderZoneCondition } from "./zone-access.js";
import { saleScopeInZones } from "./find-bill-transactions.js";
import { refundableAdvanceNumbersTakenOffBy, refuseTakenOffAdvance } from "./advance-taken-off.js";
import { issueHeldBill } from "./bill-payment-settlement.js";
import "./errors.js";

export interface SplitLine {
  rate: string;
  base: string;
  tax: string;
}

export interface InvoiceCorrectionAsk {
  submissionId: string;
  /** The money back, VAT included. */
  gross: Decimal;
  lineIds?: string[];
  reasonId: string;
  note: string | null;
  /** The split the preview answered, positive. */
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
   * correction's lineIds, or the code it refused with, the refusal's `reason` when it gave one, and
   * whether /close may end the correction keeping its refunds; on a full invoice whose filing
   * could go ahead, `invoice_correction.chain_unsound`, not closable, while the box's invoice
   * records need checking (`waitsForRecordsCheck`); null while a leg is pending, nothing is back,
   * or the correction has ended. */
  fileNow:
    | { gross: string; vatBreakdown: SplitLine[] }
    | { refusal: string; reason?: string; closable: boolean }
    | null;
}

export type InvoiceCorrectionDeps = Pick<
  TenderRefundDeps,
  "backend" | "clock" | "attendance" | "invoiceEmailAvailable"
>;

/** What {@link closeInvoiceCorrection} needs besides, to issue the bill of an advance it ends. */
export type InvoiceCorrectionEndDeps = InvoiceCorrectionDeps &
  Pick<TenderRefundDeps, "db" | "admission" | "log">;

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
  await refuseTakenOffAdvance(tx, saleId);
  await refuseWhileCorrectionOpen(tx, saleId);
  const refundable = await readRefundableTenders(tx, saleId);
  const pending = refundable.find((row) => row.pendingRefundId !== null);
  if (pending !== undefined)
    throw new AppError("invoice_correction.refund_pending", {
      saleId,
      refundId: pending.pendingRefundId!,
    });
  const moneyRefundable = appliedRemainingOf(refundable);
  const preview = await previewCorrectionAmounts(
    tx,
    backend,
    saleId,
    cfg.nodeId,
    selection,
    AS_ADMITTED,
  );
  if (compareDecimal(moneyRefundable, preview.gross) < 0)
    throw new AppError("invoice_correction.money_short", {
      saleId,
      moneyLeft: moneyRefundable,
      gross: preview.gross,
      advanceInvoiceNumbers: await refundableAdvanceNumbersTakenOffBy(tx, saleId),
    });
  if ((await backend.checkIntegrity(tx, cfg.nodeId)).issues.length > 0)
    throw new AppError("invoice_correction.chain_unsound", { saleId });
  await backend.refuseUntilRecordable(tx, reading);
  return { ...preview, moneyRefundable };
}

/** Correct invoice's refusals that do not pass by waiting: another refund pending and the clock
 * are not among them. */
const LASTING_REFUSALS: ReadonlySet<string> = new Set([
  "invoice_correction.not_settled",
  "advance.taken_off_final_invoice",
  "sale.correction_history_unusable",
  "sale.correction_unsupported",
]);

function refusesForGood(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  return hasCode(error, "sale.correction_not_admitted") || LASTING_REFUSALS.has(error.code);
}

/** Whether the box's invoice records need checking, which leaves Correct invoice nothing it can
 * give back on a receipt, and makes it wait on a full invoice ({@link readCorrectableNow}). */
export async function recordsNeedChecking(
  tx: Transaction,
  backend: FiscalBackend,
  nodeId: DeviceRequestConfig["nodeId"],
): Promise<boolean> {
  return (await backend.checkIntegrity(tx, nodeId)).issues.length > 0;
}

/**
 * The payment money still on invoice `saleId` (`refundable`, in cents) and how much of it Correct
 * invoice could give back now (`correctable`): what is left of its lines, capped by that money, or
 * 0 where Correct invoice refuses it for good. Where Correct invoice waits, `waiting` is why.
 * Unlike {@link checkCorrectionOpenable}, the lines are read before the pending-refund check, so a
 * ticket Correct invoice can never take does not wait on another payment's refund; and the chain
 * and clock checks run only when `stillRefused` says the caller would refuse without them. Answers
 * the payments and the lines it read: `lines` is null where it refused them, for good or for now.
 */
export async function readCorrectableNow(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: Pick<DeviceRequestConfig, "nodeId">,
  reading: TrustedReading,
  saleId: SaleId,
  stillRefused: (
    amounts: { refundable: number; correctable: number },
    fullInvoice: boolean,
  ) => boolean,
  admission?: CorrectionAdmission,
): Promise<{
  tenders: RefundableTender[];
  lines: CorrectableLine[] | null;
  amounts: { refundable: number; correctable: number };
  waiting: AppError | null;
  /** Whether the regime's admission marks a full invoice, whose corrective is an R1; false where
   * the invoice was refused before its admission was read. */
  fullInvoice: boolean;
}> {
  const tenders = await readRefundableTenders(tx, saleId);
  const refundable = decimalToCents(appliedRemainingOf(tenders));
  let fullInvoice = false;
  const kind = {
    ...AS_ADMITTED,
    ...(admission === undefined ? {} : { admission }),
    kindSeen: (full: boolean) => {
      fullInvoice = full;
    },
  };
  let lines: CorrectableLine[];
  try {
    const [settled] = await tx
      .select({ id: saleSettlements.id })
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    if (settled === undefined) throw new AppError("invoice_correction.not_settled", { saleId });
    await refuseTakenOffAdvance(tx, saleId);
    lines = await readCorrectableLines(tx, backend, saleId, cfg.nodeId, kind);
  } catch (error) {
    const none = { refundable, correctable: 0 };
    if (refusesForGood(error))
      return { tenders, lines: null, amounts: none, waiting: null, fullInvoice };
    if (error instanceof AppError)
      return { tenders, lines: null, amounts: none, waiting: error, fullInvoice };
    throw error;
  }
  const left = lines.reduce((total, line) => total + decimalToCents(line.left), 0);
  const amounts = { refundable, correctable: Math.min(refundable, left) };
  const pending = tenders.find((row) => row.pendingRefundId !== null);
  if (pending !== undefined)
    return {
      tenders,
      lines,
      amounts,
      waiting: new AppError("invoice_correction.refund_pending", {
        saleId,
        refundId: pending.pendingRefundId!,
      }),
      fullInvoice,
    };
  if (!stillRefused(amounts, fullInvoice))
    return { tenders, lines, amounts, waiting: null, fullInvoice };
  if (await recordsNeedChecking(tx, backend, cfg.nodeId))
    return fullInvoice
      ? {
          tenders,
          lines,
          amounts,
          waiting: new AppError("invoice_correction.chain_unsound", { saleId }),
          fullInvoice,
        }
      : { tenders, lines, amounts: { refundable, correctable: 0 }, waiting: null, fullInvoice };
  await backend.refuseUntilRecordable(tx, reading);
  return { tenders, lines, amounts, waiting: null, fullInvoice };
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
  const { view, row, back, pending } = await summaryOf(tx, correctionId);
  return {
    ...view,
    fileNow:
      row.state !== "open" || pending > 0 || back === 0
        ? null
        : await fileNowFor(tx, backend, cfg, row.originalSaleId, {
            gross: centsToDecimal(back),
            ...(row.lineIds === null ? {} : { lineIds: row.lineIds }),
          }),
  };
}

async function summaryOf(tx: Transaction, correctionId: string) {
  return summaryFrom(
    await readCorrectionRow(tx, correctionId),
    await readCorrectionLegs(tx, correctionId),
  );
}

function summaryFrom(row: InvoiceCorrectionRow, { refunds, money }: CorrectionLegs) {
  const { completed: back, pending } = money;
  const view: Omit<InvoiceCorrectionView, "fileNow"> = {
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
  };
  return { view, row, back, pending };
}

/** The open corrections whose invoice `inZones` admits ({@link saleScopeInZones}), oldest first,
 * each without `fileNow` and with the number of the invoice it corrects: one read of the
 * corrections, then one read of their refunds per `SQL_VARIABLE_LIMIT` corrections, none when no
 * correction is open. */
export async function listOpenInvoiceCorrections(
  tx: Transaction,
  inZones?: OrderZoneCondition,
): Promise<(Omit<InvoiceCorrectionView, "fileNow"> & { invoiceNumber: string })[]> {
  const rows = await tx
    .select({ row: invoiceCorrections, code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(invoiceCorrections)
    .innerJoin(sales, eq(sales.id, invoiceCorrections.originalSaleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(
      and(
        eq(invoiceCorrections.state, "open"),
        inZones === undefined
          ? sql`1`
          : saleScopeInZones(sql`${invoiceCorrections.originalSaleId}`, inZones),
      ),
    )
    .orderBy(asc(invoiceCorrections.createdAt), asc(invoiceCorrections.id));
  const legs = await readCorrectionLegsOf(
    tx,
    rows.map(({ row }) => row.id),
  );
  return rows.map(({ row, code, number }) => ({
    ...summaryFrom(row, legs.get(row.id)!).view,
    invoiceNumber: formatInvoiceNumber(code, number),
  }));
}

/**
 * Files the corrective of the open correction `correctionId` (an R1 in the full invoices' series
 * where the regime's admission says so, else an R5) for the money its refunds have given back,
 * after the filing checks run again, and marks the correction filed. The one place a correction's
 * corrective is filed. An R1 is sent the way its original went ({@link sendFiledCorrective}), on
 * paper at `cfg`'s device, whoever files it. For an R5, when a person asked (`asked`) and `cfg`'s
 * device may print receipts, queues its original on that device's receipt printer when one
 * resolves; an automatic filing queues none.
 */
export async function fileCorrectionIn(
  tx: Transaction,
  deps: InvoiceCorrectionDeps,
  cfg: DeviceRequestConfig,
  correctionId: string,
  authz: RecordCorrectionInput["authz"],
  /** Null when filed automatically, with nobody asking. */
  endedBy: string | null,
  asked?: { expectedSplit?: readonly SplitLine[]; print: true },
): Promise<SaleId> {
  const correction = await openCorrection(tx, correctionId);
  const { completed, legs } = await readSettledMoney(tx, correction);
  if (completed === 0) throw new AppError("invoice_correction.nothing_back", { correctionId });
  const saleId = correction.originalSaleId as SaleId;
  const preview = await previewCorrectionAmounts(
    tx,
    deps.backend,
    saleId,
    cfg.nodeId,
    {
      gross: centsToDecimal(completed),
      ...(correction.lineIds === null ? {} : { lineIds: correction.lineIds }),
    },
    AS_ADMITTED,
  );
  const fullInvoice = preview.fullInvoice === true;
  if (asked?.expectedSplit !== undefined)
    await refuseChangedSplit(tx, saleId, preview, asked.expectedSplit);
  if ((await deps.backend.checkIntegrity(tx, cfg.nodeId)).issues.length > 0)
    throw new AppError("invoice_correction.chain_unsound", { saleId });

  const clock = await prepareIssueClock(tx, cfg, deps.clock);
  const seriesId = brandSeriesId(
    await readLiveSeriesIdTx(tx, cfg.nodeId, fullInvoice ? "full_corrective" : "corrective"),
  );
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
    ...(fullInvoice && { fullInvoice: true as const }),
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
  if (fullInvoice)
    await linkCorrectionToCancels(tx, saleId, legs, {
      filed: { allocations: preview.allocations, openedAt: correction.createdAt },
    });
  if (fullInvoice) await sendFiledCorrective(tx, deps, cfg, correction, correctiveSaleId);
  else if (asked?.print)
    await optionalDocument(tx, "enqueueCorrectiveReceipt", correctiveSaleId, async () => {
      if (!(await deviceMayPrintReceipts(tx, cfg.origin.deviceId))) return;
      await enqueueOriginalReceipt(
        tx,
        cfg,
        await readTransactionReceipt(deps.backend, tx, cfg, correctiveSaleId),
        correctiveSaleId,
      );
    });
  return correctiveSaleId;
}

/**
 * Files the corrective of the open correction `correctionId` for the money its refunds have given
 * back so far.
 */
export async function fileInvoiceCorrectionNow(
  tx: Transaction,
  deps: InvoiceCorrectionDeps,
  cfg: DeviceRequestConfig,
  correctionId: string,
  request: { expectedSplit: readonly SplitLine[] },
  actor: { personId: string; authz: AuthzInput },
): Promise<InvoiceCorrectionView> {
  await fileCorrectionIn(tx, deps, cfg, correctionId, actor.authz, actor.personId, {
    expectedSplit: request.expectedSplit,
    print: true,
  });
  return readInvoiceCorrection(tx, deps.backend, cfg, correctionId);
}

/**
 * Ends the open correction `correctionId` without filing: discarded when nothing has gone back;
 * with money back, closed keeping its refunds only when filing it is refused for good
 * (`closableRefusal`), and otherwise refused
 * `invoice_correction.still_correctable`.
 */
export async function closeInvoiceCorrection(
  tx: Transaction,
  deps: InvoiceCorrectionEndDeps,
  cfg: DeviceRequestConfig,
  correctionId: string,
  actor: { personId: string },
): Promise<InvoiceCorrectionView> {
  const correction = await openCorrection(tx, correctionId);
  const { completed, legs } = await readSettledMoney(tx, correction);
  let fullInvoice = false;
  if (completed > 0) {
    const filing = await previewOrRefusal(
      tx,
      deps.backend,
      cfg,
      correction.originalSaleId,
      {
        gross: centsToDecimal(completed),
        ...(correction.lineIds === null ? {} : { lineIds: correction.lineIds }),
      },
      (seen) => (fullInvoice = seen),
    );
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
  if (fullInvoice)
    await linkCorrectionToCancels(tx, correction.originalSaleId as SaleId, legs, {
      closed: { lineIds: correction.lineIds, moneyBack: completed },
    });
  // Refused when issuing the table's invoice is refused (`clock.unconfirmed`, say); retrying once
  // that cause clears issues it.
  await issueAdvanceBill(tx, deps, cfg, correction.originalSaleId, actor.personId);
  return readInvoiceCorrection(tx, deps.backend, cfg, correctionId);
}

/**
 * When `saleId` is an advance, issues the invoice of the bill its payment is on if that bill is
 * paid off: a payment taken while the advance's correction was open issued none, and its money
 * has already moved, so the invoice is issued as that payment's completion would have issued it
 * ({@link issueHeldBill}).
 * Filing needs no such step: it raises what the bill owes by the money given back.
 */
async function issueAdvanceBill(
  tx: Transaction,
  deps: InvoiceCorrectionEndDeps,
  cfg: DeviceRequestConfig,
  saleId: string,
  operatorId: string,
): Promise<void> {
  const [advance] = await tx
    .select({ workingOrderId: billPayments.workingOrderId })
    .from(billAdvances)
    .innerJoin(billPayments, eq(billPayments.id, billAdvances.billPaymentId))
    .where(eq(billAdvances.advanceSaleId, saleId));
  if (advance === undefined) return;
  await issueHeldBill(tx, deps, cfg, advance.workingOrderId, operatorId);
}

/** The money `correction`'s refunds have given back, and its completed refunds in order; refused
 * `invoice_correction.refund_pending` while one of them is still pending. */
async function readSettledMoney(tx: Transaction, correction: InvoiceCorrectionRow) {
  const { money, refunds } = await readCorrectionLegs(tx, correction.id);
  if (money.pendingRefundId !== null)
    throw new AppError("invoice_correction.refund_pending", {
      saleId: correction.originalSaleId,
      refundId: money.pendingRefundId,
    });
  return { ...money, legs: refunds.filter((leg) => leg.state === "completed") };
}

/** The correction `correctionId`, refused unless it exists and is open. */
async function openCorrection(tx: Transaction, correctionId: string) {
  const correction = await readCorrectionRow(tx, correctionId);
  if (correction.state !== "open")
    throw new AppError("invoice_correction.not_open", { correctionId, state: correction.state });
  return correction;
}

/**
 * What filing `selection` off the sale would file, or the refusal it meets and whether Close may
 * end the correction over it (`closableRefusal`); `kindSeen` is passed to core's
 * `FullInvoiceCorrection`.
 */
export async function previewOrRefusal(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: Pick<DeviceRequestConfig, "nodeId">,
  saleId: string,
  selection: { gross: Decimal; lineIds?: readonly string[] },
  kindSeen?: (fullInvoice: boolean) => void,
): Promise<CorrectionPreview | { refusal: AppError; closable: boolean }> {
  try {
    return await previewCorrectionAmounts(
      tx,
      backend,
      saleId as SaleId,
      cfg.nodeId,
      selection,
      kindSeen === undefined ? AS_ADMITTED : { ...AS_ADMITTED, kindSeen },
    );
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { refusal: error, closable: closableRefusal(error) };
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
  if ("refusal" in filing) {
    const { code, params } = filing.refusal;
    const reason = (params as { reason?: unknown }).reason;
    return {
      refusal: code,
      ...(typeof reason === "string" ? { reason } : {}),
      closable: filing.closable,
    };
  }
  if (await waitsForRecordsCheck(tx, { backend, nodeId: cfg.nodeId }, filing))
    return { refusal: "invoice_correction.chain_unsound", closable: false };
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
 * (read here unless handed in), when `preview` splits other than `expectedSplit`.
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

/** The split compared by value, in rate order, whatever its order or spelling. */
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
