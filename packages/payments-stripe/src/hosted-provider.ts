import { withTransaction } from "@waitron/db";
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
  db: Database;
}

/** The Stripe Checkout (hosted) `AsyncPaymentProvider`. It has no reversal API: the reconcile sweep
 * is the one path that hands a hosted payment back (`StripeReconciler`'s `processorRef`). */
export class StripeHostedProvider implements AsyncPaymentProvider {
  readonly provider = PROVIDER;

  constructor(private readonly opts: StripeHostedProviderOptions) {}

  async initiate(params: InitiateParams): Promise<InitiateResult> {
    // Network first: the session id, our `external_ref`, is only known after creation.
    const session = await this.opts.client.createCheckoutSession({
      amount: params.amount,
      currency: CURRENCY,
      idempotencyKey: params.paymentRef,
      metadata: { working_order_id: params.workingOrderId, payment_ref: params.paymentRef },
    });
    await withTransaction(this.opts.db, (tx) =>
      insertInitiated(tx, {
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
    // A bad signature throws, deliberately not swallowed.
    const event = this.opts.client.constructWebhookEvent(payload, signature);
    const outcome =
      event.type === "checkout.session.completed"
        ? "settled"
        : event.type === "checkout.session.expired"
          ? "expired"
          : null;
    if (outcome === null) return null;
    // Coercing a null `amount_total` to 0.00 would write a 0.00 tender for a real payment. The
    // `?? 0` below is reached only for `expired`, whose amount is unused.
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
