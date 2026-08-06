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
  /** The params of the most recent `refund` call; `undefined` until one is made. Recorded because
   * WHICH processor identifier a reversal addressed is otherwise unobservable, and it is the whole
   * point of the reversal path's `resolveProcessorRef` hook: a hosted payment stores its Checkout
   * Session id in `external_ref` while `stripe.refunds` addresses a PaymentIntent, so this field is
   * how a test proves the resolution happened (and, for the terminal/on-device callers, that it
   * did NOT). */
  lastRefund: { paymentIntentId: string; amount?: Decimal; idempotencyKey: string } | undefined;
  /** The params of the most recent `createPaymentIntent` call; `undefined` until one is made.
   * Recorded because the idempotency key the provider hands Stripe is otherwise unobservable, and it
   * is the whole point of the §4 capture-idempotency guard: two `collect`s on ONE working order must
   * pass the SAME (working-order-derived) key so Stripe charges once, DECOUPLED from the per-attempt
   * random `paymentRef` (the `payments` row's own idempotency anchor). This field is how a test
   * proves that derivation. Mirrors `lastRefund`. */
  lastCreateIntent: { amount: Decimal; currency: string; idempotencyKey: string } | undefined;
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

  // Records its params into `lastCreateIntent` (so a test can assert the derived idempotency key —
  // see that field's doc) then mints a deterministic id. `params` is part of `StripeClient`'s public
  // contract, so callers on the concrete class stay typechecked against the real signature.
  createPaymentIntent(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    this.lastCreateIntent = params;
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
  // Unlike the calls above, this one really does use its params — `lastRefund` records them, so a
  // test can assert which identifier the reversal addressed.
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
