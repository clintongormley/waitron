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
 * order, possibly many `payments` rows. */
export function workingOrderIdempotencyKey(workingOrderId: string): string {
  return `wo_${workingOrderId}`;
}
