import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { AppError, addDecimal, compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import { workingOrders } from "@waitron/db";
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
  /** The processor's own reference (e.g. a Stripe PaymentIntent id) / a manual acquirer ref; null
   * when none. Read-side of the `external_ref` column, needed by the reversal path to address the
   * processor. */
  externalRef: string | null;
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
  externalRef: payments.externalRef,
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

/** Insert an offline-accepted payment — state=accepted_offline, settledAt SET (the acceptance
 * time that feeds `RecordSaleTender.settledAt`, so the sale chains immediately). `forward()` later
 * advances it to `settled` or `declined`. Written only when the offline gate accepted. */
export async function insertAcceptedOffline(
  tx: Transaction,
  params: NewPayment & { settledAt: Date },
): Promise<void> {
  await insertPayment(tx, params, "accepted_offline", params.settledAt.toISOString());
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

/** Insert an in-flight payment — state=attempting, settledAt null. Committed BEFORE a provider's
 * network call (T1) so a crash mid-network leaves a recoverable row and the `payment_ref` (the
 * caller's idempotency anchor) is already claimed. Resolved by `captureAttempting`/`failAttempting`
 * (T2). Only network-driving integrated adapters use it; manual mode never does. */
export async function insertAttempting(tx: Transaction, params: NewPayment): Promise<void> {
  await insertPayment(tx, params, "attempting", null);
}

/** Resolve an `attempting` row to `captured` (T2 success): sets `settled_at` (the tender-settlement
 * time) and `external_ref` (the processor's own reference, e.g. a Stripe PaymentIntent id). Matches
 * only a row still `attempting`; if none matches, throws `payment.not_found`. */
export async function captureAttempting(
  tx: Transaction,
  params: Key & { settledAt: Date; externalRef: string },
): Promise<PaymentRow> {
  return resolveAttempting(tx, params, "captured", {
    settledAt: params.settledAt.toISOString(),
    externalRef: params.externalRef,
  });
}

/** Resolve an `attempting` row to `failed` (T2 failure — the network refused or timed out). Matches
 * only a row still `attempting`; if none matches, throws `payment.not_found`. */
export async function failAttempting(tx: Transaction, params: Key): Promise<PaymentRow> {
  return resolveAttempting(tx, params, "failed", {});
}

async function resolveAttempting(
  tx: Transaction,
  params: Key,
  state: "captured" | "failed",
  extra: { settledAt?: string; externalRef?: string },
): Promise<PaymentRow> {
  const [row] = await tx
    .update(payments)
    .set({
      state,
      settledAt: extra.settledAt ?? null,
      externalRef: extra.externalRef ?? null,
      updatedAt: sql`now()`,
    })
    .where(and(keyWhere(params), eq(payments.state, "attempting")))
    .returning(PAYMENT_COLUMNS);
  if (row === undefined) {
    throw new AppError("payment.not_found", {
      provider: params.provider,
      paymentRef: params.paymentRef,
    });
  }
  return row;
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
  params: Key & { amount: Decimal; authorizedBy?: string },
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
    .where(
      and(
        eq(paymentRefunds.tenantId, params.tenantId),
        eq(paymentRefunds.paymentId, row.id),
        eq(paymentRefunds.state, "succeeded"),
      ),
    );
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
    authorizedBy: params.authorizedBy ?? null,
  });
  const state: PaymentState =
    compareDecimal(afterThis, captured) === 0 ? "refunded" : "partially_refunded";
  await tx
    .update(payments)
    .set({ state, updatedAt: sql`now()` })
    .where(keyWhere(params));
  return { ...row, state };
}

/** Record a refund the processor REFUSED — a `payment_refunds` row with `state='failed'`. The
 * payment's own state is unchanged (nothing was returned), and this refund is excluded from
 * `recordRefund`'s balance sum, so a later succeeded refund of the same amount is still allowed. No
 * `FOR UPDATE` needed: it neither reads a running total nor transitions the payment. */
