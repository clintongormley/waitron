import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  AppError,
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  sumDecimals,
} from "@waitron/shared";
import type { Decimal, DeviceOrigin, NodeId } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import { devices, nowIso, workingOrders } from "@waitron/db";
import "./errors.js";
import { payments } from "./schema/payments.js";
import { paymentRefunds } from "./schema/payment-refunds.js";
import { paymentHoldOutcomes, paymentHolds } from "./schema/payment-holds.js";
import { readerHeldBy, readerPaymentInProgress } from "./device-readers.js";
import type { CardDetails, CollectionOwners, PaymentState } from "./provider.js";

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
  /** The device the payment was started on. */
  origin: DeviceOrigin;
  workingOrderId: string;
  /** The box that started the payment: its collection owner. */
  nodeId: NodeId;
  provider: string;
  paymentRef: string;
  amount: Decimal;
  externalRef?: string;
  externalProvider?: "connected_account" | "other";
  externalMachine?: string;
  card?: CardDetails;
  /** The bill payment this attempt charges for; absent for a payment of a whole order. */
  billPaymentId?: string;
  /** Waitron's `card_readers.id` the payment runs on; absent when no reader is named. */
  readerId?: string;
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
    source: params.origin.source,
    deviceId: params.origin.deviceId,
    workingOrderId: params.workingOrderId,
    nodeId: params.nodeId,
    provider: params.provider,
    paymentRef: params.paymentRef,
    amount: decimalToCents(params.amount),
    externalRef: params.externalRef ?? null,
    externalProvider: params.externalProvider ?? null,
    externalMachine: params.externalMachine ?? null,
    cardScheme: params.card?.scheme ?? null,
    cardLast4: params.card?.last4 ?? null,
    cardEntryMode: params.card?.entryMode ?? null,
    cardAuthCode: params.card?.authCode ?? null,
    billPaymentId: params.billPaymentId ?? null,
    readerId: params.readerId ?? null,
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

/** Persisted so a declined attempt still leaves an audit record. The type forbids an
 * `externalRef`: a failed attempt never settled on a terminal. */
export async function insertFailedPayment(
  tx: Transaction,
  params: Omit<NewPayment, "externalRef">,
): Promise<void> {
  await insertPayment(tx, params, "failed", null);
}

/**
 * Refuses a payment start on `readerId` unless the origin device holds it and no other device has a
 * payment in progress on it.
 * No reader named passes. Run in the transaction that writes the
 * payment's first row, so a takeover and a start cannot both commit.
 */
export async function assertReaderStartable(
  tx: Transaction,
  origin: DeviceOrigin,
  readerId: string | undefined,
): Promise<void> {
  if (readerId === undefined) return;
  if ((await readerHeldBy(tx, readerId)) !== origin.deviceId) {
    throw new AppError("reader.not_held", { readerId });
  }
  if (await readerPaymentInProgress(tx, readerId, origin.deviceId)) {
    throw new AppError("reader.payment_in_progress", { readerId });
  }
}

/** Committed BEFORE a provider's network call, so a crash mid-network leaves a recoverable row and
 * the `payment_ref` is already claimed. Resolved by `captureAttempting`/`failAttempting`. A named
 * reader is checked by {@link assertReaderStartable}, after the profile. */
export async function insertAttempting(
  tx: Transaction,
  params: NewPayment & {
    /** The profile the route checked the request under; the attempt is refused
     * `device.profile_changed` if the device is no longer on it. */
    deviceProfileId?: string;
  },
): Promise<void> {
  if (params.deviceProfileId !== undefined) {
    const [device] = await tx
      .select({ deviceProfileId: devices.deviceProfileId })
      .from(devices)
      .where(eq(devices.id, params.origin.deviceId));
    if (device?.deviceProfileId !== params.deviceProfileId) {
      throw new AppError("device.profile_changed", {});
    }
  }
  await assertReaderStartable(tx, params.origin, params.readerId);
  await insertPayment(tx, params, "attempting", null);
}

