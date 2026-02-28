import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE_TOKEN } from "../database/database.provider";
import { type Database, payments, orders, locations } from "@waitron/db";
import type { PaymentProvider } from "./providers/payment-provider.interface";
import { StripeProvider } from "./providers/stripe.provider";
import { SquareProvider } from "./providers/square.provider";
import { MockProvider } from "./providers/mock.provider";
import type { CreatePaymentIntentDto } from "./dto/create-payment-intent.dto";

@Injectable()
export class PaymentsService {
  private providers: Map<string, PaymentProvider>;

  constructor(
    @Inject(DATABASE_TOKEN) private db: Database,
    private stripeProvider: StripeProvider,
    private squareProvider: SquareProvider,
    private mockProvider: MockProvider,
  ) {
    this.providers = new Map([
      ["stripe", stripeProvider],
      ["square", squareProvider],
      ["mock", mockProvider],
    ]);
  }

  private resolveProvider(name?: string): PaymentProvider {
    const key = name ?? process.env.PAYMENT_PROVIDER ?? "mock";
    const provider = this.providers.get(key);
    if (!provider) throw new NotFoundException(`Payment provider '${key}' not found`);
    return provider;
  }

  private async assertOrderBelongsToTenant(
    tenantId: string,
    orderId: string,
    locationId: string,
  ) {
    const [loc] = await this.db
      .select()
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId)));
    if (!loc) throw new NotFoundException("Location not found");

    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.locationId, locationId)));
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  async createIntent(tenantId: string, dto: CreatePaymentIntentDto) {
    const order = await this.assertOrderBelongsToTenant(
      tenantId,
      dto.orderId,
      dto.locationId,
    );
    const provider = this.resolveProvider(dto.provider);
    const currency = dto.currency ?? "USD";

    const intent = await provider.createPayment(order.totalCents, currency, {
      orderId: order.id,
    });

    const [payment] = await this.db
      .insert(payments)
      .values({
        orderId: order.id,
        provider: provider.name,
        amountCents: order.totalCents,
        currency,
        status: intent.status === "succeeded" ? "succeeded" : "pending",
        providerReference: intent.providerReference,
        metadata: intent.metadata ?? {},
      })
      .returning();

    return { payment, clientSecret: intent.clientSecret };
  }

  async handleStripeWebhook(payload: Buffer, signature: string) {
    const provider = this.stripeProvider;
    const result = provider.validateWebhook(payload, signature);
    if (!result || !result.paymentReference) return { received: true };

    if (result.status === "succeeded" || result.status === "failed") {
      await this.db
        .update(payments)
        .set({
          status: result.status === "succeeded" ? "succeeded" : "failed",
          updatedAt: new Date(),
        })
        .where(eq(payments.providerReference, result.paymentReference));

      if (result.status === "succeeded") {
        // Advance order to paid
        const [payment] = await this.db
          .select()
          .from(payments)
          .where(eq(payments.providerReference, result.paymentReference));
        if (payment) {
          await this.db
            .update(orders)
            .set({ status: "paid", updatedAt: new Date() })
            .where(eq(orders.id, payment.orderId));
        }
      }
    }

    return { received: true };
  }

  async handleSquareWebhook(payload: Buffer, signature: string) {
    const result = this.squareProvider.validateWebhook(payload, signature);
    return { received: true, handled: !!result };
  }

  async findByOrder(tenantId: string, locationId: string, orderId: string) {
    await this.assertOrderBelongsToTenant(tenantId, orderId, locationId);
    return this.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId));
  }

  async refund(tenantId: string, locationId: string, paymentId: string) {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId));
    if (!payment) throw new NotFoundException("Payment not found");

    await this.assertOrderBelongsToTenant(tenantId, payment.orderId, locationId);

    const provider = this.resolveProvider(payment.provider);
    const result = await provider.refund(payment.providerReference!);

    const [updated] = await this.db
      .update(payments)
      .set({ status: "refunded", updatedAt: new Date() })
      .where(eq(payments.id, paymentId))
      .returning();

    return updated;
  }
}