export async function recordFailedRefund(
  tx: Transaction,
  params: Key & { amount: Decimal; authorizedBy?: string },
): Promise<void> {
  const row = await getPaymentByRef(tx, params);
  if (row === undefined) {
    throw new AppError("payment.not_found", {
      provider: params.provider,
      paymentRef: params.paymentRef,
    });
  }
  await tx.insert(paymentRefunds).values({
    tenantId: params.tenantId,
    paymentId: row.id,
    provider: params.provider,
    paymentRef: params.paymentRef,
    amount: params.amount,
    state: "failed",
    authorizedBy: params.authorizedBy ?? null,
  });
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

/** A captured (or offline-accepted) payment found for a working order — the §4 capture-idempotency
 * pre-check's result. `saleId` NULL is the "collect committed, P3 never ran" recovery window; set
 * means the sale is already filed and the pay is a replay. `amount`/`settledAt`/`externalRef` are the
 * raw column strings, so the recovery path can reconstruct the tender and associate this exact row. */
export interface CapturedPaymentForOrder {
  id: string;
  paymentRef: string;
  amount: string; // numeric(12,2) as text
  saleId: string | null;
  externalRef: string | null;
  settledAt: string | null; // always set for captured/accepted_offline, but typed nullable like the column
  state: "captured" | "accepted_offline";
}

const CAPTURED_FOR_ORDER_COLUMNS = {
  ...PAYMENT_COLUMNS,
  paymentRef: payments.paymentRef,
};

/** The §4 capture-idempotency pre-check: has this working order already got a captured (or
 * offline-accepted) payment for this provider? Read-only, over existing columns/`payments_working_order_idx`.
 * A `failed`/`attempting` row is NOT captured, so a legitimately-declined card stays re-chargeable and
 * a lost-T2 `attempting` orphan is never mistaken for a completed capture (§4).
 *
 * At most one captured/accepted_offline payment exists per working order BY CONSTRUCTION, not by a DB
 * constraint (`payments` carries no unique index over `(tenant_id, provider, working_order_id)`
 * restricted to those states): Task 1 derives the Stripe PaymentIntent-creation idempotency key from
 * the working-order id (`wo_<id>`, `packages/payments-stripe`), so every retry drives the SAME
 * PaymentIntent to at most one capture — and this pre-check is itself the thing that stops a caller
 * from proceeding to a second `collect` once the first capture exists (spec §4). Split-tender (more
 * than one payment per working order) is out of scope for this slice. `ORDER BY settled_at DESC`
 * makes the read deterministic regardless, and if that invariant is ever violated it returns the MOST
 * RECENT captured row rather than an arbitrary one — this is a pre-check, so it degrades rather than
 * throwing on an unexpected second row. */
export async function findCapturedPaymentForWorkingOrder(
  tx: Transaction,
  key: { tenantId: string; provider: string; workingOrderId: string },
): Promise<CapturedPaymentForOrder | undefined> {
  const [row] = await tx
    .select(CAPTURED_FOR_ORDER_COLUMNS)
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, key.tenantId),
        eq(payments.provider, key.provider),
        eq(payments.workingOrderId, key.workingOrderId),
        inArray(payments.state, ["captured", "accepted_offline"]),
      ),
    )
    .orderBy(desc(payments.settledAt))
    .limit(1);
  return row as CapturedPaymentForOrder | undefined;
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

/** One accepted-offline payment claimed for a forward pass. `saleId` is null only for an orphan
 * (accepted but never associated); the fake/adapter uses `workingOrderId` to find the till for the
 * decline incident. */
export interface ForwardablePayment {
  tenantId: string;
  paymentRef: string;
  workingOrderId: string;
  saleId: string | null;
  amount: string;
}

const FORWARDABLE_COLUMNS = {
  tenantId: payments.tenantId,
  paymentRef: payments.paymentRef,
  workingOrderId: payments.workingOrderId,
  saleId: payments.saleId,
  amount: payments.amount,
};

/**
 * The predicate both forward-queue reads share — kept as one function so the twins below cannot
 * drift, which they briefly did when only one of them gained the tenant filter.
 *
 * Filters `tenant_id` EXPLICITLY, defence in depth alongside the RLS policy — the convention
 * fiscal's `pendingCount` already follows. Not belt-and-braces: relying on the policy alone made
 * these queries return DIFFERENT rows in different environments, because PGlite connects as
 * superuser and bypasses FORCE ROW LEVEL SECURITY. Every hermetic test therefore saw every
 * tenant's `accepted_offline` rows, so a `forward` pass counted other tenants' unresolved refs as
 * its own, while the same code under a real role saw only its own tenant's. The predicate makes
 * both agree — which is what makes a hermetic test of a forward pass mean anything at all.
 */
