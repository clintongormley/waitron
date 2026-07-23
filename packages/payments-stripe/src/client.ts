import { toScale } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";

/** The narrow Stripe surface `StripeTerminalProvider` depends on — the calls it makes, not the SDK.
 * The real impl (`./stripe-client.ts`) wraps the `stripe` SDK; `FakeStripe` (`./testing/`) models it
 * deterministically. Amounts cross this seam as exact `Decimal`; the real impl converts to Stripe's
 * integer minor units via `toMinorUnits`. Mirrors `VerifactuClient`. */
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

/** Exact major→minor conversion for Stripe amounts. Money is scale-2, so `toScale(2)` normalises to
 * `"NN.MM"`, and removing the point yields the integer cents string — parsed with `Number` on a PURE
 * INTEGER string (never a float): safe up to `MAX_MONEY_INTEGER_DIGITS + 2 = 14` digits, well under
 * `Number.MAX_SAFE_INTEGER`. There is deliberately no `Decimal.toNumber`, and this is the only place
 * a monetary value becomes a JS number — at the SDK boundary that requires an integer. */
export function toMinorUnits(amount: Decimal): number {
  const scaled = toScale(amount, 2);
  return Number(scaled.replace(".", ""));
}
