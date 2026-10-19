import { asc, eq, isNull } from "drizzle-orm";
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

/** True when this call wrote the hold; false when the payment was already held. */
export async function recordHold(
  tx: Transaction,
  params: { paymentId: string; providerAmount: Decimal; foundAt: Date },
): Promise<boolean> {
  const written = await tx
    .insert(paymentHolds)
    .values({
      paymentId: params.paymentId,
      providerAmount: decimalToCents(params.providerAmount),
      foundAt: params.foundAt.toISOString(),
    })
    .onConflictDoNothing({ target: paymentHolds.paymentId })
    .returning({ id: paymentHolds.id });
  return written.length > 0;
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
