import { eq } from "drizzle-orm";
import { billPayments, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { recordIncidentOnce } from "@waitron/core";
import { findPaymentByBillPayment } from "@waitron/payments";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  tillId as brandTillId,
} from "@waitron/shared";
import { billPaymentIsLive, completeBillPayment, failBillPayment } from "./bill-payments.js";
import type { TillConfig } from "./till-config.js";
import type { TillSaleResult } from "./till-sale.js";
import "./errors.js";

/**
 * The work loop's half of a card bill payment (bill payments design §5.4): each pass settles the
 * pending card payments no attempt in this process is driving, from their provider's row.
 */

export interface BillPaymentsLoopDeps {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  /** The box's till configuration; an invoice is filed on the bill payment's own till. */
  cfg: TillConfig;
}

export interface BillPaymentsPass {
  received: number;
  failed: number;
  /** Captured for another amount than the payment's, left pending (counted on every pass). */
  mismatched: number;
  /** A payment this pass could not settle, left for the next. */
  errors: { billPaymentId: string; error: string }[];
}

/** The provider row's states that mean the card was charged. */
const CHARGED = new Set(["captured", "accepted_offline", "settled"]);

/** What {@link settleFromProviderRow} did; `left` names the provider row's state, or `pending` for a
 * payment no longer pending or live in this process. */
export type SettledFromRow =
  | { settled: "received"; invoice: TillSaleResult | null }
  | { settled: "failed" }
  | { settled: "mismatched" }
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
): Promise<SettledFromRow> {
  const [payment] = await tx.select().from(billPayments).where(eq(billPayments.id, billPaymentId));
  // Read in the transaction: a P1 registers its payment as live in its own, which this one excludes.
  if (payment?.state !== "pending" || billPaymentIsLive(deps.db, billPaymentId)) {
    return { settled: "left", providerState: "pending" };
  }
  const provided = await findPaymentByBillPayment(tx, billPaymentId);
  if (provided === undefined) {
    // The server's reader providers commit their row before any network call (`collect` in
    // `packages/payments-stripe/src/provider.ts` and `packages/payments-sumup/src/provider.ts`
    // runs `insertAttempting` first) and the simulator charges nothing real, so no row means no
    // reader was asked to charge. The on-device provider writes its row after the money moves, and
    // nothing under `apps/` builds it (design §5.4).
    await failBillPayment(tx, billPaymentId, now);
    return { settled: "failed" };
  }
  // A `failed` row is not proof that nothing moved (SumUp fails a checkout it cannot find), and an
  // `attempting` one may still be captured: both wait for a manager.
  if (!CHARGED.has(provided.state)) return { settled: "left", providerState: provided.state };
  const expected = centsToDecimal(payment.applied + payment.tip);
  if (compareDecimal(decimal(provided.amount), expected) !== 0) {
    await recordIncidentOnce(tx, {
      tillId: brandTillId(payment.tillId),
      error: new AppError("payment.bill_capture_mismatch", {
        billPaymentId,
        workingOrderId: payment.workingOrderId,
        captured: provided.amount,
        expected,
      }),
      severity: "error",
      detectedAt: now,
    });
    return { settled: "mismatched" };
  }
  const done = await completeBillPayment(
    tx,
    deps,
    deps.cfg,
    billPaymentId,
    provided.settledAt === null ? now : new Date(provided.settledAt),
  );
  return { settled: "received", invoice: done.invoice };
}

/**
 * One pass: a pending card payment not live in this process whose provider row is charged for its
 * amount is completed as the live attempt's P3 would have (the invoice included); one with no
 * provider row is failed; one charged for another amount raises `payment.bill_capture_mismatch`
 * and stays pending; any other stays pending for a manager. Each payment in its own transaction.
 */
export async function settlePendingBillPayments(
  deps: BillPaymentsLoopDeps,
): Promise<BillPaymentsPass> {
  const pending = await withTransaction(deps.db, (tx) =>
    tx
      .select({ id: billPayments.id })
      .from(billPayments)
      .where(eq(billPayments.state, "pending"))
      .orderBy(billPayments.createdAt),
  );
  const pass: BillPaymentsPass = { received: 0, failed: 0, mismatched: 0, errors: [] };
  for (const { id } of pending) {
    try {
      const { settled } = await withTransaction(deps.db, (tx) =>
        settleFromProviderRow(tx, deps, id, deps.clock.now().instant),
      );
      if (settled !== "left") pass[settled] += 1;
    } catch (error) {
      pass.errors.push({ billPaymentId: id, error: String(error) });
    }
  }
  return pass;
}
