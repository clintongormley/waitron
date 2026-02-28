export interface PaymentIntent {
  providerReference: string;
  clientSecret?: string;
  status: "pending" | "succeeded" | "failed";
  metadata?: Record<string, unknown>;
}

export interface RefundResult {
  providerReference: string;
  status: "refunded";
}

export interface WebhookResult {
  eventType: string;
  paymentReference?: string;
  status?: "succeeded" | "failed";
}

export interface PaymentProvider {
  readonly name: "stripe" | "square" | "mock";

  createPayment(amountCents: number, currency: string, metadata?: Record<string, unknown>): Promise<PaymentIntent>;

  confirmPayment(providerReference: string): Promise<PaymentIntent>;

  refund(providerReference: string, amountCents?: number): Promise<RefundResult>;

  validateWebhook(payload: Buffer | string, signature: string): WebhookResult | null;
}
