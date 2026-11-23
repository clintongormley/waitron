import { and, eq, or } from "drizzle-orm";
import {
  linkRefundToCancels,
  readCancelsForRefund,
  readCancelsStillOwed,
} from "@waitron/adjustments";
import {
  adjustmentRefunds,
  billAdvances,
  refunds,
  sales,
  tenders,
  type Transaction,
} from "@waitron/db";
import { refusePlainRefundOfAdvance, refuseTakenOffAdvance } from "./advance-taken-off.js";
import type { FiscalBackend, TrustedReading } from "@waitron/fiscal";
import type { Authorization } from "@waitron/identity";
import { assertReversible, payments } from "@waitron/payments";
import {
  AppError,
  centsToDecimal,
  decimal,
  decimalToCents,
  isUuid,
  saleId as brandSaleId,
  type Decimal,
} from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { resolveTransactionScope } from "./find-bill-transactions.js";
import {
  checkCorrectionLeg,
  linkRefundToCorrection,
  refuseWhileCorrectionOpen,
  type CorrectionRead,
} from "./invoice-correction-legs.js";
import { correctableNow } from "./invoice-corrections.js";
import { fingerprint } from "./parties.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { matchTenderRefundCapture } from "./tender-refund-capture.js";
import { canonicaliseUuid } from "./till-session.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import type { RefundableTender, TenderRefundRequest } from "./tender-refund-types.js";
import "./errors.js";

function moneyCents(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^\d{1,12}(\.\d{1,2})?$/.test(value)) throw invalid(field);
  return decimalToCents(decimal(value.replace(/^0+(?=\d)/, "")));
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) throw invalid(field);
  return canonicaliseUuid(value)!;
}

function cancellationIdsOf(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    throw invalid("cancellationIds");
  const ids = value.map((id: unknown) => {
    if (typeof id !== "string" || !isUuid(id)) throw invalid("cancellationIds");
    return canonicaliseUuid(id)!;
  });
  if (new Set(ids).size !== ids.length) throw invalid("cancellationIds");
  return ids;
}

async function cancelsForSale(tx: Transaction, saleId: string, ids: readonly string[]) {
  const [sale] = await tx
    .select({ workingOrderId: sales.workingOrderId })
    .from(sales)
    .where(eq(sales.id, saleId));
  const found = new Map((await readCancelsForRefund(tx, ids)).map((row) => [row.id, row]));
  return ids.map((id) => {
    const cancel = found.get(id);
    if (
      cancel === undefined ||
      cancel.action !== "cancel" ||
      !cancel.refundHandoff ||
      cancel.refundValue === null ||
      cancel.workingOrderId !== sale?.workingOrderId
    )
      throw invalid("cancellationIds");
    return { ...cancel, refundValue: cancel.refundValue };
  });
}

async function allocateToCancels(
  tx: Transaction,
  saleId: string,
  ids: readonly string[],
  amount: number,
) {
  let left = amount;
  let canStillTake = 0;
  const links: { adjustmentId: string; amount: Decimal }[] = [];
  const authorisers = new Set<string>();
  for (const cancel of await cancelsForSale(tx, saleId, ids)) {
    const open = Math.max(0, decimalToCents(cancel.refundValue) - decimalToCents(cancel.linked));
    canStillTake += open;
    const share = Math.min(open, left);
    if (share > 0) {
      links.push({ adjustmentId: cancel.id, amount: centsToDecimal(share) });
      authorisers.add(cancel.approvedBy ?? cancel.requestedBy);
    }
    left -= share;
  }
  return {
    links,
    canStillTake,
    cancelledBy: authorisers.size === 1 ? [...authorisers][0] : undefined,
  };
}

