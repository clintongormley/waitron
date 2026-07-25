import { randomUUID } from "node:crypto";
import { AppError, decimal } from "@waitron/shared";
import type { Decimal, TenantId } from "@waitron/shared";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { PaymentResult } from "@waitron/payments";
import {
  assertReversible,
  findPaymentByRef,
  recordFailedRefund,
  recordRefund,
  recordVoid,
} from "@waitron/payments";

/** The Stripe refund surface both adapters' clients expose (`StripeClient` and `StripeDeviceClient`
 * declare an identical `refund`). A structural type so `reverseViaStripe` takes either client. */
export interface StripeRefunder {
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }>;
}

/**
 * `reverseViaStripe`'s OPTIONAL tail, gathered into one named object rather than trailing
 * positional parameters.
 *
 * The function already takes six positional arguments, four of them strings, and these two options
 * are unrelated to each other — a reference resolver and a tenant scope — so no ordering between
 * them reads naturally and the caller that wants only the second would have to write
 * `undefined, resolverOrUndefined, tenantId`. Naming them removes both problems and leaves room
 * for the next optional (a persisted per-reversal idempotency key is the known one) without
 * re-litigating argument order.
 *
 * It is deliberately only the TAIL: `db`/`client`/`provider`/`ref`/`kind`/`amount` stay positional,
 * so all six call sites in `provider.ts` and `device-provider.ts` are byte-for-byte unchanged. That
 * is what keeps this additive on a primitive three shipped adapters depend on — the same reason the
 * resolver was introduced with an identity default rather than as a required argument.
 */
export interface ReverseViaStripeOptions {
  /**
   * The tenant whose payment is being reversed. Supply it whenever `db` is NOT already a
   * tenant-scoped handle; omit it when it is.
   *
   * This exists because of a non-obvious fact about how tenancy is established: a bare
   * `db.transaction(...)` sets no `app.tenant_id` GUC at all. `withTenant` sets it with
   * `set_config(..., true)` — transaction-local — from INSIDE the transaction it itself opens, so a
   * transaction opened any other way begins with `current_tenant_id()` NULL. This function's first
   * act is `findPaymentByRef`, which is deliberately untenanted (the `PaymentProvider` reversal
   * methods carry only a `paymentRef`), so with the GUC unset the `payments` tenant-isolation
   * policy matches ZERO rows and the reversal fails closed with `payment.not_found` — for a payment
   * that is sitting right there. Fails CLOSED, so no money moves; but it fails every single time.
   *
   * No hermetic suite can show that: PGlite connects as superuser and bypasses FORCE ROW LEVEL
   * SECURITY, so the untenanted transaction reads the row anyway and every PGlite test passes.
   * `reconcile.rls.test.ts`, against a real non-superuser role, is the proof.
   *
   * Supplied → both database phases run through `withTenant`, the GUC is set, RLS matches the row,
   * AND the found row's own `tenant_id` is checked against this value before anything moves — the
   * explicit predicate `listReconcilable`/`existingReferences` already carry, applied to the one
   * money-moving query on the reconcile path (see the check itself for why RLS alone is not enough).
   * Omitted → behaviour is exactly what it has always been: a bare `db.transaction`. That is the
   * correct default for the two interactive providers, whose own options already REQUIRE a
   * tenant-scoped handle and document it. `StripeReconciler` is the caller that must supply it: it
   * holds a plain, unscoped handle, because the neutral sweep wraps its OWN phases in `withTenant`
   * and hands the reversal callback nothing — so without this, every hosted orphan's auto-reversal
   * would fail permanently under real RLS, which is precisely the failure the auto-reversal exists
   * to eliminate.
   */
  tenantId?: TenantId;
  /** Maps the payment's stored `external_ref` to the identifier the processor's refund API needs.
   * Defaults to identity, so the terminal and on-device callers — which store a PaymentIntent id,
   * exactly what `stripe.refunds` wants — behave byte-for-byte as before; the default is the whole
   * reason this is an additive optional parameter on a primitive TWO shipped providers depend on.
   * Reconcile supplies a real one: a HOSTED payment stores its Checkout Session id, which the refund
   * API cannot address, which is why every hosted orphan's auto-reversal used to fail permanently.
   * A resolver that cannot map its reference THROWS, and the caller treats that exactly as any other
   * un-addressable payment. */
  resolveProcessorRef?: (externalRef: string) => Promise<string>;
}

