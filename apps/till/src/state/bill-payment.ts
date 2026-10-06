import {
  MONEY_SCALE,
  addDecimal,
  compareDecimal,
  divideDecimal,
  decimal,
  subtractDecimal,
  sumDecimals,
  toScale,
  type Decimal,
} from "@waitron/shared";
import {
  isNetworkFailure,
  type AllocationChoice,
  type AllocationPreview,
  type BillBalance,
  type BillPaymentAsk,
  type BillPaymentRequest,
  type BillPaymentView,
  type BillRefundRequest,
  type TabLine,
} from "../api/client.js";
import type { StringKey } from "../i18n/strings.js";
import { moreThanOneWholeUnit, tabLineGross } from "./adjust-target.js";
import { trimQuantity } from "../widgets/dish-format.js";
import type { PayLine, PayRefusal } from "../widgets/bill-pay-dialog.js";

/** What the operator chose to pay. A pick with no `units` is the whole line. An equal share names
 * only how many people are still to pay: the server works out the share and the preview shows it. */
export type PayChoice =
  | { kind: "items"; picks: { lineNo: number; units?: number }[] }
  | { kind: "contribution"; amount: string }
  | { kind: "share"; shareOf: number };

/** The three ways to pay part of a bill, in the order they are offered. */
export const PAY_WAYS = [
  { way: "items", label: "bill_pay.way_items" },
  { way: "contribution", label: "bill_pay.way_contribution" },
  { way: "share", label: "bill_pay.way_share" },
] as const satisfies readonly { way: PayChoice["kind"]; label: StringKey }[];

const TYPED_AMOUNT = /^\d{1,9}([.,]\d{1,2})?$/;

/** A typed amount with a decimal comma read as a point, or null when it is not an amount. */
export function typedAmount(value: string): string | null {
  const typed = value.trim();
  return TYPED_AMOUNT.test(typed) ? typed.replace(",", ".") : null;
}

/** Two amounts added, at the money scale. */
export function moneyPlus(a: string, b: string): Decimal {
  return toScale(addDecimal(decimal(a), decimal(b)), MONEY_SCALE);
}

/** How it is paid. `addedTip` is, for cash, the part of the change left as a tip and, for a card,
 * what is charged above what is due. */
export type PayMethod =
  { method: "cash"; tendered: string; addedTip?: string } | { method: "card"; addedTip?: string };

/** The ask for a payment; `allocation` names which of the server's two ways pays for items that
 * cost more than is left. */
