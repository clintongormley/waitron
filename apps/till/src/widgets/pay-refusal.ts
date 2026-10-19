import { formatMoney } from "@waitron/shared";
import type { BillUnsent } from "../api/client.js";
import { billUnsentText } from "../state/bill-unsent.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { isTakePaymentRefusal } from "../state/bill-payment.js";

/** A refusal's code, the request field it names when it names one, for a tip the venue does not
 * take the most the card can be charged, and the permission an `authorization.not_permitted`
 * names. The app's own codes: `network`, a payment that got no answer; `unread`, a balance that
 * could not be read again; `declined` and `card_network`, a card the reader did not charge;
 * `sale.unconfirmed`, `sale.refused` and `bill.pay_with_bill_payments`, a presented bill's payment
 * in the till's own sentences. */
export interface PayRefusal {
  code: string;
  unsent?: BillUnsent;
  billLabel?: string;
  field?: string;
  chargeable?: string;
  permission?: string;
  /** A `device.forbidden_action`'s action: `pay` is the reader's. */
  action?: string;
}

function chargeableText(amount: string): string {
  return t("bill_pay.chargeable").replace("{amount}", () => formatMoney(amount, currentLocale()));
}

/** What a pay sheet says of a refusal: one of the app's own, the most a card can be charged when
 * the venue takes no tips, the till's own sentence for a device not set up for the card reader or
 * for a person who may not take payments, or the server's code in its own words. */
export function refusalText(refusal: PayRefusal): string {
  if (refusal.unsent !== undefined) return billUnsentText(refusal.billLabel);
  if (isTakePaymentRefusal(refusal)) return t("take_payment.not_permitted");
  switch (refusal.code) {
    case "network":
      return t("bill_pay.unconfirmed");
    case "unread":
      return t("bill_pay.read_failed");
    case "declined":
      return t("bill_pay.card_declined");
    case "card_network":
      return t("bill_pay.card_unreachable");
    case "sale.unconfirmed":
    case "sale.refused":
    case "bill.pay_with_bill_payments":
      return t(refusal.code);
  }
  if (refusal.code === "device.forbidden_action" && refusal.action === "pay")
    return t("card_reader.not_set_up");
  if (refusal.code === "bill.tip_not_allowed" && refusal.chargeable !== undefined)
    return chargeableText(refusal.chargeable);
  return codeMessage(refusal.code);
}
