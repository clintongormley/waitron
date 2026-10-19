import { personRole, roleHasPermission, type PersonRoleValue } from "@waitron/identity";
import { addDecimal, compareDecimal, decimal, type Decimal } from "@waitron/shared";
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
  active: boolean;
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
        "adjustment.action_not_allowed" | "adjustment.note_required" | "adjustment.reason_inactive";
    };

export interface CompRequest {
  action: CompAction;
  reduction: Decimal;
  actorRole: PersonRoleValue;
  note: string | null;
  /** This reason's earlier reductions on the bill. */
  priorReductionOnBill: Decimal;
  /** The most basis points any item this request changes would then carry from this reason. */
  itemShareBp: number;
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
  if (!Number.isInteger(req.itemShareBp) || req.itemShareBp < 0) {
    throw new RangeError("itemShareBp is not a whole count of basis points");
  }
}

function lacksNote(reason: AdjustmentReason, note: string | null): boolean {
  return reason.noteRequired && (note === null || note.trim() === "");
}

/** Past the bill's comp limit, that list approves the whole request (design §3.2, step 3). */
export function evaluateComp(reason: AdjustmentReason, req: CompRequest): AdjustmentVerdict {
  assertWellFormed(req);
  if (!reason.active) return { kind: "refused", code: "adjustment.reason_inactive" };
  if (reason.kind !== "comp" || !reason.actions.includes(req.action)) {
    return { kind: "refused", code: "adjustment.action_not_allowed" };
  }
  if (lacksNote(reason, req.note)) return { kind: "refused", code: "adjustment.note_required" };
  const { maxAmount: billMax, approverRoles: billRoles } = req.billLimit;
  if (billMax !== null && compareDecimal(addDecimal(req.billComped, req.reduction), billMax) > 0) {
    return billRoles.includes(req.actorRole)
      ? { kind: "allowed" }
      : {
          kind: "needs_approval",
          approval: { by: "bill_limit", roles: [...billRoles], limit: billMax },
        };
  }
  if (reason.approverRoles.includes(req.actorRole)) return { kind: "allowed" };
  const pastItem = reason.maxPercentBp !== null && req.itemShareBp > reason.maxPercentBp;
  const pastBill =
    reason.maxAmount !== null &&
    compareDecimal(addDecimal(req.priorReductionOnBill, req.reduction), reason.maxAmount) > 0;
  if (!reason.applyRoles.includes(req.actorRole) || pastItem || pastBill) {
    return {
      kind: "needs_approval",
      approval: { by: "reason", roles: [...reason.approverRoles] },
    };
  }
  return { kind: "allowed" };
}

export function evaluateCancel(reason: AdjustmentReason, req: CancelRequest): AdjustmentVerdict {
  if (!reason.active) return { kind: "refused", code: "adjustment.reason_inactive" };
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
