import { and, eq, or } from "drizzle-orm";
import { linkRefundToCancels, readCancelsForRefund } from "@waitron/adjustments";
import {
  adjustmentRefunds,
  billPaymentRefunds,
  sales,
  tenderRefunds,
  tenders,
  type Transaction,
} from "@waitron/db";
import type { Authorization } from "@waitron/identity";
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

type RefundActor = { requestedBy: string } & (
  { authorizedBy: string } | { authorize: (cancelledBy?: string) => Promise<Authorization> }
);

export async function authorizeStoredTenderRefund(
  tx: Transaction,
  refund: typeof tenderRefunds.$inferSelect,
  authorize: (cancelledBy?: string) => Promise<Authorization>,
): Promise<void> {
  const links = await tx
    .select()
    .from(adjustmentRefunds)
    .where(eq(adjustmentRefunds.tenderRefundId, refund.id));
  const cancels = await cancelsForSale(
    tx,
    refund.saleId,
    links.map((row) => row.adjustmentId),
  );
  const authorisers = new Set(cancels.map((row) => row.approvedBy ?? row.requestedBy));
  const covered =
    links.length > 0 &&
    refund.tipAmount === 0 &&
    links.reduce((total, row) => total + row.amount, 0) === refund.appliedAmount &&
    authorisers.size === 1 &&
    authorisers.has(refund.authorizedBy);
  await authorize(covered ? refund.authorizedBy : undefined);
}

export async function reserveTenderRefund(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  saleId: string,
  request: TenderRefundRequest,
  actor: RefundActor,
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
  await resolveTransactionScope(tx, saleId);
  const [earlier] = await tx
    .select()
    .from(tenderRefunds)
    .where(and(eq(tenderRefunds.saleId, saleId), eq(tenderRefunds.submissionId, submissionId)));
  if (earlier !== undefined) {
    if (earlier.fingerprint !== print) throw new AppError("submission.id_reused", { submissionId });
    if ("authorize" in actor) await authorizeStoredTenderRefund(tx, earlier, actor.authorize);
    return { refund: earlier, replayed: true };
  }

  const refundable = (await readRefundableTenders(tx, saleId)).find(
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
        !covered
      )
        throw new AppError("tender.refund_exceeds_cancelled", {
          tenderId,
          cancelled: centsToDecimal(allocation.canStillTake),
        });
      throw error;
    }
  } else authorizedBy = actor.authorizedBy;
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
      authorizedBy,
      source: cfg.origin.source,
      deviceId: cfg.origin.deviceId,
      nodeId: cfg.nodeId,
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