export function paymentAsk(
  choice: PayChoice,
  pay: PayMethod,
  allocation?: AllocationChoice,
): BillPaymentAsk {
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
  if (allocation !== undefined) ask.choice = allocation;
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

/** A request as sent: its body with a submission id, keyed by its body and what it is about. */
interface Sent<Body> {
  key: string;
  request: Body & { submissionId: string };
}

/** A confirmation as sent, keyed by its bill and its body. */
export type Submission = Sent<Confirmation>;

/** The request for `body`, keyed by `key`. Its submission id is the one `unanswered` was sent with
 * when that has the same key, and fresh otherwise. */
function sentAs<Body extends object>(
  key: string,
  body: Body,
  unanswered: Sent<Body> | null,
  mint: () => string,
): Sent<Body> {
  const submissionId =
    unanswered !== null && unanswered.key === key ? unanswered.request.submissionId : mint();
  return { key, request: { ...body, submissionId } };
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
  return sentAs(JSON.stringify([billId, confirmation]), confirmation, unanswered, mint);
}

/**
 * What is left unanswered once a send ends: nothing once the server answered it with a result, and
 * the submission otherwise. A refusal does not say what became of an earlier send of it: the server
 * refuses the session, device, reader or approver before it looks the id up (the payment and
 * refund routes, `apps/server/src/bill-payments-api.ts`; `refundBillPayment`,
 * `apps/server/src/bill-refunds.ts`). Sending the id again is safe, since the server answers an id
 * it recorded with that record; only `submission.id_reused` says it cannot be sent again.
 */
export function unansweredAfter<S>(sent: S, error?: unknown): S | null {
  if (error === undefined) return null;
  return (error as { code?: unknown }).code === "submission.id_reused" ? null : sent;
}

/** A refusal's code and the request field it names, as the refund and unpaid departure dialogs
 * show it. The app's own codes: `network`, a request that got no answer; `approvers`, a list of who
 * can approve that could not be read. */
export interface DialogRefusal {
  code: string;
  field?: string;
}

/** The longest reason a refund or an unpaid departure is sent with. */
export const REASON_MAX = 500;

/**
 * A refused request as the dialogs show it: its code, or `server.internal` when it carries none,
 * with the field it names, for a tip the venue does not take the most a card can be charged, and
 * the permission an `authorization.not_permitted` names.
 * A request that `changes` the bill and got no answer is `network`, as it may have been made.
 */
export function refusalOf(error: unknown, changes = true): PayRefusal {
  if (changes && isNetworkFailure(error)) return { code: "network" };
  const refused = error as {
    code?: unknown;
    field?: unknown;
    chargeable?: unknown;
    permission?: unknown;
    action?: unknown;
  };
  return {
    code: typeof refused.code === "string" ? refused.code : "server.internal",
    ...(typeof refused.field === "string" ? { field: refused.field } : {}),
    ...(typeof refused.chargeable === "string" ? { chargeable: refused.chargeable } : {}),
    ...(typeof refused.permission === "string" ? { permission: refused.permission } : {}),
    ...(typeof refused.action === "string" ? { action: refused.action } : {}),
  };
}

export function isTakePaymentRefusal(error: unknown): boolean {
  const refused = error as { code?: unknown; permission?: unknown } | undefined;
  return (
    refused?.code === "authorization.not_permitted" && refused.permission === "sale.take_payment"
  );
}

/** A refund as confirmed: without its submission id, and without the approver's PIN, which is
 * never kept. */
export type RefundAsk = Omit<BillRefundRequest, "submissionId" | "override">;

export type RefundSubmission = Sent<RefundAsk>;

/** As {@link submissionFor}, for a refund of one payment of the bill. */
export function refundSubmissionFor(
  billId: string,
  paymentId: string,
  ask: RefundAsk,
  unanswered: RefundSubmission | null,
  mint: () => string = () => crypto.randomUUID(),
): RefundSubmission {
  return sentAs(JSON.stringify([billId, paymentId, ask]), ask, unanswered, mint);
}

/** What is left to give back of a payment: what it took less its completed refunds. */
export function refundableOf(payment: BillPaymentView): { applied: string; tip: string } {
  const done = payment.refunds.filter((refund) => refund.state === "completed");
  const less = (amount: string, refunded: string[]) =>
    toScale(
      subtractDecimal(decimal(amount), sumDecimals(refunded.map((each) => decimal(each)))),
      MONEY_SCALE,
    );
  return {
    applied: less(
      payment.applied,
      done.map((refund) => refund.appliedAmount),
    ),
    tip: less(
      payment.tip,
      done.map((refund) => refund.tipAmount),
    ),
  };
}

/** A refund is offered of a received payment of an open bill with something left to give back,
 * while none of its refunds is still waiting for the card provider. */
export function refundOffered(payment: BillPaymentView, status: BillBalance["status"]): boolean {
  if (status !== "open" || payment.state !== "received") return false;
  if (payment.refunds.some((refund) => refund.state === "pending")) return false;
  const left = refundableOf(payment);
  return compareDecimal(moneyPlus(left.applied, left.tip), decimal("0")) > 0;
}

const paidByBalance = new WeakMap<BillBalance, ReadonlyMap<number, string>>();

/** The quantity paid of each line of `balance` by line number, worked out once per balance read. */
export function paidQuantities(balance: BillBalance): ReadonlyMap<number, string> {
  let paid = paidByBalance.get(balance);
  if (paid === undefined) {
    const byLineNo = new Map<number, string>();
    for (const line of balance.paidLines)
      if (!byLineNo.has(line.lineNo)) byLineNo.set(line.lineNo, line.paidQuantity);
    paid = byLineNo;
    paidByBalance.set(balance, paid);
  }
  return paid;
}

/** The bill's dishes as an item payment offers them, each with its extras, which are paid with it.
 * A dish is paid a unit at a time only when sold by the unit, in several units, with no extras; the
 * server refuses part of any other. */
export function payLines(lines: readonly TabLine[], name: (line: TabLine) => string): PayLine[] {
  return lines
    .filter((line) => (line.parentLineNo ?? null) === null)
    .map((line) => {
      const extras = lines.filter((row) => row.parentLineNo === line.lineNo);
      const total = toScale(sumDecimals([line, ...extras].map(tabLineGross)), MONEY_SCALE);
      return {
        lineNo: line.lineNo,
        name: name(line),
        quantity: trimQuantity(line.quantity),
        total,
        unitTotal:
          extras.length === 0 && moreThanOneWholeUnit(line)
            ? divideDecimal(total, decimal(line.quantity), MONEY_SCALE)
            : null,
      };
    });
}