/** What a refund request is checked against on a repeat of its submission id. */
function refundPrint(fields: {
  saleId: string;
  tenderId: string;
  appliedAmount: number;
  tipAmount: number;
  reason: string;
  manualConfirmed: boolean;
  cancellationIds?: readonly string[];
  invoiceCorrectionId?: string;
}): string {
  return fingerprint({
    saleId: fields.saleId,
    tenderId: fields.tenderId,
    appliedAmount: centsToDecimal(fields.appliedAmount),
    tipAmount: centsToDecimal(fields.tipAmount),
    reason: fields.reason,
    manualConfirmed: fields.manualConfirmed,
    ...(fields.cancellationIds === undefined
      ? {}
      : { cancellationIds: [...fields.cancellationIds].sort() }),
    ...(fields.invoiceCorrectionId === undefined
      ? {}
      : { invoiceCorrectionId: fields.invoiceCorrectionId }),
  });
}

/** Whether `refund` was asked for naming no cancels, whatever it was linked to. */
function namedNoCancels(refund: typeof refunds.$inferSelect): boolean {
  return [false, true].some(
    (manualConfirmed) =>
      refund.fingerprint ===
      refundPrint({
        saleId: refund.saleId!,
        tenderId: refund.tenderId!,
        appliedAmount: refund.appliedAmount,
        tipAmount: refund.tipAmount,
        reason: refund.reason,
        manualConfirmed,
      }),
  );
}

/**
 * The payment money, up to `upTo` cents, a refund outside Correct invoice may give back on the
 * sale now: what the cancels it pays for still owe (`owed`) plus what Correct invoice could not
 * give back.
 */
async function plainRefundLimit(
  tx: Transaction,
  nodeId: DeviceRequestConfig["nodeId"],
  fiscal: RefundFiscal,
  saleId: string,
  upTo: number,
  owed: number,
): Promise<number> {
  if (upTo <= owed) return upTo;
  const limit = (amounts: { refundable: number; correctable: number }) =>
    owed + amounts.refundable - amounts.correctable;
  const amounts = await correctableNow(
    tx,
    fiscal.backend,
    { nodeId },
    fiscal.reading,
    brandSaleId(saleId),
    (amounts) => upTo > limit(amounts),
  );
  return Math.min(upTo, limit(amounts));
}

/** The sale's refundable payments, each hand-keyed card payment with its `plainRefundLimit`. */
export async function readRefundableTendersWithLimits(
  tx: Transaction,
  nodeId: DeviceRequestConfig["nodeId"],
  fiscal: RefundFiscal,
  saleId: string,
): Promise<RefundableTender[]> {
  const rows = await readRefundableTenders(tx, saleId);
  if (!rows.some((row) => row.manual) || (await isPartPayment(tx, saleId))) return rows;
  const remaining = (row: RefundableTender) => decimalToCents(decimal(row.appliedRemaining));
  const upTo = Math.max(...rows.filter((row) => row.manual).map(remaining));
  const owedIds = await cancelsStillOwedBy(tx, saleId);
  const owed =
    owedIds.length === 0 ? 0 : (await allocateToCancels(tx, saleId, owedIds, 0)).canStillTake;
  let limit: number;
  try {
    await refuseWhileCorrectionOpen(tx, saleId);
    limit = await plainRefundLimit(tx, nodeId, fiscal, saleId, upTo, owed);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    // An open correction refuses every plain refund; any other refusal passes by waiting, and
    // refuses the refund above `owed` for now.
    limit = error.code === "invoice_correction.already_open" ? 0 : Math.min(upTo, owed);
  }
  return rows.map((row) =>
    row.manual
      ? { ...row, plainRefundLimit: centsToDecimal(Math.min(limit, remaining(row))) }
      : row,
  );
}

/** The fiscal backend and the clock reading a refund outside Correct invoice is checked with. */
export interface RefundFiscal {
  backend: FiscalBackend;
  reading: TrustedReading;
}

