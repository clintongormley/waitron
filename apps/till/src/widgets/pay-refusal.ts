import { formatMoney } from "@waitron/shared";
import type { BillUnsent } from "../api/client.js";
import { billUnsentText } from "../state/bill-unsent.js";
import {
  clockBehindOf,
  clockBehindText,
  clockReadingOf,
  clockUnusableText,
  currentLocale,
  t,
} from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { isTakePaymentRefusal } from "../state/bill-payment.js";
import { recoveryRefusalText } from "./recovery-refusal.js";

/** A refusal's code, the request field it names when it names one, for a tip the venue does not
 * take the most the card can be charged, and the permission an `authorization.not_permitted`
 * names. The app's own codes: `network`, a payment that got no answer; `sending`, a payment on the
 * bill still waiting for the server; `not_checked`, a payment the server could not check;
 * `payment_failed`, a payment recorded as not taken; `unread`, a balance that could not be read
 * again; `declined` and `card_network`, a card the reader did not charge; `card_timeout`, a card
 * the reader did not answer for;
 * `sale.unconfirmed`, `sale.refused` and `bill.pay_with_bill_payments`, a presented bill's payment
 * in the till's own sentences. `text`, when given, is what to say, worded by the caller. */
export interface PayRefusal {
  code: string;
  recoveryUrl?: string;
  text?: string;
  unsent?: BillUnsent;
  billLabel?: string;
  field?: string;
  chargeable?: string;
  permission?: string;
  /** A `device.forbidden_action`'s action: `pay` is the reader's. */
  action?: string;
  /** A `clock.unusable`'s reading of the box's clock. */
  clockAt?: string;
  offsetMinutes?: number;
  /** A `clock.behind_chain`'s latest record. */
  lastRecordAt?: string;
  lastRecordOffsetMinutes?: number;
  /** A `sale.charged_not_recorded`'s cause. */
  reason?: string;
  /** The payment refused was a card already charged on a terminal the box does not talk to. */
  manualCard?: true;
}

function chargeableText(amount: string): string {
  return t("bill_pay.chargeable").replace("{amount}", () => formatMoney(amount, currentLocale()));
}

/** With `checkTime`, a clock stop's words point at the till's "Check the time". */
export function refusalText(refusal: PayRefusal, checkTime = false): string {
  const recovery = recoveryRefusalText(refusal);
  if (recovery !== null) return recovery;
  if (refusal.text !== undefined) return refusal.text;
  if (refusal.unsent !== undefined) return billUnsentText(refusal.billLabel);
  if (isTakePaymentRefusal(refusal)) return t("take_payment.not_permitted");
  switch (refusal.code) {
    case "network":
      return t("bill_pay.unconfirmed");
    case "sending":
      return t("bill_pay.sending");
    case "not_checked":
      return t("bill_pay.not_checked");
    case "payment_failed":
      return t("bill_pay.payment_failed");
    case "unread":
      return t("bill_pay.read_failed");
    case "declined":
      return t("bill_pay.card_declined");
    case "card_network":
      return t("bill_pay.card_unreachable");
    case "card_timeout":
      return `${t("card.no_answer")}. ${t("card.pending_check")}`;
    case "sale.unconfirmed":
    case "sale.refused":
    case "bill.pay_with_bill_payments":
      return t(refusal.code);
    case "storage.disk_full":
      return t(refusal.manualCard ? "sale.disk_full_manual_card" : "sale.disk_full");
  }
  if (refusal.code === "clock.unusable") {
    const reading = clockReadingOf(refusal);
    if (reading !== undefined)
      return clockUnusableText(reading.clockAt, reading.offsetMinutes, checkTime);
  }
  if (refusal.code === "clock.behind_chain") {
    const behind = clockBehindOf(refusal);
    if (behind !== undefined) return clockBehindText(behind, checkTime);
  }
  if (refusal.code === "sale.charged_not_recorded" && refusal.reason === "disk_full")
    return t("sale.charged_disk_full");
  if (refusal.code === "sale.charged_not_recorded" && refusal.reason === "clock_behind_chain")
    return t("sale.charged_clock_behind");
  if (refusal.code === "device.forbidden_action" && refusal.action === "pay")
    return t("card_reader.not_set_up");
  if (refusal.code === "bill.tip_not_allowed" && refusal.chargeable !== undefined)
    return chargeableText(refusal.chargeable);
  return codeMessage(refusal.code);
}
