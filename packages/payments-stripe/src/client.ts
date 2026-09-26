import { decimal, toScale } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";

export interface StripeClient {
  createPaymentIntent(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  processPaymentIntent(readerId: string, paymentIntentId: string): Promise<void>;
  readerOutcome(
    readerId: string,
  ): Promise<{ status: "in_progress" | "succeeded" | "failed"; failureCode?: string }>;
  cancelReaderAction(readerId: string): Promise<void>;
  /** Amounts are in minor units, as Stripe reports them. */
  retrievePaymentIntent(
    paymentIntentId: string,
  ): Promise<{ id: string; status: string; amount: number; amountReceived: number }>;
  cancelPaymentIntent(paymentIntentId: string): Promise<{ status: string }>;
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }>;
}

/** `Number` parses a pure integer string, never a float, so the conversion is exact for any amount
 * within `MAX_MONEY_INTEGER_DIGITS`. */
export function toMinorUnits(amount: Decimal): number {
  const scaled = toScale(amount, 2);
  return Number(scaled.replace(".", ""));
}

/** The inverse of `toMinorUnits`, built as a string so no float is involved. */
export function fromMinorUnits(minor: number): Decimal {
  const cents = Math.trunc(Math.abs(minor));
  const s = String(cents).padStart(3, "0");
  const whole = s.slice(0, -2);
  const frac = s.slice(-2);
  return decimal(`${minor < 0 ? "-" : ""}${whole}.${frac}`);
}

/** Derived from the working order, never from the per-attempt `paymentRef`, so a retried collect
 * re-drives the SAME PaymentIntent and the card is charged once: one PaymentIntent per working
 * order, possibly many `payments` rows. `cancelled` is how many of the order's PaymentIntents a
 * resolution left cancelled at Stripe (`countProviderCancelledResolutions`): the key moves on past
 * each, because until Stripe forgets a key it replays that key's first response, which names the
 * PaymentIntent now cancelled. */
export function workingOrderIdempotencyKey(workingOrderId: string, cancelled = 0): string {
  return cancelled === 0 ? `wo_${workingOrderId}` : `wo_${workingOrderId}_r${cancelled}`;
}