async function cancelsStillOwedBy(tx: Transaction, saleId: string): Promise<string[]> {
  const [sale] = await tx
    .select({ workingOrderId: sales.workingOrderId })
    .from(sales)
    .where(eq(sales.id, saleId));
  return sale?.workingOrderId == null ? [] : readCancelsStillOwed(tx, sale.workingOrderId);
}

type RefundActor = { requestedBy: string } & (
  { authorizedBy: string } | { authorize: (cancelledBy?: string) => Promise<Authorization> }
);

export async function authorizeStoredTenderRefund(
  tx: Transaction,
  refund: typeof refunds.$inferSelect,
  authorize: (cancelledBy?: string) => Promise<Authorization>,
): Promise<void> {
  const links = await tx
    .select()
    .from(adjustmentRefunds)
    .where(eq(adjustmentRefunds.refundId, refund.id));
  const cancels = await cancelsForSale(
    tx,
    refund.saleId!,
    links.map((row) => row.adjustmentId),
  );
  const authorisers = new Set(cancels.map((row) => row.approvedBy ?? row.requestedBy));
  const covered =
    links.length > 0 &&
    !namedNoCancels(refund) &&
    refund.tipAmount === 0 &&
    links.reduce((total, row) => total + row.amount, 0) === refund.appliedAmount &&
    authorisers.size === 1 &&
    authorisers.has(refund.authorizedBy);
  await authorize(covered ? refund.authorizedBy : undefined);
}

async function isPartPayment(tx: Transaction, saleId: string): Promise<boolean> {
  const [advance] = await tx
    .select({ saleId: billAdvances.advanceSaleId })
    .from(billAdvances)
    .where(eq(billAdvances.advanceSaleId, saleId));
  return advance !== undefined;
}

export function refundAmountsFit(applied: number, tip: number, left: number, tipLeft: number) {
  return applied <= left && (tip === 0 || (applied === left && tip === tipLeft));
}

/** A tip is not on the invoice, so a payment's tip may come back on its own, up to what is left of
 * it; with payment money, as {@link refundAmountsFit}. */
export function tenderRefundAmountsFit(
  applied: number,
  tip: number,
  left: number,
  tipLeft: number,
) {
  return applied === 0 ? tip <= tipLeft : refundAmountsFit(applied, tip, left, tipLeft);
}

export function assertRefundReplay(
  refund: { fingerprint: string },
  fingerprint: string,
  submissionId: string,
): void {
  if (refund.fingerprint !== fingerprint)
    throw new AppError("submission.id_reused", { submissionId });
}

export async function insertRefundReservation(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  fields: Omit<typeof refunds.$inferInsert, "state" | "source" | "deviceId" | "nodeId">,
) {
  const [refund] = await tx
    .insert(refunds)
    .values({ ...fields, ...cfg.origin, nodeId: cfg.nodeId, state: "pending" })
    .returning();
  return refund!;
}

