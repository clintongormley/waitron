import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  AppError,
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  sumDecimals,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import { nowIso, workingOrders } from "@waitron/db";
import { payments } from "./schema/payments.js";
import { paymentRefunds } from "./schema/payment-refunds.js";
import type { CardDetails, PaymentState } from "./provider.js";

/** `amount` is the exact decimal for the column's count of cents, never a float. */
export interface PaymentRow {
  id: string;
  state: PaymentState;
  amount: string;
  saleId: string | null;
  settledAt: string | null;
  externalRef: string | null;
  cardScheme: string | null;
  cardLast4: string | null;
  cardEntryMode: string | null;
  cardAuthCode: string | null;
}

interface Key {
  provider: string;
  paymentRef: string;
}

interface NewPayment {
  workingOrderId: string;
  provider: string;
  paymentRef: string;
  amount: Decimal;
  externalRef?: string;
  card?: CardDetails;
}

/** The storage boundary: a money column counts whole cents, and nothing above this sees a count. */
function withDecimalAmount<T extends { amount: number }>(
  row: T,
): Omit<T, "amount"> & { amount: Decimal } {
  return { ...row, amount: centsToDecimal(row.amount) };
}

const PAYMENT_COLUMNS = {
  id: payments.id,
  state: payments.state,
  amount: payments.amount,
  saleId: payments.saleId,
  settledAt: payments.settledAt,
  externalRef: payments.externalRef,
  cardScheme: payments.cardScheme,
  cardLast4: payments.cardLast4,
  cardEntryMode: payments.cardEntryMode,
  cardAuthCode: payments.cardAuthCode,
};

async function insertPayment(
  tx: Transaction,
  params: NewPayment,
  state: PaymentState,
  settledAt: string | null,
): Promise<void> {
  await tx.insert(payments).values({
    workingOrderId: params.workingOrderId,
    provider: params.provider,
    paymentRef: params.paymentRef,
    amount: decimalToCents(params.amount),
    externalRef: params.externalRef ?? null,
    cardScheme: params.card?.scheme ?? null,
    cardLast4: params.card?.last4 ?? null,
    cardEntryMode: params.card?.entryMode ?? null,
    cardAuthCode: params.card?.authCode ?? null,
    state,
    settledAt,
  });
}

export async function insertCapturedPayment(
  tx: Transaction,
  params: NewPayment & { settledAt: Date },
): Promise<void> {
  await insertPayment(tx, params, "captured", params.settledAt.toISOString());
}

/** Written only once the offline gate has accepted; `forward()` later advances it to `settled` or
 * `declined`. */
export async function insertAcceptedOffline(
  tx: Transaction,
  params: NewPayment & { settledAt: Date },
): Promise<void> {
  await insertPayment(tx, params, "accepted_offline", params.settledAt.toISOString());
}

/** Persisted so a declined attempt still leaves an audit record. The type forbids an
 * `externalRef`: a failed attempt never settled on a terminal. */
export async function insertFailedPayment(
  tx: Transaction,
  params: Omit<NewPayment, "externalRef">,
): Promise<void> {
  await insertPayment(tx, params, "failed", null);
}

/** Committed BEFORE a provider's network call, so a crash mid-network leaves a recoverable row and
 * the `payment_ref` is already claimed. Resolved by `captureAttempting`/`failAttempting`. */
export async function insertAttempting(tx: Transaction, params: NewPayment): Promise<void> {
  await insertPayment(tx, params, "attempting", null);
}

/** Matches only a row still `attempting`; otherwise throws `payment.not_found`. */
export async function captureAttempting(
  tx: Transaction,
  params: Key & { settledAt: Date; externalRef: string; card?: CardDetails },
): Promise<PaymentRow> {
  return resolveAttempting(tx, params, "captured", {
    settledAt: params.settledAt.toISOString(),
    externalRef: params.externalRef,
    card: params.card,
  });
}

/** Matches only a row still `attempting`; otherwise throws `payment.not_found`. */
export async function failAttempting(tx: Transaction, params: Key): Promise<PaymentRow> {
  return resolveAttempting(tx, params, "failed", {});
}