/** The reversal path shared by BOTH Stripe providers (server-driven 2a and on-device 2b) —
 * void/refund/partialRefund via `stripe.refunds`. Find + read-only reversibility pre-check (T1) BEFORE
 * the network refund, so an invalid local state fails fast without moving money; then persist the
 * outcome (T2). A Stripe-refused refund records a `payment_refunds` failure row and leaves the payment
 * state untouched (still `captured`/`partially_refunded`); an accepted one transitions via
 * `recordVoid`/`recordRefund` (any non-`failed` status, incl. `pending`, is treated optimistically as
 * accepted — async settlement confirmation is the deferred webhook path). On success `partialRefund`
 * reports the amount REFUNDED and `refund`/`void` the captured amount; on a FAILED reversal `amount`
 * echoes the ATTEMPTED amount. Reversal `settledAt` is always null — only `collect` settles a tender.
 * A fresh `randomUUID` idempotency key per call: two INDEPENDENT equal partial refunds each issue a
 * real refund; SAME-reversal retry-safety (a persisted per-reversal id) is deferred, and reconcile
 * backstops Stripe-vs-local drift.
 *
 * Both database phases obey ONE tenant-scoping decision, made from `ReverseViaStripeOptions.tenantId`:
 * supplied means `withTenant`, omitted means the bare `db.transaction` this has always used — which
 * sets no `app.tenant_id` GUC and so, under a real non-superuser role, sees none of the tenant's
 * rows. Read that option's comment before adding a caller: whether a reversal works at all under RLS
 * depends on it. */
export async function reverseViaStripe(
  db: Database,
  client: StripeRefunder,
  provider: string,
  ref: string,
  kind: "void" | "refund",
  amount?: Decimal,
  /** The optional tail — see `ReverseViaStripeOptions` for why these two are an object and not two
   * more positional parameters. `= {}` so a caller wanting neither passes nothing at all. */
  {
    tenantId,
    resolveProcessorRef = (externalRef) => Promise.resolve(externalRef),
  }: ReverseViaStripeOptions = {},
): Promise<PaymentResult> {
  // The ONLY place either transaction opener is chosen, so the database phases below — the T1
  // pre-check and whichever T2 write the outcome selects — cannot drift apart: one tenanted and
  // another not would be a payment found under RLS and then written outside its own tenant's scope.
  // `withTenant` OPENS a transaction, which is exactly why this wraps only those short phases: the
  // processor refund between them is a network call and stays outside every transaction (T1/T2), as
  // does the `resolveProcessorRef` lookup that feeds it.
  const inTransaction = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    tenantId === undefined ? db.transaction(fn) : withTenant(db, tenantId, fn);

  const found = await inTransaction(async (tx) => {
    const f = await findPaymentByRef(tx, provider, ref);
    if (f === undefined || f.externalRef === null) {
      throw new AppError("payment.not_found", { provider, paymentRef: ref });
    }
    // Defence in depth, matching what the sweep's two READ queries already do: `listReconcilable`
    // and `existingReferences` each carry an explicit `tenant_id` predicate on top of RLS, precisely
    // so a connection that is not RLS-enforced (a superuser, a `BYPASSRLS` role, or a future pooled
    // handle whose GUC was not set) still cannot see across tenants. `findPaymentByRef` is
    // deliberately untenanted — the `PaymentProvider` reversal methods carry only a `paymentRef` —
    // which left this, the ONE query on the reconcile path that goes on to move money, relying on
    // RLS alone. Now that the tenant is in hand it is checked here too: a row belonging to anyone
    // else is `payment.not_found`, the same answer as a row that does not exist, before the refund
    // is issued or any local state is touched. Omitting `tenantId` keeps the historical behaviour
    // exactly (the two interactive providers pass an already-scoped handle and no tenant).
    if (tenantId !== undefined && f.tenantId !== tenantId) {
      throw new AppError("payment.not_found", { provider, paymentRef: ref });
    }
    const externalRef = f.externalRef;
    await assertReversible(tx, { tenantId: f.tenantId, provider, paymentRef: ref, kind, amount });
    return { ...f, externalRef };
  });
  const key = { tenantId: found.tenantId, provider, paymentRef: ref };

  // Resolution is (potentially) a NETWORK call, so it belongs here: after the read-only pre-check
  // has committed and OUTSIDE every transaction, next to the refund it feeds. Doing it inside T1
  // would hold a transaction open across the wire; doing it before `assertReversible` would go to
  // the processor for a payment the local state already forbids reversing.
  const processorRef = await resolveProcessorRef(found.externalRef);
  const outcome = await client.refund({
    paymentIntentId: processorRef,
    ...(amount ? { amount } : {}),
    idempotencyKey: randomUUID(),
  });

  if (outcome.status === "failed") {
    await inTransaction((tx) =>
      recordFailedRefund(tx, { ...key, amount: amount ?? decimal(found.amount) }),
    );
    return {
      provider,
      paymentRef: ref,
      state: found.state,
      amount: amount ?? decimal(found.amount),
      settledAt: null,
    };
  }

  const row = await inTransaction((tx) =>
    kind === "void"
      ? recordVoid(tx, key)
      : recordRefund(tx, { ...key, amount: amount ?? decimal(found.amount) }),
  );
  return {
    provider,
    paymentRef: ref,
    state: row.state,
    amount: amount ?? decimal(row.amount),
    settledAt: null,
  };
}