export async function reserveTenderRefund(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  saleId: string,
  request: TenderRefundRequest,
  actor: RefundActor,
  createdAt: string,
  fiscal: RefundFiscal,
  /** The correction `request.invoiceCorrection` names, as the caller read it in this transaction;
   * set only by server code, never from a request body. */
  correctionRead?: CorrectionRead,
): Promise<{
  refund: typeof refunds.$inferSelect;
  replayed: boolean;
  /** What the named cancels could still take before this refund; only on a new refund naming
   * cancels. */
  cancelsCanStillTake?: string;
}> {
  const submissionId = uuid(request.submissionId, "submissionId");
  const tenderId = uuid(request.tenderId, "tenderId");
  const appliedAmount = moneyCents(request.appliedAmount, "appliedAmount");
  const tipAmount = moneyCents(request.tipAmount, "tipAmount");
  if (appliedAmount + tipAmount === 0 || appliedAmount + tipAmount > 99999999999999) {
    throw invalid("appliedAmount");
  }
  if (
    typeof request.reason !== "string" ||
    request.reason.trim() === "" ||
    request.reason.length > 500
  ) {
    throw invalid("reason");
  }
  if (request.manualConfirmed !== undefined && typeof request.manualConfirmed !== "boolean")
    throw invalid("manualConfirmed");
  const cancellationIds = cancellationIdsOf(request.cancellationIds);
  const correctionLink =
    request.invoiceCorrection === undefined
      ? undefined
      : {
          id: uuid(request.invoiceCorrection.id, "invoiceCorrection"),
          requestId: uuid(request.invoiceCorrection.requestId, "invoiceCorrection"),
          ...(request.invoiceCorrection.cashRoute === true ? { cashRoute: true as const } : {}),
        };
  const reason = request.reason.trim();
  const print = refundPrint({
    saleId,
    tenderId,
    appliedAmount,
    tipAmount,
    reason,
    manualConfirmed: request.manualConfirmed === true,
    ...(cancellationIds === undefined ? {} : { cancellationIds }),
    ...(correctionLink === undefined ? {} : { invoiceCorrectionId: correctionLink.id }),
  });
  await resolveTransactionScope(tx, saleId);
  const [earlier] = await tx
    .select()
    .from(refunds)
    .where(and(eq(refunds.saleId, saleId), eq(refunds.submissionId, submissionId)));
  if (earlier !== undefined) {
    assertRefundReplay(earlier, print, submissionId);
    if ("authorize" in actor) await authorizeStoredTenderRefund(tx, earlier, actor.authorize);
    return { refund: earlier, replayed: true };
  }
  // A correction's legs meet the refusal opening one would now. No known route issues the table's
  // invoice while an advance's correction is open (`advance.correction_open`): a guard for one missed.
  if (correctionLink === undefined) await refuseWhileCorrectionOpen(tx, saleId);
  else await refuseTakenOffAdvance(tx, saleId);
  const returnsPayment = correctionLink === undefined && appliedAmount > 0;
  // A part payment's money comes back this way only as refusePlainRefundOfAdvance allows; its tip
  // alone always may.
  const partPayment = returnsPayment && (await isPartPayment(tx, saleId));
  if (partPayment) await refusePlainRefundOfAdvance(tx, saleId, { tenderId });
  const plain = returnsPayment && !partPayment;

  const refundable = (await readRefundableTenders(tx, saleId)).find(
    (row) => row.tenderId === tenderId,
  );
  if (refundable === undefined) throw new AppError("tender.refund_unavailable", { tenderId });
  if (refundable.pendingRefundId !== null)
    throw new AppError("tender.refund_in_progress", { tenderId });
  const appliedRemaining = decimalToCents(decimal(refundable.appliedRemaining));
  const tipRemaining = decimalToCents(decimal(refundable.tipRemaining));
  if (!tenderRefundAmountsFit(appliedAmount, tipAmount, appliedRemaining, tipRemaining)) {
    throw new AppError("tender.refund_exceeds_payment", {
      tenderId,
      applied: refundable.appliedRemaining,
      tip: refundable.tipRemaining,
    });
  }
  if (refundable.manual && request.manualConfirmed !== true) throw invalid("manualConfirmed");

  let provider: string | null = null;
  let providerPaymentRef: string | null = null;
  if (refundable.method === "card") {
    const originals = await tx.select().from(tenders).where(eq(tenders.saleId, saleId));
    const tender = originals.find((row) => row.id === tenderId)!;
    const captures = await tx
      .select()
      .from(payments)
      .where(
        or(
          eq(payments.saleId, saleId),
          tender.billPaymentId === null
            ? undefined
            : eq(payments.billPaymentId, tender.billPaymentId),
        ),
      );
    const capture = matchTenderRefundCapture(
      { ...tender, amount: centsToDecimal(tender.amount) },
      captures,
      originals.filter((row) => row.method === "card" && row.billPaymentId === null).length,
    );
    if (capture === undefined) throw new AppError("tender.refund_unavailable", { tenderId });
    if (capture.billPaymentId !== null) {
      const [pending] = await tx
        .select({ id: refunds.id })
        .from(refunds)
        .where(and(eq(refunds.billPaymentId, capture.billPaymentId), eq(refunds.state, "pending")));
      if (pending !== undefined) throw new AppError("tender.refund_in_progress", { tenderId });
    }
    if (!refundable.manual) {
      provider = capture.provider;
      providerPaymentRef = capture.paymentRef;
      const [pending] = await tx
        .select({ id: refunds.id })
        .from(refunds)
        .where(
          and(
            eq(refunds.provider, provider),
            eq(refunds.providerPaymentRef, providerPaymentRef),
            eq(refunds.state, "pending"),
          ),
        );
      if (pending !== undefined) throw new AppError("tender.refund_in_progress", { tenderId });
      await assertReversible(tx, {
        provider,
        paymentRef: providerPaymentRef,
        kind: "refund",
        amount: centsToDecimal(appliedAmount + tipAmount),
      });
    }
  }
  const correction =
    correctionLink === undefined
      ? undefined
      : await checkCorrectionLeg(
          tx,
          saleId,
          correctionLink,
          {
            method: refundable.method as "cash" | "card",
            appliedCents: appliedAmount,
            tipCents: tipAmount,
            cancellationIds,
          },
          correctionRead,
        );
  const allocation =
    cancellationIds === undefined
      ? undefined
      : await allocateToCancels(tx, saleId, cancellationIds, appliedAmount);
  // Unnamed cancels still owed are paid first and linked, but never cover the refund's authority.
  const owedIds =
    plain && cancellationIds === undefined ? await cancelsStillOwedBy(tx, saleId) : [];
  const unnamed =
    owedIds.length === 0 ? undefined : await allocateToCancels(tx, saleId, owedIds, appliedAmount);
  if (
    plain &&
    appliedAmount >
      (await plainRefundLimit(
        tx,
        cfg.nodeId,
        fiscal,
        saleId,
        appliedAmount,
        (allocation ?? unnamed)?.canStillTake ?? 0,
      ))
  )
    throw new AppError("tender.refund_needs_correction", { tenderId });
  const covered =
    allocation !== undefined && tipAmount === 0 && appliedAmount <= allocation.canStillTake;
  let authorizedBy: string;
  if ("authorize" in actor) {
    try {
      authorizedBy = (await actor.authorize(covered ? allocation.cancelledBy : undefined))
        .authorizedBy;
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === "authorization.not_permitted" &&
        request.override === undefined &&
        allocation !== undefined &&
        appliedAmount > allocation.canStillTake
      )
        throw new AppError("tender.refund_exceeds_cancelled", {
          tenderId,
          cancelled: centsToDecimal(allocation.canStillTake),
        });
      throw error;
    }
  } else authorizedBy = actor.authorizedBy;
  const refund = await insertRefundReservation(tx, cfg, {
    saleId,
    tenderId,
    submissionId,
    fingerprint: print,
    appliedAmount,
    tipAmount,
    reason: correction?.reason ?? reason,
    requestedBy: actor.requestedBy,
    authorizedBy,
    method: refundable.method as "cash" | "card",
    manual: refundable.manual,
    provider,
    providerPaymentRef,
    createdAt,
  });
  const links = (allocation ?? unnamed)?.links;
  if (links !== undefined) await linkRefundToCancels(tx, { tenderRefundId: refund.id, links });
  if (correctionLink !== undefined)
    await linkRefundToCorrection(tx, {
      invoiceCorrectionId: correctionLink.id,
      tenderRefundId: refund.id,
      requestId: correctionLink.requestId,
      createdAt,
    });
  return {
    refund,
    replayed: false,
    ...(allocation === undefined
      ? {}
      : { cancelsCanStillTake: centsToDecimal(allocation.canStillTake) }),
  };
}
