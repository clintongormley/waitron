import type { Decimal } from "@waitron/shared";

/** `sessionId` is our `external_ref`; `amountTotalMinor` is `amount_total` in cents, null when the
 * event carries none. */
export interface ParsedHostedEvent {
  type: string;
  sessionId: string;
  amountTotalMinor: number | null;
  createdAt: Date;
}

export interface StripeHostedClient {
  /** `idempotencyKey` (the caller's `payment_ref`) makes a retried initiate return the SAME
   * session rather than a duplicate. */
  createCheckoutSession(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    /** `initiate` writes its row only AFTER this call, so a crash in between leaves a settled
     * session with nothing local; these keys are how reconcile attributes that settlement to a till. */
    metadata: { working_order_id: string; payment_ref: string };
  }): Promise<{ id: string; url: string }>;
  /** THROWS on a bad signature. */
  constructWebhookEvent(payload: string, signature: string): ParsedHostedEvent;
}
