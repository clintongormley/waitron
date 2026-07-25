import type { Database } from "@waitron/db";
import type {
  AsyncPaymentProvider,
  InboundSettlement,
  InitiateParams,
  InitiateResult,
} from "@waitron/payments";
import { insertInitiated } from "@waitron/payments";
import type { StripeHostedClient } from "./hosted-client.js";
import { fromMinorUnits } from "./client.js";

const PROVIDER = "stripe";
const CURRENCY = "eur";

export interface StripeHostedProviderOptions {
  client: StripeHostedClient;
  /** Must be a TENANT-SCOPED `Database` handle (one that sets `app.tenant_id`): `initiate` opens its
   * own transaction to write the `initiated` row and relies on RLS scoping from this handle. The
   * inbound webhook path is untenanted and resolves its tenant separately (Slice A's
   * `resolvePaymentTenant`), so it does NOT use this handle — see the wiring test. */
  db: Database;
}

/** The real Stripe **Checkout** `AsyncPaymentProvider` (Mode 3, hosted/out-of-band). `initiate` mints a
 * Checkout Session (network) then writes an `initiated` `payments` row with `external_ref = session.id`
 * — the id the later `checkout.session.completed` webhook carries. A crash between the network call and
 * the write leaves an orphaned session (no local row), which `reconcile` backstops (deferred). The
 * webhook itself is handled by `verifyAndParse` (signature-verified, mapped to the neutral
 * `InboundSettlement`); the settle→recordSale→associate chaining is the app-level orchestrator's job
 * (deferred), proven here by the wiring capstone. Reversals of a hosted payment are out of scope for
 * this slice (the `external_ref` is the session id, not the PaymentIntent id). */
export class StripeHostedProvider implements AsyncPaymentProvider {
  readonly provider = PROVIDER;

  constructor(private readonly opts: StripeHostedProviderOptions) {}

  async initiate(params: InitiateParams): Promise<InitiateResult> {
    // Network first — the session id is only known after creation, and it IS our external_ref.
    // idempotencyKey = the caller's payment_ref, so a retried initiate returns the same session.
    const session = await this.opts.client.createCheckoutSession({
      amount: params.amount,
      currency: CURRENCY,
      idempotencyKey: params.paymentRef,
    });
    // Persist the initiated row (tenant-scoped via the injected db handle). The (tenant, provider,
    // payment_ref) unique makes a retried initiate a no-op-or-throw, and external_ref = session.id
    // is the webhook resolve/settle key.
    await this.opts.db.transaction((tx) =>
      insertInitiated(tx, {
        tenantId: params.tenantId,
        workingOrderId: params.workingOrderId,
        provider: PROVIDER,
        paymentRef: params.paymentRef,
        externalRef: session.id,
        amount: params.amount,
      }),
    );
    return { ref: params.paymentRef, externalRef: session.id, url: session.url };
  }

  verifyAndParse(payload: string, signature: string): InboundSettlement | null {
    // Throws on a bad signature — deliberately not swallowed (the caller returns a 4xx).
    const event = this.opts.client.constructWebhookEvent(payload, signature);
    const outcome =
      event.type === "checkout.session.completed"
        ? "settled"
        : event.type === "checkout.session.expired"
          ? "expired"
          : null;
    if (outcome === null) return null;
    // A `settled` event MUST carry the settled amount. Silently coercing a null `amount_total` to
    // 0.00 would write a 0.00 tender for a real payment, violating `InboundSettlement.amount` ("what
    // actually settled"); fail visibly instead so Stripe retries and the problem is seen. Unreachable
    // for a mode:"payment" session (amount_total is always populated on completion), but the SDK type
    // permits null, so it is guarded. The `?? 0` below is then only ever reached for `expired`, where
    // the amount is unused (`expireInitiated` ignores it).
    if (outcome === "settled" && event.amountTotalMinor === null) {
      throw new Error("stripe: checkout.session.completed carried no amount_total");
    }
    return {
      provider: PROVIDER,
      externalRef: event.sessionId,
      outcome,
      amount: fromMinorUnits(event.amountTotalMinor ?? 0),
      settledAt: event.createdAt,
    };
  }
}