async function resolveAttempting(
  tx: Transaction,
  params: Key,
  state: "captured" | "failed",
  extra: { settledAt?: string; externalRef?: string; card?: CardDetails },
): Promise<PaymentRow> {
  const [row] = await tx
    .update(payments)
    .set({
      state,
      settledAt: extra.settledAt ?? null,
      externalRef: extra.externalRef ?? null,
      cardScheme: extra.card?.scheme ?? null,
      cardLast4: extra.card?.last4 ?? null,
      cardEntryMode: extra.card?.entryMode ?? null,
      cardAuthCode: extra.card?.authCode ?? null,
      updatedAt: nowIso(),
    })
    .where(and(keyWhere(params), eq(payments.state, "attempting")))
    .returning(PAYMENT_COLUMNS);
  if (row === undefined) {
    throw new AppError("payment.not_found", {
      provider: params.provider,
      paymentRef: params.paymentRef,
    });
  }
  return withDecimalAmount(row);
}

/** Reverse a captured payment in full, recording no refund row. Only from `captured`; otherwise
 * throws `payment.not_voidable`. */
export async function recordVoid(tx: Transaction, params: Key): Promise<PaymentRow> {
  const row = await requireRow(tx, params);
  if (row.state !== "captured") {
    throw new AppError("payment.not_voidable", { paymentRef: params.paymentRef, state: row.state });
  }
  await tx.update(payments).set({ state: "voided", updatedAt: nowIso() }).where(keyWhere(params));
  return { ...row, state: "voided" };
}

/** Refundable from `captured` or `partially_refunded`, else `payment.not_refundable`; throws
 * `payment.refund_exceeds_capture` if the running total of refunds would exceed the capture. */
export async function recordRefund(
  tx: Transaction,
  params: Key & { amount: Decimal; authorizedBy?: string },
): Promise<PaymentRow> {
  const row = await requireRow(tx, params);
  if (row.state !== "captured" && row.state !== "partially_refunded") {
    throw new AppError("payment.not_refundable", {
      paymentRef: params.paymentRef,
      state: row.state,
    });
  }
  const prior = await tx
    .select({ amount: paymentRefunds.amount })
    .from(paymentRefunds)
    .where(and(eq(paymentRefunds.paymentId, row.id), eq(paymentRefunds.state, "succeeded")));
  const alreadyRefunded = sumDecimals(prior.map((r) => centsToDecimal(r.amount)));
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
    paymentId: row.id,
    provider: params.provider,
    paymentRef: params.paymentRef,
    amount: decimalToCents(params.amount),
    state: "succeeded",
    authorizedBy: params.authorizedBy ?? null,
  });
  const state: PaymentState =
    compareDecimal(afterThis, captured) === 0 ? "refunded" : "partially_refunded";
  await tx.update(payments).set({ state, updatedAt: nowIso() }).where(keyWhere(params));
  return { ...row, state };
}

/** A refund the processor REFUSED. The payment's state is unchanged and `recordRefund`'s balance
 * sum excludes this row, so a later refund of the same amount is still allowed. */
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
    paymentId: row.id,
    provider: params.provider,
    paymentRef: params.paymentRef,
    amount: decimalToCents(params.amount),
    state: "failed",
    authorizedBy: params.authorizedBy ?? null,
  });
}

/** Call inside the sale's own transaction, so the association commits with the sale. Write-once: a
 * payment that already has a `sale_id` throws `payment.already_associated` and is never re-pointed. */
export async function associatePaymentWithSale(
  tx: Transaction,
  params: Key & { saleId: string; readerId?: string },
): Promise<void> {
  const [row] = await tx
    .update(payments)
    .set({
      saleId: params.saleId,
      ...(params.readerId === undefined ? {} : { readerId: params.readerId }),
      updatedAt: nowIso(),
    })
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
  return row === undefined ? undefined : withDecimalAmount(row);
}

/** `saleId` null: the payment committed but the sale was never written (the recovery window).
 * Set: the sale is filed and this pay is a replay. */
export interface CapturedPaymentForOrder {
  id: string;
  paymentRef: string;
  provider: string;
  amount: string;
  saleId: string | null;
  externalRef: string | null;
  settledAt: string | null; // always set for captured/accepted_offline, but typed nullable like the column
  state: "captured" | "accepted_offline";
  cardScheme: string | null;
  cardLast4: string | null;
  cardEntryMode: string | null;
  cardAuthCode: string | null;
}

