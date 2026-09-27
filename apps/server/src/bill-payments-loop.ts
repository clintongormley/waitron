import { eq } from "drizzle-orm";
import { billPaymentRefunds, billPayments, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { recordIncidentOnce } from "@waitron/core";
import { codeOf } from "@waitron/server-kit";
import { findPaymentByBillPayment } from "@waitron/payments";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  tillId as brandTillId,
} from "@waitron/shared";
import { raiseRefundUnresolved } from "./bill-refund-alerts.js";
import { billPaymentIsLive, completeBillPayment, failBillPayment } from "./bill-payments.js";
import { resumeCardRefund } from "./bill-refunds.js";
import type { RefundProviderFor } from "./bill-refunds.js";
import { perDatabase } from "./live-in-process.js";
import type { TillConfig } from "./till-config.js";
import type { TillSaleResult } from "./till-sale.js";
import "./errors.js";

/**
 * The work loop's half of a card bill payment (bill payments design §5.4, §6b): each pass settles
 * the pending card payments no attempt in this process is driving, from their provider's row, and
 * looks up the pending card refunds nothing is driving, never sending one.
 */

/** How long a card refund may stay pending before `payment.refund_unresolved` is raised (design
 * §6b: "an alert fires after an hour"). */
const REFUND_UNRESOLVED_AFTER_MS = 60 * 60 * 1000;

const REFUND_LOOKUP_EVERY_PASS_MS = 5 * 60 * 1000;
const REFUND_LOOKUP_MAX_GAP_MS = 30 * 60 * 1000;

/**
 * How long the loop waits between two lookups of a refund sent `sentAgeMs` ago: none for its first
 * five minutes, then a quarter of its age up to half an hour, so a refund stuck for hours costs its
 * provider two requests an hour rather than one per pass.
 */
export function refundLookupGapMs(sentAgeMs: number): number {
  if (sentAgeMs < REFUND_LOOKUP_EVERY_PASS_MS) return 0;
  return Math.min(sentAgeMs / 4, REFUND_LOOKUP_MAX_GAP_MS);
}

/** When the loop last looked each pending refund up, per venue store. Kept in memory: after a
 * restart every pending refund is looked up once on the first pass. */
const lastLookupsOf = perDatabase(() => new Map<string, number>());

export interface BillPaymentsLoopDeps {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  /** The box's till configuration; an invoice is filed on the bill payment's own till. */
  cfg: TillConfig;
  /** The card providers pending refunds are looked up at; without it none is looked up. */
  refundProviderFor?: RefundProviderFor;
}

export interface BillPaymentsPass {
  received: number;
  failed: number;
  /** Captured for another amount than the payment's, left pending (counted on every pass). */
  mismatched: number;
  refundsCompleted: number;
  refundsFailed: number;
  /** Refunds pending over an hour, counted on every pass. */
  refundsUnresolved: number;
  /** The payments and refunds this pass found pending and did not settle. */
  pending: number;
  /** A payment or refund this pass could not settle, left for the next. */
  errors: (({ billPaymentId: string } | { refundId: string }) & { error: string })[];
}

type RefundRow = typeof billPaymentRefunds.$inferSelect;

/** The provider row's states that mean the card was charged. */
export const CHARGED = new Set(["captured", "accepted_offline", "settled"]);

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
  const pass: BillPaymentsPass = {
    received: 0,
    failed: 0,
    mismatched: 0,
    refundsCompleted: 0,
    refundsFailed: 0,
    refundsUnresolved: 0,
    pending: pending.length,
    errors: [],
  };
  for (const { id } of pending) {
    const now = deps.clock.now().instant;
    try {
      const { settled } = await withTransaction(deps.db, (tx) =>
        settleFromProviderRow(tx, deps, id, now),
      );
      if (settled !== "left") pass[settled] += 1;
      if (settled === "received" || settled === "failed") pass.pending -= 1;
    } catch (error) {
      pass.errors.push({ billPaymentId: id, error: String(error) });
      await raiseSettleFailed(deps, id, error, now).catch((alertError: unknown) => {
        pass.errors.push({ billPaymentId: id, error: String(alertError) });
      });
    }
  }
  await settlePendingBillRefunds(deps, pass);
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
    const [payment] = await tx
      .select()
      .from(billPayments)
      .where(eq(billPayments.id, billPaymentId));
    const provided = await findPaymentByBillPayment(tx, billPaymentId);
    if (payment?.state !== "pending" || provided === undefined || !CHARGED.has(provided.state)) {
      return;
    }
    await recordIncidentOnce(tx, {
      tillId: brandTillId(payment.tillId),
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

/**
 * The refund half of a pass (design §6b): each pending card refund nothing in this process drives
 * is failed when it never reached its provider, else looked up, at most as often as
 * {@link refundLookupGapMs} allows, and settled by the evidence table, never sent again. One still
 * pending an hour after it was asked for raises `payment.refund_unresolved` on the till that gave
 * it, whether or not this pass looked it up.
 */
async function settlePendingBillRefunds(
  deps: BillPaymentsLoopDeps,
  pass: BillPaymentsPass,
): Promise<void> {
  const pending = await withTransaction(deps.db, (tx) =>
    tx
      .select({ refund: billPaymentRefunds, workingOrderId: billPayments.workingOrderId })
      .from(billPaymentRefunds)
      .innerJoin(billPayments, eq(billPayments.id, billPaymentRefunds.billPaymentId))
      .where(eq(billPaymentRefunds.state, "pending"))
      .orderBy(billPaymentRefunds.createdAt),
  );
  pass.pending += pending.length;
  const lastLookups = lastLookupsOf(deps.db);
  const pendingIds = new Set(pending.map(({ refund }) => refund.id));
  for (const id of lastLookups.keys()) {
    if (!pendingIds.has(id)) lastLookups.delete(id);
  }
  for (const { refund: found, workingOrderId } of pending) {
    const id = found.id;
    try {
      let refund = found;
      const now = deps.clock.now().instant;
      if (lookupDue(found, lastLookups.get(id), now.getTime())) {
        const resumed = await resumeCardRefund(deps, id, "loop");
        if (!resumed.claimed) continue;
        lastLookups.set(id, now.getTime());
        refund = resumed.refund;
        if (refund.state === "completed") pass.refundsCompleted += 1;
        if (refund.state === "failed") pass.refundsFailed += 1;
      }
      if (refund.state !== "pending") {
        pass.pending -= 1;
        continue;
      }
      if (now.getTime() - Date.parse(refund.createdAt) > REFUND_UNRESOLVED_AFTER_MS) {
        pass.refundsUnresolved += 1;
        await withTransaction(deps.db, (tx) =>
          raiseRefundUnresolved(tx, refund, workingOrderId, now),
        );
      }
    } catch (error) {
      pass.errors.push({ refundId: id, error: String(error) });
    }
  }
}

/** A refund never sent is failed at once, asking nothing; a sent one waits out its lookup gap. A
 * lookup stamped after `now` (the clock went back) does not hold the next one off. */
function lookupDue(refund: RefundRow, lastLookup: number | undefined, now: number): boolean {
  if (refund.sentAt === null || lastLookup === undefined || lastLookup > now) return true;
  return now - lastLookup >= refundLookupGapMs(now - Date.parse(refund.sentAt));
}
