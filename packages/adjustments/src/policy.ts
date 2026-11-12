import {
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  decimalToThousandths,
  multiplyDecimal,
  subtractDecimal,
  type AdjustmentAction,
  type AdjustmentPolicySnapshot,
  type Decimal,
  type ReasonKind,
} from "@waitron/shared";
import type { AdjustmentStage } from "@waitron/db";

export const COMP_ACTIONS = ["comp", "discount_percent", "discount_amount"] as const;

export type CompAction = (typeof COMP_ACTIONS)[number];

export function isPercentBp(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10000;
}

export interface ReasonShape {
  kind: ReasonKind;
  actions: readonly string[];
  maxPercentBp: number | null;
  maxAmount: unknown;
}

export type ReasonShapeField = "actions" | "maxPercentBp" | "maxAmount";

export function reasonShapeFault(shape: ReasonShape): ReasonShapeField | null {
  const { actions } = shape;
  if (shape.kind === "void") {
    if (actions.length !== 1 || actions[0] !== "cancel") return "actions";
    if (shape.maxPercentBp !== null) return "maxPercentBp";
    if (shape.maxAmount !== null) return "maxAmount";
    return null;
  }
  if (
    actions.length === 0 ||
    new Set(actions).size !== actions.length ||
    !actions.every((action) => (COMP_ACTIONS as readonly string[]).includes(action))
  )
    return "actions";
  const percent = shape.maxPercentBp;
  if (percent !== null && (!isPercentBp(percent) || (percent < 10000 && actions.includes("comp"))))
    return "maxPercentBp";
  return null;
}

export interface AdjustmentReason {
  id: string;
  name: string;
  names: Record<string, string>;
  kind: ReasonKind;
  actions: AdjustmentAction[];
  maxPercentBp: number | null;
  maxAmount: Decimal | null;
  noteRequired: boolean;
  position: number;
}

export type Approval =
  | {
      by: "limit";
      permission: "adjustment.approve";
      limit: { kind: "reason" | "bill"; amount: Decimal | null; percentBp: number | null };
    }
  | { by: "refund"; permission: "sale.refund" };

export type AdjustmentVerdict =
  | { kind: "allowed" }
  | { kind: "needs_approval"; approval: Approval }
  | {
      kind: "refused";
      code:
        | "adjustment.action_not_allowed"
        | "adjustment.note_required"
        | "adjustment.free_not_allowed";
    };

export interface CompRequest {
  action: CompAction;
  reduction: Decimal;
  actorPermissions: ReadonlySet<string>;
  note: string | null;
  /** Whether the request takes off everything its subject cost before it. */
  takesAll: boolean;
  /** What this reason still has off the lines now on the bill, as {@link standingOff} counts it. */
  standingOnBill: Decimal;
  /** Each dish this request takes something off, as the per-dish floor reads it (plan D36). */
  dishes: DishPrice[];
  /** What comps have taken off the items still on the bill, before this request. */
  billComped: Decimal;
  billLimit: { maxAmount: Decimal | null };
}

export interface CancelRequest {
  actorPermissions: ReadonlySet<string>;
  note: string | null;
  stage: AdjustmentStage;
}

const ZERO = decimal("0");

/** A malformed request is the caller's bug, so it throws rather than being answered as a verdict. */
function assertWellFormed(req: CompRequest): void {
  for (const field of ["reduction", "standingOnBill", "billComped"] as const) {
    if (compareDecimal(req[field], ZERO) < 0) throw new RangeError(`${field} is negative`);
  }
  for (const { list, after, allowance } of req.dishes) {
    if (compareDecimal(list, ZERO) < 0) throw new RangeError("a dish's list is negative");
    if (compareDecimal(after, ZERO) < 0) throw new RangeError("a dish's price after is negative");
    if (!Number.isInteger(allowance) || allowance < 0) {
      throw new RangeError("a dish's allowance is not a whole count of cents");
    }
  }
}

function lacksNote(reason: AdjustmentReason, note: string | null): boolean {
  return reason.noteRequired && (note === null || note.trim() === "");
}

export function evaluateComp(reason: AdjustmentReason, req: CompRequest): AdjustmentVerdict {
  assertWellFormed(req);
  if (reason.kind !== "comp" || !reason.actions.includes(req.action)) {
    return { kind: "refused", code: "adjustment.action_not_allowed" };
  }
  if (takesEverything(reason, req)) return { kind: "refused", code: "adjustment.free_not_allowed" };
  if (lacksNote(reason, req.note)) return { kind: "refused", code: "adjustment.note_required" };
  const { maxAmount: billMax } = req.billLimit;
  return approvalFor(reason, req, {
    pastItem: belowFloor(req.dishes, reason.maxPercentBp),
    pastBill:
      reason.maxAmount !== null &&
      compareDecimal(addDecimal(req.standingOnBill, req.reduction), reason.maxAmount) > 0,
    pastBillLimit:
      billMax !== null && compareDecimal(addDecimal(req.billComped, req.reduction), billMax) > 0,
  });
}

