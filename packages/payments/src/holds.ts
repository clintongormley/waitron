import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError, centsToDecimal, decimalToCents } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import "./errors.js";
import { paymentHoldOutcome, payments } from "./schema/payments.js";
import { CHUNK_SIZE } from "./store.js";

export interface OpenHold {
  paymentId: string;
  paymentRef: string;
  provider: string;
  amount: Decimal;
  providerAmount: Decimal;
  settledAt: string | null;
  workingOrderId: string;
  heldAt: string;
}

export type HoldOutcome = (typeof paymentHoldOutcome.enumValues)[number];
export type HoldWrite = "written" | "existing" | "refused";

export async function recordHold(
  tx: Transaction,
  params: { paymentId: string; providerAmount: Decimal; foundAt: Date },
): Promise<HoldWrite> {
  const [written] = await tx
    .update(payments)
    .set({
      holdProviderAmount: decimalToCents(params.providerAmount),
      heldAt: params.foundAt.toISOString(),
    })
    .where(
      and(
        eq(payments.id, params.paymentId),
        isNull(payments.heldAt),
        isNull(payments.reconcileRemediatedAt),
      ),
    )
    .returning({ id: payments.id });
  if (written !== undefined) return "written";
  return (await holdExists(tx, params.paymentId)) ? "existing" : "refused";
}

export async function holdExists(tx: Transaction, paymentId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.id, paymentId), isNotNull(payments.heldAt)));
  return row !== undefined;
}

export async function resolvedHoldsAmong(
  tx: Transaction,
  paymentIds: string[],
): Promise<Set<string>> {
  const resolved = new Set<string>();
  for (let i = 0; i < paymentIds.length; i += CHUNK_SIZE) {
    const rows = await tx
      .select({ paymentId: payments.id })
      .from(payments)
      .where(
        and(
          inArray(payments.id, paymentIds.slice(i, i + CHUNK_SIZE)),
          isNotNull(payments.holdOutcome),
        ),
      );
    for (const row of rows) resolved.add(row.paymentId);
  }
  return resolved;
}

export function openHoldsQuery(tx: Transaction) {
  return tx
    .select({
      paymentId: payments.id,
      paymentRef: payments.paymentRef,
      provider: payments.provider,
      amount: payments.amount,
      providerAmount: payments.holdProviderAmount,
      settledAt: payments.settledAt,
      workingOrderId: payments.workingOrderId,
      heldAt: payments.heldAt,
    })
    .from(payments)
    .where(and(isNotNull(payments.heldAt), isNull(payments.holdOutcome)))
    .orderBy(asc(payments.heldAt), asc(payments.id));
}

export async function listOpenHolds(tx: Transaction): Promise<OpenHold[]> {
  const rows = await openHoldsQuery(tx);
  return rows.map((row) => ({
    ...row,
    amount: centsToDecimal(row.amount),
    providerAmount: centsToDecimal(row.providerAmount!),
    heldAt: row.heldAt!,
  }));
}

export async function recordHoldOutcome(
  tx: Transaction,
  params: {
    paymentId: string;
    outcome: HoldOutcome;
    note: string | null;
    personId: string;
    at: Date;
  },
): Promise<void> {
  const [written] = await tx
    .update(payments)
    .set({
      holdOutcome: params.outcome,
      holdNote: params.note,
      holdDecidedBy: params.personId,
      holdDecidedAt: params.at.toISOString(),
    })
    .where(
      and(
        eq(payments.id, params.paymentId),
        isNotNull(payments.heldAt),
        isNull(payments.holdOutcome),
      ),
    )
    .returning({ id: payments.id });
  if (written !== undefined) return;
  const code = (await holdExists(tx, params.paymentId))
    ? "payment.hold_already_recorded"
    : "payment.hold_not_found";
  throw new AppError(code, { paymentId: params.paymentId });
}