function forwardableWhere(tenantId: string, provider: string) {
  return and(
    eq(payments.tenantId, tenantId),
    eq(payments.provider, provider),
    eq(payments.state, "accepted_offline"),
  );
}

/**
 * Claim this provider's accepted-offline payments for a forward pass, locking each row FOR UPDATE
 * SKIP LOCKED so concurrent `forward` passes partition the queue and never double-advance a row.
 * State IS the queue (no outbox table). Ordered by `created_at` for a stable pass.
 *
 * Takes the same `tenantId` as its unlocked twin, and for the same reason — see
 * `forwardableWhere`. Its only caller today is `FakePaymentProvider`, whose single-transaction
 * drain has no network call to split around; a REAL adapter uses `listAcceptedOffline` instead so
 * it never holds a row lock across the processor round-trip.
 */
export async function claimAcceptedOffline(
  tx: Transaction,
  tenantId: string,
  provider: string,
): Promise<ForwardablePayment[]> {
  return tx
    .select(FORWARDABLE_COLUMNS)
    .from(payments)
    .where(forwardableWhere(tenantId, provider))
    .orderBy(payments.createdAt)
    .for("update", { skipLocked: true });
}

/** Like `claimAcceptedOffline` but WITHOUT the row lock — the T1 read a real adapter's `forward` uses
 * to list its pending offline payments before the (device) network sync, so it never holds a lock
 * across the network call (T1/T2). Concurrency safety comes instead from the idempotent, state-guarded
 * `settleForwarded`/`declineForwarded` advances in T2 (each matches only a row still `accepted_offline`)
 * plus the race-safe incident dedup — two concurrent forwards listing the same refs is harmless. The
 * fake's single-transaction `forward` keeps using the locking `claimAcceptedOffline`. */
export async function listAcceptedOffline(
  tx: Transaction,
  tenantId: string,
  provider: string,
): Promise<ForwardablePayment[]> {
  return tx
    .select(FORWARDABLE_COLUMNS)
    .from(payments)
    .where(forwardableWhere(tenantId, provider))
    .orderBy(payments.createdAt);
}

/** Advance a forwarded offline payment to `settled` (the network cleared it). Matches only a row
 * still `accepted_offline`, so re-running a completed forward is a no-op (idempotent). */
export async function settleForwarded(tx: Transaction, params: Key): Promise<void> {
  return advanceAcceptedOffline(tx, params, "settled");
}

/** Advance a forwarded offline payment to `declined` (the network refused). Matches only a row
 * still `accepted_offline` (idempotent). The uncollected-receivable incident is raised by the
 * caller (the `forward` implementation), not here — keeping `@waitron/core` out of this neutral
 * store, exactly as fiscal's `drain` raises incidents in the adapter, not in `packages/fiscal`. */
export async function declineForwarded(tx: Transaction, params: Key): Promise<void> {
  return advanceAcceptedOffline(tx, params, "declined");
}

/** Shared body of `settleForwarded`/`declineForwarded`: advance a row still `accepted_offline` to
 * the given terminal state. Matches only a row still `accepted_offline`, so re-running a completed
 * forward is a no-op (idempotent) whichever state it targets. */
async function advanceAcceptedOffline(
  tx: Transaction,
  params: Key,
  state: "settled" | "declined",
): Promise<void> {
  await tx
    .update(payments)
    .set({ state, updatedAt: sql`now()` })
    .where(and(keyWhere(params), eq(payments.state, "accepted_offline")));
}

/** The row `settleInitiated` returns when it advances a hosted payment, enough for the app-level
 * orchestrator to chain `recordSale`: the still-open working order, the captured amount, and the
 * payment_ref association key. */
export interface SettledInitiated {
  workingOrderId: string;
  amount: string;
  paymentRef: string;
}

/** Insert a minted-but-unpaid hosted payment — Mode 3's `initiate`. state=initiated, settledAt null,
 * external_ref = the hosted-payment id (required: it is the resolve/settle key the webhook carries).
 * The working order stays open until the inbound settlement advances this row. */