const CAPTURED_FOR_ORDER_COLUMNS = {
  ...PAYMENT_COLUMNS,
  paymentRef: payments.paymentRef,
  provider: payments.provider,
};

/** The capture-idempotency pre-check (spec §4). A `failed` or `attempting` row does not count, so
 * a declined card stays re-chargeable. At most one captured payment per working order holds by
 * construction, not by a constraint; if there are two, the most recently settled one is returned
 * rather than throwing. */
export async function findCapturedPaymentForWorkingOrder(
  tx: Transaction,
  key: { provider: string; workingOrderId: string },
): Promise<CapturedPaymentForOrder | undefined> {
  return selectCapturedForWorkingOrder(tx, key);
}

/** `provider` omitted spans every provider: drizzle's `and()` drops an `undefined` clause. */
async function selectCapturedForWorkingOrder(
  tx: Transaction,
  key: { workingOrderId: string; provider?: string },
): Promise<CapturedPaymentForOrder | undefined> {
  const [row] = await tx
    .select(CAPTURED_FOR_ORDER_COLUMNS)
    .from(payments)
    .where(
      and(
        key.provider === undefined ? undefined : eq(payments.provider, key.provider),
        eq(payments.workingOrderId, key.workingOrderId),
        inArray(payments.state, ["captured", "accepted_offline"]),
      ),
    )
    .orderBy(sql`${payments.settledAt} desc nulls last`)
    .limit(1);
  return row === undefined ? undefined : (withDecimalAmount(row) as CapturedPaymentForOrder);
}

export async function findCapturedPaymentForWorkingOrderAnyProvider(
  tx: Transaction,
  key: { workingOrderId: string },
): Promise<CapturedPaymentForOrder | null> {
  return (await selectCapturedForWorkingOrder(tx, key)) ?? null;
}

export async function findPaymentByRef(
  tx: Transaction,
  provider: string,
  paymentRef: string,
): Promise<PaymentRow | undefined> {
  const [row] = await tx
    .select(PAYMENT_COLUMNS)
    .from(payments)
    .where(and(eq(payments.provider, provider), eq(payments.paymentRef, paymentRef)))
    .limit(1);
  return row === undefined ? undefined : withDecimalAmount(row);
}

export interface ForwardablePayment {
  paymentRef: string;
  workingOrderId: string;
  saleId: string | null;
  amount: string;
}

const FORWARDABLE_COLUMNS = {
  paymentRef: payments.paymentRef,
  workingOrderId: payments.workingOrderId,
  saleId: payments.saleId,
  amount: payments.amount,
};

async function selectForwardable(tx: Transaction, provider: string): Promise<ForwardablePayment[]> {
  const rows = await tx
    .select(FORWARDABLE_COLUMNS)
    .from(payments)
    .where(and(eq(payments.provider, provider), eq(payments.state, "accepted_offline")))
    .orderBy(payments.createdAt);
  return rows.map(withDecimalAmount);
}

/**
 * State IS the queue: there is no claim column, so this stamps nothing (pinned in `store.test.ts`).
 *
 * **What makes this a claim is the CALLER's transaction, not anything in the statement**: the
 * selection and the state-guarded advances after it must commit together, and two passes are
 * serialised only inside `withTransaction`, which takes the write lock. No caller does that today —
 * `FakePaymentProvider.forward` opens a bare `db.transaction`, which is not queued — so two
 * concurrent passes have not been run against this.
 */
export async function claimAcceptedOffline(
  tx: Transaction,
  provider: string,
): Promise<ForwardablePayment[]> {
  return await selectForwardable(tx, provider);
}

/** The same statement as `claimAcceptedOffline`, for a real adapter whose network call must not
 * run inside the transaction. Two passes listing the same rows are harmless: the advances each
 * match only a row still `accepted_offline`. */
export async function listAcceptedOffline(
  tx: Transaction,
  provider: string,
): Promise<ForwardablePayment[]> {
  return await selectForwardable(tx, provider);
}

/** One in-flight payment as `resolvePending` reads it. `externalRef` is the processor's POLL key
 * (stamped by `stampAttemptingRef` after the create call), null when the adapter crashed before
 * stamping it; `createdAt` bounds how long a not-found row is still considered pending. */
