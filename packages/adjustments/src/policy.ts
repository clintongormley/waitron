import { personRole, roleHasPermission, type PersonRoleValue } from "@waitron/identity";
import {
  addDecimal,
  compareDecimal,
  decimal,
  decimalToThousandths,
  multiplyDecimal,
  subtractDecimal,
  type Decimal,
} from "@waitron/shared";
import type { AdjustmentStage } from "./schema/adjustments.js";
import type { ReasonKind } from "./schema/reasons.js";

export const ADJUSTMENT_ACTIONS = [
  "cancel",
  "comp",
  "discount_percent",
  "discount_amount",
] as const;

export type AdjustmentAction = (typeof ADJUSTMENT_ACTIONS)[number];

export const COMP_ACTIONS = ["comp", "discount_percent", "discount_amount"] as const;

export type CompAction = (typeof COMP_ACTIONS)[number];

/** A whole count of basis points from 1 to 10000: a percentage from 0.01% to 100%. */
export function isPercentBp(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10000;
}

/** A role list a reason or the bill limit may hold: not empty, no role twice, every one a role. */
export function isRoleList(roles: readonly string[]): roles is PersonRoleValue[] {
  return (
    roles.length > 0 &&
    new Set(roles).size === roles.length &&
    roles.every((role) => (personRole.enumValues as readonly string[]).includes(role))
  );
}

/** What a reason's kind decides about its other fields. `maxAmount` is read only for whether it is
 * set. */
export interface ReasonShape {
  kind: ReasonKind;
  actions: readonly string[];
  applyRoles: readonly string[];
  approverRoles: readonly string[];
  maxPercentBp: number | null;
  maxAmount: unknown;
}

export type ReasonShapeField =
  "actions" | "applyRoles" | "approverRoles" | "maxPercentBp" | "maxAmount";

/**
 * The first field of `shape` these checks fault, or null. A Void reason only cancels, and carries no
 * roles or limits: a cancel's rule is the refund permission. A Comp reason has one or more distinct
 * comp actions, two role lists {@link isRoleList} accepts, and an item limit of 1 to 10000 basis
 * points or none, under 10000 only without Free (design §3.1); its amount limit is not checked.
 */
