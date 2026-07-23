import { and, eq, isNull, sql } from "drizzle-orm";
import { AppError, addDecimal, compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { payments } from "./schema/payments.js";
import { paymentRefunds } from "./schema/payment-refunds.js";
import type { PaymentState } from "./provider.js";

/** A payment row as the store reads it back. `state` is a `PaymentState`; `amount`/`settledAt` are
 * the raw column strings (numeric/timestamptz), left as strings so no float or timezone
 * normalisation happens on the way through. */
export interface PaymentRow {
  id: string;
  state: PaymentState;
  amount: string;
  saleId: string | null;
  settledAt: string | null;
}

interface Key {
  tenantId: string;
  provider: string;
  paymentRef: string;
}

interface NewPayment {
  tenantId: string;
  workingOrderId: string;
  provider: string;
  paymentRef: string;
  amount: Decimal;
  /** Optional human acquirer reference (e.g. a standalone bank terminal's operation number). Set by
   * manual tenders today, and reusable by integrated adapters later for the acquirer reference (as
   * `payments.external_ref`'s own schema comment notes); null when no such reference applies. */
  externalRef?: string;
}

const PAYMENT_COLUMNS = {
  id: payments.id,
  state: payments.state,
  amount: payments.amount,
  saleId: payments.saleId,
  settledAt: payments.settledAt,
};

async function insertPayment(
  tx: Transaction,
  params: NewPayment,
  state: PaymentState,
  settledAt: string | null,
): Promise<void> {
  await tx.insert(payments).values({
    tenantId: params.tenantId,
    workingOrderId: params.workingOrderId,
    provider: params.provider,
    paymentRef: params.paymentRef,
    amount: params.amount,
    externalRef: params.externalRef ?? null,
    state,
    settledAt,
  });
}

/** Insert a captured payment — the single-message `collect` success. state=captured, settledAt set
 * (the tender-settlement time that feeds `RecordSaleTender.settledAt`). */
export async function insertCapturedPayment(
  tx: Transaction,
  params: NewPayment & { settledAt: Date },
): Promise<void> {
  await insertPayment(tx, params, "captured", params.settledAt.toISOString());
}

/** Insert a failed payment — the network refused. state=failed, settledAt null. Persisted so a
 * declined attempt still leaves an audit record. Takes `Omit<NewPayment, "externalRef">`: a failed
 * attempt never settled on a terminal, so it must never carry a human acquirer reference — the type
 * forbids one being supplied, guaranteeing `external_ref` stays NULL for `state = failed`. */
export async function insertFailedPayment(
  tx: Transaction,
  params: Omit<NewPayment, "externalRef">,
): Promise<void> {
  await insertPayment(tx, params, "failed", null);
}

/** Reverse a captured payment in full — a same-day void, distinct from a refund (which records a
 * refund movement instead). Valid only from `captured`; anything else throws `payment.not_voidable`. */
export async function recordVoid(tx: Transaction, params: Key): Promise<PaymentRow> {
  const row = await requireRowForUpdate(tx, params);
  if (row.state !== "captured") {
    throw new AppError("payment.not_voidable", { paymentRef: params.paymentRef, state: row.state });
  }
  await tx
    .update(payments)
    .set({ state: "voided", updatedAt: sql`now()` })
    .where(keyWhere(params));
  return { ...row, state: "voided" };
}

/** Return captured funds, whole or partial. Refundable from `captured` or `partially_refunded`;
 * anything else throws `payment.not_refundable`. Throws `payment.refund_exceeds_capture` if the
 * running total of refunds would exceed what was captured. Sets the payment to `refunded` when the
 * running total reaches the captured amount, otherwise `partially_refunded`. */
export async function recordRefund(
  tx: Transaction,
  params: Key & { amount: Decimal },
): Promise<PaymentRow> {
  const row = await requireRowForUpdate(tx, params);
  if (row.state !== "captured" && row.state !== "partially_refunded") {
    throw new AppError("payment.not_refundable", {
      paymentRef: params.paymentRef,
      state: row.state,
    });
  }
  const prior = await tx
    .select({ amount: paymentRefunds.amount })
    .from(paymentRefunds)
    .where(and(eq(paymentRefunds.tenantId, params.tenantId), eq(paymentRefunds.paymentId, row.id)));
  const alreadyRefunded = sumDecimals(prior.map((r) => decimal(r.amount)));
  const afterThis = addDecimal(alreadyRefunded, params.amount);
  const captured = decimal(row.amount);
  if (compareDecimal(afterThis, captured) > 0) {
    throw new AppError("payment.refund_exceeds_capture", {
      paymentRef: params.paymentRef,
      captured,
      requested: params.amount,
      alreadyRefunded,
    });
  }
  await tx.insert(paymentRefunds).values({
    tenantId: params.tenantId,
    paymentId: row.id,
    provider: params.provider,
    paymentRef: params.paymentRef,
    amount: params.amount,
    state: "succeeded",
  });
  const state: PaymentState =
    compareDecimal(afterThis, captured) === 0 ? "refunded" : "partially_refunded";
  await tx
    .update(payments)
    .set({ state, updatedAt: sql`now()` })
    .where(keyWhere(params));
  return { ...row, state };
}

/** Set the payment's `sale_id` once `recordSale` has written the sale row — the Option B
 * associate-back. Call inside the sale transaction (before it commits) so the association commits
 * atomically with the sale, not after it (see the wiring test).
 *
 * The link is write-once: the UPDATE only matches a row whose `sale_id` is still NULL, so a
 * second call against an already-associated payment never re-points it at a different sale. When
 * the UPDATE matches nothing, a follow-up SELECT disambiguates why: no row at all throws
 * `payment.not_found`, a row that already carries a `sale_id` throws `payment.already_associated`. */
export async function associatePaymentWithSale(
  tx: Transaction,
  params: Key & { saleId: string },
): Promise<void> {
  const [row] = await tx
    .update(payments)
    .set({ saleId: params.saleId, updatedAt: sql`now()` })
    .where(and(keyWhere(params), isNull(payments.saleId)))
    .returning({ id: payments.id });
  if (row === undefined) {
    const existing = await getPaymentByRef(tx, params);
    if (existing === undefined) {
      throw new AppError("payment.not_found", {
        provider: params.provider,
        paymentRef: params.paymentRef,
      });
    }
    throw new AppError("payment.already_associated", {
      paymentRef: params.paymentRef,
      saleId: existing.saleId,
    });
  }
}

export async function getPaymentByRef(
  tx: Transaction,
  params: Key,
): Promise<PaymentRow | undefined> {
  const [row] = await tx.select(PAYMENT_COLUMNS).from(payments).where(keyWhere(params));
  return row;
}

/** A payment row plus its tenant, looked up by (provider, paymentRef) WITHOUT a tenant filter — the
 * lookup a provider uses when it holds only its own reference (e.g. the fake's `void`/`refund`, or a
 * real adapter's webhook). Under RLS with no tenant set this returns nothing (the policy hides every
 * row); callers that already hold a tenant scope, and the superuser test DB, see the row. */
export interface PaymentRecord extends PaymentRow {
  tenantId: string;
}

export async function findPaymentByRef(
  tx: Transaction,
  provider: string,
  paymentRef: string,
): Promise<PaymentRecord | undefined> {
  const [row] = await tx
    .select({ ...PAYMENT_COLUMNS, tenantId: payments.tenantId })
    .from(payments)
    .where(and(eq(payments.provider, provider), eq(payments.paymentRef, paymentRef)))
    .limit(1);
  return row;
}

function keyWhere(params: Key) {
  return and(
    eq(payments.tenantId, params.tenantId),
    eq(payments.provider, params.provider),
    eq(payments.paymentRef, params.paymentRef),
  );
}

/** Locking row fetch for the reversal paths. Selects the payment row `FOR UPDATE` so concurrent
 * `recordVoid`/`recordRefund` calls against the same payment serialise: the second reversal blocks
 * until the first commits, then re-reads the updated state (and, for refund, the updated
 * `payment_refunds` total) instead of racing on a stale snapshot. Throws `payment.not_found` when
 * absent, and mirrors the fiscal layer's `lockChainHead` (`.for("update")`). Read-only callers
 * (`getPaymentByRef`/`findPaymentByRef`) stay UNLOCKED. */
async function requireRowForUpdate(tx: Transaction, params: Key): Promise<PaymentRow> {
  const [row] = await tx
    .select(PAYMENT_COLUMNS)
    .from(payments)
    .where(keyWhere(params))
    .for("update");
  if (row === undefined) {
    throw new AppError("payment.not_found", {
      provider: params.provider,
      paymentRef: params.paymentRef,
    });
  }
  return row;
}
