import type { Decimal } from "./money.js";
import type { PersonRoleValue } from "./person-role.js";

export const REASON_KINDS = ["void", "comp"] as const;
export type ReasonKind = (typeof REASON_KINDS)[number];

export const ADJUSTMENT_ACTIONS = [
  "cancel",
  "comp",
  "discount_percent",
  "discount_amount",
] as const;

export type AdjustmentAction = (typeof ADJUSTMENT_ACTIONS)[number];

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
