import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { newId } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, centsToDecimal, decimalToCents } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import "./errors.js";
import { paymentHoldOutcomes, paymentHolds } from "./schema/payment-holds.js";
import { payments } from "./schema/payments.js";

export interface OpenHold {
  holdId: string;
  paymentId: string;
  paymentRef: string;
  provider: string;
  /** What was charged here. */
  amount: Decimal;
  /** What the provider paid out. */
  providerAmount: Decimal;
  settledAt: string | null;
  workingOrderId: string;
  foundAt: string;
}

export type HoldOutcome = "refunded_at_provider" | "kept";

/** `written` by this call, `existing` from an earlier one, or `refused`: a payment claimed for a
 * refund is never held, so the two cannot both happen to one payment. */
export type HoldWrite = "written" | "existing" | "refused";

export async function recordHold(
  tx: Transaction,
  params: { paymentId: string; providerAmount: Decimal; foundAt: Date },
): Promise<HoldWrite> {
  const written = await tx
    .insert(paymentHolds)
    .select(
      tx
        .select({
          id: sql<string>`${newId()}`.as("id"),
          paymentId: payments.id,
          providerAmount: sql<number>`${decimalToCents(params.providerAmount)}`.as(
            "provider_amount",
          ),
          foundAt: sql<string>`${params.foundAt.toISOString()}`.as("found_at"),
        })
        .from(payments)
        .where(and(eq(payments.id, params.paymentId), isNull(payments.reconcileRemediatedAt))),
    )
    .onConflictDoNothing({ target: paymentHolds.paymentId })
    .returning({ id: paymentHolds.id });
  if (written.length > 0) return "written";
  return (await holdExists(tx, params.paymentId)) ? "existing" : "refused";
}

export async function holdExists(tx: Transaction, paymentId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: paymentHolds.id })
    .from(paymentHolds)
    .where(eq(paymentHolds.paymentId, paymentId));
  return row !== undefined;
}

/** Every hold with no recorded outcome, oldest first. */
export async function listOpenHolds(tx: Transaction): Promise<OpenHold[]> {
  const rows = await tx
    .select({
      holdId: paymentHolds.id,
      paymentId: payments.id,
      paymentRef: payments.paymentRef,
      provider: payments.provider,
      amount: payments.amount,
      providerAmount: paymentHolds.providerAmount,
      settledAt: payments.settledAt,
      workingOrderId: payments.workingOrderId,
      foundAt: paymentHolds.foundAt,
    })
    .from(paymentHolds)
    .innerJoin(payments, eq(payments.id, paymentHolds.paymentId))
    .leftJoin(paymentHoldOutcomes, eq(paymentHoldOutcomes.holdId, paymentHolds.id))
    .where(isNull(paymentHoldOutcomes.id))
    .orderBy(asc(paymentHolds.foundAt), asc(paymentHolds.id));
  return rows.map((row) => ({
    ...row,
    amount: centsToDecimal(row.amount),
    providerAmount: centsToDecimal(row.providerAmount),
  }));
}

/** Throws `payment.hold_not_found` for an unknown hold and `payment.hold_already_recorded` when
 * the hold already has an outcome. */
export async function recordHoldOutcome(
  tx: Transaction,
  params: {
    holdId: string;
    outcome: HoldOutcome;
    note: string | null;
    personId: string;
    at: Date;
  },
): Promise<{ id: string }> {
  const [hold] = await tx
    .select({ id: paymentHolds.id })
    .from(paymentHolds)
    .where(eq(paymentHolds.id, params.holdId));
  if (hold === undefined) throw new AppError("payment.hold_not_found", { holdId: params.holdId });
  const [written] = await tx
    .insert(paymentHoldOutcomes)
    .values({
      holdId: params.holdId,
      outcome: params.outcome,
      note: params.note,
      personId: params.personId,
      recordedAt: params.at.toISOString(),
    })
    .onConflictDoNothing({ target: paymentHoldOutcomes.holdId })
    .returning({ id: paymentHoldOutcomes.id });
  if (written === undefined) {
    throw new AppError("payment.hold_already_recorded", { holdId: params.holdId });
  }
  return written;
}
