import { isNetworkFailure } from "../api/client.js";
import type {
  AllocationChoice,
  AllocationPreview,
  BillPaymentAsk,
  BillPaymentRequest,
} from "../api/client.js";

/** What the operator chose to pay. A pick with no `units` is the whole line. An equal share names
 * only how many people are still to pay: the server works out the share and the preview shows it. */
export type PayChoice =
  | { kind: "items"; picks: { lineNo: number; units?: number }[] }
  | { kind: "contribution"; amount: string }
  | { kind: "share"; shareOf: number };

/** How it is paid. `addedTip` is, for cash, the part of the change left as a tip and, for a card,
 * what is charged above what is due. */
export type PayMethod =
  { method: "cash"; tendered: string; addedTip?: string } | { method: "card"; addedTip?: string };

export function paymentAsk(choice: PayChoice, pay: PayMethod): BillPaymentAsk {
  const ask: BillPaymentAsk =
    choice.kind === "items"
      ? {
          kind: "items",
          lines: choice.picks.map((pick) =>
            pick.units === undefined
              ? { lineNo: pick.lineNo }
              : { lineNo: pick.lineNo, quantity: String(pick.units) },
          ),
          method: pay.method,
        }
      : choice.kind === "contribution"
        ? { kind: "contribution", amount: choice.amount, method: pay.method }
        : { kind: "share", shareOf: choice.shareOf, method: pay.method };
  if (pay.method === "cash") ask.tendered = pay.tendered;
  if (pay.addedTip !== undefined) ask.addedTip = pay.addedTip;
  return ask;
}

/** How a card is charged: on a terminal the till does not drive, or on a reader. */
export type CardEntry =
  | { entry: "manual"; externalRef?: string }
  | { entry: "reader"; readerId?: string; simulationOutcome?: "captured" | "declined" };

/** A payment as confirmed, before it has a submission id. */
export type Confirmation = Omit<BillPaymentRequest, "submissionId">;

/**
 * The payment the operator confirmed: the ask with the allocation they were shown, which the server
 * takes only while it still holds. `shown` is the allocated preview, or the option picked from the
 * two the server offered, whose choice the ask then names.
 */
export function confirmationOf(
  ask: BillPaymentAsk,
  shown:
    | Extract<AllocationPreview, { kind: "allocated" }>
    | { choice: AllocationChoice; applied: string; tip: string },
  card?: CardEntry,
): Confirmation {
  return {
    ...ask,
    ...("kind" in shown ? {} : { choice: shown.choice }),
    applied: shown.applied,
    tip: shown.tip,
    ...card,
  };
}

/** A confirmation as sent, keyed by its bill and its body. */
export interface Submission {
  key: string;
  request: BillPaymentRequest;
}

/**
 * The request for a confirmation about to be sent. Its submission id is the one `unanswered` was
 * sent with when this is that same confirmation on that same bill, so the server answers a payment
 * that did arrive as it answered the first time and never takes it twice; otherwise it is fresh.
 */
export function submissionFor(
  billId: string,
  confirmation: Confirmation,
  unanswered: Submission | null,
  mint: () => string = () => crypto.randomUUID(),
): Submission {
  const key = JSON.stringify([billId, confirmation]);
  const submissionId =
    unanswered !== null && unanswered.key === key ? unanswered.request.submissionId : mint();
  return { key, request: { ...confirmation, submissionId } };
}

/** What is left unanswered once a send ends: the submission, when it got no answer at all;
 * nothing, when the server answered, a refusal included. */
export function unansweredAfter(sent: Submission, error?: unknown): Submission | null {
  return isNetworkFailure(error) ? sent : null;
}
