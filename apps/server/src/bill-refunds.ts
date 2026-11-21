import { assertStillSignedIn } from "./till-session.js";
import { requireEconomicWrite } from "./trading-admission.js";
import { and, eq } from "drizzle-orm";
import { billAdvances, refunds, billPayments, withTransaction } from "@waitron/db";
import { refuseAdvanceRefund } from "./advance-taken-off.js";
import type { Database, Transaction } from "@waitron/db";
import { authorize, type PinAttempts } from "@waitron/identity";
import type { Override } from "@waitron/identity";
import { MANUAL_PROVIDER, assertReversible, findPaymentByBillPayment } from "@waitron/payments";
import type { PaymentProvider, RefundRefusalReason } from "@waitron/payments";
import { AppError, centsToDecimal, decimal, decimalToCents, isAppError } from "@waitron/shared";
import { money, ZERO } from "./bill-allocation.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import {
  findSubmission,
  readBillBalance,
  readOnePaymentMoney,
  requireRefundableBill,
  toRefundView,
} from "./bill-payments.js";
import type { BillBalance, BillRefundView } from "./bill-payments.js";
import {
  claimTenderRefund,
  resolveClaimedRefund,
  resumeBillCardRefund,
} from "./tender-refund-sends.js";
import { withCheck } from "./pin-check-ahead.js";
import { confirmManualRefundAuthority, withRefundPinCheck } from "./tender-refund-authorization.js";
import { completeRefundReservation, refuseUntilRefundable } from "./tender-refund-completion.js";
import {
  assertRefundReplay,
  insertRefundReservation,
  refundAmountsFit,
} from "./tender-refund-reservation.js";
import { enqueueRefundDrawer } from "./receipt-print.js";
import type { TenderKind } from "./device-session.js";
import type { DeviceRequestConfig, TradingContext } from "./trading-context.js";
import { fingerprint } from "./parties.js";
import {
  refusePaymentInFlight,
  refusePendingPartPayment,
  refuseRefundInProgress,
} from "./working-order.js";
import type { TillSaleDeps } from "./working-order.js";
import type { AttendanceRecorder } from "./attendance-capture.js";
import "./errors.js";

export interface BillRefundRequest {
  submissionId: string;
  appliedAmount: string;
  tipAmount: string;
  reason: string;
  /** A PIN holder with `sale.refund`; required for a confirmed standalone-terminal refund. */
  override?: Override;
  /** Staff confirms the refund has already completed on the standalone card terminal. */
  manualConfirmed?: boolean;
}

export interface BillRefundResult {
  refund: BillRefundView;
  balance: BillBalance;
}

/** The card provider a bill payment was charged through, by its `payments.provider`; undefined when
 * none is available here. */
export type RefundProviderFor = (providerName: string) => Promise<PaymentProvider | undefined>;

export type BillRefundDeps = Pick<TillSaleDeps, "db" | "backend" | "clock" | "admission"> & {
  cfg: TradingContext;
  refundProviderFor?: RefundProviderFor;
  attendance?: AttendanceRecorder;
  /** Once aborted, no provider lookup starts and the refund stays pending. */
  stopSignal?: AbortSignal;
  /** True while the start clock gate holds: a refund is then left pending, as in a clock stop. */
  clockUnconfirmed?: () => boolean;
};

/** The practice simulator by its name, else the pooled provider of that name; a name neither
 * serves (a hand-keyed card's `manual`) is undefined. */
export function refundProvidersOf(sources: {
  simulator?: PaymentProvider;
  pool?: CardProviderPool;
}): RefundProviderFor {
  return async (providerName) => {
    if (sources.simulator?.provider === providerName) return sources.simulator;
    if (sources.pool === undefined) return undefined;
    try {
      return await sources.pool.get(providerName);
    } catch (error) {
      if (isAppError(error) && error.code === "payment.provider_unknown") return undefined;
      throw error;
    }
  };
}

type RefundRow = typeof refunds.$inferSelect;

/** The retry fingerprint of a refund request (design §5.1). The override is left out, so a retry
 * authorised by another manager is the same refund, and no PIN is hashed into a stored value. */
export function refundFingerprint(
  paymentId: string,
  appliedAmount: string,
  tipAmount: string,
  reason: string,
  manualConfirmed = false,
): string {
  return fingerprint({
    paymentId,
    appliedAmount: money(decimal(appliedAmount)),
    tipAmount: money(decimal(tipAmount)),
    reason,
    ...(manualConfirmed ? { manualConfirmed: true } : {}),
  });
}

