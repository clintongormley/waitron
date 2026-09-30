import { roleAtLeast, type PersonRoleValue } from "@waitron/identity";
import {
  addDecimal,
  compareDecimal,
  decimal,
  multiplyDecimal,
  type Decimal,
} from "@waitron/shared";

export const ADJUSTMENT_ACTIONS = [
  "cancel",
  "comp",
  "discount_percent",
  "discount_amount",
] as const;

export type AdjustmentAction = (typeof ADJUSTMENT_ACTIONS)[number];

/** A whole count of basis points from 1 to 10000: a percentage from 0.01% to 100%. */
export function isPercentBp(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10000;
}

export interface AdjustmentReason {
  id: string;
  name: string;
  names: Record<string, string>;
  actions: AdjustmentAction[];
  maxPercentBp: number | null;
  maxAmount: Decimal | null;
  applyRole: PersonRoleValue;
  approverRole: PersonRoleValue;
  noteRequired: boolean;
  active: boolean;
  position: number;
}

/** One adjustment asked under a reason. The priors are this reason's own earlier reductions on the
 * same bill, and its earlier percentage on the same line (D6). */
export interface AdjustmentRequest {
  action: AdjustmentAction;
  reduction: Decimal;
  percentBp: number | null;
  actorRole: PersonRoleValue;
  note: string | null;
  priorReductionOnBill: Decimal;
  priorPercentOnLineBp: number;
}

export type AdjustmentVerdict =
  | { kind: "allowed" }
  | { kind: "needs_approval"; approverRole: PersonRoleValue }
  | {
      kind: "refused";
      code:
        | "adjustment.action_not_allowed"
        | "adjustment.over_limit"
        | "adjustment.note_required"
        | "adjustment.reason_inactive";
    };

const ZERO = decimal("0");

/** A malformed request is the caller's bug, so it throws rather than being answered as a verdict. */
function assertWellFormed(req: AdjustmentRequest): void {
  if (compareDecimal(req.reduction, ZERO) < 0) throw new RangeError("reduction is negative");
  if (compareDecimal(req.priorReductionOnBill, ZERO) < 0) {
    throw new RangeError("priorReductionOnBill is negative");
  }
  if (!Number.isInteger(req.priorPercentOnLineBp) || req.priorPercentOnLineBp < 0) {
    throw new RangeError("priorPercentOnLineBp is not a whole count of basis points");
  }
  const percent = req.percentBp;
  if (req.action === "discount_percent" && !isPercentBp(percent)) {
    throw new RangeError("a percentage discount needs percentBp in 1..10000");
  }
}

/**
 * Whether a reason's policy lets this request through. Limits are cumulative per reason: `maxAmount`
 * caps the total the reason takes off one bill, whatever the action, and `maxPercentBp` caps the
 * combined percentage it takes off one line, for `discount_percent` only. A refusal is decided
 * before approval, so no approver is asked to allow what the policy refuses anyway.
 */
export function evaluateAdjustment(
  reason: AdjustmentReason,
  req: AdjustmentRequest,
): AdjustmentVerdict {
  assertWellFormed(req);
  if (!reason.active) return { kind: "refused", code: "adjustment.reason_inactive" };
  if (!reason.actions.includes(req.action)) {
    return { kind: "refused", code: "adjustment.action_not_allowed" };
  }
  if (
    req.action === "discount_percent" &&
    reason.maxPercentBp !== null &&
    req.priorPercentOnLineBp + req.percentBp! > reason.maxPercentBp
  ) {
    return { kind: "refused", code: "adjustment.over_limit" };
  }
  if (
    reason.maxAmount !== null &&
    compareDecimal(addDecimal(req.priorReductionOnBill, req.reduction), reason.maxAmount) > 0
  ) {
    return { kind: "refused", code: "adjustment.over_limit" };
  }
  if (reason.noteRequired && (req.note === null || req.note.trim() === "")) {
    return { kind: "refused", code: "adjustment.note_required" };
  }
  if (!roleAtLeast(req.actorRole, reason.applyRole)) {
    return { kind: "needs_approval", approverRole: reason.approverRole };
  }
  return { kind: "allowed" };
}

