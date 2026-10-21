import { describe, expect, it } from "vitest";
import { en } from "./strings.js";

describe("A803 refund wording", () => {
  it.each([
    [
      "cancel_item.refund_at_till",
      "Refund the payment at a till: choose Refund a payment on the receipt.",
    ],
    [
      "held.discard_holds_money",
      "This order still holds money from a payment. Refund it before discarding the order",
    ],
    [
      "table.finish_bill_holds_money",
      "A bill on this table owes nothing but still holds money. Refund it before finishing the table",
    ],
    [
      "bill.received_exceeds_total_excess",
      "Moving these items would leave this bill owing {amount} less than has already been paid on it. Move fewer items, or refund {amount} first.",
    ],
    [
      "bill.received_exceeds_total_line_excess",
      "This change would leave this bill owing {amount} less than has already been paid on it. Change less, or refund {amount} first.",
    ],
    ["bill.refund_excess", "Refund {amount}"],
    ["bill_pay.refunded", "Refunded: {amount}"],
    ["bill_refund.title", "Refund a payment"],
    ["bill_refund.how_much", "How much to refund"],
    [
      "bill_refund.whole_only",
      "This payment was for particular items, so it is refunded in full: {amount}. Those items can then be paid for again.",
    ],
    ["bill_refund.amount", "Amount to refund"],
    ["bill_refund.reason_invalid", "Say why this is refunded"],
    ["bill_refund.continue", "Refund {amount}"],
    [
      "bill_refund.terminal_next",
      "Next, refund it on the separate card terminal it was keyed on. A supervisor or manager then approves it with their PIN.",
    ],
    [
      "bill_refund.terminal",
      "This card was keyed on a separate card terminal, so Waitron cannot refund it itself. Refund {amount} on that terminal first, then confirm it here. A supervisor or manager approves it with their PIN.",
    ],
    ["bill_refund.terminal_done", "Refunded on the terminal"],
    ["bill_refund.done_cash", "Refunded: {amount}. Hand it over in cash."],
    ["bill_refund.done_card", "Refunded: {amount} to the card."],
    [
      "bill_refund.failed",
      "The card refund of {amount} did not go through, so nothing was refunded.",
    ],
  ] as const)("calls the payment return a refund in %s", (key, wording) => {
    expect(en[key]).toBe(wording);
  });
});
