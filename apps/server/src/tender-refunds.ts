import { eq, or } from "drizzle-orm";
import { carryNewTenderRefund } from "./tender-refund-completion.js";
import { requireEconomicWrite } from "./trading-admission.js";
import { tenderRefunds, tenders, type Transaction } from "@waitron/db";
import type { PinAttempts } from "@waitron/identity";
import { payments, recordManualRefund } from "@waitron/payments";
import { AppError, centsToDecimal } from "@waitron/shared";
import type { BillRefundDeps } from "./bill-refunds.js";
import { enqueueTenderRefundDrawer } from "./receipt-print.js";
import { withTenderRefundAuthorization } from "./tender-refund-authorization.js";
import { matchTenderRefundCapture } from "./tender-refund-capture.js";
import { reserveTenderRefund } from "./tender-refund-reservation.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import type { TenderRefundRequest, TenderRefundView } from "./tender-refund-types.js";
import {
  claimTenderRefund,
  resolveClaimedTenderRefund,
  resumeTenderRefund,
} from "./tender-refund-sends.js";
import "./errors.js";

/** Once `stopSignal` is aborted the recovery pass looks up no further refund; each sent one it did
 * not ask about stays pending for a later pass. */
export type TenderRefundDeps = BillRefundDeps & { stopSignal?: AbortSignal };
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
  claimConnected?: (id: string) => void,
): Promise<TenderRefundView> {
  return withTenderRefundAuthorization(
    deps.db,
    cfg,
    saleId,
    request,
    operator,
    async (tx, authorize) => {
      await requireEconomicWrite(tx, cfg, deps.admission);
      const reading = deps.clock.now();
      const createdAt = reading.instant.toISOString();
      const begun = await reserveTenderRefund(
        tx,
        cfg,
        saleId,
        request,
        {
          requestedBy: operator.personId,
          authorize,
        },
        createdAt,
      );
      if (begun.replayed) {
        if (begun.refund.state === "pending") {
          await deps.backend.refuseWhileClockBehind(tx, reading);
          await deps.backend.refuseNewRefund(tx, cfg.nodeId);
        }
        return toTenderRefundView(begun.refund);
      }
      const refund = await carryNewTenderRefund(tx, deps, cfg.nodeId, reading, begun.refund, {
        beforeCompletion: async (reserved) => {
          if (reserved.method !== "card") return;
          const capture = (await captureFor(tx, reserved))!;
          if (reserved.manual) {
            await recordManualRefund(tx, {
              paymentRef: capture.paymentRef,
              amount: centsToDecimal(reserved.appliedAmount + reserved.tipAmount),
              authorizedBy: reserved.authorizedBy,
            });
          } else {
            const provider = await deps.refundProviderFor?.(capture.provider);
            if (
              provider?.provider !== capture.provider ||
              provider.sendRefund === undefined ||
              (!provider.capabilities.partialRefund &&
                reserved.appliedAmount + reserved.tipAmount !== capture.amount)
            )
              throw new AppError("tender.refund_unavailable", { tenderId: reserved.tenderId });
          }
        },
        openDrawer: (reserved) =>
          enqueueTenderRefundDrawer(tx, cfg, reserved.id, operator.personId, {
            authorizedBy: reserved.authorizedBy,
            viaOverride: reserved.authorizedBy !== operator.personId,
          }),
      });
      if (refund.state === "pending") claimConnected?.(refund.id);
      return toTenderRefundView(refund);
    },
  );
}

export async function refundSettledTender(
  deps: TenderRefundDeps,
  cfg: DeviceRequestConfig,
  saleId: string,
  request: TenderRefundRequest,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
): Promise<TenderRefundView> {
  let release: (() => void) | undefined;
  try {
    const refund = await beginSettledTenderRefund(deps, cfg, saleId, request, operator, (id) => {
      release = claimTenderRefund(deps.db, id);
    });
    if (release !== undefined) {
      const held = release;
      release = undefined;
      return resolveClaimedTenderRefund(deps, refund.id, "retry", held);
    }
    return refund.state === "pending" ? resumeTenderRefund(deps, refund.id, "retry") : refund;
  } catch (error) {
    release?.();
    throw error;
  }
}
