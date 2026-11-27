import type { BillUnsent } from "../api/payments-api.js";
import type { SentItemRefusal } from "../i18n/sent-item-refusal.js";
import type { StringKey } from "../i18n/strings.js";
import type { PartyChange } from "./party-change.js";
import type { LateChange } from "./sent-line-change.js";

export type ExcessCause = "move" | "line" | "send" | "merge";

/** A banner's string key, a refusal shown through its code's own message, a save refused because
 * someone took the draft over (naming them), or a change that failed after its order left the
 * screen, with a second message when something else failed since. */
export type CounterError =
  | StringKey
  /** `tableId`: the table a refusal names, for wording that names it; `bill`: the label of the
   * bill it names when that is not the bill on screen. */
  | {
      code: string;
      menuId?: string;
      tableId?: string;
      bill?: string;
      recoveryUrl?: string;
      manualCard?: true;
      dishes?: string;
      /** The refusal's `reason`, or the till's own, for a code worded by it. */
      reason?: string;
      /** A `bill.below_advances` refusal's: what the payments on account came to, and by how much
       * the bill would come to less. */
      advances?: string;
      excess?: string;
      /** The ticket an `advance.correction_open` refusal names. */
      invoiceNumber?: string;
      /** The way an `order.dining_fixed` refusal names. */
      dining?: string;
      /** Followed by how to finish the counter's sale with a printed invoice instead. */
      printedInstead?: true;
      setMenuName?: unknown;
      dishName?: unknown;
      dishNames?: unknown;
    }
  | { billPayments: string }
  | { replacedGroups: string }
  /** `cause`: what was refused, when not a move of items. `billId`: the bill the Refund acts on,
   * for a refusal that names one; `bill`: its label when it is not on screen. `split`: refused by
   * Split a table. */
  | {
      excess: string;
      cause?: Exclude<ExcessCause, "move">;
      billId?: string;
      bill?: string;
      split?: true;
    }
  /** A ticked bill of Split a table's panel changed: its label. */
  | { splitChanged: string }
  /** A refusal named someone else's unsent order on a ticked bill: their name, or "" for none. */
  | { splitTaken: string }
  /** The bill a split's refusal's Refund named has left the party: its label. */
  | { splitGone: string }
  /** The bill another refusal's Refund named has left the party: its label. */
  | { refundGone: string }
  /** An order past the simplified-invoice limit, `overLimit` being the limit. */
  | { overLimit: string }
  | { clockUnusable: { clockAt: string; offsetMinutes: number } }
  | { unsentBill: BillUnsent }
  | { takenOver: string; unsent?: true }
  /** Renaming a bill refused because another person's unsent dishes hold it: their name. */
  | { billNameTakenOver: string }
  /** Print the bill refused because another person's unsent order holds the bill: their name. */
  | { printTakenOver: string }
  | { partyChanged: PartyChange }
  | { billChanged: BillChange }
  | { lateChange: LateChange; also?: StringKey | { code: string } }
  | { sentDishRefused: SentItemRefusal };

/** What a refusal as out of date found changed when the bill was read again: the dish the
 * adjustment named, gone or changed, or something else on the bill. */
interface BillChange {
  key: "adjust.changed_bill" | "adjust.changed_line" | "adjust.changed_line_gone";
  line: string;
}
