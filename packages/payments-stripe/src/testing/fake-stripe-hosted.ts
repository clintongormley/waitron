import type { Decimal } from "@waitron/shared";
import type { ParsedHostedEvent, StripeHostedClient } from "../hosted-client.js";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++seq).padStart(8, "0")}`;

/** A deterministic in-memory `StripeHostedClient` — the hermetic double for the hosted-checkout
 * adapter. NOT barrel-exported (a production import cannot reach it), like `FakeStripe`/
 * `FakeStripeDevice`. `createCheckoutSession` mints a `cs_` id + a url containing it. `constructWebhook
 * Event` trusts the payload (JSON built by the static `event()` helper) rather than verifying a real
 * signature; `failSignatureNext()` makes the next call throw, modelling a bad signature. */
export class FakeStripeHosted implements StripeHostedClient {
  private nextSigFails = false;

  /** The last `createCheckoutSession` params, so a test can assert what was stamped. */
  lastCreate: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    metadata: { working_order_id: string; payment_ref: string };
  } | null = null;

  /** Build the JSON payload a `constructWebhookEvent` call decodes — the fake's analogue of a raw
   * Stripe webhook body. `amountTotalMinor` defaults to null, `createdAt` to the epoch. */
  static event(e: {
    sessionId: string;
    type: string;
    amountTotalMinor?: number | null;
    createdAt?: Date;
  }): string {
    return JSON.stringify({
      type: e.type,
      sessionId: e.sessionId,
      amountTotalMinor: e.amountTotalMinor ?? null,
      createdAt: (e.createdAt ?? new Date(0)).toISOString(),
    });
  }

  /** Arm the next `constructWebhookEvent` to throw (a bad-signature simulation). One-shot. */
  failSignatureNext(): void {
    this.nextSigFails = true;
  }

  createCheckoutSession(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    metadata: { working_order_id: string; payment_ref: string };
  }): Promise<{ id: string; url: string }> {
    this.lastCreate = params;
    const id = nextId("cs");
    return Promise.resolve({ id, url: `https://checkout.stripe.test/${id}` });
  }

  // `signature` is part of the public contract (the real impl verifies it); this fake only uses it to
  // decide whether to simulate a failure via `failSignatureNext`.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
  constructWebhookEvent(payload: string, _signature: string): ParsedHostedEvent {
    if (this.nextSigFails) {
      this.nextSigFails = false;
      throw new Error("fake: invalid webhook signature");
    }
    const raw = JSON.parse(payload) as {
      type: string;
      sessionId: string;
      amountTotalMinor: number | null;
      createdAt: string;
    };
    return {
      type: raw.type,
      sessionId: raw.sessionId,
      amountTotalMinor: raw.amountTotalMinor,
      createdAt: new Date(raw.createdAt),
    };
  }
}
