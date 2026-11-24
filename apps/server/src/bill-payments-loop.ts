import { IssuanceRefusal, withIssuanceTransaction } from "@waitron/core";
import { eq, sql } from "drizzle-orm";
import { requireEconomicWrite } from "./trading-admission.js";
import { billPayments, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { recordIncidentOnce } from "@waitron/core";
import { codeOf } from "@waitron/server-kit";
import { findPaymentByBillPayment } from "@waitron/payments";
import { AppError, jobOrigin } from "@waitron/shared";
import {
  billPaymentIsLive,
  clockUnconfirmedRefusal,
  completeBillPayment,
  failBillPayment,
} from "./bill-payments.js";
import type { BillPaymentDeps } from "./bill-payments.js";
import type { TradingContext } from "./trading-context.js";
import { withSettledSlip, type SettledSlipPrinter } from "./payment-slip-print.js";
import type { TillSaleResult } from "./till-sale.js";
import type { GuestCountChoice } from "./receipt-guests.js";
import "./errors.js";

export interface BillPaymentsLoopDeps extends BillPaymentDeps {
  /** The box's till configuration; an invoice is recorded on the bill payment's node. */
  cfg: TradingContext;
  /** True while the start clock gate holds. */
  clockUnconfirmed?: () => boolean;
}

export interface BillPaymentsPass {
  received: number;
  failed: number;
  /** Payments this pass found pending and did not settle. */
  pending: number;
  /** A payment this pass could not settle, left for the next. */
  errors: { billPaymentId: string; error: string }[];
}

const PAYMENT_CHECK = jobOrigin("payment_check");

/** The provider row's states that mean the card was charged. */
export const CHARGED = new Set(["captured"]);

/** What {@link settleFromProviderRow} did; `left` names the provider row's state, or `pending` for a
 * payment no longer pending or live in this process. */
export type SettledFromRow =
  | { settled: "received"; invoice: TillSaleResult | null }
  | { settled: "failed" }
  | { settled: "left"; providerState: string };

/**
 * Settle one pending card bill payment nothing in this process drives, from its provider's row
 * alone (design §5.4), in the caller's transaction. Shared by the loop and the manager's resolve.
 */
export async function settleFromProviderRow(
  tx: Transaction,
  deps: BillPaymentsLoopDeps,
  billPaymentId: string,
  now: Date,
  print: SettledSlipPrinter,
  guestCount?: GuestCountChoice,
): Promise<SettledFromRow> {
  await requireEconomicWrite(tx, deps.cfg, deps.admission);
  const [payment] = await tx.select().from(billPayments).where(eq(billPayments.id, billPaymentId));
  // Read in the transaction: a P1 registers its payment as live in its own, which this one excludes.
  if (payment?.state !== "pending" || billPaymentIsLive(deps.db, billPaymentId)) {
    return { settled: "left", providerState: "pending" };
  }
  const failed = async (): Promise<SettledFromRow> => {
    await failBillPayment(tx, deps, deps.cfg, billPaymentId, now, undefined);
    await print(tx, billPaymentId);
    return { settled: "failed" };
  };
  const provided = await findPaymentByBillPayment(tx, billPaymentId);
  if (provided === undefined) {
    // The server's reader providers commit their row before any network call (`collect` in
    // `packages/payments-stripe/src/provider.ts` and `packages/payments-sumup/src/provider.ts`
    // runs `insertAttempting` first) and the simulator charges nothing real, so no row means no
    // reader was asked to charge. The on-device provider writes its row after the money moves, and
    // nothing under `apps/` builds it (design §5.4).
    return failed();
  }
  if (provided.state === "refunded") {
    return failed();
  }
  if (
    provided.state === "failed" &&
    provided.resolutionOutcome === "failed" &&
    provided.resolvedBy === null
  ) {
    return failed();
  }
  // An unaudited failure can be an uncertain charge (SumUp's not-found checkout).
  if (!CHARGED.has(provided.state)) return { settled: "left", providerState: provided.state };
  const done = await completeBillPayment(
    tx,
    deps,
    deps.cfg,
    billPaymentId,
    provided.settledAt === null ? now : new Date(provided.settledAt),
    { guestCount, datedByLatestAcceptance: true },
  );
  await print(tx, billPaymentId);
  return { settled: "received", invoice: done.invoice };
}

/**
 * One pass: a pending card payment not live in this process whose provider row is charged for its
 * actual amount is completed as the live attempt's P3 would have (the invoice included); one with no
 * provider row or with an automatic confirmed noncharge is failed; any other stays pending for a
 * manager. Each payment has its own transaction.
 */
export async function settlePendingBillPayments(
  deps: BillPaymentsLoopDeps,
): Promise<BillPaymentsPass> {
  deps.admission.require();
  const pending = await withTransaction(deps.db, (tx) =>
    tx
      .select({ id: billPayments.id })
      .from(billPayments)
      .where(eq(billPayments.state, "pending"))
      .orderBy(billPayments.createdAt, sql`${billPayments}.rowid`),
  );
  const pass: BillPaymentsPass = {
    received: 0,
    failed: 0,
    pending: pending.length,
    errors: [],
  };
  // While the gate holds it refuses the invoice, which is no failure to alert on: each payment
  // stays pending until it lets go. It can start holding mid-pass, when a clock set begins.
  for (const { id } of pending) {
    if (deps.clockUnconfirmed?.() === true) break;
    const now = deps.clock.now().instant;
    try {
      const { settled } = await withSettledSlip((print) =>
        withIssuanceTransaction(
          deps.db,
          (tx) => settleFromProviderRow(tx, deps, id, now, print),
          deps.log,
        ),
      );
      if (settled !== "left") pass[settled] += 1;
      if (settled === "received" || settled === "failed") pass.pending -= 1;
    } catch (error) {
      if (clockUnconfirmedRefusal(error)) break;
      pass.errors.push({ billPaymentId: id, error: String(error) });
      if (!(error instanceof IssuanceRefusal)) {
        await raiseSettleFailed(deps, id, error, now).catch((alertError: unknown) => {
          pass.errors.push({ billPaymentId: id, error: String(alertError) });
        });
      }
    }
  }
  return pass;
}

/**
 * `payment.bill_settle_failed` for a pending bill payment whose card was charged for it but which
 * could not be recorded, its invoice included: the bill stays locked, and the box's operator reads
 * the dashboard, not the log.
 */
async function raiseSettleFailed(
  deps: BillPaymentsLoopDeps,
  billPaymentId: string,
  error: unknown,
  now: Date,
): Promise<void> {
  await withTransaction(deps.db, async (tx) => {
    await requireEconomicWrite(tx, deps.cfg, deps.admission);
    const [payment] = await tx
      .select()
      .from(billPayments)
      .where(eq(billPayments.id, billPaymentId));
    const provided = await findPaymentByBillPayment(tx, billPaymentId);
    if (payment?.state !== "pending" || provided === undefined || !CHARGED.has(provided.state)) {
      return;
    }
    await recordIncidentOnce(tx, {
      origin: PAYMENT_CHECK,
      error: new AppError("payment.bill_settle_failed", {
        billPaymentId,
        workingOrderId: payment.workingOrderId,
        amount: provided.amount,
        errorCode: codeOf(error),
      }),
      severity: "error",
      detectedAt: now,
    });
  });
}
