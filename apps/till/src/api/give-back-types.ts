import type { InvoiceCorrectionView } from "./invoice-correction-types.js";

/** The code (and params) the write would answer for a choice, line or payment that must wait. */
export interface GiveBackWaitReason {
  code: string;
  params?: Record<string, unknown>;
}

export interface GiveBackAvailability {
  available: boolean;
  /** Null with `available: false` when there is simply nothing left to give back. */
  reason: GiveBackWaitReason | null;
}

export type GiveBackPurpose = "dishes" | "goodwill" | "extra";

export interface GiveBackLine extends GiveBackAvailability {
  id: string;
  descriptions: Record<string, string>;
  quantity: string;
  gross: string;
  /** A cancelled dish's line counts its priced extras' lines too, so it can exceed `gross`. */
  left: string;
  cancelled: { quantity: string; owed: string; back: string } | null;
  /** The cancelled dish's line this priced extra's line is given back with; never ticked itself. */
  partOf: string | null;
  givenFree: boolean;
}

export interface GiveBackWay {
  /** `"cash"` is every cash payment together; a card is its tender id. */
  way: string;
  last4: string | null;
  manual: boolean;
  moneyLeft: string;
  extraLeft: string;
  pending: boolean;
  allowedHere: boolean;
  reason: GiveBackWaitReason | null;
}

/** `GET /api/transactions/:saleId/give-back`. */
export interface GiveBackView {
  lines: GiveBackLine[];
  ways: GiveBackWay[];
  underWay: InvoiceCorrectionView | null;
  choices: Record<GiveBackPurpose, GiveBackAvailability>;
}

export interface GiveBackRequest {
  purpose: GiveBackPurpose;
  /** The ticked lines, for `dishes` only. */
  lineIds?: string[];
  /** The money to give back; for `extra`, the extra itself. */
  amount: string;
  /** The extra given back beside dishes or goodwill; "0.00" for `extra`. */
  extra: string;
  way: string;
  /** The cancels the window was opened filled in with. */
  fromCancel?: string[];
}

export type GiveBackRight = "sale.refund" | "sale.rectify";

/** The write compares every field of each part, the ids included, with what it plans again. */
export type GiveBackPart =
  | { kind: "refund"; amount: string; way: string; cancellationIds?: string[] }
  | { kind: "extra"; amount: string; way: string }
  | { kind: "correction"; amount: string; way: string; lineIds: string[] };

/** `POST /api/transactions/:saleId/give-back/preview`. */
export interface GiveBackPreview {
  parts: GiveBackPart[];
  /** What the chosen way cannot hold, left under way for the other payments. */
  leftUnderWay: string;
  /** The rights the parts need that the person signed in lacks. */
  needs: GiveBackRight[];
  manual: boolean;
}
