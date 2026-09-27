import {
  AppError,
  MONEY_SCALE,
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
  toScale,
  type Decimal,
} from "@waitron/shared";
import "./errors.js";

/**
 * How one payment against a bill splits between the bill, change and tip (bill payments design
 * §3). Pure: the caller reads the bill's money in its own transaction and hands it over.
 */

/** What the bill already holds. `received` is the net applied of its received payments. */
export interface BillFunds {
  workingOrderId: string;
  total: Decimal;
  received: Decimal;
  /** The applied amount of its pending card payments. */
  reserved: Decimal;
  hasPending: boolean;
}

export type AllocationChoice = "full_with_tip" | "use_pool";

/**
 * `addedTip` is what the payer adds on top of what the payment's own rule makes a tip: for cash,
 * the part of the change the operator marks as a tip; for a card, the amount charged above `due`.
 */
export type AllocationPayment =
  { method: "cash"; tendered: Decimal; addedTip: Decimal } | { method: "card"; addedTip: Decimal };

export type AllocationRequest = (
  | { kind: "items"; due: Decimal }
  | { kind: "contribution"; amount: Decimal }
  | { kind: "share"; shareOf: number }
) & { payment: AllocationPayment; choice?: AllocationChoice };

export interface Allocation {
  choice: AllocationChoice | null;
  applied: Decimal;
  tip: Decimal;
  /** Cash only. */
  change: Decimal | null;
  /** Card only: what the reader is asked for. */
  charged: Decimal | null;
}

export interface AllocationOption {
  choice: AllocationChoice;
  applied: Decimal;
  tip: Decimal;
}

export type AllocationPreview =
  ({ kind: "allocated" } & Allocation) | { kind: "choose"; options: AllocationOption[] };

export interface AllocationConfig {
  tipsEnabled: boolean;
}

const ZERO = decimal("0.00");
const CENT = decimal("0.01");

function invalid(field: string): AppError {
  return new AppError("management.request_invalid", { field });
}

const money = (value: Decimal): Decimal => toScale(value, MONEY_SCALE);

const minDecimal = (left: Decimal, right: Decimal): Decimal =>
  compareDecimal(left, right) <= 0 ? left : right;

/** `available / n`, rounded UP to the cent, so the shares of a bill sum to it exactly (plan D16). */
export function equalShare(available: Decimal, n: number): Decimal {
  if (!Number.isInteger(n) || n < 1) throw invalid("shareOf");
  const divisor = decimal(String(n));
  const nearest = divideDecimal(available, divisor, MONEY_SCALE);
  return compareDecimal(multiplyDecimal(nearest, divisor), available) < 0
    ? addDecimal(nearest, CENT)
    : nearest;
}

function dueOf(request: AllocationRequest, available: Decimal): Decimal {
  switch (request.kind) {
    case "items":
      if (compareDecimal(request.due, ZERO) <= 0) throw invalid("lines");
      return request.due;
    case "contribution":
      if (compareDecimal(request.amount, ZERO) <= 0) throw invalid("amount");
      return request.amount;
    case "share":
      return equalShare(available, request.shareOf);
  }
}

/** The choices §3.3 offers, in a fixed order. */
function offeredChoices(funds: BillFunds, config: AllocationConfig): AllocationChoice[] {
  const offered: AllocationChoice[] = [];
  if (config.tipsEnabled) offered.push("full_with_tip");
  if (!funds.hasPending) offered.push("use_pool");
  return offered;
}

function finish(
  funds: BillFunds,
  payment: AllocationPayment,
  config: AllocationConfig,
  choice: AllocationChoice | null,
  applied: Decimal,
  ruleTip: Decimal,
): Allocation {
  const tip = money(addDecimal(ruleTip, payment.addedTip));
  if (!config.tipsEnabled && compareDecimal(tip, ZERO) > 0) {
    throw new AppError("bill.tip_not_allowed", {
      workingOrderId: funds.workingOrderId,
      chargeable: money(applied),
    });
  }
  const paid = addDecimal(applied, tip);
  if (payment.method === "card") {
    return { choice, applied: money(applied), tip, change: null, charged: money(paid) };
  }
  const change = subtractDecimal(payment.tendered, paid);
  if (compareDecimal(change, ZERO) < 0) {
    // Cash that covers the applied amount is short only of the tip the payer added.
    throw invalid(compareDecimal(payment.tendered, applied) >= 0 ? "addedTip" : "tendered");
  }
  return { choice, applied: money(applied), tip, change: money(change), charged: null };
}

/**
 * §3.1: applied is the smaller of what the request asks to pay and what is available; the rest of
 * the money is change (cash) or tip (card). An item payment whose lines cost more than is
 * available answers with the §3.3 choices unless the request names one of them. Writes nothing.
 */
export function previewAllocation(
  funds: BillFunds,
  request: AllocationRequest,
  config: AllocationConfig,
): AllocationPreview {
  if (compareDecimal(request.payment.addedTip, ZERO) < 0) throw invalid("tip");
  const available = subtractDecimal(subtractDecimal(funds.total, funds.received), funds.reserved);
  if (compareDecimal(available, ZERO) <= 0) {
    if (compareDecimal(funds.reserved, ZERO) > 0) {
      throw new AppError("order.payment_in_flight", { workingOrderId: funds.workingOrderId });
    }
    throw new AppError("bill.nothing_outstanding", { workingOrderId: funds.workingOrderId });
  }
  const due = dueOf(request, available);
  if (request.kind !== "items" || compareDecimal(due, available) <= 0) {
    const applied = minDecimal(due, available);
    const ruleTip = request.payment.method === "card" ? subtractDecimal(due, applied) : ZERO;
    return {
      kind: "allocated",
      ...finish(funds, request.payment, config, null, applied, ruleTip),
    };
  }
  const offered = offeredChoices(funds, config);
  if (offered.length === 0) {
    throw new AppError("order.payment_in_flight", { workingOrderId: funds.workingOrderId });
  }
  const ruleTipOf = (choice: AllocationChoice): Decimal =>
    choice === "full_with_tip" ? subtractDecimal(due, available) : ZERO;
  if (request.choice !== undefined && offered.includes(request.choice)) {
    return {
      kind: "allocated",
      ...finish(
        funds,
        request.payment,
        config,
        request.choice,
        available,
        ruleTipOf(request.choice),
      ),
    };
  }
  return {
    kind: "choose",
    options: offered.map((choice) => ({
      choice,
      applied: money(available),
      tip: money(addDecimal(ruleTipOf(choice), request.payment.addedTip)),
    })),
  };
}

/**
 * §3.6: the payment goes ahead only on the allocation the operator was shown. Anything else —
 * another device paid in between, a line was added, a choice is needed — is refused
 * `bill.allocation_changed` with the new preview, for the till to show again.
 */
export function confirmAllocation(
  funds: BillFunds,
  request: AllocationRequest,
  config: AllocationConfig,
  seen: { applied: Decimal; tip: Decimal },
): Allocation {
  const preview = previewAllocation(funds, request, config);
  if (
    preview.kind === "allocated" &&
    compareDecimal(preview.applied, seen.applied) === 0 &&
    compareDecimal(preview.tip, seen.tip) === 0
  ) {
    const { choice, applied, tip, change, charged } = preview;
    return { choice, applied, tip, change, charged };
  }
  throw new AppError("bill.allocation_changed", { workingOrderId: funds.workingOrderId, preview });
}