export interface AttemptingPayment {
  paymentRef: string;
  workingOrderId: string;
  amount: string;
  externalRef: string | null;
  createdAt: string;
}

/** Not a claim, like `listAcceptedOffline`: `captureAttempting`/`failAttempting` each match only a
 * row still `attempting`, so two concurrent passes are harmless. */
export async function listAttempting(
  tx: Transaction,
  provider: string,
): Promise<AttemptingPayment[]> {
  const rows = await tx
    .select({
      paymentRef: payments.paymentRef,
      workingOrderId: payments.workingOrderId,
      amount: payments.amount,
      externalRef: payments.externalRef,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(and(eq(payments.provider, provider), eq(payments.state, "attempting")))
    .orderBy(payments.createdAt);
  return rows.map(withDecimalAmount);
}

/** Matches only a row still `attempting`, so a late stamp never clobbers the refundable reference
 * `captureAttempting` wrote. A no-match is silent: it lost to a concurrent resolution. */
export async function stampAttemptingRef(
  tx: Transaction,
  params: Key,
  externalRef: string,
): Promise<void> {
  await tx
    .update(payments)
    .set({ externalRef, updatedAt: nowIso() })
    .where(and(keyWhere(params), eq(payments.state, "attempting")));
}

export async function settleForwarded(tx: Transaction, params: Key): Promise<void> {
  return advanceAcceptedOffline(tx, params, "settled");
}

/** The uncollected-receivable incident is the caller's to raise, keeping `@waitron/core` out of
 * this store. */
export async function declineForwarded(tx: Transaction, params: Key): Promise<void> {
  return advanceAcceptedOffline(tx, params, "declined");
}

/** Matches only a row still `accepted_offline`, so re-running a completed forward is a no-op. */
async function advanceAcceptedOffline(
  tx: Transaction,
  params: Key,
  state: "settled" | "declined",
): Promise<void> {
  await tx
    .update(payments)
    .set({ state, updatedAt: nowIso() })
    .where(and(keyWhere(params), eq(payments.state, "accepted_offline")));
}

export interface SettledInitiated {
  workingOrderId: string;
  amount: string;
  paymentRef: string;
}

/** A hosted payment minted but not yet paid. `externalRef` is required: it is the key the settling
 * webhook carries. */
export async function insertInitiated(
  tx: Transaction,
  params: NewPayment & { externalRef: string },
): Promise<void> {
  await insertPayment(tx, params, "initiated", null);
}

/** Keyed by `(provider, external_ref)`, all the inbound webhook carries. Returns `null` when it
 * matched nothing (an at-least-once redelivery); the caller chains `recordSale` only on a non-null
 * return, so no second invoice number is allocated. */
export async function settleInitiated(
  tx: Transaction,
  params: { provider: string; externalRef: string; settledAt: Date },
): Promise<SettledInitiated | null> {
  const [row] = await tx
    .update(payments)
    .set({ state: "captured", settledAt: params.settledAt.toISOString(), updatedAt: nowIso() })
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
  return row === undefined ? null : withDecimalAmount(row);
}

export async function expireInitiated(
  tx: Transaction,
  params: { provider: string; externalRef: string },
): Promise<void> {
  await tx
    .update(payments)
    .set({ state: "failed", updatedAt: nowIso() })
    .where(
      and(
        eq(payments.provider, params.provider),
        eq(payments.externalRef, params.externalRef),
        eq(payments.state, "initiated"),
      ),
    );
}

/** Any state counts: for a row already past `initiated`, `true` is a webhook redelivery. */
export async function hasPaymentWithExternalRef(
  db: Database,
  provider: string,
  externalRef: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.provider, provider), eq(payments.externalRef, externalRef)))
    .limit(1);
  return row !== undefined;
}

function keyWhere(params: Key) {
  return and(eq(payments.provider, params.provider), eq(payments.paymentRef, params.paymentRef));
}