async function resultOf(tx: Transaction, refund: RefundRow, workingOrderId: string) {
  return { refund: toRefundView(refund), balance: await readBillBalance(tx, workingOrderId) };
}

/**
 * How the payment was taken, for the profile check a refund makes before its transaction: cash, a
 * card keyed on a separate terminal (a `manual` provider row), or a card on a connected reader.
 * `undefined` when the bill has no such payment, which the refund itself then refuses. No update in
 * the tree sets a payment's `method` or its provider row's `provider`.
 */
export async function refundTender(
  db: Database,
  workingOrderId: string,
  paymentId: string,
): Promise<TenderKind | undefined> {
  const [payment] = await db
    .select({ method: billPayments.method })
    .from(billPayments)
    .where(and(eq(billPayments.id, paymentId), eq(billPayments.workingOrderId, workingOrderId)));
  if (payment === undefined) return undefined;
  if (payment.method === "cash") return "cash";
  return (await findPaymentByBillPayment(db, paymentId))?.provider === MANUAL_PROVIDER
    ? "hand-keyed-card"
    : "reader-card";
}

/**
 * Give money back from one bill payment of a bill with no invoice yet (open, sent or presented),
 * needing `sale.refund` from the operator or the override. A payment gives back up to its net
 * applied money; its tip comes back only with the whole of what is left of it; an item payment only
 * whole, which frees its lines.
 *
 * Keyed by `submissionId` across the whole bill (design §5.1): the same refund again answers the
 * first and writes nothing, except that a card refund still pending is resumed; the id with another
 * request, of another payment, or naming one of the bill's payments is `submission.id_reused`.
 *
 * Cash and staff-confirmed standalone-terminal refunds are completed in this transaction. A
 * connected card refund is written `pending` before its provider is asked (design §6b), and the
 * bill is locked until the evidence settles it. `tender` is what {@link refundTender} answered for
 * the payment.
 */