/** Everything off by a percentage or an amount is Free by another name, so a reason that does not
 * offer Free refuses it too (owner, 2026-10-28). */
function takesEverything(reason: AdjustmentReason, req: CompRequest): boolean {
  return req.takesAll && !reason.actions.includes("comp");
}

function approvalFor(
  reason: AdjustmentReason,
  req: CompRequest,
  past: { pastItem: boolean; pastBill: boolean; pastBillLimit: boolean },
): AdjustmentVerdict {
  if (
    req.actorPermissions.has("adjustment.approve") ||
    (req.actorPermissions.has("adjustment.apply") &&
      !past.pastItem &&
      !past.pastBill &&
      !past.pastBillLimit)
  ) {
    return { kind: "allowed" };
  }
  return {
    kind: "needs_approval",
    approval: {
      by: "limit",
      permission: "adjustment.approve",
      limit: past.pastBillLimit
        ? { kind: "bill", amount: req.billLimit.maxAmount, percentBp: null }
        : { kind: "reason", amount: reason.maxAmount, percentBp: reason.maxPercentBp },
    },
  };
}

export function evaluateCancel(reason: AdjustmentReason, req: CancelRequest): AdjustmentVerdict {
  if (reason.kind !== "void" || !reason.actions.includes("cancel")) {
    return { kind: "refused", code: "adjustment.action_not_allowed" };
  }
  if (lacksNote(reason, req.note)) return { kind: "refused", code: "adjustment.note_required" };
  if (
    (req.stage === "fired" || req.stage === "served") &&
    !req.actorPermissions.has("sale.refund")
  ) {
    return { kind: "needs_approval", approval: { by: "refund", permission: "sale.refund" } };
  }
  return { kind: "allowed" };
}

export function approves(approval: Approval, permissions: ReadonlySet<string>): boolean {
  return permissions.has(approval.permission);
}

export function policySnapshotOf(
  reason: AdjustmentReason,
  bill: { maxBillComp: Decimal | null },
): AdjustmentPolicySnapshot {
  return {
    kind: reason.kind,
    actions: [...reason.actions],
    maxPercentBp: reason.maxPercentBp,
    maxAmount: reason.maxAmount,
    maxBillComp: bill.maxBillComp,
    noteRequired: reason.noteRequired,
  };
}

/** A dish, or identical dishes at one price, as the per-dish floor reads it (plan D36): its list
 * price and what it is charged after every reduction, each summed over the dish and its extras;
 * `allowance` is whole cents ({@link floorAllowance}). */
export interface DishPrice {
  list: Decimal;
  after: Decimal;
  allowance: number;
}

/**
 * Whether any dish is taken below its floor (owner, 2026-10-28): what is off it reaches the limit's
 * exact share of its list price plus its allowance (plan D36 reading 3).
 */
export function belowFloor(dishes: readonly DishPrice[], maxPercentBp: number | null): boolean {
  if (maxPercentBp === null) return false;
  return dishes.some(({ list, after, allowance }) => {
    if (maxPercentBp === 0) return compareDecimal(after, list) < 0;
    const off = multiplyDecimal(subtractDecimal(list, after), decimal("10000"));
    const floor = addDecimal(
      multiplyDecimal(list, decimal(String(maxPercentBp))),
      decimal(String(allowance * 100)),
    );
    return compareDecimal(off, floor) >= 0;
  });
}

/** The cents the spread's rounding can move on a dish: its lines' priced quantity (quantity over
 * the quantity its price is for), summed and rounded up once to a whole number. */
export function floorAllowance(
  lines: readonly { quantity: Decimal; priceQuantity: Decimal }[],
): number {
  let numerator = 0n;
  let denominator = 1n;
  for (const { quantity, priceQuantity } of lines) {
    const q = BigInt(decimalToThousandths(quantity));
    const p = BigInt(decimalToThousandths(priceQuantity));
    if (q <= 0n || p <= 0n) throw new RangeError("a line's quantities are not above zero");
    numerator = numerator * p + q * denominator;
    denominator *= p;
  }
  return Number((numerator + denominator - 1n) / denominator);
}

/** What a reason still has off a bill: each line's reduction scaled by the line's quantity now over
 * its quantity when taken, summed, then rounded half up to the cent once (owner, 2026-10-28; plan
 * D37 rules 3 and 5). */
export function standingOff(
  rows: readonly { reduction: Decimal; quantityThen: Decimal; quantityNow: Decimal }[],
): Decimal {
  let numerator = 0n;
  let denominator = 1n;
  for (const { reduction, quantityThen, quantityNow } of rows) {
    const cents = BigInt(decimalToCents(reduction));
    const then = BigInt(decimalToThousandths(quantityThen));
    const now = BigInt(decimalToThousandths(quantityNow));
    if (cents < 0n || then <= 0n || now < 0n) throw new RangeError("a reduction row is malformed");
    numerator = numerator * then + cents * now * denominator;
    denominator *= then;
  }
  return centsToDecimal(Number((2n * numerator + denominator) / (2n * denominator)));
}
