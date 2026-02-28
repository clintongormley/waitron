import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { PaymentProvider, PaymentIntent, RefundResult, WebhookResult } from "./payment-provider.interface";

/**
 * Mock payment provider for testing and local development.
 * Always succeeds. Enabled when PAYMENT_PROVIDER=mock or no real provider is configured.
 */
@Injectable()
export class MockProvider implements PaymentProvider {
  readonly name = "mock" as const;

  async createPayment(
    amountCents: number,
    currency: string,
  ): Promise<PaymentIntent> {
    return {
      providerReference: `mock_pi_${randomUUID()}`,
      clientSecret: `mock_secret_${randomUUID()}`,
      status: "pending",
    };
  }

  async confirmPayment(providerReference: string): Promise<PaymentIntent> {
    return { providerReference, status: "succeeded" };
  }

  async refund(providerReference: string): Promise<RefundResult> {
    return { providerReference: `mock_re_${randomUUID()}`, status: "refunded" };
  }

  validateWebhook(payload: Buffer | string, signature: string): WebhookResult | null {
    try {
      const body = typeof payload === "string" ? JSON.parse(payload) : JSON.parse(payload.toString());
      return {
        eventType: body.type ?? "mock.event",
        paymentReference: body.providerReference,
        status: body.status,
      };
    } catch {
      return null;
    }
  }
}
