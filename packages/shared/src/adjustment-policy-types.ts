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

/** A comp or discount that came off an open bill because of a change. A dish's ending goes once one
 * given on that bill names it in `reapplies` and takes something off that dish or its extras, or
 * once its line leaves the bill; a set menu's once any one names it; all once the bill is paid or
 * abandoned.
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
  /** What its endings on this bill not yet given again gave back, reckoned from each row's
   * recorded reduction at the quantity the row holds now, a row since removed counting whole: less
   * than it took off when given once only part of it came off, such as one portion's share. */
  amount: string;
  reasonId: string;
  reapplyOn: { lineId: string } | null;
}

/** A comp or discount given on an open bill and not yet written into its prices, once however
 * many rows (`given_together`) hold it, `id`, `target`, `origin` and `reasonName` being the first row's. `amount` is the fixed amount
 * given, null for a comp or a percentage; `takes` is what it takes off the bill's total now; both
 * sum its rows. `holds`, as `workOutHeldBill` decides: `cut_down` when a fixed amount cannot all
 * come off what it was given on, `set_menu_gone` when its set-menu row is gone, so it takes
 * nothing; `yes` only when every row holds, otherwise the first row's that does not. */
export interface PendingDiscountView {
  id: string;
  target:
    | { kind: "bill" }
    | { kind: "line"; lineId: string }
    | { kind: "set_menu"; lineId: string | null };
  action: Exclude<AdjustmentAction, "cancel">;
  percentBp: number | null;
  amount: string | null;
  takes: string;
  holds: "yes" | "set_menu_gone" | "cut_down";
  origin: "given" | "bill_share";
  reasonName: string;
}
