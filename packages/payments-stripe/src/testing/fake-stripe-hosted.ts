import type { Decimal } from "@waitron/shared";
import type { ParsedHostedEvent, StripeHostedClient } from "../hosted-client.js";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++seq).padStart(8, "0")}`;

/** `constructWebhookEvent` trusts the payload built by `event()` rather than verifying a signature;
 * `failSignatureNext()` models a bad one. */
export class FakeStripeHosted implements StripeHostedClient {
  private nextSigFails = false;

  lastCreate: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    metadata: { working_order_id: string; payment_ref: string };
  } | null = null;

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

  // Kept for the real signature: the real client verifies it.
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
