import type { Decimal } from "@waitron/shared";
import type { StripeClient } from "../client.js";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++seq).padStart(8, "0")}`;

type Outcome = "succeeded" | "failed" | "in_progress";

/** A stalled action stays `in_progress` until `cancelReaderAction` flips it to `failed`. */
export class FakeStripe implements StripeClient {
  lastRefund: { paymentIntentId: string; amount?: Decimal; idempotencyKey: string } | undefined;
  lastCreateIntent: { amount: Decimal; currency: string; idempotencyKey: string } | undefined;
  processedReaders: string[] = [];
  private outcome: Outcome = "succeeded";
  private nextRefundFails = false;
  private nextPollThrows = false;
  private readerAction = new Map<string, Outcome>();

  declineNext(): void {
    this.outcome = "failed";
  }
  stallNext(): void {
    this.outcome = "in_progress";
  }
  refundFailsNext(): void {
    this.nextRefundFails = true;
  }
  throwOnPollNext(): void {
    this.nextPollThrows = true;
  }

  createPaymentIntent(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    this.lastCreateIntent = params;
    return Promise.resolve({ id: nextId("pi") });
  }
  // Kept so callers on the concrete class are typechecked against the real signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
  processPaymentIntent(readerId: string, _paymentIntentId: string): Promise<void> {
    this.processedReaders.push(readerId);
    this.readerAction.set(readerId, this.outcome);
    this.outcome = "succeeded";
    return Promise.resolve();
  }
  readerOutcome(readerId: string): Promise<{ status: Outcome; failureCode?: string }> {
    if (this.nextPollThrows) {
      this.nextPollThrows = false;
      return Promise.reject(new Error("reader unreachable"));
    }
    const status = this.readerAction.get(readerId) ?? "succeeded";
    return Promise.resolve(
      status === "failed" ? { status, failureCode: "card_declined" } : { status },
    );
  }
  cancelReaderAction(readerId: string): Promise<void> {
    this.readerAction.set(readerId, "failed");
    return Promise.resolve();
  }
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }> {
    this.lastRefund = params;
    const fails = this.nextRefundFails;
    this.nextRefundFails = false;
    return Promise.resolve({ id: nextId("re"), status: fails ? "failed" : "succeeded" });
  }
}
