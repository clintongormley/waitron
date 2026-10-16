import { and, eq, or } from "drizzle-orm";
import { billPaymentRefunds, tenderRefunds, tenders, type Transaction } from "@waitron/db";
import { assertReversible, payments } from "@waitron/payments";
import { AppError, centsToDecimal, decimal, decimalToCents, isUuid } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { resolveTransactionScope } from "./find-bill-transactions.js";
import { fingerprint } from "./parties.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { matchTenderRefundCapture } from "./tender-refund-capture.js";
import { canonicaliseUuid } from "./till-session.js";
import type { DeviceRequestConfig } from "./till-config.js";
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

// The command must authorize before calling this write path. Cash/manual completion and its
// audited effects belong in the same transaction; a reservation alone reports no returned money.
export async function reserveTenderRefund(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  saleId: string,
  request: TenderRefundRequest,
  actor: { requestedBy: string; authorizedBy: string },
  createdAt: string,
): Promise<{ refund: typeof tenderRefunds.$inferSelect; replayed: boolean }> {
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
  for (const field of ["cashConfirmed", "manualConfirmed"] as const) {
    if (request[field] !== undefined && typeof request[field] !== "boolean") throw invalid(field);
  }
  const reason = request.reason.trim();
  const print = fingerprint({
    saleId,
    tenderId,
    appliedAmount: centsToDecimal(appliedAmount),
    tipAmount: centsToDecimal(tipAmount),
    reason,
    cashConfirmed: request.cashConfirmed === true,
    manualConfirmed: request.manualConfirmed === true,
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
  if (refundable.method === "cash" && request.cashConfirmed !== true)
    throw invalid("cashConfirmed");
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
  return { refund: refund!, replayed: false };
}
