import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./bill-pay-dialog.js";
import type { PayLine, PayRequest, TillBillPayDialog } from "./bill-pay-dialog.js";
import type { AllocationPreview, BillBalance, BillPaymentView } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

function balanceOf(over: Partial<BillBalance> = {}): BillBalance {
  return {
    workingOrderId: "wo-4",
    status: "open",
    total: "120.00",
    received: "0.00",
    reserved: "0.00",
    outstanding: "120.00",
    tips: "0.00",
    payments: [],
    paidLines: [],
    ...over,
  };
}

const paella: PayLine = {
  lineNo: 1,
  name: "Paella",
  quantity: "1",
  total: "35.00",
  unitTotal: null,
};
const beers: PayLine = { lineNo: 2, name: "Beer", quantity: "3", total: "9.00", unitTotal: "3.00" };
const tiramisu: PayLine = {
  lineNo: 3,
  name: "Tiramisu",
  quantity: "1",
  total: "6.00",
  unitTotal: null,
};
const lines = [paella, beers, tiramisu];

async function mount(over: Partial<TillBillPayDialog> = {}) {
  const { el } = await mountWidget<TillBillPayDialog>("till-bill-pay-dialog", {
    balance: balanceOf(),
    lines,
    way: "items",
    ...over,
  });
  return el;
}

const root = (el: TillBillPayDialog) => el.shadowRoot!;
const text = (node: Element | ShadowRoot | null) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const money = (amount: string) => formatMoney(amount, currentLocale());
const field = (el: TillBillPayDialog, name: string) =>
  root(el).querySelector<HTMLElement & { error: string; required: boolean; value: string }>(
    `wt-input[name="${name}"]`,
  );
const actions = (el: TillBillPayDialog) =>
  root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
const button = (el: TillBillPayDialog, selector: string) =>
  root(el).querySelector<HTMLElement & { disabled: boolean }>(selector)!;
const scope = (el: TillBillPayDialog) => text(root(el).querySelector("[data-pay-scope]"));
const offered = (el: TillBillPayDialog) =>
  [...root(el).querySelectorAll<HTMLInputElement>('input[name="line"]')].map((box) =>
    text(box.closest("label")),
  );

