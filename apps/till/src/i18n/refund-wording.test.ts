import { describe, expect, it } from "vitest";
import { en, es } from "./strings.js";
import { CODE_TABLES, codeMessage } from "./codes.js";
import { helpEn, helpEs } from "./help-strings.js";

describe("A803 refund wording", () => {
  it.each([
    [
      "cancel_item.refund_at_till",
      "Give the money back at a till: choose Give money back on the receipt.",
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
      "Moving these items would leave this bill owing {amount} less than has already been paid on it. Refund {amount} first, or move fewer items.",
    ],
    [
      "bill.received_exceeds_total_send_excess",
      "Sending these dishes would leave this bill owing {amount} less than has already been paid on it. Refund {amount} first.",
    ],
    [
      "bill.received_exceeds_total_merge_excess",
      "Merging would leave this bill owing {amount} less than has already been paid on it. Refund {amount} first, or keep the bills apart.",
    ],
    [
      "bill.refund_excess_bill_gone",
      "{bill} has left this table or been paid, so there is nothing to refund here.",
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

describe("A803 refund refusal wording", () => {
  it.each([
    [
      "bill.refund_exceeds_payment",
      "That is more than can be refunded from this payment. A tip is refunded only with the whole payment",
    ],
    [
      "tender.refund_exceeds_payment",
      "That is more than can be refunded from this payment. A tip is refunded on its own, or with all the remaining payment",
    ],
    [
      "bill.refund_not_whole",
      "A payment for particular items can only be refunded in full, which frees those items to be paid for again",
    ],
    [
      "payment.not_refundable",
      "This card payment can no longer be refunded. Reload the bill and try again",
    ],
    [
      "payment.refund_exceeds_capture",
      "That is more than is left to refund on this card payment. Reload the bill and check the amount",
    ],
  ] as const)("calls the payment return a refund in %s", (code, wording) => {
    expect(codeMessage(code, "en")).toBe(wording);
  });
});

const OLD_EN = /correct invoice\b|refund a payment/i;
const OLD_ES = /rectificar factura\b|devolver un pago/i;

/** Every `en`/`es` pair the code tables hold, however deeply nested. */
function pairs(value: unknown, at: string, out: [string, string, string][]): void {
  if (typeof value !== "object" || value === null) return;
  const entry = value as Record<string, unknown>;
  if (typeof entry.en === "string" && typeof entry.es === "string") {
    out.push([at, entry.en, entry.es]);
    return;
  }
  for (const [key, inner] of Object.entries(entry)) pairs(inner, `${at}.${key}`, out);
}

describe("Give money back replaces the two old buttons in the till's words", () => {
  const codes: [string, string, string][] = [];
  pairs(CODE_TABLES, "codes", codes);

  it.each(codes)("%s names neither old button, nor a corrective", (_, english, spanish) => {
    expect(english).not.toMatch(OLD_EN);
    expect(english).not.toMatch(/corrective/i);
    expect(spanish).not.toMatch(OLD_ES);
  });

  // The two old windows' own words, read only from those windows or from steps nothing reaches
  // without them, go with them (plan Task 15); Refund on the Pay window keeps its own title.
  const OLD_WINDOW_KEYS = new Set([
    "tender_refund.title",
    "tender_refund.total",
    "tender_refund.invoice_unchanged",
    "tender_refund.correction_leg",
    "tender_refund.unavailable",
    "tender_refund.applied",
    "tender_refund.tip",
    "tender_refund.amount_invalid",
    "tender_refund.tip_requires_all",
    "tender_refund.manual_confirm",
    "tender_refund.confirm_required",
    "tender_refund.manual_instruction",
    "tender_refund.status",
    "tender_refund.retry",
    "tender_refund.pending_payment",
    "tender_refund.left",
    "tender_refund.storage",
    "invoice_correction.title",
    "invoice_correction.explain",
    "invoice_correction.loading",
    "invoice_correction.read_failed",
    "invoice_correction.dishes",
    "invoice_correction.left",
    "invoice_correction.gross",
    "invoice_correction.gross_invalid",
    "invoice_correction.refundable",
    "invoice_correction.confirm",
    "invoice_correction.confirm_any",
    "invoice_correction.back",
    "invoice_correction.left_back",
    "invoice_correction.pending",
    "invoice_correction.check_again",
    "invoice_correction.give_cash",
    "invoice_correction.give_cash_hint",
    "invoice_correction.cash_given",
    "invoice_correction.refund_card",
    "invoice_correction.refund_card_hint",
    "invoice_correction.finish_now",
    "invoice_correction.finish_now_hint",
    "invoice_correction.record",
    "invoice_correction.record_hint",
    "invoice_correction.discard",
    "invoice_correction.discard_hint",
    "invoice_correction.close_keeping",
    "invoice_correction.close_keeping_hint",
    "invoice_correction.refund_still",
    "invoice_correction.card_unread",
    "invoice_correction.card_changed",
    "invoice_correction.card_not_opened",
    "invoice_correction.changed_while_checking",
    "invoice_correction.filed",
    "invoice_correction.closed",
    "invoice_correction.discarded",
    "invoice_correction.unknown",
    "invoice_correction.close",
    "invoice_correction.saved",
    "invoice_correction.no_cash_here",
    "invoice_correction.saved_cash",
    "invoice_correction.resend",
    "invoice_correction.still_lost",
    "invoice_correction.unknown_end",
    "invoice_correction.approvers_failed",
    "bill_refund.title",
  ]);
  const kept = (key: string) => OLD_WINDOW_KEYS.has(key);

  it("lists only keys the till still has", () => {
    expect([...OLD_WINDOW_KEYS].filter((key) => !Object.hasOwn(en, key))).toEqual([]);
  });

  it.each(Object.keys(en).filter((key) => !kept(key)))("%s names neither old button", (key) => {
    expect(en[key as keyof typeof en]).not.toMatch(OLD_EN);
    expect(es[key as keyof typeof es]).not.toMatch(OLD_ES);
  });

  it.each(["cancel_item.refund_at_till", "cancel_item.free_served", "meal_end.unserved_no_mark"])(
    "%s names no corrective",
    (key) => {
      expect(en[key as keyof typeof en]).not.toMatch(/corrective/i);
    },
  );

  it("words the help bubble in Give money back's terms", () => {
    expect(helpEn["help.give_money_back"]).toBe(
      "Give money back to a guest: for a dish, as goodwill, or the extra paid on top. If you close it before all the money is back, find the receipt in Find a bill under Money back under way; if it is not there, open Give money back on the receipt again on this till.",
    );
    expect(helpEs["help.give_money_back"]).toBe(
      "Devuelve dinero a un cliente: por un plato, por cortesía o lo pagado de más. Si la cierras antes de que vuelva todo el dinero, busca el ticket en Buscar cuenta, en Devoluciones en curso; si no está, vuelve a abrir Devolver dinero en el ticket en esta caja.",
    );
  });
});
