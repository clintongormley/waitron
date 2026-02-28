import { Injectable, Logger } from "@nestjs/common";
import type { PaymentProvider, PaymentIntent, RefundResult, WebhookResult } from "./payment-provider.interface";

/**
 * Square payment provider stub.
 * Full implementation requires the Square Node.js SDK (@square/square).
 * This stub satisfies the interface for wiring/testing without the SDK dependency.
 */
@Injectable()
export class SquareProvider implements PaymentProvider {
  readonly name = "square" as const;
  private readonly logger = new Logger(SquareProvider.name);

  constructor() {
    if (!process.env.SQUARE_ACCESS_TOKEN) {
      this.logger.warn("SQUARE_ACCESS_TOKEN not set — Square payments disabled");
    }
  }

  async createPayment(
    amountCents: number,
    currency: string,
    metadata?: Record<string, unknown>,
  ): Promise<PaymentIntent> {
    throw new Error("Square SDK not installed. Set SQUARE_ACCESS_TOKEN and install @square/square.");
  }

  async confirmPayment(providerReference: string): Promise<PaymentIntent> {
    throw new Error("Square SDK not installed.");
  }

  async refund(providerReference: string, amountCents?: number): Promise<RefundResult> {
    throw new Error("Square SDK not installed.");
  }

  validateWebhook(payload: Buffer | string, signature: string): WebhookResult | null {
    this.logger.warn("Square webhook validation not implemented");
    return null;
  }
}