/** A discount asked on a bill, measured against the venue's limit on the bill's total discount. */
export interface BillDiscountRequest {
  /** The venue's limit in basis points of `billValue`; null sets none. */
  limitBp: number | null;
  /** What the bill's rows are already discounted by. */
  priorDiscount: Decimal;
  reduction: Decimal;
  /** The bill's price before any adjustment. */
  billValue: Decimal;
  actorRole: PersonRoleValue;
}

/**
 * Whether this discount takes the bill's discounts past the venue's limit when the operator is
 * below a manager, so someone at or above a manager must approve it. Reaching the limit exactly is
 * allowed; the amounts are in the cents the bill shows, and the share is compared without rounding.
 */
export function billDiscountNeedsManager(req: BillDiscountRequest): boolean {
  const { limitBp } = req;
  if (limitBp !== null && !isPercentBp(limitBp)) throw new RangeError("limitBp is not in 1..10000");
  for (const field of ["priorDiscount", "reduction", "billValue"] as const) {
    if (compareDecimal(req[field], ZERO) < 0) throw new RangeError(`${field} is negative`);
  }
  if (limitBp === null || roleAtLeast(req.actorRole, "manager")) return false;
  const taken = multiplyDecimal(addDecimal(req.priorDiscount, req.reduction), decimal("10000"));
  return compareDecimal(taken, multiplyDecimal(req.billValue, decimal(String(limitBp)))) > 0;
}

/** A bill's discount and its price before adjustments, over the same rows. */
export interface BillShare {
  discount: Decimal;
  value: Decimal;
}

/** A cancel asked on a bill: its share before and after the cancel, priced in the cents the bill
 * shows and priced exactly. */
export interface BillCancelRequest {
  limitBp: number | null;
  before: BillShare;
  after: BillShare;
  exactBefore: BillShare;
  exactAfter: BillShare;
  actorRole: PersonRoleValue;
}

/**
 * Whether a cancel by an operator below a manager leaves the bill's discount share past the venue's
 * limit, judged on `after`, and raises the share on both the shown and the exact prices, so a rise
 * that rounding alone makes or hides asks nobody. A cancel that empties the bill leaves no share.
 */
export function billCancelNeedsManager(req: BillCancelRequest): boolean {
  const { limitBp, before, after, exactBefore, exactAfter } = req;
  if (limitBp !== null && !isPercentBp(limitBp)) throw new RangeError("limitBp is not in 1..10000");
  for (const [name, share] of [
    ["before", before],
    ["after", after],
    ["exactBefore", exactBefore],
    ["exactAfter", exactAfter],
  ] as const) {
    if (compareDecimal(share.discount, ZERO) < 0 || compareDecimal(share.value, ZERO) < 0) {
      throw new RangeError(`${name} is negative`);
    }
  }
  if (limitBp === null || roleAtLeast(req.actorRole, "manager")) return false;
  const past =
    compareDecimal(
      multiplyDecimal(after.discount, decimal("10000")),
      multiplyDecimal(after.value, decimal(String(limitBp))),
    ) > 0;
  const rises = (from: BillShare, to: BillShare) =>
    compareDecimal(
      multiplyDecimal(to.discount, from.value),
      multiplyDecimal(from.discount, to.value),
    ) > 0;
  return past && rises(before, after) && rises(exactBefore, exactAfter);
}

/** The reason's policy an adjustment was evaluated under, kept on the adjustment so a later edit of the
 * reason never rewrites what was approved. */
export interface AdjustmentPolicySnapshot {
  actions: AdjustmentAction[];
  maxPercentBp: number | null;
  maxAmount: Decimal | null;
  applyRole: PersonRoleValue;
  approverRole: PersonRoleValue;
  noteRequired: boolean;
}

export function policySnapshotOf(reason: AdjustmentReason): AdjustmentPolicySnapshot {
  return {
    actions: [...reason.actions],
    maxPercentBp: reason.maxPercentBp,
    maxAmount: reason.maxAmount,
    applyRole: reason.applyRole,
    approverRole: reason.approverRole,
    noteRequired: reason.noteRequired,
  };
}