/** Matches only a row still `attempting`; otherwise throws `payment.not_found`. */
export async function captureAttempting(
  tx: Transaction,
  params: Key & { settledAt: Date; externalRef: string; card?: CardDetails; amount?: Decimal },
): Promise<PaymentRow> {
  return resolveAttempting(tx, params, "captured", {
    settledAt: params.settledAt.toISOString(),
    externalRef: params.externalRef,
    card: params.card,
    amount: params.amount,
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
  extra: { settledAt?: string; externalRef?: string; card?: CardDetails; amount?: Decimal },
): Promise<PaymentRow> {
  const [row] = await tx
    .update(payments)
    .set({
      state,
      amount: extra.amount === undefined ? undefined : decimalToCents(extra.amount),
      requestedAmount: sql`${payments.amount}`,
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
  params: Key & { amount: Decimal; authorizedBy?: string; providerRefundRef?: string },
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
    providerRefundRef: params.providerRefundRef ?? null,
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
  settledAt: string | null;
  state: "captured";
  cardScheme: string | null;
  cardLast4: string | null;
  cardEntryMode: string | null;
  cardAuthCode: string | null;
}

const PAYMENT_WITH_KEY_COLUMNS = {
  ...PAYMENT_COLUMNS,
  paymentRef: payments.paymentRef,
  provider: payments.provider,
};

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
  // Without statistics SQLite prefers `payments_reconcile_idx`, which matches every payment the
  // provider has ever taken (A1469). Raw SQL because drizzle's `.from()` given the hinted table
  // refuses the selected columns: "the table "payments" is not part of the query".
  const columns = sql.join(
    Object.entries(PAYMENT_WITH_KEY_COLUMNS).map(
      ([name, column]) => sql`${column} as ${sql.identifier(name)}`,
    ),
    sql`, `,
  );
  const {
    rows: [row],
  } = await tx.execute<Omit<CapturedPaymentForOrder, "amount"> & { amount: number }>(sql`
    select ${columns} from ${payments} indexed by payments_working_order_idx
    where ${and(
      key.provider === undefined ? undefined : eq(payments.provider, key.provider),
      eq(payments.workingOrderId, key.workingOrderId),
      inArray(payments.state, ["captured"]),
    )}
    order by ${payments.settledAt} desc nulls last, ${payments}.rowid desc
    limit 1`);
  return row === undefined ? undefined : (withDecimalAmount(row) as CapturedPaymentForOrder);
}

export async function findCapturedPaymentForWorkingOrderAnyProvider(
  tx: Transaction,
  key: { workingOrderId: string },
): Promise<CapturedPaymentForOrder | null> {
  return (await selectCapturedForWorkingOrder(tx, key)) ?? null;
}

const BILL_PAYMENT_COLUMNS = {
  ...PAYMENT_WITH_KEY_COLUMNS,
  externalProvider: payments.externalProvider,
  externalMachine: payments.externalMachine,
};
type BillPaymentProviderRow = PaymentRow &
  Key &
  Pick<typeof payments.$inferSelect, "externalProvider" | "externalMachine">;

/** The provider's row for one bill payment, in whatever state it is; at most one exists
 * (`payments_bill_payment_key`). */
export async function findPaymentByBillPayment(
  tx: Transaction,
  billPaymentId: string,
): Promise<BillPaymentProviderRow | undefined> {
  const [row] = await tx
    .select(BILL_PAYMENT_COLUMNS)
    .from(payments)
    .where(eq(payments.billPaymentId, billPaymentId));
  return row === undefined ? undefined : withDecimalAmount(row);
}

/** {@link findPaymentByBillPayment} for several bill payments, by bill payment id. */
export async function findPaymentsByBillPayments(
  tx: Transaction,
  billPaymentIds: readonly string[],
): Promise<Map<string, BillPaymentProviderRow>> {
  if (billPaymentIds.length === 0) return new Map();
  const rows = await tx
    .select({
      ...BILL_PAYMENT_COLUMNS,
      billPaymentId: payments.billPaymentId,
    })
    .from(payments)
    .where(inArray(payments.billPaymentId, [...billPaymentIds]));
  return new Map(rows.map(({ billPaymentId, ...row }) => [billPaymentId!, withDecimalAmount(row)]));
}

/** The provider refund ids recorded against a bill payment's provider row, oldest first. */
export async function recordedRefundRefs(
  tx: Transaction,
  billPaymentId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ ref: paymentRefunds.providerRefundRef })
    .from(paymentRefunds)
    .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
    .where(
      and(eq(payments.billPaymentId, billPaymentId), isNotNull(paymentRefunds.providerRefundRef)),
    )
    .orderBy(paymentRefunds.createdAt, sql`${paymentRefunds}.rowid`);
  return rows.map((row) => row.ref!);
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

/** Not a claim: `captureAttempting`/`failAttempting` each match only a
 * row still `attempting`, so two concurrent passes cannot resolve a row twice; the loser throws
 * `payment.not_found`. Lists only the rows `owners` covers. */
export async function listAttempting(
  tx: Transaction,
  provider: string,
  owners: CollectionOwners,
): Promise<AttemptingPayment[]> {
  const owned = or(
    eq(payments.nodeId, owners.nodeId),
    owners.takenOverFrom.length > 0
      ? inArray(payments.nodeId, [...owners.takenOverFrom])
      : undefined,
    owners.unowned ? isNull(payments.nodeId) : undefined,
  );
  const rows = await tx
    .select({
      paymentRef: payments.paymentRef,
      workingOrderId: payments.workingOrderId,
      amount: payments.amount,
      externalRef: payments.externalRef,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(and(eq(payments.provider, provider), eq(payments.state, "attempting"), owned))
    .orderBy(payments.createdAt, sql`${payments}.rowid`);
  return rows.map(withDecimalAmount);
}

/** Matches only a row still `attempting`, so a late stamp never clobbers the refundable reference
 * `captureAttempting` wrote. Answers whether it stamped; false means it lost to a concurrent
 * resolution. */
export async function stampAttemptingRef(
  tx: Transaction,
  params: Key,
  externalRef: string,
): Promise<boolean> {
  const stamped = await tx
    .update(payments)
    .set({ externalRef, updatedAt: nowIso() })
    .where(and(keyWhere(params), eq(payments.state, "attempting")))
    .returning({ id: payments.id });
  return stamped.length > 0;
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
  paymentId: string;
  paymentRef: string;
  state: PaymentState;
  amount: string;
  externalRef: string | null;
  saleId: string | null;
  settledAt: string | null;
  createdAt: string;
  auditedAt: string;
  workingOrderId: string;
  workingOrderStatus: "open" | "placed" | "settled" | "abandoned";
  reconcileRemediatedAt: string | null;
  /** The payment has a hold, with or without an outcome. */
  held: boolean;
  /** The payment has a hold with a recorded outcome. */
  holdResolved: boolean;
}

/**
 * Auditable: money we believe we hold (`captured`, by `settled_at`) or believe is pending
 * (`initiated`, by `created_at`).
 * `failed`/`voided`/`refunded`/`partially_refunded` are absent too, and `existingReferences` still
 * sees them, so a settlement for one never reads as missingLocal.
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
        paymentId: payments.id,
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
        reconcileRemediatedAt: payments.reconcileRemediatedAt,
        held: sql<boolean>`${paymentHolds.id} is not null`.mapWith(Boolean),
        holdResolved: sql<boolean>`${paymentHoldOutcomes.id} is not null`.mapWith(Boolean),
      })
      .from(payments)
      .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
      .leftJoin(paymentHolds, eq(paymentHolds.paymentId, payments.id))
      .leftJoin(paymentHoldOutcomes, eq(paymentHoldOutcomes.holdId, paymentHolds.id));

  const capturedOrSettled = (
    await auditable().where(
      and(
        eq(payments.provider, provider),
        eq(payments.state, "captured"),
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
  return [...capturedOrSettled, ...pending].sort((a, b) => {
    const left = orderKey(a);
    const right = orderKey(b);
    return Number(left > right) - Number(left < right);
  });
}

export async function listAuditCandidates(
  tx: Transaction,
  provider: string,
  period: { from: Date; to: Date },
) {
  return tx
    .select({
      paymentRef: payments.paymentRef,
      externalRef: payments.externalRef,
      workingOrderId: payments.workingOrderId,
      state: payments.state,
    })
    .from(payments)
    .where(
      and(
        eq(payments.provider, provider),
        inArray(payments.state, ["failed", "attempting"]),
        gte(payments.createdAt, period.from.toISOString()),
        lt(payments.createdAt, period.to.toISOString()),
      ),
    )
    .orderBy(payments.paymentRef);
}

export async function listBackupPayments(tx: Transaction, period: { from: Date; to: Date }) {
  const rows = await tx
    .select({
      paymentRef: payments.paymentRef,
      workingOrderId: payments.workingOrderId,
      amount: payments.amount,
      settledAt: payments.settledAt,
      externalMachine: payments.externalMachine,
      externalRef: payments.externalRef,
    })
    .from(payments)
    .where(
      and(
        eq(payments.provider, "manual"),
        eq(payments.externalProvider, "connected_account"),
        inArray(payments.state, ["captured", "partially_refunded", "refunded"]),
        gte(payments.settledAt, period.from.toISOString()),
        lt(payments.settledAt, period.to.toISOString()),
      ),
    );
  return rows.map((row) => ({ ...row, amount: centsToDecimal(row.amount) }));
}

/** Keeps an `IN` list under the engine's bind-parameter ceiling however large the input. */
export const CHUNK_SIZE = 1000;

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
 * Stamp the orphan-remediation marker, matching only a row whose marker is still null and that has
 * no hold, and returning whether it stamped. That row-or-nothing return is the concurrency guard:
 * two sweeps racing over one orphan produce exactly one reversal, because only one of them sees
 * `true`, and a payment a racing sweep has held is never claimed.
 */
export async function markReconcileRemediated(
  tx: Transaction,
  params: Key & { at: Date },
): Promise<boolean> {
  const [row] = await tx
    .update(payments)
    .set({ reconcileRemediatedAt: params.at.toISOString(), updatedAt: nowIso() })
    .where(
      and(
        keyWhere(params),
        isNull(payments.reconcileRemediatedAt),
        sql`not exists (select 1 from ${paymentHolds} where ${paymentHolds.paymentId} = ${payments.id})`,
      ),
    )
    .returning({ id: payments.id });
  return row !== undefined;
}

/**
 * The read `recordVoid` and `recordRefund` decide on. It takes no lock: inside `withTransaction`,
 * which holds the venue file's write lock, the read is still true when the caller writes — the
 * pattern is stated on `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`).
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
