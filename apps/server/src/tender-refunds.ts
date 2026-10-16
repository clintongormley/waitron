import { eq, or } from "drizzle-orm";
import { tenderRefunds, tenders, type Transaction } from "@waitron/db";
import type { PinAttempts } from "@waitron/identity";
import { payments, recordManualRefund } from "@waitron/payments";
import { AppError, centsToDecimal } from "@waitron/shared";
import type { BillRefundDeps } from "./bill-refunds.js";
import { enqueueTenderRefundDrawer } from "./receipt-print.js";
import { withTenderRefundAuthorization } from "./tender-refund-authorization.js";
import { matchTenderRefundCapture } from "./tender-refund-capture.js";
import { reserveTenderRefund } from "./tender-refund-reservation.js";
import type { DeviceRequestConfig } from "./till-config.js";
import type { TenderRefundRequest, TenderRefundView } from "./tender-refund-types.js";
import "./errors.js";

export type TenderRefundDeps = BillRefundDeps;
type RefundRow = typeof tenderRefunds.$inferSelect;

export function toTenderRefundView(row: RefundRow): TenderRefundView {
  return {
    id: row.id,
    saleId: row.saleId,
    tenderId: row.tenderId,
    state: row.state,
    appliedAmount: centsToDecimal(row.appliedAmount),
    tipAmount: centsToDecimal(row.tipAmount),
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

async function captureFor(tx: Transaction, refund: RefundRow) {
  const originals = await tx.select().from(tenders).where(eq(tenders.saleId, refund.saleId));
  const tender = originals.find((row) => row.id === refund.tenderId)!;
  const captures = await tx
    .select()
    .from(payments)
    .where(
      or(
        eq(payments.saleId, refund.saleId),
        tender.billPaymentId === null
          ? undefined
          : eq(payments.billPaymentId, tender.billPaymentId),
      ),
    );
  return matchTenderRefundCapture(
    { ...tender, amount: centsToDecimal(tender.amount) },
    captures,
    originals.filter((row) => row.method === "card" && row.billPaymentId === null).length,
  );
}

// Connected refunds commit their reservation here; provider I/O belongs to the resolver afterwards.
export async function beginSettledTenderRefund(
  deps: TenderRefundDeps,
  cfg: DeviceRequestConfig,
  saleId: string,
  request: TenderRefundRequest,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
): Promise<TenderRefundView> {
  return withTenderRefundAuthorization(
    deps.db,
    cfg,
    saleId,
    request,
    operator,
    async (tx, authorization) => {
      const createdAt = deps.clock.now().instant.toISOString();
      const begun = await reserveTenderRefund(
        tx,
        cfg,
        saleId,
        request,
        {
          requestedBy: operator.personId,
          authorizedBy: authorization.authorizedBy,
        },
        createdAt,
      );
      if (begun.replayed) return toTenderRefundView(begun.refund);
      let refund = begun.refund;
      if (refund.method === "card") {
        const capture = (await captureFor(tx, refund))!;
        if (refund.manual) {
          await recordManualRefund(tx, {
            paymentRef: capture.paymentRef,
            amount: centsToDecimal(refund.appliedAmount + refund.tipAmount),
            authorizedBy: authorization.authorizedBy,
          });
        } else {
          const provider = await deps.refundProviderFor?.(capture.provider);
          if (provider?.provider !== capture.provider || provider.sendRefund === undefined)
            throw new AppError("tender.refund_unavailable", { tenderId: refund.tenderId });
        }
      }
      if (refund.method === "cash" || refund.manual) {
        const [completed] = await tx
          .update(tenderRefunds)
          .set({
            state: "completed",
            completedAt: createdAt,
          })
          .where(eq(tenderRefunds.id, refund.id))
          .returning();
        refund = completed!;
        if (refund.method === "cash") {
          await enqueueTenderRefundDrawer(tx, cfg, refund.id, operator.personId, authorization);
        }
      }
      await deps.attendance?.(tx, {
        source: "refund",
        key: refund.id,
        personId: refund.requestedBy,
        locationId: refund.locationId,
        kind: "payment",
        at: refund.createdAt,
        offsetMinutes: 0,
        outcome: refund.state === "completed" ? "qualified" : "pending",
      });
      return toTenderRefundView(refund);
    },
  );
}