/** The checks `recordVoid`/`recordRefund` make, run BEFORE the processor's irreversible refund so
 * an invalid local state fails without moving money; those two stay authoritative. Nothing closes
 * the window between this read and the reversal's write: the processor call runs outside every
 * transaction. Reconcile audits it. */
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
    .where(and(eq(paymentRefunds.paymentId, row.id), eq(paymentRefunds.state, "succeeded")));
  const alreadyRefunded = sumDecimals(prior.map((r) => centsToDecimal(r.amount)));
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
 * `auditedAt` is the non-null tolerance anchor: `settled_at`, or `created_at` for an `initiated`
 * row. `createdAt` is the key `listReconcilable` merges its two queries on.
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
  // Mirrors @waitron/db's working_order_status enum. Reconcile's orphan rule (`!== "open"`) and
  // auto-reverse gate (`!== "abandoned"`) treat `placed` as neither; whether that is right for a
  // placed order is not settled.
  workingOrderStatus: "open" | "placed" | "settled" | "abandoned";
  tillId: string;
  reconcileRemediatedAt: string | null;
}

/**
 * Auditable: money we believe we hold (`captured`/`settled`, by `settled_at`) or believe is pending
 * (`initiated`, by `created_at`). `accepted_offline` belongs to `forward()`. The other states are
 * absent because nothing is expected to settle for them, and `existingReferences` still sees them,
 * so their settlements never read as missingLocal.
 */
export async function listReconcilable(
  tx: Transaction,
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
      .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId));

  const held = (
    await auditable().where(
      and(
        eq(payments.provider, provider),
        inArray(payments.state, ["captured", "settled"]),
        gte(payments.settledAt, from),
        lt(payments.settledAt, to),
      ),
    )
  ).map(withDecimalAmount);
  const pending = (
    await auditable().where(
      and(
        eq(payments.provider, provider),
        eq(payments.state, "initiated"),
        gte(payments.createdAt, from),
        lt(payments.createdAt, to),
      ),
    )
  ).map(withDecimalAmount);

  // Code-unit comparison of `${created_at}|${payment_ref}` — no locale collation, no branch on the
  // three-way result. `payment_ref` is unique per provider, so the key is total.
  const orderKey = (row: ReconcilableRow): string => `${row.createdAt}|${row.paymentRef}`;
  return [...held, ...pending].sort((a, b) => {
    const left = orderKey(a);
    const right = orderKey(b);
    return Number(left > right) - Number(left < right);
  });
}

/** Keeps an `IN` list under the engine's bind-parameter ceiling however large the input. */
const CHUNK_SIZE = 1000;

/**
 * Which of these references belongs to ANY payment of this provider? Deliberately unbounded by
 * period and state: the report is fetched over a WIDER window than the local rows (settlement lags
 * capture), so a bounded check would report payments outside the audited period as missingLocal.
 */
export async function existingReferences(
  tx: Transaction,
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
      .where(and(eq(payments.provider, provider), inArray(payments.externalRef, chunk)));
    // Never null: the WHERE matched it against `chunk`.
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
    .set({ reconcileRemediatedAt: params.at.toISOString(), updatedAt: nowIso() })
    .where(and(keyWhere(params), isNull(payments.reconcileRemediatedAt)))
    .returning({ id: payments.id });
  return row !== undefined;
}

/** Keyed by working-order id; an id that does not exist is absent from the map. */
export async function tillsForWorkingOrders(
  tx: Transaction,
  workingOrderIds: string[],
): Promise<Map<string, string>> {
  if (workingOrderIds.length === 0) return new Map();
  const tills = new Map<string, string>();
  for (let i = 0; i < workingOrderIds.length; i += CHUNK_SIZE) {
    const chunk = workingOrderIds.slice(i, i + CHUNK_SIZE);
    const rows = await tx
      .select({ id: workingOrders.id, tillId: workingOrders.tillId })
      .from(workingOrders)
      .where(inArray(workingOrders.id, chunk));
    for (const row of rows) tills.set(row.id, row.tillId);
  }
  return tills;
}

/**
 * The read `recordVoid` and `recordRefund` decide on. It takes no lock: a caller's `withTransaction`
 * holds the venue file's write lock, so the read is still true when they write — the pattern is
 * stated on `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`).
 */
async function requireRow(tx: Transaction, params: Key): Promise<PaymentRow> {
  const [row] = await tx.select(PAYMENT_COLUMNS).from(payments).where(keyWhere(params));
  if (row === undefined) {
    throw new AppError("payment.not_found", {
      provider: params.provider,
      paymentRef: params.paymentRef,
    });
  }
  return withDecimalAmount(row);
}
