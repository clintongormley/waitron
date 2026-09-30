import { roleAtLeast, type PersonRoleValue } from "@waitron/identity";
import { addDecimal, compareDecimal, decimal, type Decimal } from "@waitron/shared";

export const ADJUSTMENT_ACTIONS = [
  "cancel",
  "comp",
  "discount_percent",
  "discount_amount",
] as const;

export type AdjustmentAction = (typeof ADJUSTMENT_ACTIONS)[number];

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
  if (
    req.action === "discount_percent" &&
    (percent === null || !Number.isInteger(percent) || percent < 1 || percent > 10000)
  ) {
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

/** The policy an adjustment was evaluated under, kept on the adjustment so a later edit of the
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
