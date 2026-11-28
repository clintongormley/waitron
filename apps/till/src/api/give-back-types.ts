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
  /** `waiting`: the part of `back` a card refund still waits on the card company for. */
  cancelled: { quantity: string; owed: string; back: string; waiting: string } | null;
  /** The cancels on this dish whose money is not all given back yet. */
  cancelIds: string[];
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

/** The ids one press writes under, one per part it may write; a resend reuses them. */
export interface GiveBackSubmissionIds {
  refund: string;
  extra: string;
  correction: string;
  leg: string;
}

/** What one press holds, less its ids and any PIN. */
export interface GiveBackAsk {
  request: GiveBackRequest;
  reasonId: string;
  note: string | null;
  /** The parts the preview answered; the write refuses `give_back.changed` when they differ. */
  expected: GiveBackPart[];
  /** Staff have already given the money back on the separate terminal. */
  manualConfirmed?: boolean;
}

/** `POST /api/transactions/:saleId/give-back`, which takes `request`'s fields at the top level. */
export interface GiveBackWrite extends GiveBackAsk {
  submissionIds: GiveBackSubmissionIds;
  override?: { personId: string; pin: string };
}

export interface GiveBackOutcome {
  parts: {
    kind: GiveBackPart["kind"];
    amount: string;
    state: "completed" | "pending" | "failed" | "not_started";
    refundId?: string;
    correctionId?: string;
    /** A filed corrective full invoice; `delivery` is null when the box sent nothing.
     * `printedOnReceiptNotA4`: the invoice it corrects went on A4, and this one is printing on the
     * receipt printer instead. */
    corrective?: { delivery: object | null; printedOnReceiptNotA4?: boolean };
  }[];
  /** A later part refused after an earlier one moved money. */
  refusal: { code: string; params: Record<string, unknown> } | null;
  /** Why the card company made no refund; a resend's answer leaves it out. */
  refusalReason?: "provider_balance_unavailable";
  underWay: InvoiceCorrectionView | null;
  /** What was not sent yet: it goes once the card company answers, under fresh ids. */
  rest: GiveBackRequest | null;
}