async function type(el: TillBillPayDialog, name: string, value: string): Promise<void> {
  const input = field(el, name)!.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

async function click(el: TillBillPayDialog, selector: string): Promise<void> {
  button(el, selector).click();
  await el.updateComplete;
}

async function pick(el: TillBillPayDialog, name: string, value: string): Promise<void> {
  root(el).querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!.click();
  await el.updateComplete;
}

function capture<T>(el: TillBillPayDialog, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

/** Continue, answered as the app answers it: what was asked, and the server's preview of it. */
async function previewed(el: TillBillPayDialog, preview: AllocationPreview): Promise<PayRequest> {
  const asked = capture<PayRequest>(el, "bill-pay-preview");
  await click(el, "[data-pay-continue]");
  el.asked = asked.at(-1)!;
  el.preview = preview;
  await el.updateComplete;
  return asked.at(-1)!;
}

const cashPreview = (applied: string, change: string, tip = "0.00"): AllocationPreview => ({
  kind: "allocated",
  choice: null,
  applied,
  tip,
  change,
  charged: null,
});

describe("till-bill-pay-dialog: the bill's balance", () => {
  it("shows the bill's total, what it has received, what a card in progress holds and what is still to pay", async () => {
    const el = await mount({
      balance: balanceOf({ received: "50.00", reserved: "20.00", outstanding: "50.00" }),
    });

    expect(text(root(el).querySelector("[data-pay-total]"))).toContain(money("120.00"));
    expect(text(root(el).querySelector("[data-pay-received]"))).toContain(money("50.00"));
    expect(text(root(el).querySelector("[data-pay-reserved]"))).toContain(money("20.00"));
    expect(text(root(el).querySelector("[data-pay-outstanding]"))).toContain(money("50.00"));
  });

  it("shows the balance again when it is read again", async () => {
    const el = await mount();
    el.balance = balanceOf({ received: "30.00", outstanding: "90.00" });
    await el.updateComplete;

    expect(text(root(el).querySelector("[data-pay-received]"))).toContain(money("30.00"));
    expect(text(root(el).querySelector("[data-pay-outstanding]"))).toContain(money("90.00"));
  });

  it("says the balance is being read while it has none", async () => {
    const el = await mount({ balance: null });
    expect(text(root(el).querySelector("[data-pay-balance]"))).toContain(t("bill_pay.reading"));
  });
});

describe("till-bill-pay-dialog: paying for items", () => {
  it("offers every item not yet paid for, and the units of a line still to pay", async () => {
    const el = await mount({
      balance: balanceOf({
        paidLines: [
          { lineId: "l-2", lineNo: 2, paidQuantity: "1.000" },
          { lineId: "l-3", lineNo: 3, paidQuantity: "1.000" },
        ],
      }),
    });

    expect(offered(el)).toEqual([`Paella ×1 · ${money("35.00")}`, `Beer ×2 · ${money("6.00")}`]);
  });

  it("shows what the chosen items come to before anything is asked", async () => {
    const el = await mount();
    await pick(el, "line", "1");
    await pick(el, "line", "2");

    expect(scope(el)).toContain(money("44.00"));
    expect(scope(el)).toContain("Paella");
    expect(scope(el)).toContain("Beer ×3");
  });

  it("asks for chosen whole lines, and for fewer units of a line by their count", async () => {
    const el = await mount();
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await pick(el, "line", "1");
    await pick(el, "line", "2");
    await click(el, '[data-units-less="2"]');
    await type(el, "tendered", "50");
    await click(el, "[data-pay-continue]");

    expect(scope(el)).toContain(money("41.00"));
    expect(asked).toEqual([
      {
        choice: { kind: "items", picks: [{ lineNo: 1 }, { lineNo: 2, units: 2 }] },
        pay: { method: "cash", tendered: "50" },
      },
    ]);
  });

  it("asks for the units still to pay by their count once some of a line is paid", async () => {
    const el = await mount({
      balance: balanceOf({ paidLines: [{ lineId: "l-2", lineNo: 2, paidQuantity: "1.000" }] }),
    });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await pick(el, "line", "2");
    await type(el, "tendered", "6");
    await click(el, "[data-pay-continue]");

    expect(asked[0]!.choice).toEqual({ kind: "items", picks: [{ lineNo: 2, units: 2 }] });
  });

  it("does not step units beyond one or beyond what is still to pay", async () => {
    const el = await mount();
    await pick(el, "line", "2");

    expect(button(el, '[data-units-more="2"]').disabled).toBe(true);
    await click(el, '[data-units-less="2"]');
    await click(el, '[data-units-less="2"]');
    expect(button(el, '[data-units-less="2"]').disabled).toBe(true);
    expect(text(root(el).querySelector('[data-units="2"]'))).toBe("1");
  });

  it("says when every item is already paid for", async () => {
    const el = await mount({
      lines: [tiramisu],
      balance: balanceOf({ paidLines: [{ lineId: "l-3", lineNo: 3, paidQuantity: "1.000" }] }),
    });
    expect(text(root(el).querySelector("[data-items-none]"))).toBe(t("bill_pay.items_none"));
  });
});

describe("till-bill-pay-dialog: contributing and splitting equally", () => {
  it("asks for a contribution of the amount typed, read with a decimal comma", async () => {
    const el = await mount({ way: "contribution" });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await type(el, "amount", "25,50");
    await pick(el, "method", "card");
    await click(el, "[data-pay-continue]");

    expect(scope(el)).toContain(money("25.50"));
    expect(asked).toEqual([
      {
        choice: { kind: "contribution", amount: "25.50" },
        pay: { method: "card" },
        card: { entry: "manual" },
      },
    ]);
  });

  it("starts a contribution at the amount it was opened with", async () => {
    const el = await mount({ way: "contribution", amount: "40.00" });
    expect(field(el, "amount")!.value).toBe("40.00");
  });

  it("asks for an equal share among the people still to pay, and shows what they share", async () => {
    const el = await mount({ way: "items" });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await pick(el, "way", "share");
    await type(el, "people", "3");
    await type(el, "tendered", "50");
    await click(el, "[data-pay-continue]");

    expect(scope(el)).toContain(money("120.00"));
    expect(scope(el)).toContain("3");
    expect(asked[0]!.choice).toEqual({ kind: "share", shareOf: 3 });
  });

  it("sends a card's tip and its operation number with a hand-keyed card", async () => {
    const el = await mount({ way: "contribution" });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await type(el, "amount", "40");
    await pick(el, "method", "card");
    await type(el, "cardTip", "10");
    await type(el, "externalRef", " 000123 ");
    await click(el, "[data-pay-continue]");

    expect(asked[0]).toEqual({
      choice: { kind: "contribution", amount: "40" },
      pay: { method: "card", addedTip: "10" },
      card: { entry: "manual", externalRef: "000123" },
    });
  });
});

describe("till-bill-pay-dialog: on a device that does not take cash", () => {
  it("offers card only, says to take cash at a till, and asks for a card", async () => {
    const el = await mount({ way: "contribution", takesCash: false });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    const methods = [...root(el).querySelectorAll<HTMLInputElement>('input[name="method"]')];
    expect(methods.map((radio) => [radio.value, radio.checked])).toEqual([["card", true]]);
    expect(text(root(el).querySelector(".cash-at-till"))).toBe(t("tender.cash_at_till"));
    expect(field(el, "tendered")).toBeNull();

    await type(el, "amount", "20");
    await click(el, "[data-pay-continue]");

    expect(asked).toEqual([
      {
        choice: { kind: "contribution", amount: "20" },
        pay: { method: "card" },
        card: { entry: "manual" },
      },
    ]);
  });

  it("offers cash by default, with no line about taking it at a till", async () => {
    const el = await mount();
    const methods = [...root(el).querySelectorAll<HTMLInputElement>('input[name="method"]')];
    expect(methods.map((radio) => radio.value)).toEqual(["cash", "card"]);
    expect(root(el).querySelector(".cash-at-till")).toBeNull();
  });
});

describe("till-bill-pay-dialog: its own checks", () => {
  it("marks the required fields", async () => {
    const el = await mount({ way: "contribution" });
    expect(field(el, "amount")!.required).toBe(true);
    expect(field(el, "tendered")!.required).toBe(true);
    await pick(el, "method", "card");
    expect(field(el, "tendered")).toBeNull();
    expect(field(el, "cardTip")!.required).toBe(false);
  });

  it("explains an empty submission beside each field and once above the action, which waits until they are fixed", async () => {
    const el = await mount({ way: "items" });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await click(el, "[data-pay-continue]");

    expect(text(root(el).querySelector('[data-error-for="lines"]'))).toBe(
      t("bill_pay.items_required"),
    );
    expect(field(el, "tendered")!.error).toBe(t("bill_pay.tendered_invalid"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(button(el, "[data-pay-continue]").disabled).toBe(true);
    expect(asked).toEqual([]);

    await pick(el, "line", "1");
    await type(el, "tendered", "35");

    expect(actions(el).error).toBe("");
    expect(button(el, "[data-pay-continue]").disabled).toBe(false);
  });

  it.each([
    ["contribution", "amount", "0", "bill_pay.amount_invalid"],
    ["contribution", "amount", "abc", "bill_pay.amount_invalid"],
    ["share", "people", "0", "bill_pay.people_invalid"],
    ["share", "people", "1.5", "bill_pay.people_invalid"],
  ] as const)("refuses a %s %s of %s", async (way, name, value, key) => {
    const el = await mount({ way });
    await type(el, name, value);
    await type(el, "tendered", "10");
    await click(el, "[data-pay-continue]");

    expect(field(el, name)!.error).toBe(t(key));
  });

  it("refuses a card tip that is not an amount", async () => {
    const el = await mount({ way: "contribution" });
    await type(el, "amount", "10");
    await pick(el, "method", "card");
    await type(el, "cardTip", "x");
    await click(el, "[data-pay-continue]");

    expect(field(el, "cardTip")!.error).toBe(t("bill_pay.tip_invalid"));
  });
});

describe("till-bill-pay-dialog: confirming cash", () => {
  async function toConfirm(el: TillBillPayDialog, preview: AllocationPreview) {
    await pick(el, "line", "1");
    await type(el, "tendered", "50");
    return previewed(el, preview);
  }

  it("shows what the bill takes, the cash handed over and the change before the payment is taken", async () => {
    const el = await mount();
    await toConfirm(el, cashPreview("35.00", "15.00"));

    expect(text(root(el).querySelector("[data-pay-applied]"))).toContain(money("35.00"));
    expect(text(root(el).querySelector("[data-pay-tendered]"))).toContain(money("50.00"));
    expect(text(root(el).querySelector("[data-pay-change]"))).toContain(money("15.00"));
    expect(scope(el)).toContain("Paella");
  });

  it("asks again with all the change left as a tip", async () => {
    const el = await mount();
    const first = await toConfirm(el, cashPreview("35.00", "15.00"));
    const asked = capture<PayRequest>(el, "bill-pay-preview");

    await pick(el, "leaveTip", "all");

    expect(asked).toEqual([
      { ...first, pay: { method: "cash", tendered: "50", addedTip: "15.00" } },
    ]);
  });

  it("asks again with part of the change left as a tip, then gives it all back as change", async () => {
    const el = await mount();
    const first = await toConfirm(el, cashPreview("35.00", "15.00"));
    const asked = capture<PayRequest>(el, "bill-pay-preview");

    await pick(el, "leaveTip", "part");
    await type(el, "tipAmount", "5");
    await click(el, "[data-pay-confirm]");
    el.asked = asked[0]!;
    el.preview = cashPreview("35.00", "10.00", "5.00");
    await el.updateComplete;
    await pick(el, "leaveTip", "none");

    expect(asked).toEqual([
      { ...first, pay: { method: "cash", tendered: "50", addedTip: "5" } },
      first,
    ]);
    expect(text(root(el).querySelector("[data-pay-tip]"))).toContain(money("5.00"));
  });

  it("refuses a tip larger than the change beside the tip, and holds the payment until it is fixed", async () => {
    const el = await mount();
    await toConfirm(el, cashPreview("35.00", "15.00"));
    const confirmed = capture(el, "bill-pay-confirm");

    await pick(el, "leaveTip", "part");
    await type(el, "tipAmount", "20");
    await click(el, "[data-pay-confirm]");

    expect(field(el, "tipAmount")!.error).toBe(
      t("bill_pay.tip_amount_invalid").replace("{amount}", money("15.00")),
    );
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(button(el, "[data-pay-confirm]").disabled).toBe(true);
    expect(confirmed).toEqual([]);
    await type(el, "tipAmount", "15");
    expect(button(el, "[data-pay-confirm]").disabled).toBe(false);
  });

  it("takes the payment it showed", async () => {
    const el = await mount();
    await toConfirm(el, cashPreview("35.00", "15.00"));
    const confirmed = capture(el, "bill-pay-confirm");

    await click(el, "[data-pay-confirm]");

    expect(confirmed).toHaveLength(1);
  });

  it("goes back to the form with what was entered", async () => {
    const el = await mount();
    await toConfirm(el, cashPreview("35.00", "15.00"));
    const edits = capture(el, "bill-pay-edit");

    await click(el, "[data-pay-back]");
    el.preview = null;
    await el.updateComplete;

    expect(edits).toHaveLength(1);
    expect(field(el, "tendered")!.value).toBe("50");
  });
});

describe("till-bill-pay-dialog: confirming a card", () => {
  it("shows what the bill takes, the tip and what the card is charged before it is taken", async () => {
    const el = await mount({ way: "contribution" });
    await type(el, "amount", "40");
    await pick(el, "method", "card");
    await type(el, "cardTip", "10");
    await previewed(el, {
      kind: "allocated",
      choice: null,
      applied: "40.00",
      tip: "10.00",
      change: null,
      charged: "50.00",
    });

    expect(text(root(el).querySelector("[data-pay-applied]"))).toContain(money("40.00"));
    expect(text(root(el).querySelector("[data-pay-tip]"))).toContain(money("10.00"));
    expect(text(root(el).querySelector("[data-pay-charged]"))).toContain(money("50.00"));
    expect(root(el).querySelector("[data-pay-change]")).toBeNull();
    expect(root(el).querySelector('input[name="leaveTip"]')).toBeNull();
  });
});

describe("till-bill-pay-dialog: moving between steps", () => {
  it("takes a card straight away after going back from cash with part of the change marked as a tip", async () => {
    const el = await mount({ way: "contribution" });
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await previewed(el, cashPreview("40.00", "10.00"));
    await pick(el, "leaveTip", "part");
    await click(el, "[data-pay-back]");
    el.asked = null;
    el.preview = null;
    await el.updateComplete;
    await pick(el, "method", "card");
    await type(el, "cardTip", "5");
    await previewed(el, {
      kind: "allocated",
      choice: null,
      applied: "40.00",
      tip: "5.00",
      change: null,
      charged: "45.00",
    });
    const confirmed = capture(el, "bill-pay-confirm");

    await click(el, "[data-pay-confirm]");

    expect(confirmed).toHaveLength(1);
  });

  it("takes the payment when the tip typed is the tip already shown", async () => {
    const el = await mount({ way: "contribution" });
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    const first = await previewed(el, cashPreview("40.00", "10.00"));
    await pick(el, "leaveTip", "part");
    await type(el, "tipAmount", "4");
    el.asked = { ...first, pay: { method: "cash", tendered: "50", addedTip: "4" } };
    el.preview = cashPreview("40.00", "6.00", "4.00");
    await el.updateComplete;
    const asked = capture(el, "bill-pay-preview");
    const confirmed = capture(el, "bill-pay-confirm");

    await click(el, "[data-pay-confirm]");

    expect(asked).toEqual([]);
    expect(confirmed).toHaveLength(1);
  });

  it("drops an item it was paying for when it is unticked, and steps its units back up", async () => {
    const el = await mount();
    await pick(el, "line", "1");
    await pick(el, "line", "2");
    await click(el, '[data-units-less="2"]');
    await click(el, '[data-units-more="2"]');
    await pick(el, "line", "1");

    expect(scope(el)).toBe(
      t("bill_pay.scope_items").replace("{items}", "Beer ×3").replace("{amount}", money("9.00")),
    );
  });

  it("goes back to cash after choosing a card", async () => {
    const el = await mount({ way: "contribution" });
    await pick(el, "method", "card");
    await pick(el, "method", "cash");
    expect(field(el, "tendered")).not.toBeNull();
    expect(field(el, "cardTip")).toBeNull();
  });

  it("asks from the keyboard: Enter in a field presses Continue", async () => {
    const el = await mount({ way: "contribution" });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await type(el, "amount", "10");
    await type(el, "tendered", "10");
    field(el, "tendered")!
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await el.updateComplete;

    expect(asked).toHaveLength(1);
  });

  it("closes when the dialog is dismissed", async () => {
    const el = await mount();
    const closed = capture(el, "bill-pay-close");
    root(el).querySelector("wt-dialog")!.dispatchEvent(new CustomEvent("wt-close"));
    expect(closed).toHaveLength(1);
  });
});

describe("till-bill-pay-dialog: refusals and answers", () => {
  it("shows a refusal that names no field above the action, which stays enabled", async () => {
    const el = await mount({ refusal: { code: "bill.nothing_outstanding" } });
    expect(actions(el).error).toBe(codeMessage("bill.nothing_outstanding"));
    expect(button(el, "[data-pay-continue]").disabled).toBe(false);
  });

  it("puts a refusal of the cash handed over under that field until it changes", async () => {
    const el = await mount({
      way: "contribution",
      refusal: { code: "management.request_invalid", field: "tendered" },
    });
    expect(field(el, "tendered")!.error).toBe(t("bill_pay.tendered_short"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(button(el, "[data-pay-continue]").disabled).toBe(false);

    await type(el, "tendered", "60");
    expect(field(el, "tendered")!.error).toBe("");
    expect(actions(el).error).toBe("");
  });

  it.each([
    ["amount", "contribution", "cash", "amount"],
    ["shareOf", "share", "cash", "people"],
    ["addedTip", "contribution", "card", "cardTip"],
  ] as const)(
    "puts a refusal of %s under its field in the refusal's own words",
    async (refused, way, method, name) => {
      const el = await mount({ way });
      if (method === "card") await pick(el, "method", "card");
      el.refusal = { code: "management.request_invalid", field: refused };
      await el.updateComplete;
      expect(field(el, name)!.error).toBe(codeMessage("management.request_invalid"));
    },
  );

  it.each([
    ["a field the form does not show", { field: "lines" }, "cash"],
    ["the cash handed over, on a card", { field: "tendered" }, "card"],
    ["a tip left from cash change", { field: "addedTip" }, "cash"],
  ] as const)("puts a refusal naming %s above the action", async (_case, named, method) => {
    const el = await mount({ way: "contribution" });
    if (method === "card") await pick(el, "method", "card");
    el.refusal = { code: "management.request_invalid", ...named };
    await el.updateComplete;
    expect(actions(el).error).toBe(codeMessage("management.request_invalid"));
  });

  it("says when the bill's payments could not be read again", async () => {
    const el = await mount({ refusal: { code: "unread" } });
    expect(actions(el).error).toBe(t("bill_pay.read_failed"));
  });

  it("says a payment that got no answer may have been taken", async () => {
    const el = await mount({ refusal: { code: "network" } });
    expect(actions(el).error).toBe(t("bill_pay.unconfirmed"));
  });

  it("says the operator may not take payments when refused the payment permission", async () => {
    const el = await mount({
      refusal: { code: "authorization.not_permitted", permission: "sale.take_payment" },
    });
    expect(actions(el).error).toBe(t("take_payment.not_permitted"));
  });

  it("says a refusal of any other permission in that code's own words", async () => {
    const el = await mount({
      refusal: { code: "authorization.not_permitted", permission: "sale.refund" },
    });
    expect(actions(el).error).toBe(codeMessage("authorization.not_permitted"));
  });

  it("reopens the confirmation with the new amounts when the bill changed, saying so", async () => {
    const el = await mount();
    await pick(el, "line", "1");
    await type(el, "tendered", "50");
    await previewed(el, cashPreview("35.00", "15.00"));

    el.preview = cashPreview("30.00", "20.00");
    el.refusal = { code: "bill.allocation_changed" };
    await el.updateComplete;

    expect(text(root(el).querySelector("[data-pay-applied]"))).toContain(money("30.00"));
    expect(text(root(el).querySelector("[data-pay-change]"))).toContain(money("20.00"));
    expect(actions(el).error).toBe(codeMessage("bill.allocation_changed"));
    expect(button(el, "[data-pay-confirm]").disabled).toBe(false);
  });

  it("says to contribute instead when the chosen items cost more than is left", async () => {
    const el = await mount();
    await pick(el, "line", "1");
    await type(el, "tendered", "50");
    await previewed(el, {
      kind: "choose",
      options: [{ choice: "use_pool", applied: "20.00", tip: "0.00" }],
    });

    expect(root(el).querySelector("[data-pay-confirm]")).toBeNull();
    expect(text(root(el).querySelector("[data-pay-choose-note]"))).toBe(t("bill_pay.choose_later"));
    expect(root(el).querySelector("[data-pay-choose-note]")!.getAttribute("role")).toBeNull();
    expect(actions(el).error).toBe("");
  });

  it("says a payment was taken and the change to give, and starts the form again", async () => {
    const el = await mount({ way: "contribution" });
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    el.taken = { change: "10.00" };
    await el.updateComplete;

    expect(text(root(el).querySelector("[data-pay-taken]"))).toBe(
      t("bill_pay.taken_change").replace("{amount}", money("10.00")),
    );
    expect(field(el, "amount")!.value).toBe("");
    expect(field(el, "tendered")!.value).toBe("");
  });

  it("says a payment was taken with no change", async () => {
    const el = await mount();
    el.taken = { change: null };
    await el.updateComplete;
    expect(text(root(el).querySelector("[data-pay-taken]"))).toBe(t("bill_pay.taken"));
  });

  it("closes from its Close button", async () => {
    const el = await mount();
    const closed = capture(el, "bill-pay-close");
    await click(el, "[data-pay-close]");
    await expect.poll(() => closed).toHaveLength(1);
  });
});

// Design §3.3: after €105.00 contributed on a €120.00 bill, a €25.00 steak costs more than the
// €15.00 left, so the server offers two ways to pay for it.
describe("till-bill-pay-dialog: the steak's two choices", () => {
  const steak: PayLine = {
    lineNo: 4,
    name: "Steak",
    quantity: "1",
    total: "25.00",
    unitTotal: null,
  };
  const steakChoices: AllocationPreview = {
    kind: "choose",
    options: [
      { choice: "full_with_tip", applied: "15.00", tip: "10.00" },
      { choice: "use_pool", applied: "15.00", tip: "0.00" },
    ],
  };

  async function toChoices(over: Partial<TillBillPayDialog> = {}, preview = steakChoices) {
    const el = await mount({
      lines: [...lines, steak],
      balance: balanceOf({ received: "105.00", outstanding: "15.00" }),
      ...over,
    });
    await pick(el, "line", "4");
    await type(el, "tendered", "30");
    const first = await previewed(el, preview);
    return { el, first };
  }

  const choiceButtons = (el: TillBillPayDialog) =>
    [...root(el).querySelectorAll<HTMLElement>("[data-pay-choice]")].map((choice) => ({
      choice: choice.dataset.payChoice,
      label: text(choice),
    }));

  it("shows both choices as buttons with their amounts, and nothing to take until one is chosen", async () => {
    const { el } = await toChoices();

    expect(choiceButtons(el)).toEqual([
      {
        choice: "full_with_tip",
        label: t("bill_pay.choice_tip")
          .replace("{amount}", money("25.00"))
          .replace("{tip}", money("10.00")),
      },
      {
        choice: "use_pool",
        label: t("bill_pay.choice_pool")
          .replace("{amount}", money("15.00"))
          .replace("{pool}", money("10.00")),
      },
    ]);
    expect(root(el).querySelector("[data-pay-confirm]")).toBeNull();
    expect(scope(el)).toContain("Steak");
  });

  it("asks again naming the choice pressed: the full price with a tip", async () => {
    const { el, first } = await toChoices();
    const asked = capture<PayRequest>(el, "bill-pay-preview");

    await click(el, '[data-pay-choice="full_with_tip"]');

    expect(asked).toEqual([{ ...first, allocation: "full_with_tip" }]);
  });

  it("asks again naming the choice pressed: what is left, using the earlier contribution", async () => {
    const { el, first } = await toChoices();
    const asked = capture<PayRequest>(el, "bill-pay-preview");

    await click(el, '[data-pay-choice="use_pool"]');

    expect(asked).toEqual([{ ...first, allocation: "use_pool" }]);
  });

  it("goes back to the form from the choices", async () => {
    const { el } = await toChoices();
    const edits = capture(el, "bill-pay-edit");
    await click(el, "[data-pay-back]");
    expect(edits).toHaveLength(1);
  });

  it("leaves only the change as a tip on top of the choice's own tip", async () => {
    const { el, first } = await toChoices();
    const chosen = { ...first, allocation: "full_with_tip" as const };
    el.asked = chosen;
    el.preview = {
      kind: "allocated",
      choice: "full_with_tip",
      applied: "15.00",
      tip: "10.00",
      change: "5.00",
      charged: null,
    };
    await el.updateComplete;
    const asked = capture<PayRequest>(el, "bill-pay-preview");

    await pick(el, "leaveTip", "all");
    el.asked = asked[0]!;
    el.preview = {
      kind: "allocated",
      choice: "full_with_tip",
      applied: "15.00",
      tip: "15.00",
      change: "0.00",
      charged: null,
    };
    await el.updateComplete;
    await pick(el, "leaveTip", "part");
    await type(el, "tipAmount", "12");
    await click(el, "[data-pay-confirm]");

    expect(asked).toEqual([
      { ...chosen, pay: { method: "cash", tendered: "30", addedTip: "5.00" } },
      { ...chosen, pay: { method: "cash", tendered: "30", addedTip: "2.00" } },
    ]);
  });

  it("refuses a tip below the choice's own tip beside the tip", async () => {
    const { el, first } = await toChoices();
    el.asked = { ...first, allocation: "full_with_tip" };
    el.preview = {
      kind: "allocated",
      choice: "full_with_tip",
      applied: "15.00",
      tip: "10.00",
      change: "5.00",
      charged: null,
    };
    await el.updateComplete;

    await pick(el, "leaveTip", "part");
    await type(el, "tipAmount", "8");
    await click(el, "[data-pay-confirm]");

    expect(field(el, "tipAmount")!.error).toBe(
      t("bill_pay.tip_amount_between")
        .replace("{min}", money("10.00"))
        .replace("{amount}", money("15.00")),
    );
  });

  it("shows the choices again with the refusal when the bill changed under them", async () => {
    const { el } = await toChoices();
    el.refusal = { code: "bill.allocation_changed" };
    await el.updateComplete;

    expect(choiceButtons(el)).toHaveLength(2);
    expect(actions(el).error).toBe(codeMessage("bill.allocation_changed"));
    expect(text(root(el).querySelector("[data-pay-choose-note]"))).toBe(t("bill_pay.choose_later"));
  });
});

describe("till-bill-pay-dialog: a venue that takes no tips", () => {
  it("offers only the choice that uses the earlier contribution", async () => {
    const el = await mount({ tipsEnabled: false });
    await pick(el, "line", "1");
    await type(el, "tendered", "50");
    await previewed(el, {
      kind: "choose",
      options: [
        { choice: "full_with_tip", applied: "15.00", tip: "20.00" },
        { choice: "use_pool", applied: "15.00", tip: "0.00" },
      ],
    });

    expect(
      [...root(el).querySelectorAll<HTMLElement>("[data-pay-choice]")].map(
        (choice) => choice.dataset.payChoice,
      ),
    ).toEqual(["use_pool"]);
  });

  it("says a card is in progress when the only choice left would be a tip", async () => {
    const el = await mount({ tipsEnabled: false });
    await pick(el, "line", "1");
    await type(el, "tendered", "50");
    await previewed(el, {
      kind: "choose",
      options: [{ choice: "full_with_tip", applied: "15.00", tip: "20.00" }],
    });

    expect(root(el).querySelector("[data-pay-choice]")).toBeNull();
    expect(actions(el).error).toBe(codeMessage("order.payment_in_flight"));
  });

  it("asks for no tip on a card", async () => {
    const el = await mount({ way: "contribution", tipsEnabled: false });
    await type(el, "amount", "40");
    await pick(el, "method", "card");

    expect(field(el, "cardTip")).toBeNull();
  });

  it("offers no tip from cash change", async () => {
    const el = await mount({ tipsEnabled: false });
    await pick(el, "line", "1");
    await type(el, "tendered", "50");
    await previewed(el, cashPreview("35.00", "15.00"));

    expect(text(root(el).querySelector("[data-pay-change]"))).toContain(money("15.00"));
    expect(root(el).querySelector("[data-leave-tip]")).toBeNull();
  });

  it("confirms a card by what the bill takes and what the card is charged, with no tip", async () => {
    const el = await mount({ way: "contribution", tipsEnabled: false });
    await type(el, "amount", "30");
    await pick(el, "method", "card");
    await previewed(el, {
      kind: "allocated",
      choice: null,
      applied: "30.00",
      tip: "0.00",
      change: null,
      charged: "30.00",
    });

    expect(text(root(el).querySelector("[data-pay-applied]"))).toContain(money("30.00"));
    expect(text(root(el).querySelector("[data-pay-charged]"))).toContain(money("30.00"));
    expect(root(el).querySelector("[data-pay-tip]")).toBeNull();
  });

  it("puts the most a card can be charged under the amount of a contribution that is too large", async () => {
    const el = await mount({ way: "contribution", tipsEnabled: false });
    await type(el, "amount", "50");
    await pick(el, "method", "card");
    el.refusal = { code: "bill.tip_not_allowed", chargeable: "30.00" };
    await el.updateComplete;

    expect(field(el, "amount")!.error).toBe(
      t("bill_pay.chargeable").replace("{amount}", money("30.00")),
    );
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(button(el, "[data-pay-continue]").disabled).toBe(false);
    await type(el, "amount", "30");
    expect(field(el, "amount")!.error).toBe("");
  });

  it("says the most a card can be charged above the action when no amount was typed", async () => {
    const el = await mount({ way: "share", tipsEnabled: false });
    await pick(el, "method", "card");
    el.refusal = { code: "bill.tip_not_allowed", chargeable: "30.00" };
    await el.updateComplete;

    expect(actions(el).error).toBe(t("bill_pay.chargeable").replace("{amount}", money("30.00")));
  });
});

describe("till-bill-pay-dialog: a card on the reader", () => {
  const readers = [
    { id: "r-1", name: "Bar reader", provider: "stripe_terminal" as const },
    { id: "r-2", name: "Terrace reader", provider: "stripe_terminal" as const },
  ];

  async function card(over: Partial<TillBillPayDialog>) {
    const el = await mount({ way: "contribution", ...over });
    await type(el, "amount", "40");
    await pick(el, "method", "card");
    return el;
  }

  it("sends a card to the device's own reader, with its tip and no operation number", async () => {
    const el = await card({ cardReader: "stripe_terminal", readers: [readers[0]!] });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await type(el, "cardTip", "4");

    expect(field(el, "externalRef")).toBeNull();
    expect(root(el).querySelector('input[name="reader"]')).toBeNull();
    await click(el, "[data-pay-continue]");
    expect(asked).toEqual([
      {
        choice: { kind: "contribution", amount: "40" },
        pay: { method: "card", addedTip: "4" },
        card: { entry: "reader" },
      },
    ]);
  });

  it("offers the venue's readers, showing the device's own, and sends the one picked", async () => {
    const el = await card({ cardReader: "stripe_terminal", readers, defaultReaderId: "r-1" });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    const reader = (id: string) =>
      root(el).querySelector<HTMLInputElement>(`input[name="reader"][value="${id}"]`)!;

    expect(reader("r-1").checked).toBe(true);
    expect(text(reader("r-2").closest("label"))).toBe("Terrace reader");
    await pick(el, "reader", "r-2");
    await click(el, "[data-pay-continue]");

    expect(asked[0]!.card).toEqual({ entry: "reader", readerId: "r-2" });
  });

  it("asks the practice simulator for the result chosen", async () => {
    const el = await card({ cardReader: "simulator", readers });
    const asked = capture<PayRequest>(el, "bill-pay-preview");

    expect(root(el).querySelector('input[name="reader"]')).toBeNull();
    await pick(el, "simulation", "declined");
    await click(el, "[data-pay-continue]");

    expect(asked[0]!.card).toEqual({ entry: "reader", simulationOutcome: "declined" });
  });

  it("sends a bill payment to the pretend reader without a browser-chosen result", async () => {
    const readerId = "00000000-0000-4000-8000-000000000247";
    const el = await card({
      cardReader: "simulator",
      readers: [{ id: readerId, name: "Demo card reader", provider: "simulator" }],
    });
    const asked = capture<PayRequest>(el, "bill-pay-preview");

    await pick(el, "reader", readerId);
    expect(root(el).querySelector('input[name="simulation"]')).toBeNull();
    await click(el, "[data-pay-continue]");

    expect(asked[0]!.card).toEqual({ entry: "reader", readerId });
  });

  it("names the pretend reader in Spanish on a bill", async () => {
    setLocale("es-ES");
    const el = await card({
      cardReader: "simulator",
      readers: [{ id: "demo", name: "Demo card reader", provider: "simulator" }],
    });
    expect(
      text(root(el).querySelector('input[name="reader"][value="demo"]')?.closest("label") ?? null),
    ).toBe("Lector de demostración");
  });

  it("says to present the card while the reader is being asked", async () => {
    const el = await card({ cardReader: "stripe_terminal" });
    await previewed(el, {
      kind: "allocated",
      choice: null,
      applied: "40.00",
      tip: "0.00",
      change: null,
      charged: "40.00",
    });
    expect(root(el).querySelector("[data-pay-collecting]")).toBeNull();

    el.busy = true;
    await el.updateComplete;

    expect(text(root(el).querySelector("[data-pay-collecting]"))).toBe(t("card.collecting"));
  });

  it("says a declined card took nothing, above the action", async () => {
    const el = await mount({ refusal: { code: "declined" } });
    expect(actions(el).error).toBe(t("bill_pay.card_declined"));
  });

  it("says a reader that could not reach the card network took nothing", async () => {
    const el = await mount({ refusal: { code: "card_network" } });
    expect(actions(el).error).toBe(t("bill_pay.card_unreachable"));
  });

  it("says a card still in progress holds its amount on the bill until a manager clears it", async () => {
    const el = await mount({ taken: { change: null, pending: "40.00" } });
    expect(text(root(el).querySelector("[data-pay-taken]"))).toBe(
      t("bill_pay.card_pending").replace("{amount}", money("40.00")),
    );
  });
});

describe("till-bill-pay-dialog: the bill's payments", () => {
  function paymentOf(over: Partial<BillPaymentView> = {}): BillPaymentView {
    return {
      id: "pay-1",
      submissionId: "sub-1",
      kind: "contribution",
      shareOf: null,
      method: "cash",
      entry: null,
      applied: "50.00",
      tip: "0.00",
      tendered: "50.00",
      change: "0.00",
      state: "received",
      createdAt: "2026-09-30T20:00:00.000Z",
      receivedAt: "2026-09-30T20:00:00.000Z",
      lines: [],
      refunds: [],
      ...over,
    };
  }
  const refundOf = (appliedAmount: string, state: "pending" | "completed" | "failed") => ({
    id: `r-${state}`,
    paymentId: "pay-1",
    submissionId: `s-${state}`,
    appliedAmount,
    tipAmount: "0.00",
    reason: "Mal cobrado",
    state,
    createdAt: "2026-09-30T20:10:00.000Z",
    completedAt: null,
  });
  const cashPaid = paymentOf();
  const cardPaid = paymentOf({
    id: "pay-2",
    method: "card",
    applied: "30.00",
    tip: "5.00",
    tendered: null,
    change: null,
  });
  const cardAtReader = paymentOf({
    id: "pay-3",
    method: "card",
    applied: "20.00",
    tendered: null,
    change: null,
    state: "pending",
    receivedAt: null,
  });
  const declined = paymentOf({
    id: "pay-4",
    method: "card",
    applied: "20.00",
    tendered: null,
    change: null,
    state: "declined",
    receivedAt: null,
  });
  const rows = (el: TillBillPayDialog) => [...root(el).querySelectorAll("[data-payment]")];
  const row = (el: TillBillPayDialog, id: string) =>
    root(el).querySelector<HTMLElement>(`[data-payment="${id}"]`)!;

  it("lists each payment with how it was paid, what it paid off, its tip and its state", async () => {
    const el = await mount({
      balance: balanceOf({ payments: [cashPaid, cardPaid, cardAtReader, declined] }),
    });

    expect(text(root(el).querySelector("[data-pay-payments] h3"))).toBe(t("bill_pay.payments"));
    expect(rows(el).map((each) => each.getAttribute("data-payment"))).toEqual([
      "pay-1",
      "pay-2",
      "pay-3",
      "pay-4",
    ]);
    const second = text(row(el, "pay-2"));
    expect(second).toContain(
      t("bill_pay.payment").replace("{n}", "2").replace("{method}", t("tender.card")),
    );
    expect(second).toContain(`${t("bill_pay.applied")} ${money("30.00")}`);
    expect(second).toContain(`${t("bill_pay.tip")} ${money("5.00")}`);
    expect(second).toContain(t("bill_pay.state_received"));
    expect(text(row(el, "pay-1"))).toContain(t("tender.cash"));
    expect(text(row(el, "pay-4"))).toContain(t("bill_pay.state_declined"));
  });

  it("shows a card still at the reader as in progress, and where a manager clears it", async () => {
    const el = await mount({ balance: balanceOf({ payments: [cardAtReader] }) });

    expect(text(row(el, "pay-3"))).toContain(t("bill_pay.state_pending"));
    expect(text(row(el, "pay-3").querySelector("[data-payment-pending]"))).toBe(
      t("bill_pay.pending_where"),
    );
    expect(row(el, "pay-3").querySelector("[data-payment-refund]")).toBeNull();
  });

  it("shows each refund of a payment: given back, waiting for the card provider, or failed", async () => {
    const el = await mount({
      balance: balanceOf({
        payments: [
          paymentOf({
            refunds: [
              refundOf("10.00", "completed"),
              refundOf("5.00", "failed"),
              refundOf("5.00", "pending"),
            ],
          }),
        ],
      }),
    });

    expect(
      [...row(el, "pay-1").querySelectorAll("[data-payment-refunded]")].map((each) => text(each)),
    ).toEqual([
      t("bill_pay.refunded").replace("{amount}", money("10.00")),
      t("bill_pay.refund_failed_row").replace("{amount}", money("5.00")),
      t("bill_pay.refund_waiting").replace("{amount}", money("5.00")),
    ]);
  });

  it("offers Refund on each received payment with money left to give back, and says which it is", async () => {
    const el = await mount({
      balance: balanceOf({
        payments: [
          cashPaid,
          cardPaid,
          cardAtReader,
          declined,
          paymentOf({ id: "pay-5", refunds: [refundOf("50.00", "completed")] }),
        ],
      }),
    });
    const offeredOn = [...root(el).querySelectorAll("[data-payment-refund]")].map((each) =>
      each.getAttribute("data-payment-refund"),
    );
    const asked = capture<{ paymentId: string }>(el, "bill-refund");

    await click(el, '[data-payment-refund="pay-2"]');

    expect(offeredOn).toEqual(["pay-1", "pay-2"]);
    expect(text(button(el, '[data-payment-refund="pay-2"]'))).toBe(t("bill_pay.refund"));
    expect(button(el, '[data-payment-refund="pay-2"]').getAttribute("aria-label")).toBe(
      t("bill_pay.refund_label").replace("{n}", "2").replace("{amount}", money("35.00")),
    );
    expect(asked).toEqual([{ paymentId: "pay-2" }]);
  });

  it("offers no refund once the bill is no longer open, nor while the dialog is busy", async () => {
    const closed = await mount({ balance: balanceOf({ status: "settled", payments: [cashPaid] }) });
    expect(root(closed).querySelector("[data-payment-refund]")).toBeNull();

    const busy = await mount({ busy: true, balance: balanceOf({ payments: [cashPaid] }) });
    expect(button(busy, '[data-payment-refund="pay-1"]').disabled).toBe(true);
  });

  it("lists nothing on a bill with no payments", async () => {
    const el = await mount();
    expect(root(el).querySelector("[data-pay-payments]")).toBeNull();
  });

  it("says what a refund did: cash to hand over, a card, a terminal refund recorded, one waiting, one failed", async () => {
    const el = await mount({ balance: balanceOf({ payments: [cashPaid] }) });
    const said = async (refunded: TillBillPayDialog["refunded"]) => {
      el.refunded = refunded;
      await el.updateComplete;
      return text(root(el).querySelector("[data-pay-refunded]"));
    };
    const with20 = (key: Parameters<typeof t>[0]) => t(key).replace("{amount}", money("20.00"));

    expect(
      await said({ state: "completed", amount: "20.00", method: "cash", terminal: false }),
    ).toBe(with20("bill_refund.done_cash"));
    expect(
      await said({ state: "completed", amount: "20.00", method: "card", terminal: false }),
    ).toBe(with20("bill_refund.done_card"));
    expect(
      await said({ state: "completed", amount: "20.00", method: "card", terminal: true }),
    ).toBe(with20("bill_refund.done_terminal"));
    expect(await said({ state: "pending", amount: "20.00", method: "card", terminal: false })).toBe(
      with20("bill_refund.pending"),
    );
    expect(await said({ state: "failed", amount: "20.00", method: "card", terminal: false })).toBe(
      with20("bill_refund.failed"),
    );
    expect(await said(null)).toBe("");
  });
});

for (const locale of ["en", "es"]) {
  it(`decimal input amount follows ${locale}`, async () => {
    setLocale(locale);
    const el = await mount({ way: "contribution" });

    const control = field(el, "amount")! as HTMLElement & { updateComplete: Promise<unknown> };
    await control.updateComplete;
    const native = control.shadowRoot!.querySelector("input")!;
    for (const separator of [".", ","]) {
      await type(el, "amount", `2${separator}80`);
      await control.updateComplete;
      expect(native.value).toBe(locale === "es" ? "2,80" : "2.80");
    }
  });
}
