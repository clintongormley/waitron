import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { findAdjustmentReason } from "@waitron/adjustments";
import { previewCorrectionAmounts, recordCorrection, type CorrectionPreview } from "@waitron/core";
import {
  invoiceCorrections,
  readLiveSeriesIdTx,
  saleSettlements,
  tenderRefunds,
  tenders,
  type Transaction,
} from "@waitron/db";
import { prepareIssueClock, type FiscalBackend } from "@waitron/fiscal";
import type { AuthzInput } from "@waitron/identity";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  isUuid,
  negateDecimal,
  sumDecimals,
  seriesId as brandSeriesId,
  type Decimal,
  type SaleId,
} from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { fingerprint } from "./parties.js";
import { enqueueTenderRefundDrawer } from "./receipt-print.js";
import { readSaleOperationDescription } from "./sale-operation-description.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { carryNewTenderRefund } from "./tender-refund-completion.js";
import { reserveTenderRefund } from "./tender-refund-reservation.js";
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

export interface InvoiceCorrectionResult {
  correctiveSaleId: string;
  /** One per cash payment money went back to, oldest first. */
  refunds: TenderRefundView[];
  replayed: boolean;
}

export type InvoiceCorrectionDeps = Pick<TenderRefundDeps, "backend" | "clock" | "attendance">;

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

/** What correcting `selection.gross` off the invoice would file, and the cash still refundable on it. */
export async function previewInvoiceCorrection(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: Pick<DeviceRequestConfig, "nodeId">,
  saleId: SaleId,
  selection: { gross: string; lineIds?: readonly string[] },
): Promise<CorrectionPreview & { cashRefundable: Decimal }> {
  const preview = await previewCorrectionAmounts(tx, backend, saleId, cfg.nodeId, {
    gross: moneyOf(selection.gross, "gross"),
    ...(selection.lineIds === undefined ? {} : { lineIds: selection.lineIds }),
  });
  const cash = (await readRefundableTenders(tx, saleId)).filter((row) => row.method === "cash");
  return {
    ...preview,
    cashRefundable: sumDecimals([
      decimal("0.00"),
      ...cash.map((row) => decimal(row.appliedRemaining)),
    ]),
  };
}

/**
 * Files a corrective invoice for `request.gross` off a paid cash invoice and gives that cash back
 * over the invoice's cash payments, oldest first, opening the drawer once. A repeat of the same
 * submission answers the first result and changes nothing. The caller has authorized the
 * operator for `sale.refund`; `recordCorrection` checks `sale.rectify` against `actor.authz`.
 */
export async function acceptInvoiceCorrection(
  tx: Transaction,
  deps: InvoiceCorrectionDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  request: InvoiceCorrectionRequest,
  actor: {
    personId: string;
    authz: AuthzInput;
    authorization: { authorizedBy: string; viaOverride: boolean };
  },
): Promise<InvoiceCorrectionResult> {
  const ask = parseInvoiceCorrection(request);
  const print = fingerprint({
    gross: ask.gross,
    lineIds: ask.lineIds === undefined ? null : [...ask.lineIds].sort(),
    reasonId: ask.reasonId,
    note: ask.note,
    expectedSplit: ask.expectedSplit,
  });
  const earlier = await tx
    .select({
      correctiveSaleId: invoiceCorrections.correctiveSaleId,
      fingerprint: invoiceCorrections.fingerprint,
      refund: tenderRefunds,
    })
    .from(invoiceCorrections)
    .innerJoin(tenderRefunds, eq(tenderRefunds.id, invoiceCorrections.tenderRefundId))
    .innerJoin(tenders, eq(tenders.id, tenderRefunds.tenderId))
    .where(
      and(
        eq(invoiceCorrections.originalSaleId, saleId),
        eq(invoiceCorrections.submissionId, ask.submissionId),
      ),
    )
    .orderBy(asc(tenders.settledAt), asc(tenders.id));
  if (earlier.length > 0) {
    if (earlier[0]!.fingerprint !== print)
      throw new AppError("submission.id_reused", { submissionId: ask.submissionId });
    return {
      correctiveSaleId: earlier[0]!.correctiveSaleId,
      refunds: earlier.map((row) => toTenderRefundView(row.refund)),
      replayed: true,
    };
  }

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
  const refundable = await readRefundableTenders(tx, saleId);
  const pending = refundable.find((row) => row.pendingRefundId !== null);
  if (pending !== undefined)
    throw new AppError("invoice_correction.refund_pending", {
      saleId,
      refundId: pending.pendingRefundId!,
    });
  const preview = await previewCorrectionAmounts(tx, deps.backend, saleId, cfg.nodeId, {
    gross: ask.gross,
    ...(ask.lineIds === undefined ? {} : { lineIds: ask.lineIds }),
  });
  const cashLeft = sumDecimals([
    decimal("0.00"),
    ...refundable.map((row) => decimal(row.appliedRemaining)),
  ]);
  if (compareDecimal(cashLeft, preview.gross) < 0)
    throw new AppError("invoice_correction.cash_short", {
      saleId,
      cashLeft,
      gross: preview.gross,
    });
  const split = preview.vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax }));
  if (splitKey(split) !== splitKey(ask.expectedSplit))
    throw new AppError("invoice_correction.split_changed", {
      saleId,
      gross: preview.gross,
      vatBreakdown: split,
      cashRefundable: cashLeft,
    });
  if ((await deps.backend.checkIntegrity(tx, cfg.nodeId)).issues.length > 0)
    throw new AppError("invoice_correction.chain_unsound", { saleId });

  const reason = await findAdjustmentReason(tx, ask.reasonId);
  const reasonText = (ask.note === null ? reason.name : `${reason.name}: ${ask.note}`).slice(
    0,
    500,
  );
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
    partialVatBreakdown: preview.vatBreakdown.map(({ rate, base, tax }) => ({
      rate,
      base: negateDecimal(base),
      tax: negateDecimal(tax),
    })),
    authz: actor.authz,
    clock,
  });

  const reading = deps.clock.now();
  const createdAt = reading.instant.toISOString();
  let left = decimalToCents(preview.gross);
  const refunds: TenderRefundView[] = [];
  for (const tender of refundable) {
    if (left === 0) break;
    const leg = Math.min(left, decimalToCents(decimal(tender.appliedRemaining)));
    if (leg === 0) continue;
    left -= leg;
    const { refund: reserved } = await reserveTenderRefund(
      tx,
      cfg,
      saleId,
      {
        submissionId: randomUUID(),
        tenderId: tender.tenderId,
        appliedAmount: centsToDecimal(leg),
        tipAmount: "0.00",
        reason: reasonText,
      },
      {
        requestedBy: actor.personId,
        authorizedBy: actor.authorization.authorizedBy,
        viaOverride: actor.authorization.viaOverride,
      },
      createdAt,
    );
    const first = refunds.length === 0;
    const refund = await carryNewTenderRefund(tx, deps, cfg.nodeId, reading, reserved, {
      ...(first
        ? {
            openDrawer: (done) =>
              enqueueTenderRefundDrawer(tx, cfg, done.id, actor.personId, actor.authorization),
          }
        : {}),
    });
    await tx.insert(invoiceCorrections).values({
      originalSaleId: saleId,
      correctiveSaleId,
      tenderRefundId: refund.id,
      submissionId: ask.submissionId,
      fingerprint: print,
      createdAt,
    });
    refunds.push(toTenderRefundView(refund));
  }
  return { correctiveSaleId, refunds, replayed: false };
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
