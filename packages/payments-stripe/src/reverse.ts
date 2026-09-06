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
 * `reverseViaStripe`'s trailing options, gathered into one named object rather than trailing
 * positional parameters.
 *
 * The function already takes six positional arguments, four of them strings, and these two options
 * are unrelated to each other — a reference resolver and a tenant scope — so no ordering between
 * them reads naturally. Naming them removes the problem and leaves room for the next option (a
 * persisted per-reversal idempotency key is the known one) without re-litigating argument order.
 */
export interface ReverseViaStripeOptions {
  /**
   * The tenant whose payment is being reversed. Both database phases use `withTenant`.
   * The first lookup uses only the payment reference; its returned tenant id must match this
   * value before any refund is issued or local state is changed.
   */
  tenantId: TenantId;
  /**
   * The reversing node's origin id, threaded into both `withTenant` phases below so the enrolled
   * `payment_refunds` INSERT and `payments` state UPDATE a reversal performs capture a real
   * `sync_log.origin_id` rather than the all-zero sentinel — which the pull loop (keyed on
   * `?originId=<peer>`) never replicates, so a refund would be lost on failover (design §4d(B); sync
   * origin attribution). REQUIRED for the same reason `tenantId` is: every live caller has a node id
   * in hand (the reconcile sweep and both interactive providers are per-node objects), and leaving it
   * optional is exactly how the all-zero-origin gap this closes was reachable in the first place.
   */
  nodeId: string;
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
 * Both database phases run through `withTenant` with the required tenant and node ids. */
export async function reverseViaStripe(
  db: Database,
  client: StripeRefunder,
  provider: string,
  ref: string,
  kind: "void" | "refund",
  /** Required but nullable, NOT optional (`amount?`): TypeScript forbids an optional parameter
   * before a required one, and the options object below is required now that `tenantId` is. Every
   * caller already passed an explicit `undefined` here, so the shape is unchanged in practice —
   * this only stops a new caller silently omitting the tail that carries the tenant. */
  amount: Decimal | undefined,
  /** See `ReverseViaStripeOptions` for why these are an object and not two more positional
   * parameters. No default: `tenantId` is required, so every caller passes this. */
  {
    tenantId,
    nodeId,
    resolveProcessorRef = (externalRef) => Promise.resolve(externalRef),
  }: ReverseViaStripeOptions,
): Promise<PaymentResult> {
  // The ONE opener for every database phase below — the T1 pre-check and whichever T2 write the
  // outcome selects — so they cannot drift apart. `withTenant` OPENS a transaction, which is why
  // this wraps only those short phases: the processor refund between them is a network call and
  // stays outside every transaction (T1/T2), as does the `resolveProcessorRef` lookup feeding it.
  //
  // There used to be a second, untenanted branch here (`tenantId === undefined ? db.transaction(fn)
  // : …`). It is gone with the option's optionality: it was the mechanism by which every
  // interactive-provider reversal failed closed under a real role.
  const inTransaction = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(db, tenantId, fn, { nodeId });

  const found = await inTransaction(async (tx) => {
    const f = await findPaymentByRef(tx, provider, ref);
    if (f === undefined || f.externalRef === null) {
      throw new AppError("payment.not_found", { provider, paymentRef: ref });
    }
    // findPaymentByRef has no tenant predicate. Refuse a mismatched tenant before issuing a
    // refund or changing local state, using the same not_found code as an absent payment.
    // Case-insensitive: Postgres renders `uuid` canonical-lowercase while `tenantId()` accepts and
    // preserves either case, so a caller holding `A1B2…` would be denied its OWN payment.
    if (f.tenantId.toLowerCase() !== tenantId.toLowerCase()) {
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
