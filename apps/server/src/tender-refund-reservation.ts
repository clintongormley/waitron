import { and, eq, or } from "drizzle-orm";
import { linkRefundToCancels, readCancelsForRefund } from "@waitron/adjustments";
import { billPaymentRefunds, sales, tenderRefunds, tenders, type Transaction } from "@waitron/db";
import { assertReversible, payments } from "@waitron/payments";
import {
  AppError,
  centsToDecimal,
  decimal,
  decimalToCents,
  isUuid,
  type Decimal,
} from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { resolveTransactionScope } from "./find-bill-transactions.js";
import { fingerprint } from "./parties.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { matchTenderRefundCapture } from "./tender-refund-capture.js";
import { canonicaliseUuid } from "./till-session.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import type { TenderRefundRequest } from "./tender-refund-types.js";
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

/**
 * Checks that each named cancel was handed to a refund on this sale's bill with a cap, and splits
 * `amount` across them in the order named. Answers the links and what the cancels could still take.
 */
async function allocateToCancels(
  tx: Transaction,
  saleId: string,
  ids: readonly string[],
  amount: number,
): Promise<{ links: { adjustmentId: string; amount: Decimal }[]; canStillTake: number }> {
  const [sale] = await tx
    .select({ workingOrderId: sales.workingOrderId })
    .from(sales)
    .where(eq(sales.id, saleId));
  const found = new Map((await readCancelsForRefund(tx, ids)).map((row) => [row.id, row]));
  let left = amount;
  let canStillTake = 0;
  const links: { adjustmentId: string; amount: Decimal }[] = [];
  for (const id of ids) {
    const cancel = found.get(id);
    if (
      cancel === undefined ||
      cancel.action !== "cancel" ||
      !cancel.refundHandoff ||
      cancel.refundValue === null ||
      cancel.workingOrderId !== sale?.workingOrderId
    )
      throw invalid("cancellationIds");
    const open = Math.max(0, decimalToCents(cancel.refundValue) - decimalToCents(cancel.linked));
    canStillTake += open;
    const share = Math.min(open, left);
    if (share > 0) links.push({ adjustmentId: id, amount: centsToDecimal(share) });
    left -= share;
  }
  return { links, canStillTake };
}

// The command must authorize before calling this write path. Cash/manual completion and its
// audited effects belong in the same transaction; a reservation alone reports no returned money.
export async function reserveTenderRefund(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  saleId: string,
  request: TenderRefundRequest,
  actor: { requestedBy: string; authorizedBy: string; viaOverride?: boolean },
  createdAt: string,
): Promise<{
  refund: typeof tenderRefunds.$inferSelect;
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
  const reason = request.reason.trim();
  const print = fingerprint({
    saleId,
    tenderId,
    appliedAmount: centsToDecimal(appliedAmount),
    tipAmount: centsToDecimal(tipAmount),
    reason,
    manualConfirmed: request.manualConfirmed === true,
    ...(cancellationIds === undefined ? {} : { cancellationIds: [...cancellationIds].sort() }),
  });
  await resolveTransactionScope(tx, cfg, saleId);
  const [earlier] = await tx
    .select()
    .from(tenderRefunds)
    .where(and(eq(tenderRefunds.saleId, saleId), eq(tenderRefunds.submissionId, submissionId)));
  if (earlier !== undefined) {
    if (earlier.fingerprint !== print) throw new AppError("submission.id_reused", { submissionId });
    return { refund: earlier, replayed: true };
  }

  const refundable = (await readRefundableTenders(tx, cfg, saleId)).find(
    (row) => row.tenderId === tenderId,
  );
  if (refundable === undefined) throw new AppError("tender.refund_unavailable", { tenderId });
  if (refundable.pendingRefundId !== null)
    throw new AppError("tender.refund_in_progress", { tenderId });
  const appliedRemaining = decimalToCents(decimal(refundable.appliedRemaining));
  const tipRemaining = decimalToCents(decimal(refundable.tipRemaining));
  if (
    appliedAmount > appliedRemaining ||
    (tipAmount !== 0 && (appliedAmount !== appliedRemaining || tipAmount !== tipRemaining))
  ) {
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
        .select({ id: billPaymentRefunds.id })
        .from(billPaymentRefunds)
        .where(
          and(
            eq(billPaymentRefunds.billPaymentId, capture.billPaymentId),
            eq(billPaymentRefunds.state, "pending"),
          ),
        );
      if (pending !== undefined) throw new AppError("tender.refund_in_progress", { tenderId });
    }
    if (!refundable.manual) {
      provider = capture.provider;
      providerPaymentRef = capture.paymentRef;
      const [pending] = await tx
        .select({ id: tenderRefunds.id })
        .from(tenderRefunds)
        .where(
          and(
            eq(tenderRefunds.provider, provider),
            eq(tenderRefunds.providerPaymentRef, providerPaymentRef),
            eq(tenderRefunds.state, "pending"),
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
  const allocation =
    cancellationIds === undefined
      ? undefined
      : await allocateToCancels(tx, saleId, cancellationIds, appliedAmount);
  if (
    allocation !== undefined &&
    actor.viaOverride === true &&
    (tipAmount !== 0 || appliedAmount > allocation.canStillTake)
  )
    throw new AppError("tender.refund_exceeds_cancelled", {
      tenderId,
      cancelled: centsToDecimal(allocation.canStillTake),
    });
  const [refund] = await tx
    .insert(tenderRefunds)
    .values({
      saleId,
      tenderId,
      submissionId,
      fingerprint: print,
      appliedAmount,
      tipAmount,
      reason,
      requestedBy: actor.requestedBy,
      authorizedBy: actor.authorizedBy,
      source: cfg.origin.source,
      deviceId: cfg.origin.deviceId,
      nodeId: cfg.nodeId,
      locationId: cfg.locationId,
      method: refundable.method as "cash" | "card",
      manual: refundable.manual,
      provider,
      providerPaymentRef,
      state: "pending",
      createdAt,
    })
    .returning();
  if (allocation !== undefined)
    await linkRefundToCancels(tx, { tenderRefundId: refund!.id, links: allocation.links });
  return {
    refund: refund!,
    replayed: false,
    ...(allocation === undefined
      ? {}
      : { cancelsCanStillTake: centsToDecimal(allocation.canStillTake) }),
  };
}