export async function refundBillPayment(
  deps: BillRefundDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  paymentId: string,
  req: BillRefundRequest,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
  tender: TenderKind | undefined,
): Promise<BillRefundResult> {
  const applied = decimalToCents(decimal(req.appliedAmount));
  const tip = decimalToCents(decimal(req.tipAmount));
  const confirmsManual = req.manualConfirmed === true && tender === "hand-keyed-card";
  let release: (() => void) | undefined;
  try {
    const begun = await withRefundPinCheck(
      deps.db,
      operator,
      req.override,
      confirmsManual,
      (checked) => {
        const override = withCheck(req.override, checked);
        return withTransaction(deps.db, async (tx) => {
          await requireEconomicWrite(tx, cfg, deps.admission);
          await assertStillSignedIn(tx, {
            deviceId: cfg.origin.deviceId,
            personId: operator.personId,
            sessionId: operator.sessionId,
          });
          const authorization = await authorize(
            tx,
            { sessionId: operator.sessionId, permission: "sale.refund", override },
            operator.attempts,
          );
          const [found] = await tx
            .select({ payment: billPayments, advanceSaleId: billAdvances.advanceSaleId })
            .from(billPayments)
            .leftJoin(billAdvances, eq(billAdvances.billPaymentId, billPayments.id))
            .where(
              and(eq(billPayments.id, paymentId), eq(billPayments.workingOrderId, workingOrderId)),
            );
          if (found === undefined) throw new AppError("bill.payment_not_found", { paymentId });
          const { payment, advanceSaleId } = found;
          if (advanceSaleId !== null)
            await refuseAdvanceRefund(tx, advanceSaleId, "bill.refund_of_advance", { paymentId });
          const provided =
            payment.method === "card" ? await findPaymentByBillPayment(tx, paymentId) : undefined;
          const print = refundFingerprint(
            paymentId,
            req.appliedAmount,
            req.tipAmount,
            req.reason,
            provided?.provider === MANUAL_PROVIDER && req.manualConfirmed === true,
          );

          const earlier = await findSubmission(tx, workingOrderId, req.submissionId);
          if (earlier.refund !== undefined) {
            assertRefundReplay(earlier.refund, print, req.submissionId);
            if (earlier.refund.state === "pending") {
              await refuseUntilRefundable(tx, deps.backend, cfg.nodeId, deps.clock.now());
              return { kind: "resume" as const, refundId: earlier.refund.id };
            }
            return {
              kind: "done" as const,
              result: await resultOf(tx, earlier.refund, workingOrderId),
            };
          }
          if (earlier.payment !== undefined) {
            throw new AppError("submission.id_reused", { submissionId: req.submissionId });
          }
          const reading = deps.clock.now();
          await refuseUntilRefundable(tx, deps.backend, cfg.nodeId, reading);

          if ((await requireRefundableBill(tx, workingOrderId)) === "placed") {
            await refuseRefundInProgress(tx, [workingOrderId]);
            await refusePendingPartPayment(tx, [workingOrderId], "any");
          } else {
            await refusePaymentInFlight(tx, [workingOrderId]);
          }

          const held = await readOnePaymentMoney(tx, payment);
          const [refundable, refundableTip] =
            payment.state === "received" ? [held.netApplied, held.netTip] : [ZERO, ZERO];
          const refundableCents = decimalToCents(refundable);
          if (!refundAmountsFit(applied, tip, refundableCents, decimalToCents(refundableTip))) {
            throw new AppError("bill.refund_exceeds_payment", {
              paymentId,
              applied: money(refundable),
              tip: money(refundableTip),
            });
          }
          if (payment.kind === "items" && applied !== refundableCents) {
            throw new AppError("bill.refund_not_whole", {
              paymentId,
              applied: money(refundable),
              tip: money(refundableTip),
            });
          }

          const manual = provided?.provider === MANUAL_PROVIDER && req.manualConfirmed === true;
          const approver = manual
            ? await confirmManualRefundAuthority(
                tx,
                authorization,
                override,
                operator.attempts,
                () => new AppError("bill.manual_refund_pin_required", { paymentId }),
              )
            : authorization;
          const connected = payment.method === "card" && !manual;
          const provider =
            connected && provided !== undefined
              ? await deps.refundProviderFor?.(provided.provider)
              : undefined;
          if (connected) {
            if (provided === undefined || provider?.sendRefund === undefined)
              throw new AppError("bill.refund_unsupported", { paymentId });
            await assertReversible(tx, {
              provider: provided.provider,
              paymentRef: provided.paymentRef,
              kind: "refund",
              amount: centsToDecimal(applied + tip),
            });
          }
          const reserved = await insertRefundReservation(tx, cfg, {
            billPaymentId: paymentId,
            method: payment.method,
            submissionId: req.submissionId,
            fingerprint: print,
            appliedAmount: applied,
            tipAmount: tip,
            reason: req.reason,
            authorizedBy: approver.authorizedBy,
            requestedBy: operator.personId,
            createdAt: reading.instant.toISOString(),
            manual,
            provider: connected ? provided!.provider : null,
            providerPaymentRef: connected ? provided!.paymentRef : null,
          });
          const refund = await completeRefundReservation(tx, deps, reading, reserved, {
            manualPaymentRef: async () => provided!.paymentRef,
            openDrawer: (done) =>
              enqueueRefundDrawer(tx, cfg, done.id, operator.personId, {
                authorizedBy: approver.authorizedBy,
                viaOverride: approver.viaOverride,
              }),
          });
          if (refund.state === "completed")
            return { kind: "done" as const, result: await resultOf(tx, refund, workingOrderId) };

          // Inside the transaction, so no loop pass runs between the insert and the claim.
          release = claimTenderRefund(deps.db, refund.id);
          return { kind: "send" as const, refundId: refund.id, provider: provider! };
        });
      },
    );
    if (begun.kind === "done") return begun.result;
    let refusalReason: RefundRefusalReason | undefined;
    if (begun.kind === "send") {
      const held = release!;
      release = undefined;
      const result = await resolveClaimedRefund(
        { ...deps, refundProviderFor: async () => begun.provider },
        begun.refundId,
        "retry",
        held,
        cfg.origin,
      );
      refusalReason = result.refusalReason;
    } else {
      const result = await resumeBillCardRefund(deps, begun.refundId, "retry", cfg.origin);
      if (result.claimed) refusalReason = result.refusalReason;
    }
    const refundId = begun.refundId;
    return await withTransaction(deps.db, async (tx) => {
      const [refund] = await tx.select().from(refunds).where(eq(refunds.id, refundId));
      const result = await resultOf(tx, refund!, workingOrderId);
      if (result.refund.state === "failed" && refusalReason !== undefined) {
        result.refund.refusalReason = refusalReason;
      }
      return result;
    });
  } finally {
    release?.();
  }
}