export async function insertInitiated(
  tx: Transaction,
  params: NewPayment & { externalRef: string },
): Promise<void> {
  await insertPayment(tx, params, "initiated", null);
}

/** Advance a hosted payment still `initiated` -> `captured`, setting `settled_at`. Keyed by
 * `(provider, external_ref)` — all the inbound webhook carries — under the caller's tenant scope
 * (RLS), guarded by `state = 'initiated'`. Returns the row when it advanced, `null` when it matched
 * nothing (already captured — an at-least-once redelivery). That row-or-null is the idempotency
 * signal the orchestrator branches on: it chains `recordSale` only on a non-null return, so no second
 * invoice number is ever allocated. Mirrors `settleForwarded`'s state-guarded, idempotent advance. */
export async function settleInitiated(
  tx: Transaction,
  params: { provider: string; externalRef: string; settledAt: Date },
): Promise<SettledInitiated | null> {
  const [row] = await tx
    .update(payments)
    .set({ state: "captured", settledAt: params.settledAt.toISOString(), updatedAt: sql`now()` })
    .where(
      and(
        eq(payments.provider, params.provider),
        eq(payments.externalRef, params.externalRef),
        eq(payments.state, "initiated"),
      ),
    )
    .returning({
      workingOrderId: payments.workingOrderId,
      amount: payments.amount,
      paymentRef: payments.paymentRef,
    });
  return row ?? null;
}

/** Advance a hosted payment still `initiated` -> `failed` (the customer abandoned / it expired).
 * State-guarded and idempotent, like `settleInitiated`; the working order stays open so staff can
 * take another tender. */
export async function expireInitiated(
  tx: Transaction,
  params: { provider: string; externalRef: string },
): Promise<void> {
  await tx
    .update(payments)
    .set({ state: "failed", updatedAt: sql`now()` })
    .where(
      and(
        eq(payments.provider, params.provider),
        eq(payments.externalRef, params.externalRef),
        eq(payments.state, "initiated"),
      ),
    );
}

/** Resolve the tenant that owns a hosted payment from `(provider, external_ref)` alone — the ONLY
 * identifiers an inbound webhook carries, with NO tenant context. Calls the `resolve_payment_tenant`
 * SECURITY DEFINER seam, the single controlled RLS bypass (it returns only tenant_id). Runs on a
 * plain `db` handle, OUTSIDE any tenant scope — the app-level orchestrator calls this first, then
 * opens `withTenant(tenantId)` for the settle + `recordSale` + associate. Returns null for an unknown
 * reference (the missingLocal case reconcile audits per-tenant). Mirrors fiscal drain's
 * `tenantsWithWork` call over `envios_tenants_with_work`. */
export async function resolvePaymentTenant(
  db: Database,
  provider: string,
  externalRef: string,
): Promise<string | null> {
  const result = await db.execute<{ tenant_id: string | null }>(
    sql`select resolve_payment_tenant(${provider}, ${externalRef}) as tenant_id`,
  );
  return result.rows[0]?.tenant_id ?? null;
}

function keyWhere(params: Key) {
  return and(
    eq(payments.tenantId, params.tenantId),
    eq(payments.provider, params.provider),
    eq(payments.paymentRef, params.paymentRef),
  );
}

/** Read-only reversibility pre-check for integrated adapters: validates a payment can be reversed the
 * requested way BEFORE the adapter issues the processor's (irreversible) refund, so an invalid local
 * state fails fast without moving money. Mirrors the checks `recordVoid`/`recordRefund` enforce under
 * FOR UPDATE — this is the pre-network read; those stay the authoritative locked checks (a concurrent
 * reversal slipping between this read and the write is bounded by their lock and audited by reconcile).
 * Throws the same `payment.not_found`/`payment.not_voidable`/`payment.not_refundable`/
 * `payment.refund_exceeds_capture` those functions do. */
