import type { Decimal } from "./money.js";

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
  maxBillComp: Decimal | null;
  noteRequired: boolean;
}

/** Why a comp or discount came off that a bill then answers a notice for (D54). */
export const DISCOUNT_NOTICE_WHYS = [
  "extras_changed",
  "variant_changed",
  "dish_cancelled",
  "dish_moved",
  "dish_paid_alone",
] as const;

export type DiscountNoticeWhy = (typeof DISCOUNT_NOTICE_WHYS)[number];

/** A comp or discount that came off an open bill because of a change, until one given on that bill
 * names it in `reapplies`, the bill is paid or abandoned, or (a dish's) its line leaves the bill.
 * `reapplyOn` is the line to give it again on, null when staff choose. */
export interface DiscountNotice {
  adjustmentId: string;
  why: DiscountNoticeWhy;
  /** The dish that left or changed. */
  dishName: string;
  /** The dish or set menu it was given on. */
  on: string;
  action: Exclude<AdjustmentAction, "cancel">;
  percentBp: number | null;
  /** What came off this bill when it ended and has not been given again: less than it took off
   * when given once only part of it came off, such as one portion's share. */
  amount: string;
  reasonId: string;
  reapplyOn: { lineId: string } | null;
}
