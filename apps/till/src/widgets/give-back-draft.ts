import { compareDecimal, decimal } from "@waitron/shared";
import type { GiveBackLine, GiveBackPurpose, GiveBackWay } from "../api/give-back-types.js";

export type Draft = {
  lineIds: string[];
  amount: string;
  extraOn: boolean;
  way: string;
  reasonId: string;
  note: string;
};
export type Field = "amount" | "reason" | "note";
/** What Cancel and refund or Finish table hands on: the window opens on A dish with the dishes
 * still owed on a cancel ticked, and sends the cancel ids so the cancel's approval covers them on a
 * receipt (D9). */
export interface GiveBackFill {
  cancellationIds: string[];
  reasonId: string;
}
export const blank = (): Draft => ({
  lineIds: [],
  amount: "",
  extraOn: false,
  way: "",
  reasonId: "",
  note: "",
});
export const PURPOSES: readonly GiveBackPurpose[] = ["dishes", "goodwill", "extra"];
export const AMOUNT_REFUSALS = new Set([
  "sale.correction_amount_invalid",
  "invoice_correction.money_short",
  "tender.refund_exceeds_payment",
  "tender.refund_exceeds_cancelled",
]);
/** A payment this device's profile does not take is held, as the preview refuses it. */
export const usable = (way: GiveBackWay) => way.reason === null && way.allowedHere;
export const positive = (value: string) => compareDecimal(decimal(value), decimal("0")) > 0;
/** What ticking `line` starts the amount at: a cancel's money still owed, otherwise what is left. */
export const startOf = (line: GiveBackLine) =>
  line.cancelled !== null && positive(line.cancelled.owed) ? line.cancelled.owed : line.left;