export async function assertReversible(
  tx: Transaction,
  params: Key & { kind: "void" | "refund"; amount?: Decimal },
): Promise<void> {
  const row = await getPaymentByRef(tx, params);
  if (row === undefined) {
    throw new AppError("payment.not_found", {
      provider: params.provider,
      paymentRef: params.paymentRef,
    });
  }
  if (params.kind === "void") {
    if (row.state !== "captured") {
      throw new AppError("payment.not_voidable", {
        paymentRef: params.paymentRef,
        state: row.state,
      });
    }
    return;
  }
  if (row.state !== "captured" && row.state !== "partially_refunded") {
    throw new AppError("payment.not_refundable", {
      paymentRef: params.paymentRef,
      state: row.state,
    });
  }
  const prior = await tx
    .select({ amount: paymentRefunds.amount })
    .from(paymentRefunds)
    .where(
      and(
        eq(paymentRefunds.tenantId, params.tenantId),
        eq(paymentRefunds.paymentId, row.id),
        eq(paymentRefunds.state, "succeeded"),
      ),
    );
  const alreadyRefunded = sumDecimals(prior.map((r) => decimal(r.amount)));
  const requested = params.amount ?? decimal(row.amount);
  if (compareDecimal(addDecimal(alreadyRefunded, requested), decimal(row.amount)) > 0) {
    throw new AppError("payment.refund_exceeds_capture", {
      paymentRef: params.paymentRef,
      captured: decimal(row.amount),
      requested,
      alreadyRefunded,
    });
  }
}

/**
 * One row the reconcile sweep audits, joined to its working order for the till (every incident
 * needs one) and the status (the orphan rule). `auditedAt` is the NON-NULL tolerance anchor —
 * `settled_at` for a captured/settled row, `created_at` for an `initiated` one — so the classifier
 * needs no null branch on a column that, for the states this query returns, is never null anyway.
 * `createdAt` is separate from it and carried for one reason: it is the ordering anchor
 * `listReconcilable` merges its two arms on (see there).
 */
export interface ReconcilableRow {
  paymentRef: string;
  state: PaymentState;
  amount: string;
  externalRef: string | null;
  saleId: string | null;
  settledAt: string | null;
  createdAt: string;
  auditedAt: string;
  workingOrderId: string;
  // Mirrors @waitron/db's working_order_status enum. `placed` was added by 0030 (7c) — a payment
  // can join a placed order (Modes I/T), so the query's `workingOrders.status` now yields it and this
  // pinned union must admit it too. The orphan rule below (`!== "open"`) and the auto-reverse gate
  // (`!== "abandoned"`) both treat `placed` as a non-open, non-abandoned state by their existing
  // inequalities; whether that is the right reconcile classification for a placed order is a
  // question for the reconcile owner, not settled here.
  workingOrderStatus: "open" | "placed" | "settled" | "abandoned";
  tillId: string;
  reconcileRemediatedAt: string | null;
}

/**
 * The reconcile sweep's T1 read: this provider's auditable rows for the period, joined to their
 * working order. Auditable means money we believe we hold (`captured`/`settled`, anchored on
 * `settled_at`) or money we believe is pending (`initiated`, anchored on `created_at` — it has no
 * settlement time yet). `accepted_offline` is deliberately absent: that queue belongs to
 * `forward()`. `failed`/`voided`/`refunded`/`partially_refunded` are absent too — nothing is
 * expected to settle for them, and `existingReferences` still sees them, so their settlements
 * never read as missingLocal.
 *
 * Filters compare the timestamp columns directly (no `to_char` wrapper), and the two state groups
 * are issued as TWO queries rather than one `OR`, deliberately. A single `OR` over two different
 * timestamp columns needs a usable index on BOTH arms before the planner will build a BitmapOr;
 * there is an index leading `(tenant_id, provider, settled_at)` but none on `created_at`, so the OR
 * form degrades to a scan of the tenant's whole payments history on every sweep — for a tenant with
 * a year of payments, every row, every night. Split, the `captured`/`settled` arm uses
 * `payments_reconcile_idx` fully, and the `initiated` arm uses its leading `(tenant_id, provider)`
 * columns and then filters a set that is small and short-lived by nature (a minted-but-unpaid hosted
 * payment resolves or expires within minutes). A second index on `created_at` would buy the same
 * thing at the cost of another write-path index, which is why it is not the answer here.
 *
 * The two arms are merged on `created_at` then `payment_ref`, so the combined result keeps the
 * single query's created_at ordering AND is fully deterministic (the old single `ORDER BY
 * created_at` left same-instant rows in whatever order the plan produced them).
 *
 * Run under `withTenant`, so RLS scopes both tables; on top of that, both arms below ALSO carry an
 * explicit `eq(payments.tenantId, tenantId)` predicate — defence-in-depth for a superuser or
 * `BYPASSRLS` connection, where RLS does not apply and this predicate is the only thing scoping the
 * query to one tenant at all. The join's `workingOrders.tenantId = payments.tenantId` equality is
 * NOT that defence: it only keeps the join tenant-*consistent* (the two tables agree with each
 * other), never tenant-*scoped* (that either belongs to the caller's tenant) — under a bypassing
 * connection with no `eq(payments.tenantId, …)` at all, it happily agrees across every tenant's
 * rows. Mirrors the fiscal sweep's `rowsForPeriod`, which carries the same explicit predicate
 * alongside its own join-consistency one, for the identical reason.
 */
