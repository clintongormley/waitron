import { describe, expect, it } from "vitest";
import { en, es } from "./strings.js";
import { CODE_TABLES, codeMessage, freeItemAtFinishMessage } from "./codes.js";
import { helpEn, helpEs } from "./help-strings.js";

describe("A803 refund wording", () => {
  it.each([
    ["cancel_item.refund_at_till", "Refund it at a till: choose Refund on the receipt."],
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

  // Refund on the Pay window keeps its own title.
  const KEPT_KEYS = new Set(["bill_refund.title"]);
  const kept = (key: string) => KEPT_KEYS.has(key);

  it("lists only keys the till still has", () => {
    expect([...KEPT_KEYS].filter((key) => !Object.hasOwn(en, key))).toEqual([]);
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

  it("words the help bubble in Refund's terms", () => {
    expect(helpEn["help.give_money_back"]).toBe(
      "Refund a guest: for a dish, as goodwill, or the extra paid on top. If you close it before it is all refunded, find the receipt in Find a bill under Refunds under way; if it is not there, open Refund on the receipt again on this till.",
    );
    expect(helpEs["help.give_money_back"]).toBe(
      "Devuelve dinero a un cliente: por un plato, por cortesía o lo pagado de más. Si la cierras antes de que vuelva todo el dinero, busca el ticket en Buscar cuenta, en Devoluciones en curso; si no está, vuelve a abrir Devolución en el ticket en esta caja.",
    );
  });
});

describe("Refund names the receipt's action in English", () => {
  it.each([
    ["give_back.title", "Refund"],
    ["give_back.submit", "Refund {amount}"],
    ["give_back.submit_any", "Refund"],
    ["give_back.under_way", "Refund under way"],
    ["find_page.corrections", "Refunds under way"],
    ["give_back.done_card_any", "{amount} is refunded to the card."],
    ["bill_pay.given_back", "Refunded: {amount}"],
  ] as const)("%s says refund", (key, wording) => {
    expect(en[key]).toBe(wording);
  });

  it("keeps the per-dish checkbox's name", () => {
    expect(en["find_page.refund"]).toBe("Refund");
  });

  it("tells the checkbox from the receipt's Refund where a sentence names both", () => {
    const tables = CODE_TABLES as Record<string, Record<string, { en: string }>>;
    expect(tables.FREE_ITEM_WITH_DISH!.served!.en).toBe(
      "A dish given free with this one has been served, so it cannot come back with it. Untick Refund to cancel this dish, then refund it from the receipt.",
    );
    expect(freeItemAtFinishMessage("served", "en")).toBe(
      "A dish given free on this bill has been served, so the paid dishes cannot all be refunded here. Untick Refund on one of them, then refund it from the receipt.",
    );
  });

  it("leaves no English string naming Give money back", () => {
    const old =
      /give (money |the money |the extra |the rest )?back|money back|given back|goes back (to (the )?card|in cash)/i;
    expect(Object.entries(en).filter(([, text]) => old.test(text))).toEqual([]);
    const codes: [string, string, string][] = [];
    pairs(CODE_TABLES, "codes", codes);
    expect(codes.filter(([, english]) => old.test(english))).toEqual([]);
    expect(Object.entries(helpEn).filter(([, text]) => old.test(text))).toEqual([]);
  });
});

describe("Devolución names the receipt's action in Spanish", () => {
  it.each([
    ["give_back.title", "Devolución"],
    ["give_back.submit", "Devolver {amount}"],
    ["give_back.submit_any", "Devolver"],
    ["give_back.under_way", "Devolución en curso"],
    ["find_page.corrections", "Devoluciones en curso"],
    ["find_page.refund", "Devolución"],
    ["cancel_item.refund_at_till", "Devuélvelo en una caja: elige Devolución en el ticket."],
    [
      "cancel_item.free_served",
      "Un plato por invitación que iba con este ya se ha servido, así que no puede volver con él. Cancela este plato aquí y después devuélvelo desde el ticket.",
    ],
  ] as const)("%s", (key, wording) => {
    expect(es[key]).toBe(wording);
  });

  it("tells the checkbox from the receipt's Devolución where a sentence names both", () => {
    const tables = CODE_TABLES as Record<string, Record<string, { es: string }>>;
    expect(tables.FREE_ITEM_WITH_DISH!.served!.es).toBe(
      "Un plato por invitación que iba con este ya se ha servido, así que no puede volver con él. Desmarca Devolución para cancelar este plato y después devuélvelo desde el ticket.",
    );
    expect(freeItemAtFinishMessage("served", "es")).toBe(
      "Un plato por invitación de esta cuenta ya se ha servido, así que aquí no pueden devolver dinero todos los platos pagados. Desmarca Devolución en uno de ellos y después devuélvelo desde el ticket.",
    );
  });

  it("leaves no Spanish string naming Devolver dinero", () => {
    const old = /Devolver dinero/;
    expect(Object.entries(es).filter(([, text]) => old.test(text))).toEqual([]);
    const codes: [string, string, string][] = [];
    pairs(CODE_TABLES, "codes", codes);
    expect(codes.filter(([, , spanish]) => old.test(spanish))).toEqual([]);
    expect(Object.entries(helpEs).filter(([, text]) => old.test(text))).toEqual([]);
  });
});
