import { Injectable, Logger } from "@nestjs/common";
import Stripe from "stripe";
import type { PaymentProvider, PaymentIntent, RefundResult, WebhookResult } from "./payment-provider.interface";

@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  private stripe: Stripe;
  private webhookSecret: string;
  private readonly logger = new Logger(StripeProvider.name);

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      this.logger.warn("STRIPE_SECRET_KEY not set — Stripe payments disabled");
      this.stripe = null as any;
    } else {
      this.stripe = new Stripe(secretKey, { apiVersion: "2025-01-27.acacia" });
    }
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  }

  async createPayment(
    amountCents: number,
    currency: string,
    metadata?: Record<string, unknown>,
  ): Promise<PaymentIntent> {
    const intent = await this.stripe.paymentIntents.create({
      amount: amountCents,
      currency: currency.toLowerCase(),
      metadata: metadata as Record<string, string>,
    });
    return {
      providerReference: intent.id,
      clientSecret: intent.client_secret ?? undefined,
      status: intent.status === "succeeded" ? "succeeded" : "pending",
    };
  }

  async confirmPayment(providerReference: string): Promise<PaymentIntent> {
    const intent = await this.stripe.paymentIntents.retrieve(providerReference);
    return {
      providerReference: intent.id,
      status: intent.status === "succeeded" ? "succeeded" : "pending",
    };
  }

  async refund(providerReference: string, amountCents?: number): Promise<RefundResult> {
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: providerReference,
    };
    if (amountCents) refundParams.amount = amountCents;
    const refund = await this.stripe.refunds.create(refundParams);
    return { providerReference: refund.id, status: "refunded" };
  }

  validateWebhook(payload: Buffer | string, signature: string): WebhookResult | null {
    if (!this.webhookSecret) return null;
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.webhookSecret,
      );
      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as Stripe.PaymentIntent;
        return { eventType: event.type, paymentReference: pi.id, status: "succeeded" };
      }
      if (event.type === "payment_intent.payment_failed") {
        const pi = event.data.object as Stripe.PaymentIntent;
        return { eventType: event.type, paymentReference: pi.id, status: "failed" };
      }
      return { eventType: event.type };
    } catch {
      return null;
    }
  }
}
