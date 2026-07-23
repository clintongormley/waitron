import type { Decimal } from "@waitron/shared";
import type { StripeClient } from "../client.js";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++seq).padStart(8, "0")}`;

type Outcome = "succeeded" | "failed" | "in_progress";

/** A deterministic in-memory `StripeClient` — the hermetic test double for the Stripe adapter. NOT
 * barrel-exported (a production import cannot reach it), like `FakePaymentProvider`. Test controls:
 * `declineNext`/`stallNext` shape the next reader outcome; `refundFailsNext` fails the next refund;
 * `throwOnPollNext` makes the next `readerOutcome` call reject (simulating a network error mid-poll).
 * A stalled action stays `in_progress` until `cancelReaderAction` flips it to `failed`. */
export class FakeStripe implements StripeClient {
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

  // `params` is part of `StripeClient`'s public contract (the real adapter needs the amount,
  // currency and idempotency key to call Stripe); this fake mints a deterministic id and has
  // nothing else to do with it, but the parameter stays — underscore-prefixed so tsc's own
  // `noUnusedParameters` leaves it alone — so callers on the concrete class are still typechecked
  // against the real signature. Mirrors `FakeFiscalBackend`'s identical `_reason`/`_now` convention.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
  createPaymentIntent(_params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    return Promise.resolve({ id: nextId("pi") });
  }
  // `paymentIntentId` is part of the public contract; this fake only needs `readerId` to key the
  // in-memory outcome map, but the parameter stays for the same reason as `createPaymentIntent`'s
  // `_params` above.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
  processPaymentIntent(readerId: string, _paymentIntentId: string): Promise<void> {
    this.readerAction.set(readerId, this.outcome);
    this.outcome = "succeeded"; // reset to the default after one use
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
  // Same convention as `createPaymentIntent`'s `_params` above.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
  refund(_params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }> {
    const fails = this.nextRefundFails;
    this.nextRefundFails = false;
    return Promise.resolve({ id: nextId("re"), status: fails ? "failed" : "succeeded" });
  }
}
