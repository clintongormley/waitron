import { eq, inArray, or } from "drizzle-orm";
import { carryNewTenderRefund, refuseUntilRefundable } from "./tender-refund-completion.js";
import { requireEconomicWrite } from "./trading-admission.js";
import { refunds, tenders, type Transaction } from "@waitron/db";
import type { PinAttempts } from "@waitron/identity";
import { codeOf, type Logger } from "@waitron/server-kit";
import { payments, type PaymentProvider } from "@waitron/payments";
import { AppError, centsToDecimal } from "@waitron/shared";
import type { BillRefundDeps } from "./bill-refunds.js";
import { fileCorrectionAutomatically } from "./invoice-correction-alerts.js";
import { enqueueRefundDrawer } from "./receipt-print.js";
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
export type TenderRefundDeps = BillRefundDeps & { stopSignal?: AbortSignal; log?: Logger };
type RefundRow = typeof refunds.$inferSelect;

export function toTenderRefundView(row: RefundRow): TenderRefundView {
  return {
    id: row.id,
    saleId: row.saleId!,
    tenderId: row.tenderId!,
    state: row.state,
    appliedAmount: centsToDecimal(row.appliedAmount),
    tipAmount: centsToDecimal(row.tipAmount),
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

/** The capture each of the sale `saleId`'s payments `tenderIds` was taken with; undefined for one
 * no capture pairs with. */
export async function capturesFor(
  tx: Transaction,
  saleId: string,
  tenderIds: readonly string[],
): Promise<Map<string, typeof payments.$inferSelect | undefined>> {
  const found = new Map<string, typeof payments.$inferSelect | undefined>();
  if (tenderIds.length === 0) return found;
  const originals = await tx.select().from(tenders).where(eq(tenders.saleId, saleId));
  const billIds = originals.flatMap((row) =>
    row.billPaymentId === null ? [] : [row.billPaymentId],
  );
  const captures = await tx
    .select()
    .from(payments)
    .where(
      or(
        eq(payments.saleId, saleId),
        billIds.length === 0 ? undefined : inArray(payments.billPaymentId, billIds),
      ),
    );
  const directCards = originals.filter(
    (row) => row.method === "card" && row.billPaymentId === null,
  ).length;
  for (const tenderId of tenderIds) {
    const tender = originals.find((row) => row.id === tenderId);
    found.set(
      tenderId,
      tender === undefined
        ? undefined
        : matchTenderRefundCapture(
            { ...tender, amount: centsToDecimal(tender.amount) },
            captures,
            directCards,
          ),
    );
  }
  return found;
}

/** The capture `refund`'s payment was taken with. */
export async function captureFor(tx: Transaction, refund: RefundRow) {
  return (await capturesFor(tx, refund.saleId!, [refund.tenderId!])).get(refund.tenderId!);
}

/** Whether `provider`, looked up for a capture taken through `captureProvider`, can send its
 * refund at all; whether it takes a part refund is a separate check. */
export function sendsRefunds(
  provider: PaymentProvider | undefined,
  captureProvider: string,
): boolean {
  return provider?.provider === captureProvider && provider.sendRefund !== undefined;
}

/** Refuses `tender.refund_unavailable` when `reserved` is a reader card's refund its capture's
 * provider cannot send, or a part refund it cannot take. */
export async function refuseUnlessProviderRefunds(
  tx: Transaction,
  deps: Pick<TenderRefundDeps, "refundProviderFor">,
  reserved: RefundRow,
): Promise<void> {
  if (reserved.method !== "card" || reserved.manual) return;
  const capture = (await captureFor(tx, reserved))!;
  const provider = await deps.refundProviderFor?.(capture.provider);
  if (
    !sendsRefunds(provider, capture.provider) ||
    (!provider!.capabilities.partialRefund &&
      reserved.appliedAmount + reserved.tipAmount !== capture.amount)
  )
    throw new AppError("tender.refund_unavailable", { tenderId: reserved.tenderId! });
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
        { backend: deps.backend, reading },
      );
      if (begun.replayed) {
        if (begun.refund.state === "pending")
          await refuseUntilRefundable(tx, deps.backend, cfg.nodeId, reading);
        return toTenderRefundView(begun.refund);
      }
      const refund = await carryNewTenderRefund(tx, deps, cfg.nodeId, reading, begun.refund, {
        manualPaymentRef: async (reserved) => (await captureFor(tx, reserved))!.paymentRef,
        beforeCompletion: (reserved) => refuseUnlessProviderRefunds(tx, deps, reserved),
        openDrawer: (reserved, printers) =>
          enqueueRefundDrawer(
            tx,
            cfg,
            reserved.id,
            operator.personId,
            {
              authorizedBy: reserved.authorizedBy,
              viaOverride: reserved.authorizedBy !== operator.personId,
            },
            printers,
          ),
      });
      if (refund.state === "pending") claimConnected?.(refund.id);
      return toTenderRefundView(refund);
    },
  );
}

/** Gives a payment's money back; once a leg of a correction completes, files that correction if
 * its money is now all back (`fileCorrectionAutomatically`), never undoing the refund. A filing
 * that throws is logged and left to the background pass, so the saved refund is still answered. */
export async function refundSettledTender(
  deps: TenderRefundDeps,
  cfg: DeviceRequestConfig,
  saleId: string,
  request: TenderRefundRequest,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
): Promise<TenderRefundView> {
  const refund = await settleTenderRefund(deps, cfg, saleId, request, operator);
  const correctionId = request.invoiceCorrection?.id;
  if (refund.state === "completed" && correctionId !== undefined)
    await fileCorrectionAutomatically(deps, correctionId).catch((error: unknown) => {
      deps.log?.("error", "invoice_correction.automatic_filing_failed", {
        correctionId,
        refundId: refund.id,
        errorCode: codeOf(error),
      });
    });
  return refund;
}

async function settleTenderRefund(
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