export async function listReconcilable(
  tx: Transaction,
  tenantId: string,
  provider: string,
  period: { from: Date; to: Date },
): Promise<ReconcilableRow[]> {
  const from = period.from.toISOString();
  const to = period.to.toISOString();
  const auditable = () =>
    tx
      .select({
        paymentRef: payments.paymentRef,
        state: payments.state,
        amount: payments.amount,
        externalRef: payments.externalRef,
        saleId: payments.saleId,
        settledAt: payments.settledAt,
        createdAt: payments.createdAt,
        auditedAt: sql<string>`coalesce(${payments.settledAt}, ${payments.createdAt})`,
        workingOrderId: payments.workingOrderId,
        workingOrderStatus: workingOrders.status,
        tillId: workingOrders.tillId,
        reconcileRemediatedAt: payments.reconcileRemediatedAt,
      })
      .from(payments)
      .innerJoin(
        workingOrders,
        and(
          eq(workingOrders.id, payments.workingOrderId),
          eq(workingOrders.tenantId, payments.tenantId),
        ),
      );

  const held = await auditable().where(
    and(
      eq(payments.tenantId, tenantId),
      eq(payments.provider, provider),
      inArray(payments.state, ["captured", "settled"]),
      gte(payments.settledAt, from),
      lt(payments.settledAt, to),
    ),
  );
  const pending = await auditable().where(
    and(
      eq(payments.tenantId, tenantId),
      eq(payments.provider, provider),
      eq(payments.state, "initiated"),
      gte(payments.createdAt, from),
      lt(payments.createdAt, to),
    ),
  );

  // Code-unit comparison of `${created_at}|${payment_ref}` — no locale collation, no branch on the
  // three-way result. `payment_ref` is unique per (tenant, provider), so the key is total.
  const orderKey = (row: ReconcilableRow): string => `${row.createdAt}|${row.paymentRef}`;
  return [...held, ...pending].sort((a, b) => {
    const left = orderKey(a);
    const right = orderKey(b);
    return Number(left > right) - Number(left < right);
  });
}

/** Postgres statements have a hard bind-parameter ceiling (65535); chunking an `IN` list keeps a
 * caller well under it regardless of how large the input is, rather than trusting every future
 * caller to stay small. Shared by `existingReferences` (a settlement report's references) and
 * `tillsForWorkingOrders` (a sweep's hinted working-order ids) — the same discipline, two lists. */
const CHUNK_SIZE = 1000;