export function reasonShapeFault(shape: ReasonShape): ReasonShapeField | null {
  const { actions } = shape;
  if (shape.kind === "void") {
    if (actions.length !== 1 || actions[0] !== "cancel") return "actions";
    if (shape.applyRoles.length > 0) return "applyRoles";
    if (shape.approverRoles.length > 0) return "approverRoles";
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
  if (!isRoleList(shape.applyRoles)) return "applyRoles";
  if (!isRoleList(shape.approverRoles)) return "approverRoles";
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
  applyRoles: PersonRoleValue[];
  approverRoles: PersonRoleValue[];
  noteRequired: boolean;
  position: number;
}

/** Whose PIN lets a request through: a list of roles, or anyone holding the refund permission. */
export type Approval =
  | { by: "reason"; roles: PersonRoleValue[] }
  | { by: "bill_limit"; roles: PersonRoleValue[]; limit: Decimal }
  | { by: "refund" };

export type AdjustmentVerdict =
  | { kind: "allowed" }
  | { kind: "needs_approval"; approval: Approval }
  | {
      kind: "refused";
      code:
        | "adjustment.action_not_allowed"
        | "adjustment.note_required"
        | "adjustment.no_common_approver";
    };

export interface CompRequest {
  action: CompAction;
  reduction: Decimal;
  actorRole: PersonRoleValue;
  note: string | null;
  /** This reason's earlier reductions on the bill. */
  priorReductionOnBill: Decimal;
  /** Each dish this request takes something off, as the per-dish floor reads it (plan D36). */
  dishes: DishPrice[];
  /** What comps have taken off the items still on the bill, before this request. */
  billComped: Decimal;
  billLimit: { maxAmount: Decimal | null; approverRoles: PersonRoleValue[] };
}

export interface CancelRequest {
  actorRole: PersonRoleValue;
  note: string | null;
  stage: AdjustmentStage;
}

const ZERO = decimal("0");

/** A malformed request is the caller's bug, so it throws rather than being answered as a verdict. */
function assertWellFormed(req: CompRequest): void {
  for (const field of ["reduction", "priorReductionOnBill", "billComped"] as const) {
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
  if (lacksNote(reason, req.note)) return { kind: "refused", code: "adjustment.note_required" };
  const { maxAmount: billMax } = req.billLimit;
  return approvalFor(reason, req, {
    pastItem: belowFloor(req.dishes, reason.maxPercentBp),
    pastBill:
      reason.maxAmount !== null &&
      compareDecimal(addDecimal(req.priorReductionOnBill, req.reduction), reason.maxAmount) > 0,
    pastBillLimit:
      billMax !== null && compareDecimal(addDecimal(req.billComped, req.reduction), billMax) > 0,
  });
}

/** Whoever lets a request through must be allowed both past the bill's comp limit and this
 * reason; being on the bill-limit list never overrides the reason's own lists (owner, 2026-10-28). */
function approvalFor(
  reason: AdjustmentReason,
  req: CompRequest,
  past: { pastItem: boolean; pastBill: boolean; pastBillLimit: boolean },
): AdjustmentVerdict {
  const canDoReason = (role: PersonRoleValue): boolean =>
    reason.approverRoles.includes(role) ||
    (reason.applyRoles.includes(role) && !past.pastItem && !past.pastBill);
  const billRoles = req.billLimit.approverRoles;
  const canPassBill = (role: PersonRoleValue): boolean =>
    !past.pastBillLimit || billRoles.includes(role);
  if (canDoReason(req.actorRole) && canPassBill(req.actorRole)) return { kind: "allowed" };
  if (!past.pastBillLimit) {
    return {
      kind: "needs_approval",
      approval: { by: "reason", roles: [...reason.approverRoles] },
    };
  }
  const roles = billRoles.filter(canDoReason);
  if (roles.length === 0) return { kind: "refused", code: "adjustment.no_common_approver" };
  return {
    kind: "needs_approval",
    approval: { by: "bill_limit", roles, limit: req.billLimit.maxAmount! },
  };
}

export function evaluateCancel(reason: AdjustmentReason, req: CancelRequest): AdjustmentVerdict {
  if (reason.kind !== "void" || !reason.actions.includes("cancel")) {
    return { kind: "refused", code: "adjustment.action_not_allowed" };
  }
  if (lacksNote(reason, req.note)) return { kind: "refused", code: "adjustment.note_required" };
  if (
    (req.stage === "fired" || req.stage === "served") &&
    !roleHasPermission(req.actorRole, "sale.refund")
  ) {
    return { kind: "needs_approval", approval: { by: "refund" } };
  }
  return { kind: "allowed" };
}

export function approves(approval: Approval, role: PersonRoleValue): boolean {
  return approval.by === "refund"
    ? roleHasPermission(role, "sale.refund")
    : approval.roles.includes(role);
}

/** The reason's policy an adjustment was evaluated under, kept on the adjustment so a later edit of the
 * reason never rewrites what was approved. */
export interface AdjustmentPolicySnapshot {
  kind: ReasonKind;
  actions: AdjustmentAction[];
  maxPercentBp: number | null;
  maxAmount: Decimal | null;
  applyRoles: PersonRoleValue[];
  approverRoles: PersonRoleValue[];
  noteRequired: boolean;
}

export function policySnapshotOf(reason: AdjustmentReason): AdjustmentPolicySnapshot {
  return {
    kind: reason.kind,
    actions: [...reason.actions],
    maxPercentBp: reason.maxPercentBp,
    maxAmount: reason.maxAmount,
    applyRoles: [...reason.applyRoles],
    approverRoles: [...reason.approverRoles],
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
