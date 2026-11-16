import type {
  RefundAnswer,
  RefundLookup,
  RefundLookupQuery,
  RefundOutcome,
  RefundSend,
} from "@waitron/payments";
import { refundLookupOf } from "@waitron/payments";
import type { StripeClient } from "./client.js";

export type StripeRefundClient = Pick<StripeClient, "createRefund" | "listRefunds">;

/**
 * Refusals of `POST /v1/refunds` that Stripe's documentation says leave no refund made
 * (read 2026-09-27): "a request that's rate limited with a 429 can produce a different result with
 * the same idempotency key because rate limiters run before the API's idempotency layer. The same
 * goes for a 401 that omitted an API key, or most 400s that sent invalid parameters."
 * (https://docs.stripe.com/error-low-level); and refunds/create "Raises an error if the
 * Charge/PaymentIntent has already been refunded, or if an invalid identifier was provided"
 * (https://docs.stripe.com/api/refunds/create), which is the 404. Stripe says MOST 400s, not all.
 * 402, 403, 409 and 424 are left off: the error page says nothing either way of them, and a 409
 * is a same-key request still executing, which may be the earlier send. 429 is left off too: it
 * says only that the attempt it answers ran nothing, and the SDK may have made an earlier attempt
 * of the same send (`createRefund` in stripe-client.ts), so a rate-limited refund stays pending
 * and a retry sends it again under its key.
 */
const DOCUMENTED_REFUND_REFUSALS = new Set([400, 401, 404]);

/** Stripe's refund statuses ("`pending`, `requires_action`, `succeeded`, `failed`, or
 * `canceled`", https://docs.stripe.com/api/refunds/object); a status it adds later is `pending`,
 * never an outcome. */
function refundOutcomeOf(status: string): RefundOutcome {
  if (status === "succeeded") return "completed";
  if (status === "failed" || status === "canceled") return "failed";
  return "pending";
}

export async function sendStripeRefund(
  client: StripeRefundClient,
  req: RefundSend,
  metadataKey: string,
  rejectUnmatched = false,
): Promise<RefundAnswer> {
  let answer;
  try {
    answer = await client.createRefund({
      paymentIntentId: req.processorRef,
      amount: req.amount,
      idempotencyKey: req.idempotencyKey,
      metadata: { [metadataKey]: req.refundId },
    });
  } catch {
    return { kind: "uncertain", reason: "network" };
  }
  if (answer.ok) {
    return {
      kind: "outcome",
      outcome: refundOutcomeOf(answer.refund.status),
      providerRefundRef: answer.refund.id,
      providerStatus: answer.refund.status,
    };
  }
  const status = answer.httpStatus;
  if (status === null) return { kind: "uncertain", reason: "network" };
  if (status >= 500) return { kind: "uncertain", reason: "server_error", httpStatus: status };
  // A refusal answers only the last HTTP attempt of this send (`createRefund`). What Stripe
  // holds under the refund's id decides; an empty list does not clear an earlier attempt, whose
  // refund may not show yet, so a refusal stands only when it answered the send's one attempt.
  const held = await lookupStripeRefund(
    client,
    {
      processorRef: req.processorRef,
      refundId: req.refundId,
      amount: req.amount,
      sentAt: new Date(0),
      excludeRefs: [],
    },
    metadataKey,
    rejectUnmatched,
  );
  if (held.kind === "match") {
    return {
      kind: "outcome",
      outcome: held.outcome,
      providerRefundRef: held.providerRefundRef,
      providerStatus: held.providerStatus,
    };
  }
  if (held.kind !== "none" || answer.attempts !== 1) {
    return { kind: "uncertain", reason: "network", httpStatus: status };
  }
  return {
    kind: "refused",
    httpStatus: status,
    documented: DOCUMENTED_REFUND_REFUSALS.has(status),
  };
}

export async function lookupStripeRefund(
  client: StripeRefundClient,
  query: RefundLookupQuery,
  metadataKey: string,
  rejectUnmatched = false,
): Promise<RefundLookup> {
  let refunds;
  try {
    refunds = await client.listRefunds(query.processorRef);
  } catch {
    return { kind: "unreachable" };
  }
  if (rejectUnmatched && refunds.some((r) => r.metadata[metadataKey] !== query.refundId))
    return { kind: "ambiguous", candidates: refunds.length };
  return refundLookupOf(
    refunds.filter((r) => r.metadata[metadataKey] === query.refundId),
    (refund) => ({
      providerRefundRef: refund.id,
      outcome: refundOutcomeOf(refund.status),
      providerStatus: refund.status,
    }),
  );
}
