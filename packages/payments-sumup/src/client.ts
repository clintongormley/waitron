import { decimal, toScale } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";

/** This adapter's `payments.provider` discriminator. It lives HERE, not in `provider.ts`, so that
 * `reverse.ts` can import it without a cycle: `provider.ts` imports `reverseViaSumUp`, and
 * `reverse.ts` needs the constant, while `client.ts` imports neither. */
export const SUMUP_PROVIDER = "sumup";

/** The `status` values SumUp documents on a transaction (`GET /v2.1/merchants/{mc}/transactions`).
 * `SumUpTransaction.status` is deliberately wider: a value SumUp adds later must reach the adapter as
 * a string it does not recognise, not be silently narrowed away by a type. */
export type SumUpStatus = "SUCCESSFUL" | "CANCELLED" | "FAILED" | "PENDING" | "REFUNDED";

export interface SumUpTransaction {
  /** SumUp's transaction id — what the refund endpoint addresses. */
  id: string;
  status: SumUpStatus | (string & {});
  amount: Decimal;
}

/** A create call has three outcomes, not two: accepted (the reader will wake), REFUSED by SumUp
 * with a definite 4xx (the reader will not wake — `reason` is the problem title, never the body),
 * or THROWN (network error, timeout: we do not know whether SumUp accepted it). The adapter treats
 * the three differently (T2 `failed` only for the second). */
export type CreateCheckoutOutcome =
  | { accepted: true; checkoutId: string; clientTransactionId: string }
  | { accepted: false; reason: string };

export type TransactionQuery =
  { clientTransactionId: string } | { foreignTransactionId: string } | { id: string };

/** The narrow SumUp surface `SumUpCloudProvider` depends on — the calls it makes, not the API. The
 * real impl (`./sumup-client.ts`) maps these onto `fetch`; `FakeSumUp` (`./testing/`) models them
 * deterministically. Amounts cross this seam as exact `Decimal`; the real impl converts at the
 * boundary. Mirrors `StripeClient`. `findTransaction` returns null for a 404 — before the reader
 * has started a checkout, SumUp may hold no transaction yet, and the adapter reads null as
 * "still pending", never as an error. */
export interface SumUpClient {
  createCheckout(params: {
    readerId: string;
    amount: Decimal;
    currency: string;
    description: string;
    /** OUR `payment_ref`, sent as `affiliate.foreign_transaction_id` when the merchant holds an
     * affiliate key — the client-supplied lookup key. */
    foreignTransactionId: string;
  }): Promise<CreateCheckoutOutcome>;
  findTransaction(query: TransactionQuery): Promise<SumUpTransaction | null>;
  refund(params: {
    transactionId: string;
    amount?: Decimal;
  }): Promise<{ status: "accepted" | "refused" }>;
}

/** Exact major→minor for `total_amount.value` (SumUp wants integer minor units with
 * `minor_unit: 2`). Same construction as payments-stripe's `toMinorUnits`: scale to "NN.MM", drop
 * the point, parse a pure integer string — never a float. */
export function toMinorUnits(amount: Decimal): number {
  return Number(toScale(amount, 2).replace(".", ""));
}

/** SumUp reports `amount` as a JSON number in major units. Round to cents via integer arithmetic
 * on the scaled value so `0.30000000000000004` becomes `"0.30"`, then rebuild the exact decimal. */
export function fromMajorUnits(major: number): Decimal {
  const cents = Math.round(major * 100);
  const sign = cents < 0 ? "-" : "";
  const s = String(Math.abs(cents)).padStart(3, "0");
  return decimal(`${sign}${s.slice(0, -2)}.${s.slice(-2)}`);
}