/**
 * Which of these processor references belongs to ANY payment of this provider — in any state, at
 * any time? The targeted existence check that stands between an unmatched settlement and a
 * `missingLocal` classification, batched into as few round trips as the bind-parameter ceiling
 * allows: the caller collects every reference across a whole sweep's unmatched settlements and
 * calls this ONCE (see `reconcilePayments`'s T2), rather than once per settlement. T2 is a WRITE
 * transaction, so one query per settlement there would also lengthen lock contention with the
 * concurrent sweeps this feature explicitly supports (see `reconcile.concurrency.test.ts`) — for a
 * tenant with zero local rows against a large report, the exact silent-data-loss case this audit
 * exists to catch, that is an unmatched settlement's worth of round trips inside the one
 * transaction every other sweep also has to get through.
 *
 * It is deliberately unbounded by period and by state: the report is fetched over a WIDER window
 * than the local rows (settlement lags capture by days), so a window-difference would manufacture
 * false positives for payments whose local row simply sits outside the audited period.
 *
 * Carries an explicit `eq(payments.tenantId, tenantId)` predicate for the same defence-in-depth
 * reason as `listReconcilable` — under a superuser or `BYPASSRLS` connection, where RLS does not
 * apply, this is the only thing scoping the check to one tenant. The consequence of skipping it here
 * is sharper than `listReconcilable`'s: a match against another tenant's `external_ref` would
 * suppress a real `missingLocal` finding, silently hiding exactly the money-loss case this audit
 * exists to catch.
 */
export async function existingReferences(
  tx: Transaction,
  tenantId: string,
  provider: string,
  references: string[],
): Promise<Set<string>> {
  if (references.length === 0) return new Set();
  const found = new Set<string>();
  for (let i = 0; i < references.length; i += CHUNK_SIZE) {
    const chunk = references.slice(i, i + CHUNK_SIZE);
    const rows = await tx
      .select({ externalRef: payments.externalRef })
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(payments.provider, provider),
          inArray(payments.externalRef, chunk),
        ),
      );
    // `externalRef` is never null here: the WHERE clause matches only rows whose external_ref
    // equals one of `chunk`'s (non-null) entries. The cast avoids a null check the query already
    // forecloses, which would otherwise sit as a branch no test can legitimately take.
    for (const row of rows) found.add(row.externalRef as string);
  }
  return found;
}

/**
 * Stamp the orphan-remediation marker, matching only a row whose marker is still null and returning
 * whether it stamped. That row-or-nothing return is the concurrency guard: two sweeps racing over
 * one orphan produce exactly one reversal, because only one of them sees `true`.
 */
export async function markReconcileRemediated(
  tx: Transaction,
  params: Key & { at: Date },
): Promise<boolean> {
  const [row] = await tx
    .update(payments)
    .set({ reconcileRemediatedAt: params.at.toISOString(), updatedAt: sql`now()` })
    .where(and(keyWhere(params), isNull(payments.reconcileRemediatedAt)))
    .returning({ id: payments.id });
  return row !== undefined;
}

/**
 * The tills of many working orders, resolved in as few round trips as the bind-parameter ceiling
 * allows — every incident needs a till, and a payment reaches its till only through its working
 * order. Batched for the same reason `existingReferences` is: `raiseMissingLocal` collects every
 * hinted settlement's working-order id across a whole sweep and calls this ONCE (in `reconcile.ts`'s
 * T2, a write transaction), rather than once per hinted settlement — one query per settlement there
 * would lengthen lock contention with the concurrent sweeps this feature explicitly supports (see
 * `reconcile.concurrency.test.ts`), worst-case largest for a large report with few or no local rows.
 *
 * Returns a map keyed by `workingOrderId`; an id that does not exist (or that RLS hides) is simply
 * absent from it, which the caller reads as "skip this hint" — the same contract the unbatched
 * single-lookup form expressed with `undefined`.
 *
 * Carries an explicit `eq(workingOrders.tenantId, tenantId)` predicate for the same defence-in-depth
 * reason as `listReconcilable`/`existingReferences` — under a superuser or `BYPASSRLS` connection,
 * where RLS does not apply, this is the only thing scoping the lookup to one tenant.
 */
export async function tillsForWorkingOrders(
  tx: Transaction,
  tenantId: string,
  workingOrderIds: string[],
): Promise<Map<string, string>> {
  if (workingOrderIds.length === 0) return new Map();
  const tills = new Map<string, string>();
  for (let i = 0; i < workingOrderIds.length; i += CHUNK_SIZE) {
    const chunk = workingOrderIds.slice(i, i + CHUNK_SIZE);
    const rows = await tx
      .select({ id: workingOrders.id, tillId: workingOrders.tillId })
      .from(workingOrders)
      .where(and(eq(workingOrders.tenantId, tenantId), inArray(workingOrders.id, chunk)));
    for (const row of rows) tills.set(row.id, row.tillId);
  }
  return tills;
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
